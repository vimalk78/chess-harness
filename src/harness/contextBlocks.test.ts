import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { ALL_VARIABLE_NAMES, CONTEXT_BLOCKS, opponentChecks, variableSources, type VariableContext } from "./contextBlocks";
import { renderTemplate } from "./template";

function ctx(history: string[], extra: Partial<VariableContext> = {}): VariableContext {
  const c = new Chess();
  for (const m of history) c.move(m);
  return { game: { history, fen: c.fen(), legalMoves: c.moves(), myColor: c.turn(), previousAttempts: [] }, ...extra };
}
const v = (name: string, c: VariableContext) => renderTemplate(`{{${name}}}`, variableSources(c));

// From a real game: White's knight on f7 forks queen and rook and hangs to the king.
const FORK = ["Nf3", "e5", "Nxe5", "Nf6", "Nxf7"];

describe("base variables", () => {
  it("describe the game", () => {
    const c = ctx(FORK);
    expect(v("side", c)).toBe("Black");
    expect(v("opponent", c)).toBe("White");
    expect(v("pgn", c)).toBe("1. Nf3 e5 2. Nxe5 Nf6 3. Nxf7");
    expect(v("move_number", c)).toBe("3");
    expect(v("last_move", c)).toBe("White played Nxf7");
    expect(v("pgn", ctx([]))).toBe("(no moves yet)");
    expect(v("last_move", ctx([]))).toBe("none");
  });

  it("errors lists referee rejections on new lines, problem only in re-asks", () => {
    const c = ctx([]);
    c.game.previousAttempts = [{ move: "e5", error: "e5 is not a legal move in this position" }];
    expect(v("errors", c)).toBe("\nYour move e5 was rejected: e5 is not a legal move in this position. Try again.");
    expect(v("errors", ctx([]))).toBe("");
    expect(v("problem", ctx([], { problem: "Ke3 is not legal in this position." }))).toBe("Ke3 is not legal in this position.");
  });
});

describe("context blocks", () => {
  it("last_move_threats lists newly attacked pieces", () => {
    expect(v("last_move_threats", ctx(FORK))).toBe("White played Nxf7 (knight e5 to f7). Newly attacked: queen d8, rook h8.");
    expect(v("last_move_threats", ctx([]))).toBe("none (no moves yet)");
  });

  it("last_move_threats catches discovered attacks and check", () => {
    // 2...d6 moves a pawn, but it's the c8 bishop behind it that now hits the queen on g4.
    expect(v("last_move_threats", ctx(["e4", "e5", "Qg4", "d6"]))).toBe(
      "Black played d6 (pawn d7 to d6). Newly attacked: queen g4.",
    );
    expect(v("last_move_threats", ctx(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]))).toMatch(/You are in check\.$/);
  });

  it("opponent_checks lists the opponent's checks as if it were their turn, mates first", () => {
    // Planner + notes vs Stockfish 1600, before 30.Qxe5?? Rh3#: the mate was already threatened.
    const fen = "5k1B/5p2/p7/2P1pq2/P6K/2Pr4/N3QP1P/R4R2 w - - 7 30";
    expect(opponentChecks(fen)).toBe("Rh3# <- CHECKMATE, Qf6+, Qh7+, Qg5+, Qh5+, Qg4+, Qh3+, Qf4+, Qxf2+, Qe4+, Rd4+");
    expect(opponentChecks(new Chess().fen())).toBe("none");
    // In check now: listing the checker's other checks would be misleading.
    expect(v("opponent_checks", ctx(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]))).toMatch(/^none listed: you are in check/);
  });

  it("attacks shows both sides with defenders and flags undefended pieces", () => {
    expect(v("attacks", ctx(FORK))).toBe(
      [
        "Your pieces that are attacked:",
        "- queen d8: attacked by knight f7; defended by king e8",
        "- rook h8: attacked by knight f7; defended by nothing  <- UNDEFENDED",
        "Opponent pieces you attack:",
        "- knight f7: attacked by king e8; defended by nothing  <- UNDEFENDED",
      ].join("\n"),
    );
  });

  it("captures, checks, material", () => {
    expect(v("captures", ctx(FORK))).toBe("Kxf7 (takes knight)");
    expect(v("captures", ctx([]))).toBe("none");
    expect(v("checks", ctx(["e4", "d5", "e5", "f5"]))).toBe("Qh5+, Bb5+");
    expect(v("material", ctx(FORK))).toBe(
      "White: 1 queen, 2 rooks, 2 bishops, 2 knights, 8 pawns\nBlack: 1 queen, 2 rooks, 2 bishops, 2 knights, 6 pawns",
    );
  });

  it("boards and piece list", () => {
    expect(v("board_unicode", ctx(FORK)).split("\n")[1]).toBe("7 ♟ ♟ ♟ ♟ · ♘ ♟ ♟");
    expect(v("board_ascii", ctx([]))).toContain(" 1 | R  N  B  Q  K  B  N  R |");
    expect(v("pieces", ctx(FORK)).split("\n")[0]).toBe("White: Ke1, Qd1, Ra1, Rh1, Bc1, Bf1, Nf7, Nb1, pawns a2 b2 c2 d2 e2 f2 g2 h2");
  });

  it("legal moves, flat and by piece", () => {
    expect(v("legal_moves", ctx([])).split(", ")).toHaveLength(20);
    expect(v("legal_moves_by_piece", ctx(FORK))).toContain("King e8: Kxf7, Ke7");
  });

  it("game_state reports en passant, castling and repetition", () => {
    const s = v("game_state", ctx(["e4", "d5", "e5", "f5"]));
    expect(s).toContain("En passant square: f6");
    expect(s).toContain("Castling rights: White O-O, O-O-O; Black O-O, O-O-O");
    expect(v("game_state", ctx(["Nf3", "Nf6", "Ng1", "Ng8"]))).toContain("This position has occurred 2 times");
  });

  it("move_safety flags moves that leave the moved piece hanging", () => {
    expect(v("move_safety", ctx(FORK))).toBe("Moves that leave the moved piece undefended and attacked: Ba3, g5");
    expect(v("move_safety", ctx(["e4", "d5", "e5", "f5"]))).toContain("exf6");
  });

  it("every block has a description and a fairness tag; only move_safety is borderline", () => {
    for (const b of CONTEXT_BLOCKS) expect(b.description.length).toBeGreaterThan(10);
    expect(CONTEXT_BLOCKS.filter((b) => b.fairness === "borderline").map((b) => b.name)).toEqual(["move_safety"]);
    expect(ALL_VARIABLE_NAMES.size).toBe(9 + 13); // 9 game variables (incl. my_notes) + 13 context blocks
  });
});
