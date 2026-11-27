import { describe, expect, it } from "vitest";
import { ATTACKER_NOTES_PRESET, LISTS_PRESET, RAW_PRESET, TACTICAL_PRESET } from "./presets";
import { summarizeHarness } from "./summary";

describe("summarizeHarness", () => {
  it("describes Raw as moves only with no checking", () => {
    const s = summarizeHarness(RAW_PRESET);
    expect(s.blocks).toEqual([]);
    expect(s.usesFen).toBe(false);
    expect(s.checking).toMatch(/no pre-check/);
    expect(s.approxTokens).toBeGreaterThan(10);
  });

  it("lists context blocks and flags borderline ones", () => {
    const s = summarizeHarness(LISTS_PRESET);
    expect(s.blocks.map((b) => b.name)).toEqual(expect.arrayContaining(["pieces", "legal_moves_by_piece", "move_safety"]));
    expect(s.blocks.find((b) => b.name === "move_safety")?.borderline).toBe(true);
    expect(s.usesFen).toBe(false);
    expect(summarizeHarness(TACTICAL_PRESET).usesFen).toBe(true);
  });

  it("notices notes and pre-check settings", () => {
    const s = summarizeHarness(ATTACKER_NOTES_PRESET);
    expect(s.usesNotes).toBe(true);
    expect(s.checking).toBe("pre-check, 2 re-asks, then a random legal move");
    expect(summarizeHarness(TACTICAL_PRESET).usesNotes).toBe(false);
  });
});
