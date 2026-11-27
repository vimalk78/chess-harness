import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import type { AgentDeps, ChatMessage, GameView, LlmClient } from "../agents/types";
import { ANALYSIS_SYSTEM_INSTRUCTIONS, analyzeLine, formatAnalysis, hasFinalMove, MAX_LINES_PER_ROUND, NO_ROUNDS_LEFT, parseAnalyzeRequests } from "./analysis";
import { validateHarness } from "./config";
import { CALCULATOR_PRESET, HARNESSED_PRESET } from "./presets";
import { createHarnessAgent } from "./runner";
import { summarizeHarness } from "./summary";

const fenAfter = (moves: string[]) => {
  const c = new Chess();
  for (const m of moves) c.move(m);
  return c.fen();
};

describe("analysis board: parsing", () => {
  it("reads ANALYZE lines, strips move numbers and annotations, drops duplicates", () => {
    const reply = "Let me check.\nANALYZE: 1. Nxe5 Nxe5 2. d4!?\n**Analyze:** Bc4, Nf6\nANALYZE: Nxe5 Nxe5 d4\nanalyse: 3... Qh4";
    expect(parseAnalyzeRequests(reply)).toEqual([["Nxe5", "Nxe5", "d4"], ["Bc4", "Nf6"], ["Qh4"]]);
    const many = Array.from({ length: 9 }, (_, i) => `ANALYZE: a${(i % 6) + 3} h${(i % 3) + 4} b${i}`).join("\n");
    expect(parseAnalyzeRequests(many)).toHaveLength(MAX_LINES_PER_ROUND);
  });

  it("knows a final MOVE line from an ANALYZE line", () => {
    expect(hasFinalMove("ANALYZE: e4 e5")).toBe(false);
    expect(hasFinalMove("thinking\n**MOVE:** e4")).toBe(true);
    expect(hasFinalMove("I'll remove: nothing")).toBe(false);
  });
});

describe("analysis board: facts at the end of a line", () => {
  // White to move after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4?
  const fen = fenAfter(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nd4"]);

  it("reports captures along the line, material, the side to move and what's attacked", () => {
    const out = analyzeLine(fen, ["Nxe5", "Qg5"], "w");
    expect(out).toContain("4. Nxe5 Qg5");
    expect(out).toContain("Captured along the line: you lose none; opponent loses pawn on e5.");
    expect(out).toContain("Material at the end: White: 1 queen, 2 rooks, 2 bishops, 2 knights, 8 pawns; Black: 1 queen, 2 rooks, 2 bishops, 2 knights, 7 pawns.");
    expect(out).toContain("White (you) to move.");
    expect(out).toMatch(/Your pieces that are attacked:\n- knight e5: attacked by queen g5/);
    expect(out).toMatch(/White's captures: .*Nxf7 \(takes pawn\)/);
  });

  it("numbers lines that start with Black, and says where an illegal line breaks", () => {
    const blackFen = fenAfter(["e4"]);
    expect(analyzeLine(blackFen, ["e5", "Nf3"], "b").split("\n")[0]).toBe("1... e5 2. Nf3");
    const bad = analyzeLine(blackFen, ["e5", "Ke3"], "b");
    expect(bad).toMatch(/^Ke3 is not legal after 1\.\.\. e5\.\nWhite's legal moves there: /);
  });

  it("spots checkmate and stalemate at the end of a line", () => {
    expect(analyzeLine(fenAfter(["f3", "e5", "g4"]), ["Qh4#"], "b")).toContain("CHECKMATE: Black (you) wins.");
    expect(analyzeLine(fenAfter(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"]), ["Qxf7#"], "w")).toContain("CHECKMATE: White (you) wins.");
  });

  it("tells the model how many rounds remain", () => {
    expect(formatAnalysis(fen, [["Nxe5"]], "w", 2)).toMatch(/You have 2 analysis rounds left/);
    expect(formatAnalysis(fen, [["Nxe5"]], "w", 0)).toMatch(/That was your last analysis round/);
  });
});

/** A scripted model: returns the given replies in order and records every request. */
function scripted(replies: string[]) {
  const requests: ChatMessage[][] = [];
  const llm: LlmClient = {
    async chat(req) {
      requests.push(req.messages.map((m) => ({ ...m })));
      return { text: replies[requests.length - 1] ?? "MOVE: e4" };
    },
  };
  return { llm, requests };
}
const deps = (llm: LlmClient): AgentDeps => ({ llm, waitForHumanMove: async () => "" });
const start = (): GameView => {
  const c = new Chess();
  return { history: [], fen: c.fen(), legalMoves: c.moves(), myColor: "w", previousAttempts: [], signal: new AbortController().signal };
};

describe("analysis board: the runner loop", () => {
  it("answers ANALYZE requests until the model gives a MOVE", async () => {
    const m = scripted(["ANALYZE: e4 e5 Nf3\nANALYZE: d4 d5", "ANALYZE: e4 d5 exd5", "Good.\nMOVE: e4"]);
    const r = await createHarnessAgent(CALCULATOR_PRESET, { model: "x" }, deps(m.llm)).nextMove(start());
    expect(r.move).toBe("e4");
    expect(m.requests).toHaveLength(3);
    expect(m.requests[1].at(-1)!.content).toMatch(/Line 1: ANALYZE e4 e5 Nf3\n1\. e4 e5 2\. Nf3/);
    expect(m.requests[1].at(-1)!.content).toMatch(/You have 3 analysis rounds left/);
    expect(r.log.filter((e) => e.kind === "analysis")).toHaveLength(2);
  });

  it("stops at the round limit, reminds once, then falls back to the pre-check", async () => {
    const config = { ...CALCULATOR_PRESET, analysisRounds: 1, maxReasks: 0 };
    const m = scripted(["ANALYZE: e4", "ANALYZE: d4", "ANALYZE: c4"]);
    const r = await createHarnessAgent(config, { model: "x" }, deps(m.llm)).nextMove(start());
    expect(m.requests).toHaveLength(3);
    expect(m.requests[2].at(-1)!.content).toBe(NO_ROUNDS_LEFT);
    // No MOVE line at all: the parser takes the first move it finds, which the pre-check accepts.
    expect(r.move).toBe("c4");
  });

  it("is off for harnesses without it: ANALYZE lines are just text", async () => {
    const m = scripted(["ANALYZE: d4 d5\nMOVE: e4"]);
    await createHarnessAgent(HARNESSED_PRESET, { model: "x" }, deps(m.llm)).nextMove(start());
    expect(m.requests).toHaveLength(1);
  });
});

describe("Calculator preset", () => {
  it("explains the analysis board, keeps its builder checklist, and shows on its card", () => {
    expect(CALCULATOR_PRESET.systemPrompt).toContain(ANALYSIS_SYSTEM_INSTRUCTIONS);
    expect(CALCULATOR_PRESET.analysisRounds).toBe(4);
    expect(CALCULATOR_PRESET.builder?.items.length).toBeGreaterThan(5);
    expect(summarizeHarness(CALCULATOR_PRESET).analysisRounds).toBe(4);
    expect(validateHarness({ ...CALCULATOR_PRESET, analysisRounds: 9 }).ok).toBe(false);
  });
});
