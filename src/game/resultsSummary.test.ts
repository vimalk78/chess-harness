import { describe, expect, it } from "vitest";
import type { ResultFile } from "./resultFile";
import { aimlessness, summarize, summaryTable } from "./resultsSummary";

describe("aimlessness", () => {
  it("counts pieces going straight back, per colour", () => {
    // White's knight: out, back, out again (back to where it came from), back: 3. Black's: out and back once.
    const h = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nc6", "Ng1", "e5"];
    expect(aimlessness(h, "w")).toEqual({ backAndForth: 3, longestQuiet: 4 });
    expect(aimlessness(h, "b")).toEqual({ backAndForth: 1, longestQuiet: 3 });
  });

  it("doesn't count a different piece arriving on the square, and resets the quiet run on captures", () => {
    // No piece returns; Nxf7 is a capture, so the longest quiet run is Nf3 Bc4 Ng5.
    const h = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "Nxf7"];
    expect(aimlessness(h, "w")).toEqual({ backAndForth: 0, longestQuiet: 3 });
  });
});

const side = (over: object) => ({ player: "x", kind: "llm", model: "acme/m1:free", harness: { id: "planner-notes", name: "Planner + notes", source: "preset" }, ...over });
const sf = { player: "Stockfish", kind: "engine", engine: { id: "stockfish:1320", name: "SF", elo: 1320 } };
const file = (result: string, white: object, black: object, extra: object = {}) =>
  ({ format: "chess-agent-arena-result", version: 1, result, termination: "checkmate", reason: "checkmate", plies: 4, pgn: "1. f3 e5 2. g4 Qh4#", white, black, ...extra }) as unknown as ResultFile;

describe("summarize", () => {
  it("groups by player and opponent, from the player's side, and leaves Stockfish's rows out", () => {
    const review = { engine: "SF", depth: 12, white: { accuracy: 40, avgLoss: 300, inaccuracies: 0, mistakes: 0, blunders: 2 }, black: { accuracy: 100, avgLoss: 0, inaccuracies: 0, mistakes: 0, blunders: 0 } };
    const rows = summarize([
      file("0-1", side({ stats: { requests: 2, promptTokens: 0, completionTokens: 0, reasks: 1, refereeRejections: 0, randomMoves: 0, emptyReplies: 0, costUsd: 0.5 } }), sf, { review }),
      file("1-0", sf, side({})),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ player: "Planner + notes · m1 (free)", opponent: "Stockfish 1320", games: 2, wins: 0, draws: 0, losses: 2, accuracy: 40, avgLoss: 300, blundersPerGame: 2, costPerGame: 0.5, avgMoves: 2 });
    expect(summarize([file("1-0", sf, side({}))], { engines: true }).map((r) => r.player).sort()).toEqual(["Planner + notes · m1 (free)", "Stockfish 1320"]);
    expect(summaryTable(rows)).toMatch(/\| Planner \+ notes · m1 \(free\) \| Stockfish 1320 \| 2 \| 0-0-2 \|/);
  });
});
