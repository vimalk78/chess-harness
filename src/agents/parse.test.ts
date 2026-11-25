import { describe, expect, it } from "vitest";
import { extractMove } from "./parse";

describe("extractMove", () => {
  it.each([
    ["e4", "e4"],
    ["Nf3", "Nf3"],
    ["I'll play **Nf3**.", "Nf3"],
    ["1... e5", "e5"],
    ["12. Bxf7+", "Bxf7+"],
    ["O-O", "O-O"],
    ["0-0-0", "O-O-O"],
    ["e8=Q#", "e8=Q#"],
    ["g1f3", "g1f3"],
    ["e7e8q", "e7e8q"],
    ["Threats: Bb5 pins. Candidates: Nc3, d4.\nMOVE: d4", "d4"],
    ["move: `Qxd5`", "Qxd5"],
  ])("%s -> %s", (input, expected) => {
    expect(extractMove(input)).toBe(expected);
  });

  it.each(["", "I resign.", "Let me think about this position carefully"])(
    "returns null for %j",
    (input) => {
      expect(extractMove(input)).toBeNull();
    },
  );

  it("does not mistake ordinary words for moves", () => {
    expect(extractMove("A good plan is to castle. Kd2")).toBe("Kd2");
  });
});
