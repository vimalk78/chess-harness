import { describe, expect, it } from "vitest";
import { buildPgn } from "./pgn";
import { buildResultFile, resultFileName, sideStats, terminationOf, validateResultFile, type ResultFile } from "./resultFile";
import type { SavedGame } from "./savedGame";
import { ATTACKER_PRESET, HARNESSED_PRESET, LIBRARY, PRESETS } from "../harness/presets";

const FOOLS_MATE = ["f3", "e5", "g4", "Qh4#"];

function game(over: Partial<SavedGame> = {}): SavedGame {
  const history = over.history ?? FOOLS_MATE;
  const usage = { promptTokens: 100, completionTokens: 50, costUsd: 0.001 };
  return {
    version: 1,
    startedAt: Date.UTC(2026, 10, 27, 8, 0),
    savedAt: Date.UTC(2026, 10, 27, 8, 5),
    sides: { w: { agentId: "harnessed", model: "acme/small-1", effort: "" }, b: { agentId: "attacker", model: "acme/big-2:free", effort: "high" } },
    labels: { w: "Harnessed · acme/small-1", b: "Attacker · acme/big-2:free (high)" },
    harnesses: { w: HARNESSED_PRESET, b: ATTACKER_PRESET },
    history,
    result: "0-1",
    reason: "checkmate",
    events: [
      { t: 1, event: { type: "log", color: "w", entries: [{ kind: "prompt", text: "p" }, { kind: "response", text: "MOVE: Ke2", usage }, { kind: "response", text: "", usage }, { kind: "note", text: "No legal move after 2 tries; playing random legal move f3." }] } },
      { t: 2, event: { type: "move", color: "w", san: "f3", fen: "", history: ["f3"] } },
      { t: 3, event: { type: "log", color: "b", entries: [{ kind: "response", text: "MOVE: e5", usage }] } },
      { t: 4, event: { type: "move", color: "b", san: "e5", fen: "", history: ["f3", "e5"] } },
      { t: 5, event: { type: "illegalAttempt", color: "w", move: "Kf2", error: "illegal" } },
      { t: 6, event: { type: "log", color: "w", entries: [{ kind: "response", text: "MOVE: Kf2", usage }, { kind: "response", text: "MOVE: g4", usage }] } },
      { t: 7, event: { type: "move", color: "w", san: "g4", fen: "", history: ["f3", "e5", "g4"] } },
      { t: 8, event: { type: "log", color: "b", entries: [{ kind: "response", text: "MOVE: Qh4#", usage }] } },
      { t: 9, event: { type: "move", color: "b", san: "Qh4#", fen: "", history: FOOLS_MATE } },
      { t: Date.UTC(2026, 10, 27, 8, 4), event: { type: "gameOver", result: "0-1", reason: "checkmate" } },
    ],
    ...over,
  };
}

const opts = (g: SavedGame) => ({
  pgn: buildPgn(g.history, { white: g.labels.w, black: g.labels.b, result: g.result!, termination: g.reason! }),
  arenaVersion: "abc1234",
  presets: PRESETS,
  community: [],
});

function build(g = game(), extra: object = {}): ResultFile {
  const r = buildResultFile(g, { ...opts(g), ...extra });
  if (!r.ok) throw new Error(r.error);
  return r.file;
}

describe("result files", () => {
  it("counts requests, tokens, re-asks, rejections, random moves and empty replies per side", () => {
    expect(sideStats(game(), "w")).toEqual({
      requests: 4, promptTokens: 400, completionTokens: 200, costUsd: 0.004, reasks: 1, refereeRejections: 1, randomMoves: 1, emptyReplies: 1, analysisRounds: 0,
    });
    expect(sideStats(game(), "b")).toMatchObject({ requests: 2, reasks: 0, refereeRejections: 0 });
  });

  it("builds a file that passes validation, referencing presets by id", () => {
    const f = build(game(), { submittedBy: "  someone  ", comment: "fool's mate" });
    expect(f).toMatchObject({ result: "0-1", termination: "checkmate", plies: 4, submittedBy: "someone", startedAt: "2026-11-27T08:00:00.000Z", finishedAt: "2026-11-27T08:04:00.000Z" });
    expect(f.white.harness).toEqual({ id: "harnessed", name: HARNESSED_PRESET.name, source: "preset" });
    expect(f.black).toMatchObject({ model: "acme/big-2:free", effort: "high" });
    expect(validateResultFile(JSON.parse(JSON.stringify(f)), LIBRARY)).toMatchObject({ ok: true, adjudicated: false });
    expect(resultFileName(f)).toMatch(/^2026-11-27-harnessed-small-1-vs-attacker-big-2-free-[a-z0-9]+\.json$/);
  });

  it("includes the full harness for custom harnesses and changed presets", () => {
    const custom = { ...HARNESSED_PRESET, id: "abc", name: "Mine" };
    const f = build(game({ sides: { ...game().sides, w: { agentId: "custom:abc", model: "m/x", effort: "" } }, harnesses: { w: custom, b: { ...ATTACKER_PRESET, maxReasks: 5 } } }));
    expect(f.white.harness).toMatchObject({ source: "custom", config: custom });
    expect(f.black.harness).toMatchObject({ source: "preset", id: "attacker", config: { maxReasks: 5 } });
    expect(validateResultFile(f, LIBRARY).ok).toBe(true);
  });

  it("records engine sides with their strength, and validates them", () => {
    const f = build(game({ sides: { ...game().sides, w: { agentId: "stockfish:1600", model: "", effort: "" } }, harnesses: { w: null, b: ATTACKER_PRESET }, labels: { w: "Stockfish 19 lite · Elo 1600", b: "x" } }));
    expect(f.white).toEqual({ player: "Stockfish 19 lite · Elo 1600", kind: "engine", engine: { id: "stockfish:1600", name: "Stockfish 19 lite", elo: 1600 } });
    expect(validateResultFile(f, LIBRARY).ok).toBe(true);
    expect(resultFileName(f)).toMatch(/^2026-11-27-stockfish-1600-vs-attacker-big-2-free-/);
    const full = build(game({ sides: { ...game().sides, b: { agentId: "stockfish:full", model: "", effort: "" } }, harnesses: { w: HARNESSED_PRESET, b: null } }));
    expect(full.black.engine).toEqual({ id: "stockfish:full", name: "Stockfish 19 lite", elo: null });
    expect(validateResultFile(full, LIBRARY).ok).toBe(true);
    const bad = (engine: object) => validateResultFile({ ...f, white: { ...f.white, engine } }, LIBRARY);
    expect(bad({ id: "stockfish:1234", name: "x", elo: 1234 })).toMatchObject({ ok: false, error: expect.stringMatching(/not a known engine level/) });
    expect(bad({ id: "stockfish:1600", name: "x", elo: 2400 })).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't match/) });
  });

  it("records humans without a model or stats", () => {
    const f = build(game({ sides: { ...game().sides, w: { agentId: "human", model: "", effort: "" } }, harnesses: { w: null, b: ATTACKER_PRESET }, labels: { w: "Human", b: "x" } }));
    expect(f.white).toEqual({ player: "Human", kind: "human" });
    expect(validateResultFile(f, LIBRARY).ok).toBe(true);
  });

  it("won't build unfinished or stopped games", () => {
    expect(buildResultFile(game({ result: "*", reason: "stopped" }), opts(game())).ok).toBe(false);
    expect(buildResultFile(game({ result: null }), opts(game())).ok).toBe(false);
  });

  it("maps the referee's reasons", () => {
    expect(terminationOf("Black forfeits: 3 illegal moves in one turn")).toBe("forfeit");
    expect(terminationOf("adjudicated by the person watching")).toBe("adjudicated");
    expect(terminationOf("move limit (400 half-moves) reached")).toBe("move-limit");
    expect(terminationOf("50-move rule")).toBe("fifty-move-rule");
  });

  it("validation checks the claimed ending against the final position", () => {
    const f = build();
    const bad = (patch: object) => validateResultFile({ ...f, ...patch }, LIBRARY);
    expect(bad({ result: "1-0" })).toMatchObject({ ok: false });
    expect(bad({ termination: "stalemate" })).toMatchObject({ ok: false, error: expect.stringContaining("stalemate") });
    expect(bad({ plies: 3 })).toMatchObject({ ok: false });
    expect(bad({ pgn: "1. e4 e5 2. Ke3" })).toMatchObject({ ok: false });
    expect(bad({ white: { ...f.white, harness: { id: "nope", name: "x", source: "community" } } })).toMatchObject({ ok: false, error: expect.stringContaining("nope") });
    expect(bad({ white: { ...f.white, harness: { id: "x", name: "x", source: "custom" } } })).toMatchObject({ ok: false });

    // Adjudicated: any result, but only while the game wasn't already over.
    const mid = game({ history: ["e4", "e5"], result: "1/2-1/2", reason: "adjudicated by the person watching" });
    const adj = build(mid);
    expect(validateResultFile(adj, LIBRARY)).toMatchObject({ ok: true, adjudicated: true });
    expect(bad({ termination: "adjudicated" })).toMatchObject({ ok: false });

    // Forfeit: the side to move loses.
    const ff = game({ history: ["e4", "e5", "Nf3"], result: "1-0", reason: "Black forfeits: 3 illegal moves in one turn" });
    expect(validateResultFile(build(ff), LIBRARY).ok).toBe(true);
    expect(validateResultFile({ ...build(ff), result: "0-1", pgn: build(ff).pgn.replace('"1-0"', '"0-1"').replace(/1-0\s*$/, "0-1") }, LIBRARY).ok).toBe(false);

    // Threefold repetition is checked on the replayed game.
    const rep = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"];
    expect(validateResultFile(build(game({ history: rep, result: "1/2-1/2", reason: "threefold repetition" })), LIBRARY).ok).toBe(true);
    expect(validateResultFile(build(game({ history: rep.slice(0, 6), result: "1/2-1/2", reason: "threefold repetition" })), LIBRARY).ok).toBe(false);
  });
});
