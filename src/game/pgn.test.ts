import { describe, expect, it } from "vitest";
import { buildPgn, movetext } from "./pgn";

describe("pgn", () => {
  it("builds a PGN with headers and result", () => {
    const pgn = buildPgn(["e4", "e5", "Nf3"], {
      white: "Harnessed (anthropic/claude-haiku-5.5)",
      black: "Raw (anthropic/claude-opus-5.5)",
      result: "1-0",
      termination: "Black forfeits",
      date: new Date(2026, 10, 26),
    });
    expect(pgn).toContain('[White "Harnessed (anthropic/claude-haiku-5.5)"]');
    expect(pgn).toContain('[Date "2026.11.26"]');
    expect(pgn).toContain('[Termination "Black forfeits"]');
    expect(pgn.trimEnd()).toMatch(/1\. e4 e5 2\. Nf3 1-0$/);
  });

  it("formats movetext", () => {
    expect(movetext([])).toBe("");
    expect(movetext(["e4", "e5", "Nf3"])).toBe("1. e4 e5 2. Nf3");
  });
});
