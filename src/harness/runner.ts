// The harness runner: executes one harness config for one turn.
// Render prompts -> call the model (streaming) -> extract the move -> optionally pre-check it.
// Legality is ultimately decided by the referee; the pre-check only spares the harness
// from submitting moves the referee would reject.

import { legalSan } from "../agents/chessUtil";
import { extractMove } from "../agents/parse";
import type { Agent, AgentDefinition, AgentDeps, AgentSettings, ChatMessage, GameView, LogEntry } from "../agents/types";
import type { HarnessConfig } from "./config";
import { variableSources, type VariableContext } from "./contextBlocks";
import { renderTemplate } from "./template";

type PromptGame = VariableContext["game"];

/** The exact messages the model receives at the start of a turn (also used by the editor preview). */
export function renderPrompts(config: HarnessConfig, game: PromptGame): { system: string; user: string } {
  const sources = variableSources({ game });
  return {
    system: config.systemPrompt ? renderTemplate(config.systemPrompt, sources) : "",
    user: renderTemplate(config.turnPrompt, sources),
  };
}

export function renderReask(config: HarnessConfig, game: PromptGame, problem: string): string {
  return renderTemplate(config.reaskPrompt, variableSources({ game, problem }));
}

export function createHarnessAgent(config: HarnessConfig, settings: AgentSettings, { llm }: AgentDeps): Agent {
  return {
    async nextMove(game: GameView) {
      const { system, user } = renderPrompts(config, game);
      const messages: ChatMessage[] = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: user });
      const log: LogEntry[] = [{ kind: "prompt", text: system ? `[system]\n${system}\n\n[user]\n${user}` : user }];

      const reasks = config.precheck ? config.maxReasks : 0;
      let lastAnswer = "";
      for (let attempt = 0; attempt <= reasks; attempt++) {
        game.onStream?.({ start: true });
        const res = await llm.chat({
          model: settings.model,
          messages,
          reasoningEffort: settings.reasoningEffort,
          signal: game.signal,
          onDelta: (d) => game.onStream?.(d),
        });
        log.push({ kind: "response", text: res.text, usage: res.usage, reasoning: res.reasoning });

        const candidate = extractMove(res.text);
        lastAnswer = candidate ?? res.text.trim().slice(0, 60);
        if (!config.precheck) return { move: lastAnswer, log };

        const san = candidate ? legalSan(game.fen, candidate) : null;
        if (san) return { move: san, log };
        if (attempt === reasks) break;

        const problem = candidate
          ? `${candidate} is not legal in this position.`
          : `I couldn't find a "MOVE: <san>" line in your reply.`;
        const reask = renderReask(config, game, problem);
        messages.push({ role: "assistant", content: res.text }, { role: "user", content: reask });
        log.push({ kind: "prompt", text: reask });
      }

      if (config.fallback === "random") {
        const move = game.legalMoves[Math.floor(Math.random() * game.legalMoves.length)];
        log.push({ kind: "note", text: `No legal move after ${reasks + 1} tries; playing random legal move ${move}.` });
        return { move, log };
      }
      log.push({ kind: "note", text: `No legal move after ${reasks + 1} tries; submitting the last answer to the referee.` });
      return { move: lastAnswer, log };
    },
  };
}

export function harnessDefinition(config: HarnessConfig, id: string): AgentDefinition {
  return {
    id,
    label: config.name,
    description: config.description ?? "Custom harness.",
    needsModel: true,
    create: (settings, deps) => createHarnessAgent(config, settings, deps),
  };
}
