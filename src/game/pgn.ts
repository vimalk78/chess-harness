import { Chess } from "chess.js";

export interface PgnInfo {
  white: string;
  black: string;
  result: string;
  termination?: string;
  date?: Date;
}

/** Replays SAN history into a PGN with player and result headers. */
export function buildPgn(history: string[], info: PgnInfo): string {
  const chess = new Chess();
  for (const san of history) chess.move(san);
  const d = info.date ?? new Date();
  chess.setHeader("Event", "Chess Agent Arena");
  chess.setHeader("Date", `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`);
  chess.setHeader("White", info.white);
  chess.setHeader("Black", info.black);
  chess.setHeader("Result", info.result);
  if (info.termination) chess.setHeader("Termination", info.termination);
  const pgn = chess.pgn();
  // chess.js only appends the result for finished positions; forfeits and stops need it too.
  return pgn.trimEnd().endsWith(info.result) ? pgn : `${pgn.trimEnd()} ${info.result}`;
}

/** Moves so far as PGN movetext only, e.g. "1. e4 e5 2. Nf3". */
export function movetext(history: string[]): string {
  return history
    .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
    .join(" ");
}
