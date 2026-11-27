// Connects the referee to React state: starts/pauses/stops games, routes human
// board moves to the Human agent, collects every event for the log download, and
// saves the game in the browser after every event so it can be resumed later.

import { useCallback, useRef, useState } from "react";
import { getAgent, harnessConfigFor } from "../agents/registry";
import { legalSan } from "../agents/chessUtil";
import type { AgentDeps, Color, GameView, LogEntry, StreamDelta } from "../agents/types";
import type { HarnessConfig } from "../harness/config";
import { harnessDefinition } from "../harness/runner";
import { GameRunner, type GameEvent, type GameResult } from "../game/referee";
import { clearCurrentGame, saveCurrentGame } from "../game/gameStore";
import { isUnfinished, latestNotes, replay, type SavedGame, type SideConfig } from "../game/savedGame";
import { OpenRouterClient } from "../llm/openrouter";

export type { SideConfig } from "../game/savedGame";

export type PanelEntry = LogEntry | { kind: "illegal"; text: string } | { kind: "turn"; text: string };

export interface GameState {
  status: "setup" | "running" | "paused" | "over";
  fen: string;
  history: string[];
  logs: Record<Color, PanelEntry[]>;
  thinking: { color: Color; since: number } | null;
  humanToMove: Color | null;
  pauseError: string | null;
  result: GameResult | null;
  reason: string | null;
  sides: Record<Color, SideConfig> | null;
  /** Snapshot taken when the game starts, so later edits or deletes can't change a running game. */
  labels: Record<Color, string> | null;
  harnesses: Record<Color, HarnessConfig | null> | null;
}

export interface LiveOutput {
  reasoning: string;
  text: string;
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const initialState: GameState = {
  status: "setup",
  fen: START_FEN,
  history: [],
  logs: { w: [], b: [] },
  thinking: null,
  humanToMove: null,
  pauseError: null,
  result: null,
  reason: null,
  sides: null,
  labels: null,
  harnesses: null,
};

/** "Harnessed · some/model (high)", or the agent's name for Human. Pass `harness` to label a saved game. */
export function sideLabel(side: SideConfig, harness?: HarnessConfig | null): string {
  let name: string;
  if (harness) {
    name = harness.name;
  } else {
    let def;
    try {
      def = getAgent(side.agentId);
    } catch {
      return side.agentId;
    }
    if (!def.needsModel) return def.label;
    name = def.label;
  }
  return `${name.replace(/ \(.*\)$/, "")} · ${side.model}${side.effort ? ` (${side.effort})` : ""}`;
}

/** The React state for a saved game, rebuilt by replaying its recorded events. */
function restoreState(game: SavedGame, status: GameState["status"]): GameState {
  let s: GameState = { ...initialState, sides: game.sides, labels: game.labels, harnesses: game.harnesses };
  for (const { event } of game.events) s = reduce(s, event);
  const replayed = replay(game.history);
  return {
    ...s,
    status,
    fen: replayed.ok ? replayed.chess.fen() : START_FEN,
    history: game.history,
    thinking: null,
    humanToMove: null,
    pauseError: null,
    result: status === "over" ? game.result : null,
    reason: status === "over" ? game.reason : null,
  };
}

const ADJUDICATED = "adjudicated by the person watching";

export function useGame(getKey: () => string) {
  const [state, setState] = useState<GameState>(initialState);
  const runnerRef = useRef<GameRunner | null>(null);
  const humanRef = useRef<{ resolve: (m: string) => void; game: GameView } | null>(null);
  const eventsRef = useRef<{ t: number; event: GameEvent }[]>([]);
  // The game being played, as it will be saved: everything except events lives here.
  const gameRef = useRef<Omit<SavedGame, "events" | "savedAt"> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Streamed model output, buffered and flushed to React at most once per animation frame.
  const [live, setLive] = useState<Record<Color, LiveOutput | null>>({ w: null, b: null });
  const liveBuf = useRef<Record<Color, LiveOutput | null>>({ w: null, b: null });
  const liveFrame = useRef<number | null>(null);
  const flushLive = useCallback((now = false) => {
    const flush = () => {
      liveFrame.current = null;
      setLive({ w: liveBuf.current.w && { ...liveBuf.current.w }, b: liveBuf.current.b && { ...liveBuf.current.b } });
    };
    if (now) {
      if (liveFrame.current !== null) cancelAnimationFrame(liveFrame.current);
      flush();
    } else if (liveFrame.current === null) {
      liveFrame.current = requestAnimationFrame(flush);
    }
  }, []);
  const clearLive = useCallback(
    (color?: Color) => {
      if (color) liveBuf.current[color] = null;
      else liveBuf.current = { w: null, b: null };
      flushLive(true);
    },
    [flushLive],
  );
  // One client for the whole session, so the free-model rate limiter spans both sides and every game.
  const llmRef = useRef<OpenRouterClient | null>(null);
  const [rateWait, setRateWait] = useState<{ model: string; since: number; until: number; reason: string } | null>(null);
  // When the current rate-limit wait began; waits don't count toward the side's thinking time.
  const waitStart = useRef<number | null>(null);
  llmRef.current ??= new OpenRouterClient(getKey, undefined, {
    onWait: (w) => {
      const now = Date.now();
      if (w) {
        waitStart.current ??= now;
        setRateWait({ model: w.model, since: waitStart.current, until: now + w.waitMs, reason: w.reason });
        return;
      }
      const began = waitStart.current;
      waitStart.current = null;
      setRateWait(null);
      if (began !== null) {
        const waited = now - began;
        setState((s) => (s.thinking ? { ...s, thinking: { ...s.thinking, since: s.thinking.since + waited } } : s));
      }
    },
  });

  const snapshot = useCallback((): SavedGame | null => {
    const g = gameRef.current;
    return g && { ...g, savedAt: Date.now(), events: eventsRef.current };
  }, []);

  const save = useCallback(
    (now = false) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const write = () => {
        saveTimer.current = null;
        const g = snapshot();
        if (g) void saveCurrentGame(g);
      };
      if (now) write();
      else saveTimer.current = setTimeout(write, 500);
    },
    [snapshot],
  );

  /** Runs a game from its saved form: a fresh one (no moves) or one being resumed. */
  const launch = useCallback(
    (game: SavedGame, paused: boolean) => {
      const deps: AgentDeps = {
        llm: llmRef.current!,
        waitForHumanMove: (view) =>
          new Promise<string>((resolve, reject) => {
            humanRef.current = { resolve, game: view };
            setState((s) => ({ ...s, humanToMove: view.myColor }));
            view.signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      };
      // Agents are built from the harness snapshot, so a resumed game plays exactly as it began
      // even if the harness was edited or deleted since (or never existed in this browser).
      const make = (c: Color) => {
        const h = game.harnesses[c];
        const def = h ? harnessDefinition(h, game.sides[c].agentId) : getAgent(game.sides[c].agentId);
        return def.create({ model: game.sides[c].model.trim(), reasoningEffort: game.sides[c].effort || undefined }, deps);
      };
      const white = make("w");
      const black = make("b");

      const onStream = (color: Color, d: StreamDelta) => {
        if (runnerRef.current !== runner) return;
        if (d.start || !liveBuf.current[color]) liveBuf.current[color] = { reasoning: "", text: "" };
        const buf = liveBuf.current[color]!;
        if (d.reasoning) buf.reasoning += d.reasoning;
        if (d.content) buf.text += d.content;
        flushLive();
      };
      const runner: GameRunner = new GameRunner(
        { white, black, onStream, startHistory: game.history, startPaused: paused, startNotes: latestNotes(game.events) },
        (event) => {
          if (runnerRef.current !== runner) return; // event from a game that was replaced
          eventsRef.current.push({ t: Date.now(), event });
          const g = gameRef.current!;
          if (event.type === "move") g.history = event.history;
          if (event.type === "gameOver") {
            g.result = event.result;
            g.reason = event.reason;
          }
          if (event.type === "log" || event.type === "turnStart") clearLive(event.color);
          if (event.type === "paused" || event.type === "gameOver") clearLive();
          // A stopped game stays saved as it was, so it can still be resumed.
          if (!(event.type === "gameOver" && event.result === "*")) save(event.type === "gameOver" || event.type === "paused");
          setState((s) => reduce(s, event));
        },
      );

      runnerRef.current?.stop();
      humanRef.current = null;
      runnerRef.current = runner;
      eventsRef.current = [...game.events];
      gameRef.current = { ...game, result: null, reason: null };
      delete (gameRef.current as Partial<SavedGame>).events;
      clearLive();
      setState(restoreState(game, paused ? "paused" : "running"));
      save(true);
      void runner.start();
    },
    [clearLive, flushLive, save],
  );

  const start = useCallback(
    (sides: Record<Color, SideConfig>) => {
      const harnesses = { w: harnessConfigFor(sides.w.agentId), b: harnessConfigFor(sides.b.agentId) };
      const now = Date.now();
      launch(
        {
          version: 1,
          startedAt: now,
          savedAt: now,
          sides,
          labels: { w: sideLabel(sides.w, harnesses.w), b: sideLabel(sides.b, harnesses.b) },
          harnesses,
          history: [],
          result: null,
          reason: null,
          events: [],
        },
        false,
      );
    },
    [launch],
  );

  /**
   * Opens a saved game or downloaded log. An unfinished game opens paused (press Resume
   * to continue); a finished one opens for viewing and downloading only.
   * Throws if the game can't be set up (e.g. an unknown agent).
   */
  const load = useCallback(
    (game: SavedGame) => {
      if (isUnfinished(game)) {
        launch(game, true);
        return;
      }
      const r = runnerRef.current;
      runnerRef.current = null;
      r?.stop();
      humanRef.current = null;
      eventsRef.current = [...game.events];
      gameRef.current = { ...game };
      delete (gameRef.current as Partial<SavedGame>).events;
      clearLive();
      setState(restoreState(game, "over"));
    },
    [launch, clearLive],
  );

  const adjudicate = useCallback((result: Exclude<GameResult, "*">) => runnerRef.current?.adjudicate(result, ADJUDICATED), []);

  const pause = useCallback(() => runnerRef.current?.pause(), []);
  const resume = useCallback(() => runnerRef.current?.resume(), []);
  const reset = useCallback(() => {
    const r = runnerRef.current;
    runnerRef.current = null;
    r?.stop();
    humanRef.current = null;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    gameRef.current = null;
    void clearCurrentGame();
    clearLive();
    setState(initialState);
  }, [clearLive]);

  /** Called by the board on a drop. Returns false (snap back) unless it's a legal human move. */
  const humanMove = useCallback((from: string, to: string, isPawn: boolean): boolean => {
    const pending = humanRef.current;
    if (!pending) return false;
    const promo = isPawn && (to[1] === "8" || to[1] === "1") ? "q" : "";
    const uci = `${from}${to}${promo}`;
    if (!legalSan(pending.game.fen, uci)) return false;
    humanRef.current = null;
    setState((s) => ({ ...s, humanToMove: null }));
    pending.resolve(uci);
    return true;
  }, []);

  /** The game in its saved form: also the downloadable log, which can be loaded to resume. */
  const exportGame = snapshot;

  // A wait only matters while the game is running.
  const visibleWait = state.status === "running" ? rateWait : null;
  return { state, live, rateWait: visibleWait, start, load, adjudicate, pause, resume, reset, humanMove, exportGame };
}

function reduce(s: GameState, e: GameEvent): GameState {
  switch (e.type) {
    case "turnStart":
      return { ...s, thinking: { color: e.color, since: Date.now() }, pauseError: null };
    case "log":
      return { ...s, logs: { ...s.logs, [e.color]: [...s.logs[e.color], ...e.entries] } };
    case "illegalAttempt":
      return {
        ...s,
        logs: { ...s.logs, [e.color]: [...s.logs[e.color], { kind: "illegal", text: `Referee rejected ${e.move || "(empty)"}: ${e.error}` }] },
      };
    case "move": {
      const ply = e.history.length;
      const label = `${Math.ceil(ply / 2)}${e.color === "w" ? "." : "..."} ${e.san}`;
      return {
        ...s,
        fen: e.fen,
        history: e.history,
        thinking: null,
        humanToMove: null,
        logs: { ...s.logs, [e.color]: [...s.logs[e.color], { kind: "turn", text: `Played ${label}` }] },
      };
    }
    case "paused":
      return { ...s, status: "paused", thinking: null, humanToMove: null, pauseError: e.error ?? null };
    case "resumed":
      return { ...s, status: "running", pauseError: null };
    case "gameOver":
      return { ...s, status: "over", thinking: null, humanToMove: null, result: e.result, reason: e.reason };
  }
}
