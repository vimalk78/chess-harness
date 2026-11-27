import { describe, expect, it } from "vitest";
import { reviewMoves, winPercent, type PositionEval } from "./review";

describe("game review", () => {
  it("uses Lichess's winning-chance curve", () => {
    expect(winPercent(0)).toBe(50);
    expect(winPercent(1000)).toBeGreaterThan(97);
    expect(winPercent(-300)).toBeCloseTo(100 - winPercent(300));
  });

  it("judges each move by the drop in the mover's winning chances", () => {
    // Evals are from the side to move: 1. e4 (best, +30 for White) e5 (gives +110) 2. Qh5 (drops to -150 for White).
    const evals: PositionEval[] = [
      { cp: 30, best: "e2e4" },
      { cp: -30, best: "c7c5" },
      { cp: 110, best: "g1f3" },
      { cp: 150, best: "b8c6" },
    ];
    const r = reviewMoves(["e4", "e5", "Qh5"], evals, "SF", 12);
    expect(r.moves[0]).toMatchObject({ eval: 30, best: "e4", loss: 0, winDrop: 0, accuracy: 100 });
    expect(r.moves[0].class).toBeUndefined();
    expect(r.moves[1]).toMatchObject({ eval: 110, best: "c5", loss: 80 });
    expect(r.moves[1].class).toBe("inaccuracy");
    expect(r.moves[2]).toMatchObject({ eval: -150, best: "Nf3", loss: 260, class: "blunder" });
    expect(r.white).toMatchObject({ blunders: 1, mistakes: 0, inaccuracies: 0, avgLoss: 130 });
    expect(r.black).toMatchObject({ inaccuracies: 1, avgLoss: 80 });
    expect(r.white.accuracy).toBeLessThan(r.black.accuracy);
  });

  it("scores delivering checkmate and missing a mate", () => {
    const fools = ["f3", "e5", "g4", "Qh4#"];
    const evals: PositionEval[] = [{ cp: 30, best: "e2e4" }, { cp: 60, best: "e7e5" }, { cp: -90, best: "e2e4" }, { mate: 1, best: "d8h4" }, { mate: 0 }];
    const r = reviewMoves(fools, evals, "SF", 12);
    expect(r.moves[2]).toMatchObject({ class: "blunder", mate: -1 });
    expect(r.moves[3]).toMatchObject({ loss: 0, eval: -1000, mate: 0 });
    expect(() => reviewMoves(fools, evals.slice(1), "SF", 12)).toThrow();
  });
});
