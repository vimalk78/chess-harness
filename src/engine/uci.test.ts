import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { engineLevel, formatEval, formatWdl } from "../agents/engine";
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

  it("keeps the best line's evaluation when a strength-limited engine plays a weaker move", async () => {
    // Real Stockfish 19 lite output at UCI_Elo 1600 (Planner + threats game, before 21...b5).
    const { engine } = fakeEngine([
      "info depth 14 seldepth 24 multipv 1 score cp 562 wdl 1000 0 0 nodes 198524 time 552 pv e4f3 g2f3 b6b5",
      "info depth 14 seldepth 22 multipv 1 score cp 0 wdl 9 982 9 nodes 394153 time 1000 pv e4a8 a4b6 d7b6",
      "bestmove e4a8 ponder a4b6",
    ]);
    const res = await engine.search({ moves: [], movetimeMs: 1000 });
    expect(res).toMatchObject({ bestmove: "e4a8", depth: 14, cp: 562, wdl: [1000, 0, 0], pv: ["e4f3", "g2f3", "b6b5"] });
  });

  it("keeps a real 0.00 for the move it plays", async () => {
    const { engine } = fakeEngine(["info depth 9 multipv 1 score cp 0 wdl 20 960 20 pv e7e5 g1f3", "bestmove e7e5 ponder g1f3"]);
    expect(await engine.search({ moves: ["e2e4"], movetimeMs: 100 })).toMatchObject({ cp: 0, pv: ["e7e5", "g1f3"] });
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

  it("formats the score from White's side, with the usual advantage symbols", () => {
    expect(formatEval({ cp: 25 }, "w")).toBe("+0.25 = equal");
    expect(formatEval({ cp: 25 }, "b")).toBe("−0.25 = equal");
    expect(formatEval({ cp: 50 }, "w")).toBe("+0.50 ⩲ White is slightly better");
    expect(formatEval({ cp: 80 }, "b")).toBe("−0.80 ∓ Black is clearly better");
    expect(formatEval({ cp: -149 }, "b")).toBe("+1.49 ± White is clearly better");
    expect(formatEval({ cp: 150 }, "b")).toBe("−1.50 −+ Black is winning");
    expect(formatEval({ cp: 611 }, "w")).toBe("+6.11 +− White is winning");
    expect(formatEval({ mate: 2 }, "b")).toBe("mate in 2 for Black");
    expect(formatEval({ mate: -3 }, "w")).toBe("mate in 3 for Black");
  });

  it("reads and formats Stockfish's win/draw/loss chances from White's side", () => {
    expect(parseInfo("info depth 12 seldepth 15 multipv 1 score cp 611 wdl 1000 0 0 nodes 2110 pv g3h4 f2d1")).toMatchObject({ cp: 611, wdl: [1000, 0, 0], pv: ["g3h4", "f2d1"] });
    expect(formatWdl([340, 600, 60], "w")).toBe("White wins 34% · draw 60% · Black wins 6%");
    expect(formatWdl([340, 600, 60], "b")).toBe("White wins 6% · draw 60% · Black wins 34%");
  });

  it("knows the engine levels by agent id", () => {
    expect(engineLevel("stockfish:1600")).toBe(1600);
    expect(engineLevel("stockfish:full")).toBeNull();
    expect(engineLevel("stockfish:1234")).toBeUndefined();
    expect(engineLevel("human")).toBeUndefined();
  });
});
