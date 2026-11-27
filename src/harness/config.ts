// A harness config: everything a no-code harness controls. Presets, community
// harnesses (harnesses/ folder) and user harnesses share this format; the harness
// runner (runner.ts) executes it. It is data only: prompts and a few settings.

import { buildTurnPrompt, validateBuilder, type BuilderSpec } from "./builder";

export interface HarnessConfig {
  version: 1;
  /** Library harnesses: the file name without .json. User harnesses: random id. */
  id: string;
  name: string;
  description?: string;
  /** Who wrote it (name or GitHub handle); shown for community harnesses. */
  author?: string;
  /** "" means no system message. */
  systemPrompt: string;
  /** Sent as the user message each turn. */
  turnPrompt: string;
  /** Sent after a failed pre-check; may use {{problem}}. */
  reaskPrompt: string;
  /** "Pre-check moves before submitting": check legality with the rules and re-ask. */
  precheck: boolean;
  /** 0-5, used only when precheck is on. */
  maxReasks: number;
  /** After re-asks run out: play a random legal move (logged), or submit the last answer to the referee. */
  fallback: "random" | "submit";
  /** Save the reply's "NOTES:" block and give it back next move as {{my_notes}}. Off when absent. */
  keepNotes?: boolean;
  /** Longest notes kept, in characters (100-4000). Default 800. */
  notesMaxChars?: number;
  /**
   * Analysis board: rounds per move in which the model may write "ANALYZE: <line>" and get the
   * facts at the end of each line (see analysis.ts). Off when absent. 1-8.
   */
  analysisRounds?: number;
  /**
   * Set when the turn prompt was made with the editor's builder (a checklist of what the
   * model sees). turnPrompt always holds the generated text; this only lets the editor
   * show the checklist again. Dropped if the two disagree.
   */
  builder?: BuilderSpec;
}

export const MAX_PROMPT_CHARS = 20_000;

export type Validation = { ok: true; config: HarnessConfig } | { ok: false; error: string };

export function validateHarness(input: unknown): Validation {
  if (!input || typeof input !== "object") return { ok: false, error: "Not a harness: expected a JSON object." };
  const x = input as Record<string, unknown>;
  if (x.version !== 1) return { ok: false, error: `Unsupported harness version: ${JSON.stringify(x.version)}.` };
  for (const f of ["id", "name", "systemPrompt", "turnPrompt", "reaskPrompt"] as const) {
    if (typeof x[f] !== "string") return { ok: false, error: `"${f}" must be text.` };
  }
  if ((x.name as string).trim() === "") return { ok: false, error: "The harness needs a name." };
  if ((x.turnPrompt as string).trim() === "") return { ok: false, error: "The turn prompt is empty." };
  for (const f of ["systemPrompt", "turnPrompt", "reaskPrompt"] as const) {
    if ((x[f] as string).length > MAX_PROMPT_CHARS) return { ok: false, error: `"${f}" is longer than ${MAX_PROMPT_CHARS} characters.` };
  }
  if (x.description !== undefined && (typeof x.description !== "string" || x.description.length > 500)) {
    return { ok: false, error: '"description" must be text of at most 500 characters.' };
  }
  if (x.author !== undefined && (typeof x.author !== "string" || x.author.length > 80)) {
    return { ok: false, error: '"author" must be text of at most 80 characters.' };
  }
  if (typeof x.precheck !== "boolean") return { ok: false, error: '"precheck" must be true or false.' };
  if (!Number.isInteger(x.maxReasks) || (x.maxReasks as number) < 0 || (x.maxReasks as number) > 5) {
    return { ok: false, error: '"maxReasks" must be a whole number from 0 to 5.' };
  }
  if (x.fallback !== "random" && x.fallback !== "submit") return { ok: false, error: '"fallback" must be "random" or "submit".' };
  if (x.keepNotes !== undefined && typeof x.keepNotes !== "boolean") return { ok: false, error: '"keepNotes" must be true or false.' };
  if (x.notesMaxChars !== undefined && (!Number.isInteger(x.notesMaxChars) || (x.notesMaxChars as number) < 100 || (x.notesMaxChars as number) > 4000)) {
    return { ok: false, error: '"notesMaxChars" must be a whole number from 100 to 4000.' };
  }
  if (x.analysisRounds !== undefined && (!Number.isInteger(x.analysisRounds) || (x.analysisRounds as number) < 0 || (x.analysisRounds as number) > 8)) {
    return { ok: false, error: '"analysisRounds" must be a whole number from 0 to 8.' };
  }
  let builder: BuilderSpec | undefined;
  if (x.builder !== undefined) {
    const b = validateBuilder(x.builder);
    if (!b.ok) return b;
    if (buildTurnPrompt(b.spec) === x.turnPrompt) builder = b.spec;
  }
  const config: HarnessConfig = {
    version: 1,
    id: x.id as string,
    name: (x.name as string).trim(),
    ...(x.description ? { description: x.description as string } : {}),
    ...(typeof x.author === "string" && x.author.trim() ? { author: x.author.trim() } : {}),
    systemPrompt: x.systemPrompt as string,
    turnPrompt: x.turnPrompt as string,
    reaskPrompt: x.reaskPrompt as string,
    precheck: x.precheck,
    maxReasks: x.maxReasks as number,
    fallback: x.fallback,
    ...(x.keepNotes ? { keepNotes: true } : {}),
    ...(x.keepNotes && x.notesMaxChars !== undefined ? { notesMaxChars: x.notesMaxChars as number } : {}),
    ...(x.analysisRounds ? { analysisRounds: x.analysisRounds as number } : {}),
    ...(builder ? { builder } : {}),
  };
  return { ok: true, config };
}
