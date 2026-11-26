import { describe, expect, it } from "vitest";
import { HARNESSED_PRESET } from "../harness/presets";
import { historyFromPgn, isUnfinished, parseSavedGame } from "./savedGame";

const fallback = (id: string) => (id === "harnessed" ? HARNESSED_PRESET : null);
const label = (s: { agentId: string; model: string }) => `${s.agentId} · ${s.model}`;

// The shape of a log downloaded before saved games had a version or labels.
const oldLog = {
  pgn: "1. e4 e5 *",
  sides: {
    w: { agentId: "harnessed", model: "m/a:free", effort: "" },
    b: { agentId: "human", model: "", effort: "" },
  },
  harnesses: { w: HARNESSED_PRESET, b: null },
  result: null,
  reason: null,
  history: ["e4", "e5"],
  events: [
    { t: 1000, event: { type: "turnStart", color: "w" } },
    { t: 2000, event: { type: "move", color: "w", san: "e4", fen: "x", history: ["e4"] } },
    { t: 3000, event: { type: "bogus" } },
  ],
};

describe("parseSavedGame", () => {
  it("reads an older downloaded log", () => {
    const r = parseSavedGame(oldLog, fallback, label);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.game.history).toEqual(["e4", "e5"]);
    expect(r.game.harnesses.w?.id).toBe("harnessed");
    expect(r.game.harnesses.b).toBeNull();
    expect(r.game.labels.w).toBe("harnessed · m/a:free");
    expect(r.game.events).toHaveLength(2); // unknown event dropped
    expect(r.game.startedAt).toBe(1000);
    expect(isUnfinished(r.game)).toBe(true);
  });

  it("looks up a harness the log didn't record", () => {
    const r = parseSavedGame({ ...oldLog, harnesses: undefined }, fallback, label);
    expect(r.ok && r.game.harnesses.w?.id).toBe("harnessed");
  });

  it("keeps saved labels and results", () => {
    const r = parseSavedGame({ ...oldLog, labels: { w: "W", b: "B" }, result: "1/2-1/2", reason: "agreed" }, fallback, label);
    expect(r.ok && r.game.labels).toEqual({ w: "W", b: "B" });
    expect(r.ok && isUnfinished(r.game)).toBe(false);
  });

  it("rejects broken input", () => {
    expect(parseSavedGame("nope", fallback, label)).toMatchObject({ ok: false });
    expect(parseSavedGame({ ...oldLog, history: ["e4", "e4"] }, fallback, label)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/1\.\.\. e4 is not legal/),
    });
    expect(parseSavedGame({ ...oldLog, sides: undefined }, fallback, label)).toMatchObject({ ok: false });
    expect(parseSavedGame({ ...oldLog, harnesses: { w: { name: "x" }, b: null } }, fallback, label)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/White's harness is invalid/),
    });
  });
});

describe("historyFromPgn", () => {
  it("reads moves and ignores headers", () => {
    const r = historyFromPgn('[White "a"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 {comment} Nc6 *');
    expect(r).toEqual({ ok: true, history: ["e4", "e5", "Nf3", "Nc6"] });
  });

  it("reports an unreadable PGN", () => {
    expect(historyFromPgn("1. e4 e4")).toMatchObject({ ok: false });
  });
});
