// Every {{variable}} a harness prompt can use. Base variables describe the game;
// context blocks are facts computed from the position with the rules of chess
// (chess.js) before the model is called. Nothing here evaluates positions or searches.

import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import { movetext } from "../game/pgn";
import type { GameView } from "../agents/types";
import type { VariableSources } from "./template";

export type Fairness = "game" | "rules" | "borderline";

export interface VariableInfo {
  name: string;
  label: string;
  description: string;
  fairness: Fairness;
}

/** Everything a variable may look at for the current turn. */
export interface VariableContext {
  game: Pick<GameView, "history" | "fen" | "legalMoves" | "myColor" | "previousAttempts" | "myNotes">;
  /** Only set while rendering a re-ask prompt. */
  problem?: string;
}

const NAME: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const PLURAL: Record<PieceSymbol, string> = { p: "pawns", n: "knights", b: "bishops", r: "rooks", q: "queens", k: "kings" };
const ORDER: PieceSymbol[] = ["k", "q", "r", "b", "n", "p"];
const UNICODE: Record<string, string> = {
  wk: "♔", wq: "♕", wr: "♖", wb: "♗", wn: "♘", wp: "♙",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
};
const colorName = (c: Color) => (c === "w" ? "White" : "Black");
const other = (c: Color): Color => (c === "w" ? "b" : "w");

/** Replays history so we have both the current position and the one before the last move. */
function positions(history: string[]) {
  const now = new Chess();
  for (const san of history) now.move(san);
  const before = new Chess();
  for (const san of history.slice(0, -1)) before.move(san);
  const last: Move | undefined = now.history({ verbose: true }).at(-1);
  return { now, before, last };
}

function squaresLabel(chess: Chess, squares: Square[]): string {
  return squares.length ? squares.map((s) => `${NAME[chess.get(s)!.type]} ${s}`).join(", ") : "nothing";
}

function attackedLines(chess: Chess, owner: Color): string {
  const lines: string[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== owner || cell.type === "k") continue;
      const attackers = chess.attackers(cell.square, other(owner));
      if (!attackers.length) continue;
      const defenders = chess.attackers(cell.square, owner);
      const flag =
        defenders.length === 0
          ? "  <- UNDEFENDED"
          : attackers.length > defenders.length
            ? "  <- attacked more times than defended"
            : "";
      lines.push(`- ${NAME[cell.type]} ${cell.square}: attacked by ${squaresLabel(chess, attackers)}; defended by ${squaresLabel(chess, defenders)}${flag}`);
    }
  }
  return lines.length ? lines.join("\n") : "- none";
}

function boardGrid(chess: Chess, cell: (piece: { type: PieceSymbol; color: Color } | null) => string): string {
  const rows = chess.board().map((row, i) => `${8 - i} ${row.map((p) => cell(p)).join(" ")}`);
  return [...rows, "  a b c d e f g h"].join("\n");
}

function pieceList(chess: Chess, color: Color): string {
  const parts: string[] = [];
  for (const type of ORDER) {
    const squares: string[] = [];
    for (const row of chess.board()) for (const c of row) if (c && c.color === color && c.type === type) squares.push(c.square);
    if (!squares.length) continue;
    parts.push(type === "p" ? `pawns ${squares.join(" ")}` : squares.map((s) => `${type.toUpperCase()}${s}`).join(", "));
  }
  return `${colorName(color)}: ${parts.join(", ")}`;
}

function materialLine(chess: Chess, color: Color): string {
  const counts = new Map<PieceSymbol, number>();
  for (const row of chess.board()) for (const c of row) if (c && c.color === color) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  const parts = ORDER.filter((t) => t !== "k" && counts.get(t)).map((t) => `${counts.get(t)} ${counts.get(t) === 1 ? NAME[t] : PLURAL[t]}`);
  return `${colorName(color)}: ${parts.length ? parts.join(", ") : "king only"}`;
}

const BASE: (VariableInfo & { value: (ctx: VariableContext) => string })[] = [
  { name: "side", label: "Your side", description: "White or Black.", fairness: "game", value: ({ game }) => colorName(game.myColor) },
  { name: "opponent", label: "Opponent side", description: "White or Black.", fairness: "game", value: ({ game }) => colorName(other(game.myColor)) },
  { name: "fen", label: "FEN", description: "The position in FEN notation.", fairness: "game", value: ({ game }) => game.fen },
  {
    name: "pgn",
    label: "Moves so far",
    description: 'Moves as PGN movetext ("1. e4 e5 2. Nf3"), or "(no moves yet)".',
    fairness: "game",
    value: ({ game }) => (game.history.length ? movetext(game.history) : "(no moves yet)"),
  },
  {
    name: "move_number",
    label: "Move number",
    description: "The current full-move number.",
    fairness: "game",
    value: ({ game }) => String(Math.floor(game.history.length / 2) + 1),
  },
  {
    name: "last_move",
    label: "Last move",
    description: '"Black played Nf6", or "none".',
    fairness: "game",
    value: ({ game }) => {
      const san = game.history.at(-1);
      return san ? `${colorName(other(game.myColor))} played ${san}` : "none";
    },
  },
  {
    name: "my_notes",
    label: "Your notes",
    description:
      'The notes you wrote at the end of your previous move (turn on "Keep notes between moves"), or "(none yet)". Only your own notes, never the opponent\'s.',
    fairness: "game",
    value: ({ game }) => game.myNotes?.trim() || "(none yet)",
  },
  {
    name: "errors",
    label: "Referee rejections",
    description:
      'Moves the referee rejected earlier this turn, each on a new line: "Your move X was rejected: <reason>. Try again." Empty if none.',
    fairness: "game",
    value: ({ game }) => game.previousAttempts.map((a) => `\nYour move ${a.move} was rejected: ${a.error}. Try again.`).join(""),
  },
  {
    name: "problem",
    label: "Pre-check problem",
    description: 'Re-ask prompt only: why the pre-check refused the move, e.g. "Ke3 is not legal in this position."',
    fairness: "game",
    value: ({ problem }) => problem ?? "",
  },
];

const BLOCKS: (VariableInfo & { value: (ctx: VariableContext) => string })[] = [
  {
    name: "board_ascii",
    label: "ASCII board",
    description: "Text grid with letters for pieces (uppercase White), White at the bottom.",
    fairness: "rules",
    value: ({ game }) => new Chess(game.fen).ascii(),
  },
  {
    name: "board_unicode",
    label: "Unicode board",
    description: "Grid with chess symbols (♔♕♖ for White, ♚♛♜ for Black), White at the bottom.",
    fairness: "rules",
    value: ({ game }) => boardGrid(new Chess(game.fen), (p) => (p ? UNICODE[p.color + p.type] : "·")),
  },
  {
    name: "pieces",
    label: "Piece list",
    description: 'Every piece by square: "White: Ke1, Qd1, … pawns a2 b2 …".',
    fairness: "rules",
    value: ({ game }) => {
      const chess = new Chess(game.fen);
      return `${pieceList(chess, "w")}\n${pieceList(chess, "b")}`;
    },
  },
  {
    name: "legal_moves",
    label: "Legal moves",
    description: "All legal moves in SAN, comma-separated.",
    fairness: "rules",
    value: ({ game }) => game.legalMoves.join(", "),
  },
  {
    name: "legal_moves_by_piece",
    label: "Legal moves by piece",
    description: 'One line per piece that can move: "Knight g1: Nf3, Nh3".',
    fairness: "rules",
    value: ({ game }) => {
      const chess = new Chess(game.fen);
      const groups = new Map<string, string[]>();
      for (const m of chess.moves({ verbose: true })) {
        const key = `${NAME[m.piece][0].toUpperCase()}${NAME[m.piece].slice(1)} ${m.from}`;
        groups.set(key, [...(groups.get(key) ?? []), m.san]);
      }
      return [...groups].map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n") || "none";
    },
  },
  {
    name: "last_move_threats",
    label: "Threats from last move",
    description:
      "Your pieces attacked now that weren't attacked before the opponent's last move (discovered attacks included), and whether you're in check.",
    fairness: "rules",
    value: ({ game }) => {
      const { now, before, last } = positions(game.history);
      if (!last) return "none (no moves yet)";
      const me = game.myColor;
      const newly: Square[] = [];
      for (const row of now.board()) {
        for (const c of row) {
          if (!c || c.color !== me || c.type === "k") continue;
          const wasMine = before.get(c.square)?.color === me;
          if (now.attackers(c.square, other(me)).length && !(wasMine && before.attackers(c.square, other(me)).length)) {
            newly.push(c.square);
          }
        }
      }
      const head = `${colorName(other(me))} played ${last.san} (${NAME[last.piece]} ${last.from} to ${last.to}).`;
      const check = now.inCheck() ? " You are in check." : "";
      return `${head} Newly attacked: ${squaresLabel(now, newly)}.${check}`;
    },
  },
  {
    name: "attacks",
    label: "Attacked & undefended pieces",
    description:
      "For both sides: each attacked piece with its attackers and defenders; undefended ones flagged. Counts only; pins and pieces lined up behind each other are ignored.",
    fairness: "rules",
    value: ({ game }) => {
      const chess = new Chess(game.fen);
      const me = chess.turn();
      return [
        chess.inCheck() ? "You are IN CHECK." : null,
        `Your pieces that are attacked:\n${attackedLines(chess, me)}`,
        `Opponent pieces you attack:\n${attackedLines(chess, other(me))}`,
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    name: "captures",
    label: "Captures",
    description: 'Every legal capture and what it takes: "Nxd8 (takes queen)", or "none".',
    fairness: "rules",
    value: ({ game }) => {
      const caps = new Chess(game.fen)
        .moves({ verbose: true })
        .filter((m) => m.captured)
        .map((m) => `${m.san} (takes ${NAME[m.captured!]})`);
      return caps.length ? caps.join(", ") : "none";
    },
  },
  {
    name: "checks",
    label: "Checks",
    description: 'Every legal move that gives check, or "none".',
    fairness: "rules",
    value: ({ game }) => {
      const checks = game.legalMoves.filter((m) => /[+#]$/.test(m));
      return checks.length ? checks.join(", ") : "none";
    },
  },
  {
    name: "material",
    label: "Piece count",
    description: 'Pieces per side ("White: 8 pawns, 2 knights, …"). No point values.',
    fairness: "rules",
    value: ({ game }) => {
      const chess = new Chess(game.fen);
      return `${materialLine(chess, "w")}\n${materialLine(chess, "b")}`;
    },
  },
  {
    name: "game_state",
    label: "Game state",
    description: "Check, castling rights, en passant square, how often this position occurred, and the 50-move counter.",
    fairness: "rules",
    value: ({ game }) => {
      const chess = new Chess(game.fen);
      const [, , , ep, halfmove] = game.fen.split(" ");
      const rights = (c: Color) => {
        const r = chess.getCastlingRights(c);
        const list = [r.k ? "O-O" : null, r.q ? "O-O-O" : null].filter(Boolean);
        return `${colorName(c)} ${list.length ? list.join(", ") : "none"}`;
      };
      const key = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
      const replay = new Chess();
      let seen = key(replay.fen()) === key(game.fen) ? 1 : 0;
      for (const san of game.history) {
        replay.move(san);
        if (key(replay.fen()) === key(game.fen)) seen++;
      }
      return [
        `In check: ${chess.inCheck() ? "yes" : "no"}`,
        `Castling rights: ${rights("w")}; ${rights("b")}`,
        `En passant square: ${ep === "-" ? "none" : ep}`,
        `This position has occurred ${seen} time${seen === 1 ? "" : "s"} (3 = draw)`,
        `Half-moves since last capture or pawn move: ${halfmove} (100 = draw)`,
      ].join("\n");
    },
  },
  {
    name: "move_safety",
    label: "Move safety (borderline)",
    description:
      "Legal moves after which the moved piece stands on a square the opponent attacks and you don't defend. Looks one move ahead, so it's marked borderline.",
    fairness: "borderline",
    value: ({ game }) => {
      const chess = new Chess(game.fen);
      const unsafe: string[] = [];
      for (const m of chess.moves({ verbose: true })) {
        if (m.piece === "k") continue; // king moves into attack are already illegal
        chess.move(m);
        const to = m.to as Square;
        const attacked = chess.attackers(to, other(m.color)).length > 0;
        const defended = chess.attackers(to, m.color).length > 0;
        chess.undo();
        if (attacked && !defended) unsafe.push(m.san);
      }
      return unsafe.length
        ? `Moves that leave the moved piece undefended and attacked: ${unsafe.join(", ")}`
        : "No move leaves the moved piece undefended and attacked.";
    },
  },
];

export const BASE_VARIABLES: VariableInfo[] = BASE.map(({ value: _v, ...info }) => info);
export const CONTEXT_BLOCKS: VariableInfo[] = BLOCKS.map(({ value: _v, ...info }) => info);
export const ALL_VARIABLE_NAMES = new Set([...BASE, ...BLOCKS].map((v) => v.name));

/** Lazy sources for renderTemplate: a block is only computed if its variable is used. */
export function variableSources(ctx: VariableContext): VariableSources {
  const out: VariableSources = {};
  for (const v of [...BASE, ...BLOCKS]) out[v.name] = () => v.value(ctx);
  return out;
}
