// Connects the referee to React state: starts/pauses/stops games, routes human
// board moves to the Human agent, and collects every event for the log download.

import { useCallback, useRef, useState } from "react";
import { getAgent } from "../agents/registry";
import { legalSan } from "../agents/chessUtil";
import type { AgentDeps, Color, GameView, LogEntry, ReasoningEffort } from "../agents/types";
import { GameRunner, type GameEvent, type GameResult } from "../game/referee";
import { OpenRouterClient } from "../llm/openrouter";

export interface SideConfig {
  agentId: string;
  model: string;
  effort: ReasoningEffort | "";
}

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
};

export function sideLabel(side: SideConfig): string {
  const def = getAgent(side.agentId);
  if (!def.needsModel) return def.label;
  return `${def.label.replace(/ \(.*\)$/, "")} · ${side.model}${side.effort ? ` (${side.effort})` : ""}`;
}

export function useGame(getKey: () => string) {
  const [state, setState] = useState<GameState>(initialState);
  const runnerRef = useRef<GameRunner | null>(null);
  const humanRef = useRef<{ resolve: (m: string) => void; game: GameView } | null>(null);
  const eventsRef = useRef<{ t: number; event: GameEvent }[]>([]);

  const start = useCallback(
    (sides: Record<Color, SideConfig>) => {
      runnerRef.current?.stop();
      eventsRef.current = [];
      humanRef.current = null;

      const deps: AgentDeps = {
        llm: new OpenRouterClient(getKey),
        waitForHumanMove: (game) =>
          new Promise<string>((resolve, reject) => {
            humanRef.current = { resolve, game };
            setState((s) => ({ ...s, humanToMove: game.myColor }));
            game.signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      };
      const make = (c: Color) =>
        getAgent(sides[c].agentId).create(
          { model: sides[c].model.trim(), reasoningEffort: sides[c].effort || undefined },
          deps,
        );

      const runner: GameRunner = new GameRunner({ white: make("w"), black: make("b") }, (event) => {
        if (runnerRef.current !== runner) return; // event from a game that was replaced
        eventsRef.current.push({ t: Date.now(), event });
        setState((s) => reduce(s, event));
      });
      runnerRef.current = runner;
      setState({ ...initialState, status: "running", sides });
      void runner.start();
    },
    [getKey],
  );

  const pause = useCallback(() => runnerRef.current?.pause(), []);
  const resume = useCallback(() => runnerRef.current?.resume(), []);
  const reset = useCallback(() => {
    const r = runnerRef.current;
    runnerRef.current = null;
    r?.stop();
    humanRef.current = null;
    setState(initialState);
  }, []);

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

  const exportLog = useCallback(() => ({ sides: state.sides, result: state.result, reason: state.reason, history: state.history, events: eventsRef.current }), [state]);

  return { state, start, pause, resume, reset, humanMove, exportLog };
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
