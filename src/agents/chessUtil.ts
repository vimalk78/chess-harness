import { Chess } from "chess.js";

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

/** Returns the SAN of `move` (SAN or UCI) if it is legal in `fen`, else null. Rules only. */
export function legalSan(fen: string, move: string): string | null {
  const chess = new Chess(fen);
  const uci = UCI.exec(move);
  try {
    return uci
      ? chess.move({ from: uci[1], to: uci[2], promotion: uci[3] }).san
      : chess.move(move.replace(/0/g, "O")).san;
  } catch {
    return null;
  }
}

/** Plain-text board, rank 8 at the top, as chess.js renders it. */
export function asciiBoard(fen: string): string {
  return new Chess(fen).ascii();
}
