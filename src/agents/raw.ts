// Raw: the baseline. The model sees the game as PGN each turn and must answer
// with a move. No board picture, no legal-move list, no validation, and only the
// referee's one-line rejection on a retry.

import { movetext } from "../game/pgn";
import { extractMove } from "./parse";
import type { AgentDefinition, ChatMessage, LogEntry } from "./types";

export const rawAgent: AgentDefinition = {
  id: "raw",
  label: "Raw (no harness)",
  description: "Game as PGN in, one move out. No board, no legal moves, no checking.",
  needsModel: true,
  create(settings, { llm }) {
    return {
      async nextMove(game) {
        const side = game.myColor === "w" ? "White" : "Black";
        const pgn = game.history.length ? movetext(game.history) : "(no moves yet)";
        let content =
          `You are playing chess as ${side}. The game so far in PGN: ${pgn}\n` +
          `Reply with only your next move in standard algebraic notation.`;
        for (const a of game.previousAttempts) {
          content += `\nYour move ${a.move} was rejected: ${a.error}. Try again.`;
        }
        const messages: ChatMessage[] = [{ role: "user", content }];
        const log: LogEntry[] = [{ kind: "prompt", text: content }];

        const res = await llm.chat({
          model: settings.model,
          messages,
          reasoningEffort: settings.reasoningEffort,
          signal: game.signal,
        });
        log.push({ kind: "response", text: res.text, usage: res.usage, reasoning: res.reasoning });
        const move = extractMove(res.text) ?? res.text.trim().slice(0, 60);
        return { move, log };
      },
    };
  },
};
