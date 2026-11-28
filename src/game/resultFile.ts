// A finished game submitted to the repo as results/<file>.json, by pull request.
// It holds what's needed to read and reproduce the game: the PGN, how it ended, and for
// each side the model, effort, harness and a few counts (tokens, re-asks, rejections).
// Prompts and reasoning are left out: they run to megabytes (the transcript has them).
//
// Results are self-reported: CI checks the file is consistent (legal moves, a result
// that matches the final position, known harnesses), not that the game really happened.

import { Chess } from "chess.js";
import { ENGINE_NAME, engineLevel } from "../agents/engine";
import type { Color, ReasoningEffort } from "../agents/types";
import { validateHarness, type HarnessConfig } from "../harness/config";
import { moveRecords, type MoveRecord } from "./moveRecords";
import type { GameReview, MoveReview, SideReview } from "./review";
import type { SavedGame } from "./savedGame";

export const RESULTS_DIR = "results";
export const RESULT_FORMAT = "chess-agent-arena-result";

export type Termination =
  | "checkmate"
  | "stalemate"
  | "threefold-repetition"
  | "insufficient-material"
  | "fifty-move-rule"
  | "move-limit"
  | "forfeit"
  | "adjudicated";

export interface SideStats {
  /** Model calls, including re-asks. */
  requests: number;
  promptTokens: number;
  completionTokens: number;
  costUsd?: number;
  /** Extra calls after a move failed the harness's pre-check. */
  reasks: number;
  /** Moves the referee rejected. */
  refereeRejections: number;
  /** Moves the harness picked at random after the model failed to give a legal one. */
  randomMoves: number;
  /** Replies with no text at all (often a model that ran out of tokens while thinking). */
  emptyReplies: number;
  /** Analysis board rounds used (each one is an extra call). Absent in results from before the analysis board. */
  analysisRounds?: number;
  /** Replies the app stopped because the model was looping or far too long (their tokens aren't counted). */
  stoppedReplies?: number;
}

export interface ResultSide {
  /** The player's name as shown in the game, e.g. "Attacker + notes · some/model (high)". */
  player: string;
  kind: "llm" | "human" | "engine";
  /** For kind "engine": the agent id ("stockfish:1600"), its name and strength (null: full). */
  engine?: { id: string; name: string; elo: number | null };
  model?: string;
  effort?: ReasoningEffort;
  harness?: {
    id: string;
    name: string;
    source: "preset" | "community" | "custom";
    /** Included when the harness isn't on the site as it was played (custom, or changed since). */
    config?: HarnessConfig;
  };
  stats?: SideStats;
}

export interface ResultFile {
  format: typeof RESULT_FORMAT;
  version: 1;
  /** When the game started and ended (ISO 8601). */
  startedAt: string;
  finishedAt: string;
  /** The site's commit the game was played on ("dev" for a local build). */
  arenaVersion: string;
  submittedBy?: string;
  comment?: string;
  result: "1-0" | "0-1" | "1/2-1/2";
  termination: Termination;
  /** The referee's own words, e.g. "Black forfeits: 3 illegal moves in one turn". */
  reason: string;
  /** Half-moves played. */
  plies: number;
  pgn: string;
  white: ResultSide;
  black: ResultSide;
  /** Every half-move: cost, problems, the visible reply and notes, and (when reviewed) the engine's verdict. */
  moves?: ResultMove[];
  /** Stockfish's review of the game, per side (the per-move part is in `moves`). */
  review?: { engine: string; depth: number; white: SideReview; black: SideReview };
}

export type ResultMove = MoveRecord & Partial<MoveReview>;

export function terminationOf(reason: string): Termination | null {
  const r = reason.toLowerCase();
  if (r === "checkmate") return "checkmate";
  if (r === "stalemate") return "stalemate";
  if (r === "threefold repetition") return "threefold-repetition";
  if (r === "insufficient material") return "insufficient-material";
  if (r === "50-move rule") return "fifty-move-rule";
  if (r.startsWith("move limit")) return "move-limit";
  if (r.includes("forfeits")) return "forfeit";
  if (r.startsWith("adjudicated")) return "adjudicated";
  return null;
}

/** Counts for one side from a saved game's events. */
export function sideStats(game: SavedGame, color: Color): SideStats {
  const s: SideStats & { analysisRounds: number } = { requests: 0, promptTokens: 0, completionTokens: 0, reasks: 0, refereeRejections: 0, randomMoves: 0, emptyReplies: 0, analysisRounds: 0 };
  let cost = 0;
  let hasCost = false;
  let moves = 0;
  for (const { event } of game.events) {
    if (event.type === "illegalAttempt" && event.color === color) s.refereeRejections++;
    if (event.type === "move" && event.color === color) moves++;
    if (event.type !== "log" || event.color !== color) continue;
    for (const e of event.entries) {
      if (e.kind === "response") {
        s.requests++;
        if (!e.text.trim()) s.emptyReplies++;
        if (e.stopped) s.stoppedReplies = (s.stoppedReplies ?? 0) + 1;
        if (e.usage) {
          s.promptTokens += e.usage.promptTokens;
          s.completionTokens += e.usage.completionTokens;
          if (e.usage.costUsd !== undefined) {
            cost += e.usage.costUsd;
            hasCost = true;
          }
        }
      }
      if (e.kind === "note" && /random legal move/.test(e.text)) s.randomMoves++;
      if (e.kind === "analysis") s.analysisRounds++;
    }
  }
  // Each move takes one call, plus one per referee rejection and one per analysis round; anything beyond that was a pre-check re-ask.
  s.reasks = Math.max(0, s.requests - moves - s.refereeRejections - s.analysisRounds);
  if (hasCost) s.costUsd = Math.round(cost * 1e6) / 1e6;
  return s;
}

const sameHarness = (a: HarnessConfig, b: HarnessConfig) =>
  JSON.stringify({ ...a, builder: undefined }) === JSON.stringify({ ...b, builder: undefined });

export interface BuildOptions {
  pgn: string;
  arenaVersion: string;
  submittedBy?: string;
  comment?: string;
  /** Stockfish's review, computed before submitting (see game/review.ts). */
  review?: GameReview;
  /** Harnesses on the site, to tell presets and community harnesses from custom ones. */
  presets: HarnessConfig[];
  community: HarnessConfig[];
}

export type Built = { ok: true; file: ResultFile } | { ok: false; error: string };

export function buildResultFile(game: SavedGame, opts: BuildOptions): Built {
  if (game.result === null || game.result === "*") return { ok: false, error: "Only finished games can be submitted." };
  const termination = terminationOf(game.reason ?? "");
  if (!termination) return { ok: false, error: `This game ended in a way results don't cover yet (${game.reason}).` };

  const side = (c: Color): ResultSide => {
    const config = game.harnesses[c];
    const sideCfg = game.sides[c];
    if (!config) {
      const elo = engineLevel(sideCfg.agentId);
      if (elo === undefined) return { player: game.labels[c], kind: "human" };
      return { player: game.labels[c], kind: "engine", engine: { id: sideCfg.agentId, name: ENGINE_NAME, elo } };
    }
    const agentId = sideCfg.agentId;
    const community = agentId.startsWith("community:") ? opts.community.find((h) => `community:${h.id}` === agentId) : undefined;
    const preset = opts.presets.find((h) => h.id === agentId);
    const library = community ?? preset;
    const source = community ? "community" : preset ? "preset" : "custom";
    const harness: ResultSide["harness"] = {
      id: library?.id ?? config.id,
      name: config.name,
      source,
      ...(!library || !sameHarness(library, config) ? { config } : {}),
    };
    return {
      player: game.labels[c],
      kind: "llm",
      model: sideCfg.model,
      ...(sideCfg.effort ? { effort: sideCfg.effort } : {}),
      harness,
      stats: sideStats(game, c),
    };
  };

  const finishedAt = game.events.findLast((e) => e.event.type === "gameOver")?.t ?? game.savedAt;
  return {
    ok: true,
    file: {
      format: RESULT_FORMAT,
      version: 1,
      startedAt: new Date(game.startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      arenaVersion: game.arenaVersion ?? opts.arenaVersion,
      ...(opts.submittedBy?.trim() ? { submittedBy: opts.submittedBy.trim().slice(0, 80) } : {}),
      ...(opts.comment?.trim() ? { comment: opts.comment.trim().slice(0, 1000) } : {}),
      result: game.result,
      termination,
      reason: game.reason ?? "",
      plies: game.history.length,
      pgn: opts.pgn,
      white: side("w"),
      black: side("b"),
      moves: moveRecords(game).map((m, i) => ({ ...m, ...opts.review?.moves[i] })),
      ...(opts.review ? { review: { engine: opts.review.engine, depth: opts.review.depth, white: opts.review.white, black: opts.review.black } } : {}),
    },
  };
}

const slug = (s: string, max: number) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "") || "x";

const sideSlug = (s: ResultSide) =>
  s.kind === "human" ? "human" : s.kind === "engine" ? slug(s.engine?.id ?? "engine", 40) : slug(`${s.harness?.id ?? "harness"}-${(s.model ?? "").split("/").pop()}`, 40);

/** e.g. "2026-11-27-attacker-gpt-5-vs-harnessed-llama-3-mgx2k1.json" (the last part comes from the start time). */
export function resultFileName(file: ResultFile): string {
  const start = new Date(file.startedAt);
  return `${file.startedAt.slice(0, 10)}-${sideSlug(file.white)}-vs-${sideSlug(file.black)}-${start.getTime().toString(36)}.json`;
}

// ---- Commit message (GitHub's upload page can't be pre-filled, so the dialog offers it to copy) ----

const shortModel = (id: string) => id.replace(/^[^/]*\//, "").replace(/:free$/, "");

/** "Stockfish 1600", "Attacker + notes (ernie-5.5-flash-preview)", "Human". */
function shortPlayer(side: ResultSide): string {
  if (side.kind === "engine" && side.engine) return `Stockfish ${side.engine.elo ?? "full strength"}`;
  if (side.kind === "llm") return `${side.harness?.name ?? "LLM"} (${shortModel(side.model ?? "?")})`;
  return side.player;
}

function sideLine(label: string, side: ResultSide): string {
  if (side.kind === "engine" && side.engine) return `${label}: ${side.engine.name}, ${side.engine.elo ? `Elo ${side.engine.elo}` : "full strength"}`;
  if (side.kind !== "llm") return `${label}: ${side.player}`;
  const s = side.stats;
  const parts = [`${label}: ${side.harness?.name ?? "?"} (${side.harness?.source ?? "?"})`, side.model ?? "?"];
  if (s) {
    parts.push(`${s.requests} requests`, `${(s.promptTokens + s.completionTokens).toLocaleString("en")} tokens`);
    if (s.costUsd !== undefined) parts.push(`$${s.costUsd.toFixed(2)}`);
    const problems = [s.reasks && count(s.reasks, "re-ask"), s.refereeRejections && `${s.refereeRejections} rejected`, s.randomMoves && count(s.randomMoves, "random move"), s.stoppedReplies && count(s.stoppedReplies, "stopped reply")].filter(Boolean);
    if (problems.length) parts.push(problems.join(", "));
  }
  return parts.join(" · ");
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const moveName = (ply: number, san: string) => `${Math.ceil(ply / 2)}${ply % 2 ? "." : "..."}${san}`;

/** A commit title and description that say what the game was. */
export function resultCommitMessage(file: ResultFile): { title: string; description: string } {
  const moves = Math.ceil(file.plies / 2);
  const title = `Result: ${shortPlayer(file.white)} vs ${shortPlayer(file.black)}, ${file.result} (${file.termination}, ${moves} moves)`;
  const lines = [sideLine("White", file.white), sideLine("Black", file.black)];
  if (file.reason.toLowerCase() !== file.termination.replace(/-/g, " ")) lines.push(`Ended: ${file.reason}`);
  if (file.review) {
    const r = file.review;
    const side = (k: "white" | "black") =>
      `${k === "white" ? "White" : "Black"} ${r[k].accuracy}% accuracy, ${count(r[k].blunders, "blunder")}, ${count(r[k].mistakes, "mistake")}`;
    lines.push("", `Review (${r.engine}, depth ${r.depth}): ${side("white")}; ${side("black")}`);
    const bad = (file.moves ?? []).filter((m) => m.class === "blunder");
    if (bad.length) lines.push(`Blunders: ${bad.map((m) => moveName(m.ply, m.san) + (m.best ? ` (best ${m.best})` : "")).join(", ")}`);
  }
  if (file.comment) lines.push("", file.comment);
  if (file.submittedBy) lines.push("", `Submitted by ${file.submittedBy}`);
  return { title, description: lines.join("\n") };
}

// ---- Validation (run by CI on every file in results/) ----

export type Checked = { ok: true; file: ResultFile; adjudicated: boolean } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isIso = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));

function checkSide(raw: unknown, name: string, library: HarnessConfig[]): string | null {
  if (!isObj(raw)) return `${name} is missing.`;
  if (typeof raw.player !== "string" || !raw.player) return `${name}.player is missing.`;
  if (raw.kind === "human") return null;
  if (raw.kind === "engine") {
    const e = raw.engine;
    if (!isObj(e) || typeof e.id !== "string" || engineLevel(e.id) === undefined) return `${name}.engine.id is not a known engine level.`;
    if (e.elo !== engineLevel(e.id)) return `${name}.engine.elo doesn't match ${e.id}.`;
    return null;
  }
  if (raw.kind !== "llm") return `${name}.kind must be "llm", "human" or "engine".`;
  if (typeof raw.model !== "string" || !raw.model.trim()) return `${name}.model is missing.`;
  if (raw.effort !== undefined && !["low", "medium", "high"].includes(raw.effort as string)) return `${name}.effort is not low, medium or high.`;
  const h = raw.harness;
  if (!isObj(h) || typeof h.id !== "string" || typeof h.name !== "string") return `${name}.harness needs an id and a name.`;
  if (!["preset", "community", "custom"].includes(h.source as string)) return `${name}.harness.source must be preset, community or custom.`;
  if (h.config !== undefined) {
    const v = validateHarness(h.config);
    if (!v.ok) return `${name}.harness.config is not a valid harness: ${v.error}`;
  } else if (h.source === "custom") {
    return `${name}.harness.config is required for a custom harness.`;
  } else if (!library.some((l) => l.id === h.id)) {
    return `${name}.harness "${h.id}" isn't in harnesses/; include its config.`;
  }
  if (!isObj(raw.stats)) return `${name}.stats is missing.`;
  for (const k of ["requests", "promptTokens", "completionTokens", "reasks", "refereeRejections", "randomMoves", "emptyReplies", "analysisRounds"]) {
    const n = raw.stats[k];
    if (k === "analysisRounds" && n === undefined) continue;
    if (!Number.isInteger(n) || (n as number) < 0) return `${name}.stats.${k} must be a whole number.`;
  }
  return null;
}

const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

/** `moves`, when present, must follow the PGN move by move. */
function checkMoves(raw: unknown, history: string[]): string | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length !== history.length) return `moves must have one entry per half-move (${history.length}).`;
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    const at = `moves[${i}]`;
    if (!isObj(m) || m.ply !== i + 1 || m.san !== history[i] || m.color !== (i % 2 === 0 ? "w" : "b")) return `${at} doesn't match half-move ${i + 1} (${history[i]}) of the PGN.`;
    for (const k of ["requests", "promptTokens", "completionTokens", "reasoningChars", "reasks"]) if (!isCount(m[k])) return `${at}.${k} must be a whole number.`;
    if (m.stopped !== undefined && !isCount(m.stopped)) return `${at}.stopped must be a whole number.`;
    if (m.reply !== undefined && (typeof m.reply !== "string" || m.reply.length > 1000)) return `${at}.reply must be text of at most 1000 characters.`;
    if (m.notes !== undefined && (typeof m.notes !== "string" || m.notes.length > 1000)) return `${at}.notes must be text of at most 1000 characters.`;
    if (m.class !== undefined && !["inaccuracy", "mistake", "blunder"].includes(m.class as string)) return `${at}.class is not inaccuracy, mistake or blunder.`;
  }
  return null;
}

function checkReview(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (!isObj(raw) || typeof raw.engine !== "string" || !isCount(raw.depth)) return "review needs an engine and a depth.";
  for (const side of ["white", "black"]) {
    const s = raw[side];
    if (!isObj(s) || typeof s.accuracy !== "number" || !isCount(s.avgLoss) || !isCount(s.inaccuracies) || !isCount(s.mistakes) || !isCount(s.blunders)) {
      return `review.${side} needs accuracy, avgLoss, inaccuracies, mistakes and blunders.`;
    }
  }
  return null;
}

/** Checks a submitted result: the moves are legal and the claimed ending matches the final position. */
export function validateResultFile(data: unknown, library: HarnessConfig[]): Checked {
  if (!isObj(data)) return { ok: false, error: "Not a JSON object." };
  if (data.format !== RESULT_FORMAT || data.version !== 1) return { ok: false, error: `Expected format "${RESULT_FORMAT}", version 1.` };
  if (!isIso(data.startedAt) || !isIso(data.finishedAt)) return { ok: false, error: "startedAt and finishedAt must be ISO dates." };
  if (typeof data.arenaVersion !== "string") return { ok: false, error: "arenaVersion is missing." };
  if (data.submittedBy !== undefined && (typeof data.submittedBy !== "string" || data.submittedBy.length > 80)) {
    return { ok: false, error: "submittedBy must be text of at most 80 characters." };
  }
  if (data.comment !== undefined && (typeof data.comment !== "string" || data.comment.length > 1000)) {
    return { ok: false, error: "comment must be text of at most 1000 characters." };
  }
  const result = data.result;
  if (result !== "1-0" && result !== "0-1" && result !== "1/2-1/2") return { ok: false, error: 'result must be "1-0", "0-1" or "1/2-1/2".' };
  if (typeof data.reason !== "string") return { ok: false, error: "reason is missing." };
  if (typeof data.pgn !== "string") return { ok: false, error: "pgn is missing." };

  const chess = new Chess();
  try {
    chess.loadPgn(data.pgn);
  } catch (e) {
    return { ok: false, error: `The PGN doesn't load: ${e instanceof Error ? e.message : String(e)}` };
  }
  const plies = chess.history().length;
  if (data.plies !== plies) return { ok: false, error: `plies says ${String(data.plies)}, but the PGN has ${plies} half-moves.` };
  const pgnResult = /\[Result "([^"]+)"\]/.exec(data.pgn)?.[1];
  if (pgnResult && pgnResult !== result) return { ok: false, error: `The PGN's Result header (${pgnResult}) doesn't match result (${result}).` };

  const winner = result === "1-0" ? "w" : result === "0-1" ? "b" : null;
  const toMove = chess.turn();
  const fail = (what: string) => ({ ok: false as const, error: `termination is "${String(data.termination)}", but ${what}.` });
  switch (data.termination) {
    case "checkmate":
      if (!chess.isCheckmate()) return fail("the final position isn't checkmate");
      if (winner !== (toMove === "w" ? "b" : "w")) return fail("the result names the wrong winner");
      break;
    case "stalemate":
      if (!chess.isStalemate() || winner) return fail("the final position isn't a stalemate draw");
      break;
    case "threefold-repetition":
      if (!chess.isThreefoldRepetition() || winner) return fail("the final position hasn't occurred three times");
      break;
    case "insufficient-material":
      if (!chess.isInsufficientMaterial() || winner) return fail("there is still mating material");
      break;
    case "fifty-move-rule":
      if (!chess.isDrawByFiftyMoves() || winner) return fail("the 50-move rule doesn't apply");
      break;
    case "move-limit":
      if (winner) return fail("a move-limit ending is a draw");
      break;
    case "forfeit":
      // A side forfeits on its own turn, so the side to move loses.
      if (winner !== (toMove === "w" ? "b" : "w")) return fail("the side that forfeits is the side to move, and it must lose");
      break;
    case "adjudicated":
      if (chess.isGameOver()) return fail("the game was already over by the rules");
      break;
    default:
      return { ok: false, error: `Unknown termination "${String(data.termination)}".` };
  }

  for (const [key, name] of [["white", "White"], ["black", "Black"]] as const) {
    const problem = checkSide(data[key], name, library);
    if (problem) return { ok: false, error: problem };
  }
  const movesProblem = checkMoves(data.moves, chess.history());
  if (movesProblem) return { ok: false, error: movesProblem };
  const reviewProblem = checkReview(data.review);
  if (reviewProblem) return { ok: false, error: reviewProblem };
  return { ok: true, file: data as unknown as ResultFile, adjudicated: data.termination === "adjudicated" };
}
