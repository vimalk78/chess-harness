// Harnessed: an example harness. Same model, more help per turn:
//   - the position as FEN and an ASCII board, plus the full legal-move list
//   - a short thinking procedure (threats -> candidates -> safety check -> MOVE:)
//   - its own legality check, with re-asks that quote the exact problem
//   - a disclosed random legal move if the model still fails
// No engine, no evaluation, no search: only information derived from the rules.
// It's meant as a readable starting point for your own harness, not the strongest one.

import { movetext } from "../game/pgn";
import { asciiBoard, legalSan } from "./chessUtil";
import { extractMove } from "./parse";
import type { AgentDefinition, ChatMessage, LogEntry } from "./types";

const MAX_REASKS = 2;

export const SYSTEM_PROMPT = `You are a careful chess player. Each turn you get the position and the list of legal moves.
Think in this order before you answer:
1. Threats: what is your opponent threatening after their last move? (captures, checks, attacks on undefended pieces, mate threats)
2. Candidates: list 2-3 candidate moves taken from the legal-move list.
3. Safety: for each candidate, check whether it leaves one of your pieces undefended or lets the opponent give mate or win material.
4. Pick the best candidate.
End your reply with a final line in exactly this form:
MOVE: <move in SAN, copied from the legal-move list>`;

export function buildUserPrompt(game: { fen: string; history: string[]; legalMoves: string[]; myColor: "w" | "b" }): string {
  const side = game.myColor === "w" ? "White" : "Black";
  return [
    `You are playing ${side}.`,
    `FEN: ${game.fen}`,
    `Board (uppercase = White, lowercase = Black):\n${asciiBoard(game.fen)}`,
    `Moves so far: ${game.history.length ? movetext(game.history) : "(none, this is the first move)"}`,
    `Legal moves (${game.legalMoves.length}): ${game.legalMoves.join(", ")}`,
  ].join("\n\n");
}

export const harnessedAgent: AgentDefinition = {
  id: "harnessed",
  label: "Harnessed (example harness)",
  description: "FEN + board + legal moves, a threats/candidates/safety procedure, self-checked moves.",
  needsModel: true,
  create(settings, { llm }) {
    return {
      async nextMove(game) {
        const user = buildUserPrompt(game);
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
          log.push({ kind: "response", text: res.text, usage: res.usage });

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
  },
};
