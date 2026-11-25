import { Chess } from "chess.js";
import { useMemo } from "react";
import { Chessboard } from "react-chessboard";
import type { Color } from "../agents/types";

interface Props {
  fen: string;
  history: string[];
  orientation: "white" | "black";
  humanToMove: Color | null;
  onHumanMove: (from: string, to: string, isPawn: boolean) => boolean;
}

export function Board({ fen, history, orientation, humanToMove, onHumanMove }: Props) {
  const lastMoveStyles = useMemo(() => {
    if (!history.length) return {};
    const chess = new Chess();
    for (const san of history) chess.move(san);
    const last = chess.history({ verbose: true }).at(-1)!;
    const hl = { background: "rgba(255, 213, 79, 0.45)" };
    return { [last.from]: hl, [last.to]: hl };
  }, [history]);

  return (
    <div className="board">
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          allowDragging: humanToMove !== null,
          canDragPiece: ({ piece }) => humanToMove !== null && piece.pieceType[0] === humanToMove,
          onPieceDrop: ({ piece, sourceSquare, targetSquare }) =>
            targetSquare ? onHumanMove(sourceSquare, targetSquare, piece.pieceType[1] === "P") : false,
          squareStyles: lastMoveStyles,
          animationDurationInMs: 200,
        }}
      />
    </div>
  );
}
