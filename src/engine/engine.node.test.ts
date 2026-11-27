// Plays the real engine (the lite single-threaded build the site serves) from Node.
// A separate file so only it is type-checked with Node's types (tsconfig.nodetest.json).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { engineDefinition } from "../agents/engine";
import type { AgentDeps, GameView } from "../agents/types";
import { uciToSan, UciEngine } from "./uci";

/** The real engine (the same lite single-threaded build the site uses), as a Node child process. */
function nodeEngine(): { engine: UciEngine; quit: () => void } {
  const path = createRequire(import.meta.url)("stockfish").findEngine("lite-single");
  const child = spawn(process.execPath, [path], { stdio: "pipe" });
  const listeners: ((l: string) => void)[] = [];
  let buf = "";
  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) listeners.forEach((l) => l(line.trim()));
  });
  return { engine: new UciEngine({ send: (c) => child.stdin.write(c + "\n"), onLine: (l) => listeners.push(l) }), quit: () => child.kill() };
}

const view = (history: string[], signal = new AbortController().signal): GameView => {
  const chess = new Chess();
  history.forEach((m) => chess.move(m));
  return { history, fen: chess.fen(), legalMoves: chess.moves(), myColor: chess.turn(), previousAttempts: [], signal };
};
const deps = {} as AgentDeps;

describe("Stockfish agent (real engine)", () => {
  it("plays legal moves at a limited strength and logs its evaluation", async () => {
    const { engine, quit } = nodeEngine();
    try {
      const agent = engineDefinition(1320, () => engine).create({ model: "" }, deps);
      const history = ["e4"];
      for (let i = 0; i < 4; i++) {
        const v = view(history);
        const res = await agent.nextMove(v);
        const san = uciToSan(v.fen, [res.move])[0];
        expect(v.legalMoves).toContain(san);
        expect(res.log[0]).toMatchObject({ kind: "note", text: expect.stringMatching(/^Engine: depth \d+ · eval /) });
        history.push(san);
        const replies = view(history).legalMoves;
        if (!replies.length) break;
        history.push(replies[0]);
      }
    } finally {
      quit();
    }
  }, 30_000);

  it("finds mate in one at full strength", async () => {
    const { engine, quit } = nodeEngine();
    try {
      const agent = engineDefinition(null, () => engine).create({ model: "" }, deps);
      const v = view(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"]);
      const res = await agent.nextMove(v);
      expect(uciToSan(v.fen, [res.move])).toEqual(["Qxf7#"]);
      expect(res.log[0].kind === "note" && res.log[0].text).toMatch(/mate in 1 for White/);
    } finally {
      quit();
    }
  }, 30_000);

});
