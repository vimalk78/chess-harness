// The analysis board: a harness tool the model drives itself. Before answering, the model
// may write lines like "ANALYZE: Nxe5 Nxe5 d4"; the harness plays each line on a scratch
// board and replies with facts from the rules at the end of it (legality, captures along
// the way, material, what's attacked, the side to move's captures and checks, mate or
// stalemate). No evaluation and no search of its own: the model picks every line, decides
// how deep to go and judges the result. Rounds are limited per move by the harness.

import { Chess, type Color, type Move } from "chess.js";
import { attackedLines, colorName, materialLine, NAME, other } from "./contextBlocks";

export const MAX_LINES_PER_ROUND = 6;
export const MAX_PLIES_PER_LINE = 10;
export const ANALYSIS_ROUND_CHOICES = [1, 2, 3, 4, 5, 6, 8];
export const MAX_ANALYSIS_ROUNDS = 8;

/** Added to the system prompt by the editor's "Add analysis instructions" button (and used by the presets). */
export const ANALYSIS_SYSTEM_INSTRUCTIONS = `Analysis board: before you answer you can play out lines and get the facts at the end of each one, computed from the rules (no engine and no evaluation: you judge the result). Write one line per variation, starting with "ANALYZE:", moves in SAN from the current position for both sides, for example:
ANALYZE: Nxe5 Nxe5 d4
ANALYZE: Bc4 Nf6 Ng5
Up to ${MAX_LINES_PER_ROUND} lines per reply and ${MAX_PLIES_PER_LINE} moves per line. A reply with ANALYZE lines and no MOVE line uses one analysis round: you get the results and can analyze again. Rounds are limited and the results tell you how many remain. When you are ready, reply with your final MOVE line and no ANALYZE lines.`;

const ANALYZE_LINE = /^[ \t>*_#-]*analy[sz]e[ \t*_]*:[ \t*_]*(.+)$/gim;
const FINAL_MOVE = /^[ \t>*_#-]*move[ \t*_]*:[ \t*_]*\S/im;

/** True if the reply contains a final "MOVE: …" line. */
export function hasFinalMove(text: string): boolean {
  return FINAL_MOVE.test(text);
}

/** Splits "1. Nxe5 Nxe5 2. d4!?" into ["Nxe5", "Nxe5", "d4"]. */
function lineMoves(raw: string): string[] {
  return raw
    .replace(/[*_`]/g, " ")
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^\d+\.+/, "").replace(/[!?]+$/, ""))
    .filter((t) => t && t !== "..." && t !== "…" && !/^\d+$/.test(t));
}

/** The lines a reply asks to analyze (duplicates dropped, at most MAX_LINES_PER_ROUND). */
export function parseAnalyzeRequests(text: string): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const m of text.matchAll(ANALYZE_LINE)) {
    const moves = lineMoves(m[1]);
    const key = moves.join(" ");
    if (!moves.length || seen.has(key)) continue;
    seen.add(key);
    out.push(moves);
  }
  return out.slice(0, MAX_LINES_PER_ROUND);
}

/** "12. Nxe5 Nxe5 13. d4" or "12... Nxe5 13. d4", numbered from the position's move number. */
function numbered(moves: Move[], fen: string): string {
  let [turn, full] = [fen.split(" ")[1] as Color, Number(fen.split(" ")[5]) || 1];
  return moves
    .map((m, i) => {
      const label = turn === "w" ? `${full}. ` : i === 0 ? `${full}... ` : "";
      if (turn === "b") full++;
      turn = other(turn);
      return label + m.san;
    })
    .join(" ");
}

const listOrNone = (items: string[]) => (items.length ? items.join(", ") : "none");

/** Facts at the end of one line, from the point of view of `me` (the side to move now). */
export function analyzeLine(fen: string, moves: string[], me: Color): string {
  const chess = new Chess(fen);
  const played: Move[] = [];
  const lost = { mine: [] as string[], theirs: [] as string[] };
  const plies = moves.slice(0, MAX_PLIES_PER_LINE);
  for (const san of plies) {
    let m: Move;
    try {
      m = chess.move(san);
    } catch {
      const where = played.length ? `after ${numbered(played, fen)}` : "in the current position";
      return [
        `${san} is not legal ${where}.`,
        `${colorName(chess.turn())}'s legal moves there: ${listOrNone(chess.moves())}`,
      ].join("\n");
    }
    played.push(m);
    if (m.captured) (m.color === me ? lost.theirs : lost.mine).push(`${NAME[m.captured]} on ${m.to}`);
  }

  const toMove = chess.turn();
  const who = (c: Color) => `${colorName(c)} (${c === me ? "you" : "opponent"})`;
  const out = [numbered(played, fen) + (moves.length > plies.length ? ` (cut at ${MAX_PLIES_PER_LINE} moves)` : "")];
  out.push(
    lost.mine.length || lost.theirs.length
      ? `Captured along the line: you lose ${listOrNone(lost.mine)}; opponent loses ${listOrNone(lost.theirs)}.`
      : "No captures along the line.",
  );
  out.push(`Material at the end: ${materialLine(chess, "w")}; ${materialLine(chess, "b")}.`);

  if (chess.isCheckmate()) {
    out.push(`CHECKMATE: ${who(other(toMove))} wins.`);
    return out.join("\n");
  }
  if (chess.isStalemate()) out.push("Stalemate: draw.");
  else if (chess.isInsufficientMaterial()) out.push("Draw: insufficient material.");
  else if (chess.isThreefoldRepetition()) out.push("Draw: threefold repetition.");
  if (chess.isGameOver()) return out.join("\n");

  const verbose = chess.moves({ verbose: true });
  out.push(`${who(toMove)} to move${chess.inCheck() ? ", IN CHECK" : ""}.`);
  out.push(`${colorName(toMove)}'s captures: ${listOrNone(verbose.filter((m) => m.captured).map((m) => `${m.san} (takes ${NAME[m.captured!]})`))}`);
  out.push(`${colorName(toMove)}'s checks: ${listOrNone(verbose.filter((m) => /[+#]$/.test(m.san)).map((m) => m.san))}`);
  out.push(`Your pieces that are attacked:\n${attackedLines(chess, me)}`);
  out.push(`Opponent pieces that are attacked:\n${attackedLines(chess, other(me))}`);
  return out.join("\n");
}

/** The message sent back after an analysis round. */
export function formatAnalysis(fen: string, lines: string[][], me: Color, roundsLeft: number): string {
  const body = lines.map((moves, i) => `Line ${i + 1}: ANALYZE ${moves.join(" ")}\n${analyzeLine(fen, moves, me)}`).join("\n\n");
  const tail =
    roundsLeft > 0
      ? `You have ${roundsLeft} analysis round${roundsLeft === 1 ? "" : "s"} left. Analyze further, or give your final answer ending with: MOVE: <san>`
      : "That was your last analysis round. Give your final answer now, ending with: MOVE: <san>";
  return `Analysis board results (facts from the rules, not an engine; you are ${colorName(me)}):\n\n${body}\n\n${tail}`;
}

/** Sent when the model asks for analysis after its rounds are used up. */
export const NO_ROUNDS_LEFT = "No analysis rounds left. Give your final answer now, ending with: MOVE: <san>";
