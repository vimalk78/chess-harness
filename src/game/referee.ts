// The referee: asks the side to move for a move, checks it, applies it, repeats.
// No UI and no network code, so it can be driven by fake agents in tests.

import { Chess } from "chess.js";
import type { Agent, Color, LogEntry, StreamDelta } from "../agents/types";

export type GameResult = "1-0" | "0-1" | "1/2-1/2" | "*";

export type GameEvent =
  | { type: "turnStart"; color: Color }
  | { type: "log"; color: Color; entries: LogEntry[] }
  | { type: "illegalAttempt"; color: Color; move: string; error: string }
  | { type: "move"; color: Color; san: string; fen: string; history: string[] }
  | { type: "paused"; reason: "user" | "error"; error?: string }
  | { type: "resumed" }
  | { type: "gameOver"; result: GameResult; reason: string };

export interface RefereeOptions {
  white: Agent;
  black: Agent;
  /** Rejected moves allowed in one turn before that side forfeits. */
  maxIllegalAttempts?: number;
  /** Half-moves before the game is adjudicated a draw. */
  maxPlies?: number;
  /** Live model output from the side to move (for display only). */
  onStream?: (color: Color, delta: StreamDelta) => void;
  /** Continue a saved game: SAN moves already played. Throws if they aren't a legal game. */
  startHistory?: string[];
  /** Start paused, so nothing is asked until resume() (used when reopening a saved game). */
  startPaused?: boolean;
  /** Each side's latest notes, when continuing a saved game. */
  startNotes?: Partial<Record<Color, string>>;
}

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const MOVE_SHAPED = /^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?$/;

const colorName = (c: Color) => (c === "w" ? "White" : "Black");

export class GameRunner {
  private chess = new Chess();
  private readonly opts: Required<Pick<RefereeOptions, "white" | "black" | "maxIllegalAttempts" | "maxPlies">> &
    Pick<RefereeOptions, "onStream">;
  private readonly emit: (e: GameEvent) => void;
  private turnAbort: AbortController | null = null;
  private pausedBy: "user" | "error" | null = null;
  private resumeWaiter: (() => void) | null = null;
  private stopped = false;
  private finished = false;
  /** Each side's own notes for its next move. Kept per side: neither agent ever sees the other's. */
  private notes: Partial<Record<Color, string>> = {};

  constructor(opts: RefereeOptions, onEvent: (e: GameEvent) => void) {
    const { startHistory, startPaused, startNotes, ...rest } = opts;
    this.notes = { ...startNotes };
    this.opts = { maxIllegalAttempts: 3, maxPlies: 300, ...rest };
    this.emit = onEvent;
    for (const san of startHistory ?? []) {
      try {
        this.chess.move(san);
      } catch {
        throw new Error(`Saved game has an illegal move: ${san} (after ${this.chess.history().length} half-moves)`);
      }
    }
    if (startPaused) this.pausedBy = "user";
  }

  get history(): string[] {
    return this.chess.history();
  }

  get fen(): string {
    return this.chess.fen();
  }

  get isPaused(): boolean {
    return this.pausedBy !== null;
  }

  pause(): void {
    if (this.stopped || this.pausedBy) return;
    this.pausedBy = "user";
    this.turnAbort?.abort();
    this.emit({ type: "paused", reason: "user" });
  }

  resume(): void {
    if (!this.pausedBy) return;
    this.pausedBy = null;
    this.emit({ type: "resumed" });
    this.resumeWaiter?.();
    this.resumeWaiter = null;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.turnAbort?.abort();
    this.resumeWaiter?.();
    this.resumeWaiter = null;
  }

  /**
   * Ends the game now with a result decided by the person watching (e.g. a dead-drawn
   * position the agents would otherwise play out). Aborts any turn in progress.
   */
  adjudicate(result: Exclude<GameResult, "*">, reason: string): void {
    if (this.finished) return;
    this.finished = true;
    this.stopped = true;
    this.turnAbort?.abort();
    this.emit({ type: "gameOver", result, reason });
    this.resumeWaiter?.();
    this.resumeWaiter = null;
  }

  private waitIfPaused(): Promise<void> {
    if (!this.pausedBy || this.stopped) return Promise.resolve();
    return new Promise((resolve) => (this.resumeWaiter = resolve));
  }

  /** Runs until the game ends. Resolves after the gameOver event. */
  async start(): Promise<void> {
    const end = (result: GameResult, reason: string) => {
      if (this.finished) return; // already adjudicated
      this.finished = true;
      this.emit({ type: "gameOver", result, reason });
    };

    while (true) {
      const over = this.checkGameOver();
      if (over) return end(over.result, over.reason);

      const color = this.chess.turn();
      const agent = color === "w" ? this.opts.white : this.opts.black;
      const attempts: { move: string; error: string }[] = [];

      // One turn: keep asking until a legal move, a forfeit, or a stop.
      while (true) {
        await this.waitIfPaused();
        if (this.stopped) return end("*", "stopped");

        const abort = new AbortController();
        this.turnAbort = abort;
        this.emit({ type: "turnStart", color });

        let move: string;
        try {
          const res = await agent.nextMove({
            history: this.chess.history(),
            fen: this.chess.fen(),
            legalMoves: this.chess.moves(),
            myColor: color,
            previousAttempts: [...attempts],
            myNotes: this.notes[color],
            signal: abort.signal,
            onStream: (delta) => {
              if (!abort.signal.aborted) this.opts.onStream?.(color, delta);
            },
          });
          if (abort.signal.aborted) continue; // paused or stopped mid-call: discard, replay
          if (res.log.length) this.emit({ type: "log", color, entries: res.log });
          const kept = res.log.filter((e) => e.kind === "notes").at(-1);
          if (kept) this.notes[color] = kept.text;
          move = res.move;
        } catch (err) {
          if (this.stopped) return end("*", "stopped");
          if (abort.signal.aborted) continue; // user pause: replay the turn after resume
          // API/network failure: not the agent's fault at chess. Pause, then replay.
          this.pausedBy = "error";
          this.emit({ type: "paused", reason: "error", error: err instanceof Error ? err.message : String(err) });
          continue;
        } finally {
          this.turnAbort = null;
        }

        const verdict = this.tryMove(move);
        if (verdict.ok) {
          this.emit({ type: "move", color, san: verdict.san, fen: this.chess.fen(), history: this.chess.history() });
          break;
        }
        attempts.push({ move, error: verdict.error });
        this.emit({ type: "illegalAttempt", color, move, error: verdict.error });
        if (attempts.length >= this.opts.maxIllegalAttempts) {
          return end(
            color === "w" ? "0-1" : "1-0",
            `${colorName(color)} forfeits: ${attempts.length} illegal moves in one turn`,
          );
        }
      }
    }
  }

  private tryMove(raw: string): { ok: true; san: string } | { ok: false; error: string } {
    const move = (raw ?? "").trim();
    if (!move) return { ok: false, error: "empty response, no move given" };

    const uci = UCI.exec(move);
    if (uci) {
      try {
        const m = this.chess.move({ from: uci[1], to: uci[2], promotion: uci[3] });
        return { ok: true, san: m.san };
      } catch {
        return { ok: false, error: `${move} is not a legal move in this position` };
      }
    }
    const san = move.replace(/0/g, "O");
    if (!MOVE_SHAPED.test(san)) {
      return { ok: false, error: `could not parse "${move.slice(0, 40)}" as a move; reply with a move in SAN like Nf3` };
    }
    try {
      const m = this.chess.move(san);
      return { ok: true, san: m.san };
    } catch {
      return { ok: false, error: `${move} is not a legal move in this position` };
    }
  }

  private checkGameOver(): { result: GameResult; reason: string } | null {
    const c = this.chess;
    if (c.isCheckmate()) return { result: c.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
    if (c.isStalemate()) return { result: "1/2-1/2", reason: "stalemate" };
    if (c.isThreefoldRepetition()) return { result: "1/2-1/2", reason: "threefold repetition" };
    if (c.isInsufficientMaterial()) return { result: "1/2-1/2", reason: "insufficient material" };
    if (c.isDrawByFiftyMoves()) return { result: "1/2-1/2", reason: "50-move rule" };
    if (c.history().length >= this.opts.maxPlies) {
      return { result: "1/2-1/2", reason: `move limit (${this.opts.maxPlies} half-moves) reached` };
    }
    return null;
  }
}
