import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { engineLevel, formatEval } from "../agents/engine";
import { parseInfo, sanToUci, uciToSan, UciEngine, type UciTransport } from "./uci";

/** A scripted engine: answers uci/isready and replies to "go" with the given lines. */
function fakeEngine(goReply: string[]) {
  const sent: string[] = [];
  let listener: (l: string) => void = () => {};
  const t: UciTransport = {
    send(c) {
      sent.push(c);
      const reply = c === "uci" ? ["id name Fake", "uciok"] : c === "isready" ? ["readyok"] : c.startsWith("go") ? goReply : [];
      queueMicrotask(() => reply.forEach((l) => listener(l)));
    },
    onLine: (l) => (listener = l),
  };
  return { engine: new UciEngine(t), sent };
}


describe("UCI driver", () => {
  it("parses the main line's depth, score and pv, skipping secondary lines", () => {
    expect(parseInfo("info depth 12 seldepth 22 multipv 1 score cp -35 nodes 1 pv e7e5 g1f3")).toEqual({ depth: 12, cp: -35, pv: ["e7e5", "g1f3"] });
    expect(parseInfo("info depth 9 multipv 1 score mate 3 pv d1h5")).toEqual({ depth: 9, mate: 3, pv: ["d1h5"] });
    expect(parseInfo("info depth 12 multipv 2 score cp 10 pv a2a3")).toBeNull();
    expect(parseInfo("info string NNUE evaluation using nn.bin")).toBeNull();
  });

  it("converts between SAN and UCI, including promotions", () => {
    expect(sanToUci(["e4", "e5", "Nf3"])).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(uciToSan("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", ["b7b8q", "e8d7"])).toEqual(["b8=Q+", "Kd7"]);
    expect(uciToSan(new Chess().fen(), ["e2e4", "e2e4"])).toEqual(["e4"]);
  });

  it("sends options, the position from the start and the move time, and keeps the last score", async () => {
    const { engine, sent } = fakeEngine(["info depth 1 multipv 1 score cp 20 pv e7e5", "info depth 2 multipv 1 score mate -4 pv e7e6 d2d4", "bestmove e7e6 ponder d2d4"]);
    const res = await engine.search({ moves: ["e2e4"], options: { UCI_LimitStrength: true, UCI_Elo: 1600 }, movetimeMs: 500, newGame: true });
    expect(res).toEqual({ bestmove: "e7e6", depth: 2, mate: -4, cp: undefined, pv: ["e7e6", "d2d4"] });
    expect(sent).toEqual(["uci", "ucinewgame", "setoption name UCI_LimitStrength value true", "setoption name UCI_Elo value 1600", "isready", "position startpos moves e2e4", "go movetime 500"]);
  });

  it("stops the engine and rejects when the turn is aborted", async () => {
    const { engine, sent } = fakeEngine([]);
    const abort = new AbortController();
    const p = engine.search({ moves: [], movetimeMs: 1000, signal: abort.signal });
    await new Promise((r) => setTimeout(r, 5));
    abort.abort();
    expect(sent.at(-1)).toBe("stop");
    void p.catch(() => undefined);
  });

  it("formats the score from White's side", () => {
    expect(formatEval({ cp: 25 }, "w")).toBe("+0.25 (about equal)");
    expect(formatEval({ cp: 80 }, "w")).toBe("+0.80 (White is better)");
    expect(formatEval({ cp: 150 }, "b")).toBe("−1.50 (Black is better)");
    expect(formatEval({ mate: 2 }, "b")).toBe("mate in 2 for Black");
    expect(formatEval({ mate: -3 }, "w")).toBe("mate in 3 for Black");
  });

  it("knows the engine levels by agent id", () => {
    expect(engineLevel("stockfish:1600")).toBe(1600);
    expect(engineLevel("stockfish:full")).toBeNull();
    expect(engineLevel("stockfish:1234")).toBeUndefined();
    expect(engineLevel("human")).toBeUndefined();
  });
});
