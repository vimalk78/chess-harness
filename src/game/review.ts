// Game review: Stockfish evaluates every position of a finished game, and each move is
// judged by how much it lowered the mover's winning chances, the way Lichess does it:
// win% = 50 + 50 * (2 / (1 + e^(-0.00368208 * centipawns)) - 1); a drop of 5+ points is an
// inaccuracy, 10+ a mistake, 15+ a blunder; move accuracy = 103.1668 * e^(-0.04354 * drop) - 3.1669.
// This is for reading results, never for playing: no agent sees it.

import { Chess } from "chess.js";
import type { Color } from "../agents/types";
import { uciToSan, type UciEngine } from "../engine/uci";

export const REVIEW_DEPTH = 12;
const CP_CAP = 1000;

/** One position's evaluation, from the side to move's point of view. */
export interface PositionEval {
  cp?: number;
  mate?: number;
  /** The engine's best move there, in UCI (absent for finished positions). */
  best?: string;
}

export type MoveClass = "inaccuracy" | "mistake" | "blunder";

export interface MoveReview {
  /** Evaluation after the move, in centipawns from White's side (mates count as ±1000). */
  eval: number;
  /** Mate in N after the move, from White's side (negative: Black mates; 0: checkmate on the board), when there is one. */
  mate?: number;
  /** The engine's best move in the position before, in SAN. */
  best?: string;
  /** Centipawns the move lost against the best move (0 or more, capped at 1000). */
  loss: number;
  /** Points of winning chance (0–100) the move gave away. */
  winDrop: number;
  accuracy: number;
  class?: MoveClass;
}

export interface SideReview {
  /** Mean of the move accuracies, 0–100. */
  accuracy: number;
  /** Average centipawn loss. */
  avgLoss: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
}

export interface GameReview {
  engine: string;
  depth: number;
  moves: MoveReview[];
  white: SideReview;
  black: SideReview;
}

/** Centipawns from the side to move's point of view, with mates as ±1000. */
function cpOf(e: PositionEval): number {
  // mate 0 is a finished checkmate: the side to move has lost.
  if (e.mate !== undefined) return e.mate > 0 ? CP_CAP : -CP_CAP;
  return Math.max(-CP_CAP, Math.min(CP_CAP, e.cp ?? 0));
}

export const winPercent = (cp: number) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Judges every move from the evaluations of the positions before and after it (history.length + 1 evals). */
export function reviewMoves(history: string[], evals: PositionEval[], engine: string, depth: number): GameReview {
  if (evals.length !== history.length + 1) throw new Error("Need one evaluation per position.");
  const chess = new Chess();
  const moves: MoveReview[] = [];
  history.forEach((san, i) => {
    const fen = chess.fen();
    const mover = chess.turn();
    const played = chess.move(san);
    const before = evals[i];
    const after = evals[i + 1];
    const bestSan = before.best ? uciToSan(fen, [before.best])[0] : undefined;
    const isBest = before.best === played.from + played.to + (played.promotion ?? "");
    // After the move the opponent is to move, so its score is negated for the mover.
    const cpBefore = cpOf(before);
    const cpAfter = -cpOf(after);
    const winDrop = isBest ? 0 : Math.max(0, winPercent(cpBefore) - winPercent(cpAfter));
    const loss = isBest ? 0 : Math.max(0, cpBefore - cpAfter);
    const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * winDrop) - 3.1669));
    const white = mover === "w" ? cpAfter : -cpAfter;
    const mateAfter = after.mate !== undefined ? (chess.turn() === "w" ? after.mate : -after.mate) : undefined;
    moves.push({
      eval: Math.round(white),
      ...(mateAfter !== undefined ? { mate: mateAfter } : {}),
      ...(bestSan ? { best: bestSan } : {}),
      loss: Math.round(Math.min(CP_CAP, loss)),
      winDrop: round1(winDrop),
      accuracy: round1(accuracy),
      ...(winDrop >= 15 ? { class: "blunder" as const } : winDrop >= 10 ? { class: "mistake" as const } : winDrop >= 5 ? { class: "inaccuracy" as const } : {}),
    });
  });
  const side = (c: Color): SideReview => {
    const mine = moves.filter((_, i) => (i % 2 === 0) === (c === "w"));
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    return {
      accuracy: round1(mean(mine.map((m) => m.accuracy))),
      avgLoss: Math.round(mean(mine.map((m) => m.loss))),
      inaccuracies: mine.filter((m) => m.class === "inaccuracy").length,
      mistakes: mine.filter((m) => m.class === "mistake").length,
      blunders: mine.filter((m) => m.class === "blunder").length,
    };
  };
  return { engine, depth, moves, white: side("w"), black: side("b") };
}

/** Evaluates the start position and the position after every move (finished positions need no engine). */
export async function evaluatePositions(
  history: string[],
  engine: UciEngine,
  opts: { depth?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<PositionEval[]> {
  const chess = new Chess();
  const uci: string[] = [];
  const evals: PositionEval[] = [];
  const total = history.length + 1;
  for (let i = 0; i < total; i++) {
    if (i > 0) {
      const m = chess.move(history[i - 1]);
      uci.push(m.from + m.to + (m.promotion ?? ""));
    }
    if (chess.isCheckmate()) evals.push({ mate: 0 });
    else if (chess.isDraw() || chess.isStalemate()) evals.push({ cp: 0 });
    else {
      const res = await engine.search({
        moves: [...uci],
        options: { UCI_LimitStrength: false },
        depth: opts.depth ?? REVIEW_DEPTH,
        newGame: i === 0,
        signal: opts.signal,
      });
      evals.push({ cp: res.cp, mate: res.mate, best: res.bestmove });
    }
    opts.onProgress?.(i + 1, total);
  }
  return evals;
}
