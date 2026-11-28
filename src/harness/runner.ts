// The harness runner: executes one harness config for one turn.
// Render prompts -> call the model (streaming) -> extract the move -> optionally pre-check it.
// Legality is ultimately decided by the referee; the pre-check only spares the harness
// from submitting moves the referee would reject.

import { legalSan } from "../agents/chessUtil";
import { extractMove } from "../agents/parse";
import type { Agent, AgentDefinition, AgentDeps, AgentResult, AgentSettings, ChatMessage, ChatResult, GameView, LogEntry } from "../agents/types";
import type { HarnessConfig } from "./config";
import { variableSources, type VariableContext } from "./contextBlocks";
import { DEFAULT_NOTES_MAX_CHARS, extractNotes } from "./notes";
import { formatAnalysis, hasFinalMove, NO_ROUNDS_LEFT, parseAnalyzeRequests } from "./analysis";
import { renderTemplate } from "./template";
import { describeCutOff } from "../llm/loopGuard";

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
      const result = await playTurn(config, settings, llm, game);
      if (config.keepNotes) {
        // The latest reply with a NOTES block wins (a re-ask answer is often just the move). Reasoning
        // models sometimes write the notes only in their reasoning, so that is the fallback.
        const max = config.notesMaxChars ?? DEFAULT_NOTES_MAX_CHARS;
        const responses = result.log.flatMap((e) => (e.kind === "response" ? [e] : [])).reverse();
        const notes =
          responses.map((r) => extractNotes(r.text, max)).find((n) => n) ??
          responses.map((r) => extractNotes(r.reasoning ?? "", max)).find((n) => n);
        if (notes) result.log.push({ kind: "notes", text: notes });
        else result.log.push({ kind: "note", text: "No NOTES block in the reply; last move's notes are kept." });
      }
      return result;
    },
  };
}

/** One turn: prompt -> model -> move, with the optional pre-check, re-asks and fallback. */
async function playTurn(config: HarnessConfig, settings: AgentSettings, llm: AgentDeps["llm"], game: GameView): Promise<AgentResult> {
  const { system, user } = renderPrompts(config, game);
  const messages: ChatMessage[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });
  const log: LogEntry[] = [{ kind: "prompt", text: system ? `[system]\n${system}\n\n[user]\n${user}` : user }];

  const call = async () => {
    game.onStream?.({ start: true });
    const res = await llm.chat({
      model: settings.model,
      messages,
      reasoningEffort: settings.reasoningEffort,
      signal: game.signal,
      onDelta: (d) => game.onStream?.(d),
    });
    const stopped = res.cutOff ? describeCutOff(res.cutOff) : undefined;
    log.push({ kind: "response", text: res.text, usage: res.usage, reasoning: res.reasoning, ...(stopped ? { stopped } : {}) });
    if (stopped) log.push({ kind: "note", text: `${stopped} Its tokens and cost aren't known: a stopped stream has no usage report.` });
    if (res.hitTokenLimit) log.push({ kind: "note", text: OUT_OF_ROOM_NOTE });
    return res;
  };

  /** What goes back into the conversation as the model's turn: a stopped reply is cut short, so the loop isn't fed back. */
  const asSent = (res: Awaited<ReturnType<typeof call>>) => (res.cutOff ? `${res.text.slice(0, 1500)}\n[cut off]` : res.text);

  // Analysis board: while the reply asks to ANALYZE lines (and gives no final MOVE), play them
  // out and send back the facts, up to the harness's rounds for this move. Asking again after
  // the last round gets one reminder to answer.
  let roundsLeft = config.analysisRounds ?? 0;
  let reminded = false;
  const callWithAnalysis = async () => {
    let res = await call();
    while (config.analysisRounds && !hasFinalMove(res.text)) {
      const lines = parseAnalyzeRequests(res.text);
      if (!lines.length || (roundsLeft === 0 && reminded)) break;
      let reply: string;
      if (roundsLeft > 0) {
        roundsLeft--;
        reply = formatAnalysis(game.fen, lines, game.myColor, roundsLeft);
      } else {
        reminded = true;
        reply = NO_ROUNDS_LEFT;
      }
      messages.push({ role: "assistant", content: asSent(res) }, { role: "user", content: reply });
      log.push({ kind: "analysis", text: reply });
      res = await call();
    }
    return res;
  };

  const reasks = config.precheck ? config.maxReasks : 0;
  let lastAnswer = "";
  let res = await callWithAnalysis();
  for (let attempt = 0; attempt <= reasks; attempt++) {
    const candidate = extractMove(res.text);
    lastAnswer = candidate ?? res.text.trim().slice(0, 60);
    if (!config.precheck) return withReason({ move: lastAnswer, log }, res);

    const san = candidate ? legalSan(game.fen, candidate) : null;
    if (san) return { move: san, log };
    if (attempt === reasks) break;

    const problem = res.cutOff
      ? `${res.cutOff.reason === "loop" ? "Your reply was stopped because it kept repeating itself." : "Your reply was stopped because it ran far too long."} Don't analyze everything again: decide now and answer briefly.`
      : res.hitTokenLimit && !candidate
        ? OUT_OF_ROOM
        : candidate
        ? `${candidate} is not legal in this position.`
        : `I couldn't find a "MOVE: <san>" line in your reply.`;
    const reask = renderReask(config, game, problem);
    messages.push({ role: "assistant", content: asSent(res) }, { role: "user", content: reask });
    log.push({ kind: "prompt", text: reask });
    res = await callWithAnalysis();
  }

  if (config.fallback === "random") {
    const move = game.legalMoves[Math.floor(Math.random() * game.legalMoves.length)];
    log.push({ kind: "note", text: `No legal move after ${reasks + 1} tries; playing random legal move ${move}.` });
    return { move, log };
  }
  log.push({ kind: "note", text: `No legal move after ${reasks + 1} tries; submitting the last answer to the referee.` });
  return withReason({ move: lastAnswer, log }, res);
}

/** What the model is told when its reply hit the provider's length limit before giving a move. */
export const OUT_OF_ROOM =
  "Your reply hit the limit on reply length before you gave a move. Don't analyze everything again: decide now and answer briefly.";
const OUT_OF_ROOM_NOTE = "The reply ended at the provider's limit on reply length.";
/** The same, as a referee rejection ("Your move (empty) was rejected: …. Try again."). */
const OUT_OF_ROOM_REJECTION =
  "your reply hit the limit on reply length before you gave a move; don't analyze everything again, decide now and answer briefly";

/** An empty answer from a reply that ran out of room: tell the referee why, so the model hears it. */
function withReason(result: AgentResult, res: ChatResult): AgentResult {
  return !result.move && res.hitTokenLimit ? { ...result, noMoveReason: OUT_OF_ROOM_REJECTION } : result;
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
