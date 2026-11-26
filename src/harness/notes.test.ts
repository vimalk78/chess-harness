import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import type { AgentDeps, GameView, LlmClient } from "../agents/types";
import { GameRunner, type GameEvent } from "../game/referee";
import { latestNotes } from "../game/savedGame";
import { buildTranscript } from "../game/transcript";
import { validateHarness } from "./config";
import { extractNotes } from "./notes";
import { HARNESSED_PRESET, NOTES_PRESET } from "./presets";
import { createHarnessAgent, renderPrompts } from "./runner";

describe("extractNotes", () => {
  it("takes the NOTES block up to the MOVE line", () => {
    expect(extractNotes("Analysis…\nNOTES:\n- plan: castle\n- watch Bb4\nMOVE: O-O")).toBe("- plan: castle\n- watch Bb4");
  });
  it("accepts markdown and same-line notes, and uses the last block", () => {
    expect(extractNotes("**NOTES:** draft\n...\n**Notes:** final plan: f4\n**MOVE:** f4")).toBe("final plan: f4");
  });
  it("returns null when there are no notes", () => {
    expect(extractNotes("MOVE: e4")).toBeNull();
    expect(extractNotes("NOTES:\nMOVE: e4")).toBeNull();
  });
  it("trims long notes", () => {
    const n = extractNotes(`NOTES: ${"x".repeat(500)}\nMOVE: e4`, 100)!;
    expect(n).toHaveLength(100);
    expect(n.endsWith("…")).toBe(true);
  });
});

describe("notes settings", () => {
  it("validates keepNotes and notesMaxChars", () => {
    expect(validateHarness({ ...HARNESSED_PRESET, keepNotes: true, notesMaxChars: 500 })).toMatchObject({ ok: true, config: { keepNotes: true, notesMaxChars: 500 } });
    expect(validateHarness({ ...HARNESSED_PRESET, notesMaxChars: 50, keepNotes: true }).ok).toBe(false);
    expect(validateHarness({ ...HARNESSED_PRESET, keepNotes: "yes" }).ok).toBe(false);
    // Off is stored as absent, so existing harness files are unchanged.
    const off = validateHarness({ ...HARNESSED_PRESET, keepNotes: false, notesMaxChars: 500 });
    expect(off.ok && "keepNotes" in off.config).toBe(false);
  });

  it("the preset passes notes back through {{my_notes}}", () => {
    const chess = new Chess();
    const game = { history: [], fen: chess.fen(), legalMoves: chess.moves(), myColor: "w" as const, previousAttempts: [] };
    expect(renderPrompts(NOTES_PRESET, game).user).toContain("(check them against the position): (none yet)");
    expect(renderPrompts(NOTES_PRESET, { ...game, myNotes: "plan: e4, Nf3" }).user).toContain("position): plan: e4, Nf3");
    expect(NOTES_PRESET.keepNotes).toBe(true);
  });
});

/** A model that replies with a move and notes saying which turn it is, and records what it was told. */
function noteTaker(label: string) {
  const seen: string[] = [];
  let n = 0;
  const llm: LlmClient = {
    async chat(req) {
      const user = req.messages.filter((m) => m.role === "user").at(-1)!.content;
      seen.push(/position\): (.*)/.exec(user)?.[1] ?? "");
      const move = /Legal moves: ([^,\s]+)/.exec(user)![1];
      n++;
      return { text: `NOTES: ${label} note ${n}\nMOVE: ${move}` };
    },
  };
  return { llm, seen };
}

const deps = (llm: LlmClient): AgentDeps => ({ llm, waitForHumanMove: async () => "" });

describe("notes in a game", () => {
  it("each side gets back only its own latest notes", async () => {
    const w = noteTaker("white");
    const b = noteTaker("black");
    const events: GameEvent[] = [];
    const runner = new GameRunner(
      { white: createHarnessAgent(NOTES_PRESET, { model: "m" }, deps(w.llm)), black: createHarnessAgent(NOTES_PRESET, { model: "m" }, deps(b.llm)), maxPlies: 6 },
      (e) => events.push(e),
    );
    await runner.start();
    expect(w.seen).toEqual(["(none yet)", "white note 1", "white note 2"]);
    expect(b.seen).toEqual(["(none yet)", "black note 1", "black note 2"]);
    const saved = events.map((event) => ({ t: 0, event }));
    expect(latestNotes(saved)).toEqual({ w: "white note 3", b: "black note 3" });
  });

  it("resumes with each side's saved notes", async () => {
    const w = noteTaker("white");
    const runner = new GameRunner(
      { white: createHarnessAgent(NOTES_PRESET, { model: "m" }, deps(w.llm)), black: createHarnessAgent(NOTES_PRESET, { model: "m" }, deps(w.llm)), maxPlies: 1, startNotes: { w: "saved plan" } },
      () => {},
    );
    await runner.start();
    expect(w.seen[0]).toBe("saved plan");
  });

  it("falls back to notes written in the reasoning, and keeps old notes when there are none", async () => {
    const game = (myNotes?: string): GameView => {
      const c = new Chess();
      return { history: [], fen: c.fen(), legalMoves: c.moves(), myColor: "w", previousAttempts: [], signal: new AbortController().signal, myNotes };
    };
    const reasoned: LlmClient = { chat: async () => ({ text: "MOVE: e4", reasoning: "…\nNOTES: from reasoning\n" }) };
    const r1 = await createHarnessAgent(NOTES_PRESET, { model: "m" }, deps(reasoned)).nextMove(game());
    expect(r1.log.at(-1)).toEqual({ kind: "notes", text: "from reasoning" });

    const bare: LlmClient = { chat: async () => ({ text: "MOVE: e4" }) };
    const r2 = await createHarnessAgent(NOTES_PRESET, { model: "m" }, deps(bare)).nextMove(game("old"));
    expect(r2.log.at(-1)).toMatchObject({ kind: "note", text: expect.stringMatching(/notes are kept/) });
    expect(r2.log.some((e) => e.kind === "notes")).toBe(false);
  });

  it("appear in the transcript", () => {
    const md = buildTranscript(
      {
        version: 1, startedAt: 0, savedAt: 0,
        sides: { w: { agentId: "harnessed-notes", model: "m", effort: "" }, b: { agentId: "human", model: "", effort: "" } },
        labels: { w: "W", b: "B" }, harnesses: { w: NOTES_PRESET, b: null }, history: ["e4"], result: null, reason: null,
        events: [
          { t: 0, event: { type: "log", color: "w", entries: [{ kind: "notes", text: "plan: d4 next" }] } },
          { t: 1, event: { type: "move", color: "w", san: "e4", fen: "", history: ["e4"] } },
        ],
      },
      "1. e4 *",
    );
    expect(md).toContain("**Notes kept for next move:**\n\n```text\nplan: d4 next\n```");
  });
});
