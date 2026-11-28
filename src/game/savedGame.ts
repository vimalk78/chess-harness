// A game as it is saved in the browser and in the downloadable JSON log. The same format
// is read back to resume a game, so a downloaded log can be continued in any browser.
// Older logs (before this format had a version) load too: they have the same fields.

import { Chess } from "chess.js";
import type { Color, ReasoningEffort } from "../agents/types";
import { validateHarness, type HarnessConfig } from "../harness/config";
import type { GameEvent, GameResult } from "./referee";

export interface SideConfig {
  agentId: string;
  model: string;
  effort: ReasoningEffort | "";
}

export interface SavedGame {
  version: 1;
  /** When the game was first started (ms since epoch); also identifies it. */
  startedAt: number;
  savedAt: number;
  sides: Record<Color, SideConfig>;
  labels: Record<Color, string>;
  /** Full harness configs each side played with (null for Human), so a game resumes exactly as it began. */
  harnesses: Record<Color, HarnessConfig | null>;
  /** SAN moves played so far. */
  history: string[];
  result: GameResult | null;
  reason: string | null;
  /** Everything the referee reported, including every prompt, reply and reasoning text. */
  events: { t: number; event: GameEvent }[];
  /** The site's commit the game was started on (older logs don't have it). */
  arenaVersion?: string;
}

export type ParsedGame = { ok: true; game: SavedGame } | { ok: false; error: string };

const COLORS: Color[] = ["w", "b"];
const RESULTS = ["1-0", "0-1", "1/2-1/2", "*"];
const EVENT_TYPES = ["turnStart", "log", "illegalAttempt", "move", "paused", "resumed", "gameOver"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** True if the game can still be played on (no result yet). */
export function isUnfinished(g: Pick<SavedGame, "result">): boolean {
  return g.result === null || g.result === "*";
}

/** Each side's latest notes in a saved game's events (handed back to the referee on resume). */
export function latestNotes(events: SavedGame["events"]): Partial<Record<Color, string>> {
  const notes: Partial<Record<Color, string>> = {};
  for (const { event } of events) {
    if (event.type !== "log") continue;
    for (const e of event.entries) if (e.kind === "notes") notes[event.color] = e.text;
  }
  return notes;
}

/** Replays SAN moves; returns the error for the first illegal one. */
export function replay(history: string[]): { ok: true; chess: Chess } | { ok: false; error: string } {
  const chess = new Chess();
  for (let i = 0; i < history.length; i++) {
    try {
      chess.move(history[i]);
    } catch {
      return { ok: false, error: `move ${Math.floor(i / 2) + 1}${i % 2 ? "..." : "."} ${history[i]} is not legal` };
    }
  }
  return { ok: true, chess };
}

/**
 * Reads a saved game or downloaded log. `fallbackHarness` supplies a side's harness when
 * an older log didn't record it (looked up by agent id); it returns null for Human.
 */
export function parseSavedGame(
  data: unknown,
  fallbackHarness: (agentId: string) => HarnessConfig | null,
  labelFor: (side: SideConfig, harness: HarnessConfig | null) => string,
): ParsedGame {
  if (!isObj(data)) return { ok: false, error: "not a game log (expected a JSON object)" };
  if (data.format === "chess-agent-arena-result") {
    return {
      ok: false,
      error:
        "this is a result file (the one for GitHub's results/ folder), not a game log. It's ready to upload as it is. To open the game, load the chess-agent-arena-….json from Download log (JSON), or a PGN",
    };
  }
  if (!Array.isArray(data.history) || !data.history.every((m) => typeof m === "string")) {
    return { ok: false, error: "no move list (history) found" };
  }
  const history = data.history as string[];
  const replayed = replay(history);
  if (!replayed.ok) return { ok: false, error: `the move list is broken: ${replayed.error}` };

  if (!isObj(data.sides)) return { ok: false, error: "missing side settings (sides)" };
  const sides = {} as Record<Color, SideConfig>;
  const harnesses = {} as Record<Color, HarnessConfig | null>;
  const labels = {} as Record<Color, string>;
  for (const c of COLORS) {
    const s = (data.sides as Record<string, unknown>)[c];
    if (!isObj(s) || typeof s.agentId !== "string") return { ok: false, error: `missing settings for ${c === "w" ? "White" : "Black"}` };
    const effort = s.effort === "low" || s.effort === "medium" || s.effort === "high" ? s.effort : "";
    sides[c] = { agentId: s.agentId, model: typeof s.model === "string" ? s.model : "", effort };

    const savedHarness = isObj(data.harnesses) ? (data.harnesses as Record<string, unknown>)[c] : undefined;
    if (savedHarness) {
      const v = validateHarness(savedHarness);
      if (!v.ok) return { ok: false, error: `${c === "w" ? "White" : "Black"}'s harness is invalid: ${v.error}` };
      harnesses[c] = v.config;
    } else {
      harnesses[c] = fallbackHarness(s.agentId);
    }
    const savedLabel = isObj(data.labels) ? (data.labels as Record<string, unknown>)[c] : undefined;
    labels[c] = typeof savedLabel === "string" ? savedLabel : labelFor(sides[c], harnesses[c]);
  }

  const result = typeof data.result === "string" && RESULTS.includes(data.result) ? (data.result as GameResult) : null;
  const events = Array.isArray(data.events)
    ? (data.events as unknown[]).filter(
        (e): e is SavedGame["events"][number] =>
          isObj(e) && typeof e.t === "number" && isObj(e.event) && EVENT_TYPES.includes(e.event.type as string),
      )
    : [];

  return {
    ok: true,
    game: {
      version: 1,
      startedAt: typeof data.startedAt === "number" ? data.startedAt : (events[0]?.t ?? Date.now()),
      savedAt: typeof data.savedAt === "number" ? data.savedAt : (events.at(-1)?.t ?? Date.now()),
      sides,
      labels,
      harnesses,
      history,
      result,
      reason: typeof data.reason === "string" ? data.reason : null,
      events,
      ...(typeof data.arenaVersion === "string" ? { arenaVersion: data.arenaVersion } : {}),
    },
  };
}

/** Moves from a PGN file (headers and comments are ignored). */
export function historyFromPgn(text: string): { ok: true; history: string[] } | { ok: false; error: string } {
  const chess = new Chess();
  try {
    chess.loadPgn(text);
  } catch (e) {
    return { ok: false, error: `couldn't read the PGN (${e instanceof Error ? e.message : String(e)})` };
  }
  return { ok: true, history: chess.history() };
}

const slugPart = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

/** "planner-notes-particle-1", "stockfish-1320", "human". */
function playerSlug(g: Pick<SavedGame, "sides" | "harnesses">, c: Color): string {
  const { agentId, model } = g.sides[c];
  const harness = g.harnesses[c];
  if (!harness) return slugPart(agentId) || "player"; // Human, Stockfish
  const shortModel = model.split("/").pop()!.replace(/:free$/, "");
  return slugPart(`${harness.id}-${shortModel}`) || "player";
}

/**
 * Download name for a game's log or transcript, from when it started (local time) and who
 * played: "chess-agent-arena-2026-11-28-1336-planner-notes-particle-1-vs-stockfish-1320.json".
 * Downloading the same game twice gives the same name.
 */
export function gameFileName(g: Pick<SavedGame, "startedAt" | "sides" | "harnesses">, ext: "json" | "md"): string {
  const d = new Date(g.startedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `chess-agent-arena-${stamp}-${playerSlug(g, "w")}-vs-${playerSlug(g, "b")}.${ext}`;
}
