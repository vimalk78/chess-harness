import { describe, expect, it } from "vitest";
import type { Agent, GameView } from "../agents/types";
import { GameRunner, type GameEvent } from "./referee";

/** Agent that plays a fixed script of replies, one per call. */
function scripted(replies: (string | Error)[]): Agent & { calls: GameView[] } {
  const calls: GameView[] = [];
  let i = 0;
  return {
    calls,
    async nextMove(game) {
      calls.push(game);
      const r = replies[i++];
      if (r === undefined) throw new Error("script exhausted");
      if (r instanceof Error) throw r;
      return { move: r, log: [{ kind: "note", text: `played ${r}` }] };
    },
  };
}

function run(white: Agent, black: Agent, opts: Partial<ConstructorParameters<typeof GameRunner>[0]> = {}) {
  const events: GameEvent[] = [];
  const runner = new GameRunner({ white, black, ...opts }, (e) => events.push(e));
  return { runner, events, done: runner.start() };
}

const gameOver = (events: GameEvent[]) => events.find((e) => e.type === "gameOver");

describe("GameRunner", () => {
  it("plays scholar's mate to checkmate", async () => {
    const { events, done } = run(
      scripted(["e4", "Bc4", "Qh5", "Qxf7#"]),
      scripted(["e5", "Nc6", "Nf6"]),
    );
    await done;
    expect(gameOver(events)).toMatchObject({ result: "1-0", reason: "checkmate" });
    expect(events.filter((e) => e.type === "move")).toHaveLength(7);
  });

  it("accepts UCI moves and records them as SAN", async () => {
    const { events, runner, done } = run(scripted(["e2e4", "f1c4", "d1h5", "h5f7"]), scripted(["e7e5", "b8c6", "g8f6"]));
    await done;
    expect(runner.history).toEqual(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]);
    expect(gameOver(events)).toMatchObject({ result: "1-0" });
  });

  it("retries after an illegal move and passes the rejection to the agent", async () => {
    const white = scripted(["e5", "e4", "Bc4", "Qh5", "Qxf7#"]);
    const { events, done } = run(white, scripted(["e5", "Nc6", "Nf6"]));
    await done;
    expect(events.find((e) => e.type === "illegalAttempt")).toMatchObject({
      color: "w",
      move: "e5",
      error: expect.stringMatching(/not a legal move/),
    });
    expect(white.calls[0].previousAttempts).toEqual([]);
    expect(white.calls[1].previousAttempts).toEqual([{ move: "e5", error: expect.any(String) }]);
    expect(white.calls[2].previousAttempts).toEqual([]);
    expect(gameOver(events)).toMatchObject({ result: "1-0" });
  });

  it("explains unparseable and empty replies", async () => {
    const white = scripted(["", "I like knights", "e4", "Bc4", "Qh5", "Qxf7#"]);
    const { events, done } = run(white, scripted(["e5", "Nc6", "Nf6"]));
    await done;
    const errors = events.flatMap((e) => (e.type === "illegalAttempt" ? [e.error] : []));
    expect(errors[0]).toMatch(/empty/);
    expect(errors[1]).toMatch(/could not parse/);
  });

  it("forfeits after maxIllegalAttempts rejected moves in one turn", async () => {
    const { events, done } = run(scripted(["e4"]), scripted(["Ke3", "Qh1", "a1", "e5"]), {
      maxIllegalAttempts: 3,
    });
    await done;
    expect(gameOver(events)).toMatchObject({ result: "1-0", reason: expect.stringMatching(/Black forfeits/) });
  });

  it("gives the agent fresh game state each turn", async () => {
    const black = scripted(["e5", "Nc6", "Nf6"]);
    const { done } = run(scripted(["e4", "Bc4", "Qh5", "Qxf7#"]), black);
    await done;
    expect(black.calls[1]).toMatchObject({ history: ["e4", "e5", "Bc4"], myColor: "b" });
    expect(black.calls[1].legalMoves).toContain("Nc6");
    expect(black.calls[1].fen).toMatch(/ b /);
  });

  it("adjudicates a draw at maxPlies", async () => {
    const { events, done } = run(scripted(["Nf3", "Ng1", "Nf3"]), scripted(["Nf6", "Ng8", "Nf6"]), { maxPlies: 4 });
    await done;
    expect(gameOver(events)).toMatchObject({ result: "1/2-1/2", reason: expect.stringMatching(/move limit/) });
  });

  it("pauses on an agent error and replays the turn on resume", async () => {
    const white = scripted([new Error("429 rate limited"), "e4", "Bc4", "Qh5", "Qxf7#"]);
    const events: GameEvent[] = [];
    const runner = new GameRunner({ white, black: scripted(["e5", "Nc6", "Nf6"]) }, (e) => {
      events.push(e);
      if (e.type === "paused") queueMicrotask(() => runner.resume());
    });
    await runner.start();
    expect(events.find((e) => e.type === "paused")).toMatchObject({ reason: "error", error: "429 rate limited" });
    expect(events.some((e) => e.type === "illegalAttempt")).toBe(false);
    expect(gameOver(events)).toMatchObject({ result: "1-0" });
  });

  it("user pause aborts the in-flight call and resume replays the turn", async () => {
    let call = 0;
    const white: Agent = {
      nextMove: (game) =>
        new Promise((resolve, reject) => {
          call++;
          if (call === 1) {
            game.signal.addEventListener("abort", () => reject(new Error("aborted")));
            return; // hangs until aborted
          }
          resolve({ move: ["e4", "Bc4", "Qh5", "Qxf7#"][call - 2], log: [] });
        }),
    };
    const events: GameEvent[] = [];
    const runner = new GameRunner({ white, black: scripted(["e5", "Nc6", "Nf6"]) }, (e) => {
      events.push(e);
      if (e.type === "turnStart" && call === 0) queueMicrotask(() => runner.pause());
      if (e.type === "paused") queueMicrotask(() => runner.resume());
    });
    await runner.start();
    expect(events.find((e) => e.type === "paused")).toMatchObject({ reason: "user" });
    expect(gameOver(events)).toMatchObject({ result: "1-0" });
  });

  it("stop ends the game with result *", async () => {
    const white: Agent = { nextMove: (g) => new Promise((_, rej) => g.signal.addEventListener("abort", () => rej(new Error("aborted")))) };
    const events: GameEvent[] = [];
    const runner = new GameRunner({ white, black: scripted([]) }, (e) => {
      events.push(e);
      if (e.type === "turnStart") queueMicrotask(() => runner.stop());
    });
    await runner.start();
    expect(gameOver(events)).toMatchObject({ result: "*", reason: "stopped" });
  });
});
