import { describe, expect, it } from "vitest";
import { HARNESSED_PRESET } from "../harness/presets";
import type { SavedGame } from "./savedGame";
import { buildTranscript } from "./transcript";

const game: SavedGame = {
  version: 1,
  startedAt: Date.UTC(2026, 10, 26, 10, 0),
  savedAt: Date.UTC(2026, 10, 26, 10, 5),
  sides: { w: { agentId: "harnessed", model: "m/a:free", effort: "" }, b: { agentId: "human", model: "", effort: "" } },
  labels: { w: "Harnessed · m/a:free", b: "Human (you)" },
  harnesses: { w: HARNESSED_PRESET, b: null },
  history: ["e4", "e5", "Nf3"],
  result: null,
  reason: null,
  events: [
    { t: 0, event: { type: "turnStart", color: "w" } },
    {
      t: 1000,
      event: {
        type: "log",
        color: "w",
        entries: [
          { kind: "prompt", text: "[system]\nBe careful.\n\n[user]\nYou are White." },
          { kind: "response", text: "MOVE: e9", reasoning: "Thinking ```hard```", usage: { promptTokens: 100, completionTokens: 20 } },
          { kind: "prompt", text: "e9 is not legal." },
          { kind: "response", text: "MOVE: e4", usage: { promptTokens: 150, completionTokens: 5 } },
        ],
      },
    },
    { t: 65_000, event: { type: "move", color: "w", san: "e4", fen: "", history: ["e4"] } },
    { t: 66_000, event: { type: "turnStart", color: "b" } },
    { t: 70_000, event: { type: "move", color: "b", san: "e5", fen: "", history: ["e4", "e5"] } },
    { t: 71_000, event: { type: "turnStart", color: "w" } },
    {
      t: 72_000,
      event: { type: "log", color: "w", entries: [{ kind: "prompt", text: "[system]\nBe careful.\n\n[user]\nAgain." }, { kind: "response", text: "MOVE: Nf3" }] },
    },
    { t: 73_000, event: { type: "illegalAttempt", color: "w", move: "Nf9", error: "not legal" } },
    { t: 74_000, event: { type: "move", color: "w", san: "Nf3", fen: "", history: ["e4", "e5", "Nf3"] } },
    { t: 75_000, event: { type: "turnStart", color: "b" } },
    { t: 76_000, event: { type: "paused", reason: "error", error: "daily limit" } },
  ],
};

describe("buildTranscript", () => {
  const md = buildTranscript(game, "1. e4 e5 2. Nf3 *");

  it("has a header, players and the PGN", () => {
    expect(md).toMatch(/^# Harnessed · m\/a:free vs Human \(you\)/);
    expect(md).toContain("In progress, Black to move");
    expect(md).toContain("### White: Harnessed · m/a:free");
    expect(md).toContain("- Agent: `human` (not a harness)");
    expect(md).toContain("```pgn\n1. e4 e5 2. Nf3 *\n```");
  });

  it("writes each turn with prompt, reasoning, re-ask, reply and timing", () => {
    expect(md).toContain("### 1. e4 (White, 1m 5s)");
    expect(md).toContain("### 1... e5 (Black, 4s)");
    expect(md).toContain("**Re-ask:**");
    expect(md).toContain("(100 prompt tokens, 20 reply tokens)");
    expect(md).toContain("<summary>Reasoning (19 characters)</summary>");
    // Backticks inside the text get a longer fence.
    expect(md).toContain("````text\nThinking ```hard```\n````");
  });

  it("doesn't repeat an unchanged system prompt", () => {
    expect(md.match(/Be careful\./g)).toHaveLength(1);
    expect(md).toContain("**System prompt:** same as before.");
  });

  it("records referee rulings, pauses, the unfinished turn and token totals", () => {
    expect(md).toContain("> **Referee rejected** `Nf9`: not legal");
    expect(md).toContain("### Black to move (in progress)");
    expect(md).toContain("> Paused: daily limit");
    expect(md).toContain("- White: 250 prompt tokens, 25 reply tokens");
  });
});
