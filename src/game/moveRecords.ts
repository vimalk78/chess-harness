// One record per half-move, from a saved game's events: what the move cost (time, calls,
// tokens), what went wrong on the way (re-asks, referee rejections, random fallbacks), and
// what the agent said (its visible reply and the notes it kept), trimmed so a whole game
// stays small enough for a results file. Prompts and reasoning text are left out: the
// transcript has them.

import type { Color } from "../agents/types";
import type { SavedGame } from "./savedGame";

export const MAX_REPLY_CHARS = 600;
export const MAX_NOTES_CHARS = 600;

export interface MoveRecord {
  /** Half-move number, from 1. */
  ply: number;
  color: Color;
  san: string;
  /** Time from the turn starting to the move (pauses left out). */
  thinkMs?: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  costUsd?: number;
  /** Length of the model's reasoning text, all calls this turn. */
  reasoningChars: number;
  /** Extra calls the pre-check made for an illegal or missing move. */
  reasks: number;
  /** Moves the referee rejected this turn. */
  rejected?: string[];
  analysisRounds?: number;
  /** The harness gave up and played a random legal move. */
  random?: true;
  /** Calls that came back empty. */
  emptyReplies?: number;
  /** Calls the app stopped: the model was looping, or far too long (their tokens aren't counted). */
  stopped?: number;
  /** The last reply's visible text (no reasoning), trimmed. */
  reply?: string;
  /** The notes kept after this move, trimmed. */
  notes?: string;
}

const clip = (s: string, max: number) => {
  const t = s.trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
};

export function moveRecords(game: SavedGame): MoveRecord[] {
  const out: MoveRecord[] = [];
  let cur: MoveRecord | null = null;
  let turnStart: number | null = null;
  let pausedAt: number | null = null;
  let pausedMs = 0;
  let cost = 0;
  let hasCost = false;
  let reply = "";

  const fresh = (color: Color): MoveRecord => ({ ply: out.length + 1, color, san: "", requests: 0, promptTokens: 0, completionTokens: 0, reasoningChars: 0, reasks: 0 });

  for (const { t, event } of game.events) {
    switch (event.type) {
      case "turnStart":
        if (!cur || cur.color !== event.color) {
          cur = fresh(event.color);
          turnStart = t;
          pausedMs = 0;
          cost = 0;
          hasCost = false;
          reply = "";
        }
        break;
      case "paused":
        pausedAt ??= t;
        break;
      case "resumed":
        if (pausedAt !== null) pausedMs += t - pausedAt;
        pausedAt = null;
        break;
      case "illegalAttempt":
        if (!cur || cur.color !== event.color) cur = fresh(event.color);
        (cur.rejected ??= []).push(event.move || "(empty)");
        break;
      case "log": {
        if (!cur || cur.color !== event.color) cur = fresh(event.color);
        for (const e of event.entries) {
          if (e.kind === "response") {
            cur.requests++;
            if (!e.text.trim()) cur.emptyReplies = (cur.emptyReplies ?? 0) + 1;
            else reply = e.text;
            cur.reasoningChars += e.reasoning?.length ?? 0;
            if (e.stopped) cur.stopped = (cur.stopped ?? 0) + 1;
            if (e.usage) {
              cur.promptTokens += e.usage.promptTokens;
              cur.completionTokens += e.usage.completionTokens;
              if (e.usage.costUsd !== undefined) {
                cost += e.usage.costUsd;
                hasCost = true;
              }
            }
          }
          if (e.kind === "analysis") cur.analysisRounds = (cur.analysisRounds ?? 0) + 1;
          if (e.kind === "note" && /random legal move/.test(e.text)) cur.random = true;
          if (e.kind === "notes") cur.notes = clip(e.text, MAX_NOTES_CHARS);
        }
        break;
      }
      case "move": {
        const rec: MoveRecord = cur && cur.color === event.color ? cur : fresh(event.color);
        rec.san = event.san;
        if (turnStart !== null) rec.thinkMs = Math.max(0, t - turnStart - pausedMs);
        // One call per attempt the referee saw, plus analysis rounds; the rest were pre-check re-asks.
        if (rec.requests) rec.reasks = Math.max(0, rec.requests - 1 - (rec.rejected?.length ?? 0) - (rec.analysisRounds ?? 0));
        if (hasCost) rec.costUsd = Math.round(cost * 1e6) / 1e6;
        if (reply) rec.reply = clip(reply, MAX_REPLY_CHARS);
        out.push(rec);
        cur = null;
        turnStart = null;
        pausedMs = 0;
        cost = 0;
        hasCost = false;
        reply = "";
        break;
      }
    }
  }
  // Loaded PGNs and old logs may have moves without events: fill in bare records.
  return game.history.map((san, i) => {
    const r = out[i];
    return r && r.san === san ? r : { ...fresh(i % 2 === 0 ? "w" : "b"), ply: i + 1, san };
  });
}
