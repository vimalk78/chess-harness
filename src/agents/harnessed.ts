// Harnessed: an example harness. Same model, more help per turn:
//   - the position as FEN and an ASCII board, plus the full legal-move list
//   - a short thinking procedure (threats -> opportunities -> loose pieces -> candidates -> safety -> MOVE:)
//   - its own legality check, with re-asks that quote the exact problem
//   - a disclosed random legal move if the model still fails
// The "+ tactical facts" variant also lists attacked/defended pieces, captures and checks,
// computed from the rules (see tactics.ts).
// No engine, no evaluation, no search. It's meant as a readable starting point for your
// own harness, not the strongest one.

import { movetext } from "../game/pgn";
import { asciiBoard, legalSan } from "./chessUtil";
import { extractMove } from "./parse";
import { boardFacts } from "./tactics";
import type { Agent, AgentDefinition, AgentDeps, AgentSettings, ChatMessage, LogEntry } from "./types";

const MAX_REASKS = 2;

export const SYSTEM_PROMPT = `You are a careful chess player. Each turn you get the position and the list of legal moves.
Think in this order before you answer:
1. Threats: what is your opponent threatening after their last move? (captures, checks, attacks on undefended pieces, mate threats)
2. Opportunities: list every capture and check you have. Is any opponent piece undefended, or attacked more times than it is defended? Can you win material?
3. Loose pieces: which of your own pieces are attacked and not defended? Don't leave them hanging.
4. Candidates: list 2-3 candidate moves from the legal-move list. Include any capture that wins material and any move that saves a hanging piece.
5. Safety: for each candidate, check whether it leaves one of your pieces undefended or lets the opponent give mate or win material.
6. Pick the best candidate.
End your reply with a final line in exactly this form:
MOVE: <move in SAN, copied from the legal-move list>`;

type PromptGame = { fen: string; history: string[]; legalMoves: string[]; myColor: "w" | "b" };

export function buildUserPrompt(game: PromptGame, opts: { facts?: boolean } = {}): string {
  const side = game.myColor === "w" ? "White" : "Black";
  return [
    `You are playing ${side}.`,
    `FEN: ${game.fen}`,
    `Board (uppercase = White, lowercase = Black):\n${asciiBoard(game.fen)}`,
    `Moves so far: ${game.history.length ? movetext(game.history) : "(none, this is the first move)"}`,
    opts.facts ? boardFacts(game.fen) : null,
    `Legal moves (${game.legalMoves.length}): ${game.legalMoves.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function createHarnessed(settings: AgentSettings, { llm }: AgentDeps, opts: { facts: boolean }): Agent {
  return {
    async nextMove(game) {
      const user = buildUserPrompt(game, opts);
      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ];
      const log: LogEntry[] = [{ kind: "prompt", text: `[system]\n${SYSTEM_PROMPT}\n\n[user]\n${user}` }];

      for (let attempt = 0; attempt <= MAX_REASKS; attempt++) {
        const res = await llm.chat({
          model: settings.model,
          messages,
          reasoningEffort: settings.reasoningEffort,
          signal: game.signal,
        });
        log.push({ kind: "response", text: res.text, usage: res.usage, reasoning: res.reasoning });

        const candidate = extractMove(res.text);
        const san = candidate ? legalSan(game.fen, candidate) : null;
        if (san) return { move: san, log };

        if (attempt === MAX_REASKS) break;
        const problem = candidate
          ? `${candidate} is not legal in this position.`
          : `I couldn't find a "MOVE: <san>" line in your reply.`;
        const reask = `${problem} Choose one move from this list and end with "MOVE: <san>": ${game.legalMoves.join(", ")}`;
        messages.push({ role: "assistant", content: res.text }, { role: "user", content: reask });
        log.push({ kind: "prompt", text: reask });
      }

      const fallback = game.legalMoves[Math.floor(Math.random() * game.legalMoves.length)];
      log.push({ kind: "note", text: `No legal move after ${MAX_REASKS + 1} tries; playing random legal move ${fallback}.` });
      return { move: fallback, log };
    },
  };
}

export const harnessedAgent: AgentDefinition = {
  id: "harnessed",
  label: "Harnessed (example harness)",
  description: "FEN + board + legal moves, a threats/opportunities/safety procedure, self-checked moves.",
  needsModel: true,
  create: (settings, deps) => createHarnessed(settings, deps, { facts: false }),
};

export const tacticalAgent: AgentDefinition = {
  id: "harnessed-tactics",
  label: "Harnessed + tactical facts",
  description:
    "Everything in Harnessed, plus rules-derived facts each turn: attacked/undefended pieces, captures, checks. No engine.",
  needsModel: true,
  create: (settings, deps) => createHarnessed(settings, deps, { facts: true }),
};
