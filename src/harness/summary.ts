// What a harness card shows in the picker: which context blocks it uses, its
// features, and roughly how big a turn prompt is. Computed from the config alone.

import { Chess } from "chess.js";
import type { HarnessConfig } from "./config";
import { CONTEXT_BLOCKS } from "./contextBlocks";
import { renderPrompts } from "./runner";
import { templateVariables } from "./template";

export interface HarnessSummary {
  /** Context blocks used, in the order they're defined. */
  blocks: { name: string; label: string; borderline: boolean }[];
  usesFen: boolean;
  usesNotes: boolean;
  usesSystemPrompt: boolean;
  /** Analysis board rounds per move (0 = off). */
  analysisRounds: number;
  /** e.g. "pre-check, 2 re-asks, then a random legal move" */
  checking: string;
  /** Approximate tokens of the first turn's prompt (system + user), at a typical middlegame position. */
  approxTokens: number;
}

// A quiet middlegame position, so position-dependent blocks have realistic sizes.
const SAMPLE = "e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3 d6 c3 O-O".split(" ");

export function summarizeHarness(config: HarnessConfig): HarnessSummary {
  // The re-ask prompt is only ever sent when the pre-check is on.
  const prompts = [config.systemPrompt, config.turnPrompt, ...(config.precheck ? [config.reaskPrompt] : [])];
  const used = new Set(prompts.flatMap(templateVariables));
  const chess = new Chess();
  for (const m of SAMPLE) chess.move(m);
  const { system, user } = renderPrompts(config, {
    history: chess.history(),
    fen: chess.fen(),
    legalMoves: chess.moves(),
    myColor: chess.turn(),
    previousAttempts: [],
    myNotes: config.keepNotes ? "Plan: castle, then push d4. Watch ...Ng4." : undefined,
  });
  return {
    blocks: CONTEXT_BLOCKS.filter((b) => used.has(b.name)).map((b) => ({ name: b.name, label: b.label, borderline: b.fairness === "borderline" })),
    usesFen: used.has("fen"),
    usesNotes: !!config.keepNotes && used.has("my_notes"),
    usesSystemPrompt: config.systemPrompt.trim() !== "",
    analysisRounds: config.analysisRounds ?? 0,
    checking: config.precheck
      ? `pre-check, ${config.maxReasks} re-ask${config.maxReasks === 1 ? "" : "s"}, then ${config.fallback === "random" ? "a random legal move" : "the referee decides"}`
      : "no pre-check: the referee judges the raw answer",
    approxTokens: Math.round((system.length + user.length) / 4),
  };
}
