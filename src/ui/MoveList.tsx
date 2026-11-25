import { useEffect, useRef } from "react";

export function MoveList({ history }: { history: string[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  const rows: [string, string | undefined][] = [];
  for (let i = 0; i < history.length; i += 2) rows.push([history[i], history[i + 1]]);

  return (
    <ol className="moves" ref={ref}>
      {rows.length === 0 && <li className="empty">No moves yet</li>}
      {rows.map(([w, b], i) => (
        <li key={i}>
          <span className="num">{i + 1}.</span>
          <span>{w}</span>
          <span>{b ?? ""}</span>
        </li>
      ))}
    </ol>
  );
}
