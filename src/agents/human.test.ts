import { describe, expect, it } from "vitest";
import { humanAgent } from "./human";

describe("human agent", () => {
  it("waits for the board move", async () => {
    const llm = { chat: async () => ({ text: "" }) };
    const game = { history: [], fen: "", legalMoves: [], myColor: "w" as const, previousAttempts: [], signal: new AbortController().signal };
    const res = await humanAgent.create({ model: "" }, { llm, waitForHumanMove: async () => "d4" }).nextMove(game);
    expect(res).toEqual({ move: "d4", log: [] });
  });
});
