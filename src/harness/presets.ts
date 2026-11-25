import type { HarnessConfig } from "./config";

export const HARNESSED_SYSTEM_PROMPT = `You are a careful chess player. Each turn you get the position and the list of legal moves.
Think in this order before you answer:
1. Threats: what is your opponent threatening after their last move? (captures, checks, attacks on undefended pieces, mate threats)
2. Opportunities: list every capture and check you have. Is any opponent piece undefended, or attacked more times than it is defended? Can you win material?
3. Loose pieces: which of your own pieces are attacked and not defended? Don't leave them hanging.
4. Candidates: list 2-3 candidate moves from the legal-move list. Include any capture that wins material and any move that saves a hanging piece.
5. Safety: for each candidate, check whether it leaves one of your pieces undefended or lets the opponent give mate or win material.
6. Pick the best candidate.
End your reply with a final line in exactly this form:
MOVE: <move in SAN, copied from the legal-move list>`;

const REASK = `{{problem}} Choose one move from this list and end with "MOVE: <san>": {{legal_moves}}`;

const HARNESSED_TURN = `You are playing {{side}}.

FEN: {{fen}}

Board (uppercase = White, lowercase = Black):
{{board_ascii}}

Moves so far: {{pgn}}

Legal moves: {{legal_moves}}`;

export const RAW_PRESET: HarnessConfig = {
  version: 1,
  id: "raw",
  name: "Raw (no harness)",
  description: "Game as PGN in, one move out. No board, no legal moves, no checking.",
  systemPrompt: "",
  turnPrompt:
    "You are playing chess as {{side}}. The game so far in PGN: {{pgn}}\nReply with only your next move in standard algebraic notation.{{errors}}",
  reaskPrompt: REASK,
  precheck: false,
  maxReasks: 0,
  fallback: "submit",
};

export const HARNESSED_PRESET: HarnessConfig = {
  version: 1,
  id: "harnessed",
  name: "Harnessed (example harness)",
  description: "FEN + board + legal moves, a threats/opportunities/safety procedure, self-checked moves.",
  systemPrompt: HARNESSED_SYSTEM_PROMPT,
  turnPrompt: HARNESSED_TURN,
  reaskPrompt: REASK,
  precheck: true,
  maxReasks: 2,
  fallback: "random",
};

export const TACTICAL_PRESET: HarnessConfig = {
  ...HARNESSED_PRESET,
  id: "harnessed-tactics",
  name: "Harnessed + tactical facts",
  description: "Everything in Harnessed, plus rules-derived facts each turn: attacked/undefended pieces, captures, checks. No engine.",
  turnPrompt: HARNESSED_TURN.replace(
    "\n\nLegal moves:",
    `\n\nBoard facts (computed from the rules, not an engine; pins are ignored):
{{attacks}}
Your captures: {{captures}}
Your checking moves: {{checks}}

Legal moves:`,
  ),
};

export const PRESETS: HarnessConfig[] = [RAW_PRESET, HARNESSED_PRESET, TACTICAL_PRESET];
