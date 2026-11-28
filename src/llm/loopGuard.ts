// Stops a streamed reply that has gone wrong: a model stuck repeating itself ("Q? Q? Q? …",
// or the same paragraph over and over), or one that has run far past any sensible length.
// Stopping the stream ends the request, so the model stops generating (and, for most
// providers, billing) right away; the harness then re-asks for a short answer.

/** Characters of reasoning plus reply after which a call is stopped (about 50k tokens). Free
 * providers cut replies off around there anyway, usually with no answer. */
export const MAX_REPLY_CHARS = 200_000;
/** A repeat counts as a loop once the repeated part covers this much text… */
const MIN_LOOP_CHARS = 1_000;
/** …and at least this many copies. */
const MIN_COPIES = 3;
/** Longest repeating unit looked for (a paragraph). */
const MAX_PERIOD = 2_000;
/** The probe: the last few characters, searched for earlier in the text. */
const PROBE = 120;
/** Check after this many new characters (checks are cheap but not free). */
const CHECK_EVERY = 400;

export type CutOff = { reason: "loop"; sample: string } | { reason: "length"; chars: number };

/**
 * Finds a loop at the end of `text`: the tail is the same unit repeated MIN_COPIES or more
 * times over at least MIN_LOOP_CHARS. Returns the repeating unit, or null.
 */
export function findLoop(full: string): string | null {
  // Only the tail matters: the longest loop looked for is MIN_COPIES paragraphs.
  const text = full.slice(-(Math.max(MIN_LOOP_CHARS, MAX_PERIOD * MIN_COPIES) + PROBE));
  if (text.length < MIN_LOOP_CHARS) return null;
  const probe = text.slice(-PROBE);
  // Every earlier copy of the probe is a candidate period, nearest first.
  let at = text.lastIndexOf(probe, text.length - PROBE - 1);
  while (at >= 0) {
    const period = text.length - PROBE - at;
    if (period > MAX_PERIOD) return null;
    const span = Math.max(MIN_LOOP_CHARS, period * MIN_COPIES);
    if (span <= text.length && isPeriodic(text, period, span)) return text.slice(-period);
    at = text.lastIndexOf(probe, at - 1);
  }
  return null;
}

/** True when the last `span` characters repeat with the given period. */
function isPeriodic(text: string, period: number, span: number): boolean {
  const end = text.length;
  for (let i = end - span + period; i < end; i++) if (text.charCodeAt(i) !== text.charCodeAt(i - period)) return false;
  return true;
}

/** Watches one streamed call (reasoning and reply text separately) and says when to stop it. */
export class LoopGuard {
  private texts = { reasoning: "", content: "" };
  private sinceCheck = { reasoning: 0, content: 0 };
  private readonly maxChars: number;

  constructor(maxChars = MAX_REPLY_CHARS) {
    this.maxChars = maxChars;
  }

  /** Adds streamed text; returns why to stop, or null to carry on. */
  push(kind: "reasoning" | "content", piece: string): CutOff | null {
    this.texts[kind] += piece;
    const chars = this.texts.reasoning.length + this.texts.content.length;
    if (chars > this.maxChars) return { reason: "length", chars };
    this.sinceCheck[kind] += piece.length;
    if (this.sinceCheck[kind] < CHECK_EVERY) return null;
    this.sinceCheck[kind] = 0;
    const unit = findLoop(this.texts[kind]);
    return unit === null ? null : { reason: "loop", sample: unit.trim().slice(0, 80) };
  }
}

/** One line for the game log and the re-ask. */
export function describeCutOff(c: CutOff): string {
  return c.reason === "loop"
    ? `Stopped the reply: it was repeating itself ("${c.sample.replace(/\s+/g, " ")}…").`
    : `Stopped the reply after ${c.chars.toLocaleString("en")} characters of reasoning and text.`;
}
