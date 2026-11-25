import { useEffect, useRef } from "react";

interface Props {
  history: string[];
  /** Shown after the last move when the game is over, e.g. "1-0". */
  result?: string | null;
}

export function MoveList({ history, result }: Props) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  const pairs: { n: number; white: string; black?: string }[] = [];
  for (let i = 0; i < history.length; i += 2) pairs.push({ n: i / 2 + 1, white: history[i], black: history[i + 1] });
  const last = history.length - 1;

  return (
    <section className="moves-box" aria-label="Moves">
      <header>
        <h3>Moves</h3>
        <p className="hint">
          Standard notation: K king, Q queen, R rook, B bishop, N knight, no letter for a pawn; x captures, + check, # mate,
          O-O castles.
        </p>
      </header>
      {history.length === 0 ? (
        <p className="hint empty">No moves yet.</p>
      ) : (
        <ol className="moves" ref={ref}>
          {pairs.map(({ n, white, black }) => (
            <li key={n}>
              <span className="num">{n}.</span>
              <span className={(n - 1) * 2 === last ? "mv last" : "mv"}>{white}</span>
              {black && <span className={(n - 1) * 2 + 1 === last ? "mv last" : "mv"}>{black}</span>}
            </li>
          ))}
          {result && result !== "*" && <li className="result">{result}</li>}
        </ol>
      )}
    </section>
  );
}
