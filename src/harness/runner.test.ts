import { Chess } from "chess.js";
import { describe, expect, it, vi } from "vitest";
import type { AgentDeps, ChatMessage, GameView, LlmClient, StreamDelta } from "../agents/types";
import type { HarnessConfig } from "./config";
import { HARNESSED_PRESET, RAW_PRESET, TACTICAL_PRESET } from "./presets";
import { createHarnessAgent, renderPrompts } from "./runner";

function fakeLlm(replies: string[], reasoning?: string) {
  const calls: ChatMessage[][] = [];
  const llm: LlmClient = {
    chat: vi.fn<LlmClient["chat"]>(async (req) => {
      calls.push(req.messages.map((m) => ({ ...m })));
      req.onDelta?.({ reasoning: "thinking…" });
      req.onDelta?.({ content: replies[calls.length - 1] ?? "" });
      return { text: replies[calls.length - 1] ?? "", usage: { promptTokens: 10, completionTokens: 5 }, reasoning };
    }),
  };
  return { llm, calls };
}

function view(history: string[], extra: Partial<GameView> = {}): GameView {
  const chess = new Chess();
  for (const m of history) chess.move(m);
  return {
    history,
    fen: chess.fen(),
    legalMoves: chess.moves(),
    myColor: chess.turn(),
    previousAttempts: [],
    signal: new AbortController().signal,
    ...extra,
  };
}

const deps = (llm: LlmClient): AgentDeps => ({ llm, waitForHumanMove: async () => "e4" });
const run = (config: HarnessConfig, llm: LlmClient, game: GameView) => createHarnessAgent(config, { model: "m" }, deps(llm)).nextMove(game);

describe("Raw preset", () => {
  it("sends exactly today's Raw prompt: PGN only, no system message", async () => {
    const { llm, calls } = fakeLlm(["I'll play Nf3"]);
    const res = await run(RAW_PRESET, llm, view(["e4", "e5"]));
    expect(res.move).toBe("Nf3");
    expect(calls[0]).toEqual([
      {
        role: "user",
        content:
          "You are playing chess as White. The game so far in PGN: 1. e4 e5\nReply with only your next move in standard algebraic notation.",
      },
    ]);
  });

  it("passes referee rejections through {{errors}} and does not check legality", async () => {
    const { llm, calls } = fakeLlm(["Ke5"]);
    const res = await run(RAW_PRESET, llm, view([], { previousAttempts: [{ move: "e5", error: "e5 is not a legal move in this position" }] }));
    expect(res.move).toBe("Ke5");
    expect(calls[0][0].content).toMatch(/notation\.\nYour move e5 was rejected: e5 is not a legal move in this position\. Try again\.$/);
  });

  it("returns the raw text when no move can be found, so the referee can reject it", async () => {
    const { llm } = fakeLlm(["I resign."]);
    expect((await run(RAW_PRESET, llm, view([]))).move).toBe("I resign.");
  });
});

describe("Harnessed preset", () => {
  it("sends system prompt, FEN, board and legal moves", async () => {
    const { llm, calls } = fakeLlm(["Threats: none.\nMOVE: Nf3"]);
    const res = await run(HARNESSED_PRESET, llm, view(["e4", "e5"]));
    expect(res.move).toBe("Nf3");
    const [system, user] = calls[0];
    expect(system).toMatchObject({ role: "system", content: expect.stringContaining("Opportunities") });
    expect(user.content).toContain("FEN: rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq");
    expect(user.content).toContain("r  n  b  q  k  b  n  r");
    expect(user.content).toContain("Legal moves: a3, a4");
    expect(user.content).not.toContain("Board facts");
  });

  it("re-asks with {{problem}} when the pre-check fails", async () => {
    const { llm, calls } = fakeLlm(["MOVE: Ke3", "MOVE: d4"]);
    const res = await run(HARNESSED_PRESET, llm, view([]));
    expect(res.move).toBe("d4");
    expect(calls[1].at(-2)).toEqual({ role: "assistant", content: "MOVE: Ke3" });
    expect(calls[1].at(-1)!.content).toMatch(/^Ke3 is not legal in this position\. Choose one move from this list/);
  });

  it("falls back to a random legal move and says so", async () => {
    const { llm } = fakeLlm(["hmm", "MOVE: Ke3", "still thinking"]);
    const game = view([]);
    const res = await run(HARNESSED_PRESET, llm, game);
    expect(llm.chat).toHaveBeenCalledTimes(3);
    expect(game.legalMoves).toContain(res.move);
    expect(res.log.at(-1)).toMatchObject({ kind: "note", text: expect.stringMatching(/random legal move/) });
  });

  it("accepts UCI and returns SAN", async () => {
    const { llm } = fakeLlm(["MOVE: g1f3"]);
    expect((await run(HARNESSED_PRESET, llm, view([]))).move).toBe("Nf3");
  });
});

describe("Tactical preset", () => {
  it("adds attacks, captures and checks", async () => {
    const { llm, calls } = fakeLlm(["MOVE: Nxd8"]);
    const res = await run(TACTICAL_PRESET, llm, view(["Nf3", "e5", "Nxe5", "Nf6", "Nxf7", "Nc6"]));
    expect(res.move).toBe("Nxd8");
    expect(calls[0][1].content).toContain("Your captures: Nxd8 (takes queen), Nxh8 (takes rook)");
    expect(calls[0][1].content).toContain("- knight f7: attacked by king e8; defended by nothing  <- UNDEFENDED");
  });
});

describe("harness runner", () => {
  const custom: HarnessConfig = { ...HARNESSED_PRESET, id: "c", name: "Custom", maxReasks: 1, fallback: "submit" };

  it("submit fallback hands the last answer to the referee", async () => {
    const { llm } = fakeLlm(["MOVE: Ke3", "MOVE: Qh7"]);
    const res = await run(custom, llm, view([]));
    expect(res.move).toBe("Qh7");
    expect(res.log.at(-1)).toMatchObject({ kind: "note", text: expect.stringMatching(/submitting the last answer/) });
  });

  it("omits the system message when the system prompt is empty", async () => {
    const { llm, calls } = fakeLlm(["MOVE: e4"]);
    await run({ ...custom, systemPrompt: "" }, llm, view([]));
    expect(calls[0].map((m) => m.role)).toEqual(["user"]);
  });

  it("streams deltas with a start marker before each call", async () => {
    const { llm } = fakeLlm(["MOVE: Ke3", "MOVE: e4"]);
    const deltas: StreamDelta[] = [];
    await run(custom, llm, view([], { onStream: (d) => deltas.push(d) }));
    expect(deltas).toEqual([
      { start: true },
      { reasoning: "thinking…" },
      { content: "MOVE: Ke3" },
      { start: true },
      { reasoning: "thinking…" },
      { content: "MOVE: e4" },
    ]);
  });

  it("keeps reasoning in the log", async () => {
    const { llm } = fakeLlm(["MOVE: e4"], "deep thoughts");
    const res = await run(custom, llm, view([]));
    expect(res.log[1]).toMatchObject({ kind: "response", reasoning: "deep thoughts" });
  });

  it("renderPrompts fills variables for the preview", () => {
    const p = renderPrompts({ ...custom, systemPrompt: "Play as {{side}}", turnPrompt: "{{last_move}} / {{unknown}}" }, view(["e4"]));
    expect(p).toEqual({ system: "Play as Black", user: "White played e4 / {{unknown}}" });
  });
});

describe("stopped replies (loop guard)", () => {
  it("logs the stop, sends back only the start of the reply, and asks for a short answer", async () => {
    const calls: ChatMessage[][] = [];
    const looping = "Is Qxb2 safe? " + "Q? ".repeat(2000);
    const llm: LlmClient = {
      chat: async (req) => {
        calls.push(req.messages.map((m) => ({ ...m })));
        return calls.length === 1
          ? { text: looping, cutOff: { reason: "loop", sample: "Q?" } }
          : { text: "MOVE: Nf3", usage: { promptTokens: 10, completionTokens: 5 } };
      },
    };
    const res = await run(HARNESSED_PRESET, llm, view([]));
    expect(res.move).toBe("Nf3");
    expect(res.log).toContainEqual(expect.objectContaining({ kind: "response", stopped: expect.stringMatching(/repeating itself/) }));
    expect(res.log).toContainEqual(expect.objectContaining({ kind: "note", text: expect.stringMatching(/^Stopped the reply: it was repeating itself \("Q\?…"\)/) }));
    const second = calls[1];
    const sentBack = second[second.length - 2];
    expect(sentBack.role).toBe("assistant");
    expect(sentBack.content.length).toBeLessThan(1600);
    expect(sentBack.content).toMatch(/\[cut off\]$/);
    expect(second[second.length - 1].content).toMatch(/^Your reply was stopped because it kept repeating itself\. Don't analyze everything again: decide now and answer briefly\./);
  });
});
