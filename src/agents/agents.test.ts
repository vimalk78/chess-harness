import { Chess } from "chess.js";
import { describe, expect, it, vi } from "vitest";
import { harnessedAgent, tacticalAgent } from "./harnessed";
import { humanAgent } from "./human";
import { rawAgent } from "./raw";
import type { AgentDeps, ChatMessage, GameView, LlmClient } from "./types";

function fakeLlm(replies: string[]) {
  const calls: ChatMessage[][] = [];
  const llm: LlmClient = {
    chat: vi.fn<LlmClient["chat"]>(async (req) => {
      calls.push(req.messages.map((m) => ({ ...m })));
      return { text: replies[calls.length - 1] ?? "", usage: { promptTokens: 10, completionTokens: 5 } };
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

describe("raw agent", () => {
  it("sends only the PGN, never the FEN or legal moves", async () => {
    const { llm, calls } = fakeLlm(["I'll play Nf3"]);
    const agent = rawAgent.create({ model: "m" }, deps(llm));
    const res = await agent.nextMove(view(["e4", "e5"]));
    expect(res.move).toBe("Nf3");
    const prompt = calls[0][0].content;
    expect(prompt).toContain("as White");
    expect(prompt).toContain("1. e4 e5");
    expect(prompt).not.toContain("rnbqkbnr");
    expect(prompt).not.toMatch(/legal/i);
  });

  it("does not check legality and passes rejections through bare", async () => {
    const { llm, calls } = fakeLlm(["Ke5"]);
    const agent = rawAgent.create({ model: "m" }, deps(llm));
    const res = await agent.nextMove(view([], { previousAttempts: [{ move: "e5", error: "e5 is not a legal move in this position" }] }));
    expect(res.move).toBe("Ke5");
    expect(calls[0][0].content).toContain("Your move e5 was rejected: e5 is not a legal move in this position. Try again.");
  });

  it("returns the raw text when no move can be found, so the referee can reject it", async () => {
    const { llm } = fakeLlm(["I resign."]);
    const res = await rawAgent.create({ model: "m" }, deps(llm)).nextMove(view([]));
    expect(res.move).toBe("I resign.");
  });

  it("passes model and reasoning effort through", async () => {
    const { llm } = fakeLlm(["e4"]);
    await rawAgent.create({ model: "x/y", reasoningEffort: "low" }, deps(llm)).nextMove(view([]));
    expect(llm.chat).toHaveBeenCalledWith(expect.objectContaining({ model: "x/y", reasoningEffort: "low" }));
  });
});

describe("harnessed agent", () => {
  it("sends FEN, board and legal moves, and returns the MOVE line", async () => {
    const { llm, calls } = fakeLlm(["Threats: none.\nCandidates: Nf3, Nc3\nMOVE: Nf3"]);
    const res = await harnessedAgent.create({ model: "m" }, deps(llm)).nextMove(view(["e4", "e5"]));
    expect(res.move).toBe("Nf3");
    const [system, user] = calls[0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("MOVE:");
    expect(user.content).toContain("FEN: rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq");
    expect(user.content).toContain("Legal moves (");
    expect(user.content).toContain("Nf3");
    expect(user.content).toContain("r  n  b  q  k  b  n  r");
  });

  it("re-asks with the exact problem when the move is illegal", async () => {
    const { llm, calls } = fakeLlm(["MOVE: Ke3", "MOVE: d4"]);
    const res = await harnessedAgent.create({ model: "m" }, deps(llm)).nextMove(view([]));
    expect(res.move).toBe("d4");
    const reask = calls[1].at(-1)!;
    expect(reask.content).toContain("Ke3 is not legal");
    expect(calls[1].at(-2)).toEqual({ role: "assistant", content: "MOVE: Ke3" });
  });

  it("falls back to a random legal move and says so", async () => {
    const { llm } = fakeLlm(["hmm", "MOVE: Ke3", "still thinking"]);
    const game = view([]);
    const res = await harnessedAgent.create({ model: "m" }, deps(llm)).nextMove(game);
    expect(llm.chat).toHaveBeenCalledTimes(3);
    expect(game.legalMoves).toContain(res.move);
    expect(res.log.at(-1)).toMatchObject({ kind: "note", text: expect.stringMatching(/random legal move/) });
  });

  it("accepts UCI and returns SAN", async () => {
    const { llm } = fakeLlm(["MOVE: g1f3"]);
    const res = await harnessedAgent.create({ model: "m" }, deps(llm)).nextMove(view([]));
    expect(res.move).toBe("Nf3");
  });
});

describe("human agent", () => {
  it("waits for the board move", async () => {
    const res = await humanAgent.create({ model: "" }, { llm: fakeLlm([]).llm, waitForHumanMove: async () => "d4" }).nextMove(view([]));
    expect(res).toEqual({ move: "d4", log: [] });
  });
});

describe("tactical agent", () => {
  it("adds rules-derived board facts to the harnessed prompt", async () => {
    const { llm, calls } = fakeLlm(["MOVE: Nxd8"]);
    const res = await tacticalAgent.create({ model: "m" }, deps(llm)).nextMove(view(["Nf3", "e5", "Nxe5", "Nf6", "Nxf7", "Nc6"]));
    expect(res.move).toBe("Nxd8");
    expect(calls[0][1].content).toContain("Board facts (computed from the rules, not an engine");
    expect(calls[0][1].content).toContain("Nxd8 (takes queen)");
  });

  it("plain harnessed prompt has no board facts but asks about opportunities", async () => {
    const { llm, calls } = fakeLlm(["MOVE: e4"]);
    await harnessedAgent.create({ model: "m" }, deps(llm)).nextMove(view([]));
    expect(calls[0][1].content).not.toContain("Board facts");
    expect(calls[0][0].content).toContain("Opportunities");
  });

  it("keeps the model's reasoning in the log", async () => {
    const llm: LlmClient = { chat: async () => ({ text: "MOVE: e4", reasoning: "thinking hard" }) };
    const res = await harnessedAgent.create({ model: "m" }, deps(llm)).nextMove(view([]));
    expect(res.log[1]).toMatchObject({ kind: "response", reasoning: "thinking hard" });
  });
});
