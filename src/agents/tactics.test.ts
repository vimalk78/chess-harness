import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { boardFacts } from "./tactics";

const after = (moves: string[]) => {
  const c = new Chess();
  for (const m of moves) c.move(m);
  return c.fen();
};

describe("boardFacts", () => {
  // Position from a real game: White's knight on f7 hangs to the king and forks queen and rook.
  const fork = after(["Nf3", "e5", "Nxe5", "Nf6", "Nxf7", "Nc6"]);

  it("flags the side to move's undefended pieces", () => {
    expect(boardFacts(fork)).toContain("- knight f7: attacked by king e8; defended by nothing  <- UNDEFENDED");
  });

  it("lists opponent pieces under attack with their defenders", () => {
    const facts = boardFacts(fork);
    expect(facts).toContain("- queen d8: attacked by knight f7; defended by king e8");
    expect(facts).toContain("- rook h8: attacked by knight f7; defended by nothing  <- UNDEFENDED");
  });

  it("lists captures with the captured piece, and checks", () => {
    const facts = boardFacts(fork);
    expect(facts).toContain("Your captures: Nxd8 (takes queen), Nxh8 (takes rook)");
    expect(facts).toContain("Your checking moves: Nd6+");
  });

  it("says when you are in check", () => {
    expect(boardFacts(after(["e4", "f5", "Qh5+"]))).toContain("You are IN CHECK.");
  });

  it("handles the quiet starting position", () => {
    const facts = boardFacts(new Chess().fen());
    expect(facts).toContain("Your pieces that are attacked:\n- none");
    expect(facts).toContain("Your captures: none");
    expect(facts).not.toContain("IN CHECK");
  });
});
