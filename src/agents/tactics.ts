// Board facts derived purely from the rules of chess: which pieces are attacked,
// which are defended, what can be captured, which moves give check.
// No evaluation, no search, no piece values: the model still decides what matters.

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

const NAME: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

export function boardFacts(fen: string): string {
  const chess = new Chess(fen);
  const me: Color = chess.turn();
  const opp: Color = me === "w" ? "b" : "w";

  const describe = (squares: Square[]) =>
    squares.length
      ? squares
          .map((s) => {
            const p = chess.get(s)!;
            return `${NAME[p.type]} ${s}`;
          })
          .join(", ")
      : "nothing";

  const attackedPieces = (owner: Color) => {
    const lines: string[] = [];
    for (const row of chess.board()) {
      for (const cell of row) {
        if (!cell || cell.color !== owner || cell.type === "k") continue;
        const attackers = chess.attackers(cell.square, owner === "w" ? "b" : "w");
        if (!attackers.length) continue;
        const defenders = chess.attackers(cell.square, owner);
        const flag = defenders.length === 0 ? "  <- UNDEFENDED" : attackers.length > defenders.length ? "  <- attacked more times than defended" : "";
        lines.push(`- ${NAME[cell.type]} ${cell.square}: attacked by ${describe(attackers)}; defended by ${describe(defenders)}${flag}`);
      }
    }
    return lines.length ? lines.join("\n") : "- none";
  };

  const moves = chess.moves({ verbose: true });
  const captures = moves.filter((m) => m.captured).map((m) => `${m.san} (takes ${NAME[m.captured!]})`);
  const checks = moves.filter((m) => /[+#]$/.test(m.san)).map((m) => m.san);

  return [
    `Board facts (computed from the rules, not an engine; pins are ignored):`,
    chess.inCheck() ? `You are IN CHECK.` : null,
    `Your pieces that are attacked:\n${attackedPieces(me)}`,
    `Opponent pieces you attack:\n${attackedPieces(opp)}`,
    `Your captures: ${captures.length ? captures.join(", ") : "none"}`,
    `Your checking moves: ${checks.length ? checks.join(", ") : "none"}`,
  ]
    .filter(Boolean)
    .join("\n");
}
