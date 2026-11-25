import { useEffect, useRef } from "react";
import type { Color } from "../agents/types";
import type { PanelEntry } from "./useGame";

interface Props {
  color: Color;
  title: string;
  entries: PanelEntry[];
  thinkingSince: number | null;
  isHuman: boolean;
  now: number;
}

export function AgentLog({ color, title, entries, thinkingSince, isHuman, now }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  let prompt = 0;
  let completion = 0;
  let cost = 0;
  let costKnown = false;
  let calls = 0;
  let illegal = 0;
  for (const e of entries) {
    if (e.kind === "response") {
      calls++;
      prompt += e.usage?.promptTokens ?? 0;
      completion += e.usage?.completionTokens ?? 0;
      if (e.usage?.costUsd !== undefined) {
        cost += e.usage.costUsd;
        costKnown = true;
      }
    }
    if (e.kind === "illegal") illegal++;
  }

  return (
    <section className={`panel panel-${color}`}>
      <header>
        <h2>
          <span className={`dot dot-${color}`} />
          {color === "w" ? "White" : "Black"}
        </h2>
        <div className="panel-title">{title}</div>
        {!isHuman && (
          <div className="stats">
            <span>{calls} calls</span>
            <span>{(prompt + completion).toLocaleString()} tokens</span>
            <span>{costKnown ? `$${cost.toFixed(4)}` : "$–"}</span>
            <span className={illegal ? "bad" : ""}>{illegal} rejected</span>
          </div>
        )}
        {thinkingSince !== null && (
          <div className="thinking">
            {isHuman ? "Your move" : `Thinking… ${Math.max(0, Math.floor((now - thinkingSince) / 1000))}s`}
          </div>
        )}
      </header>
      <div className="log" ref={listRef}>
        {entries.length === 0 && (
          <p className="empty">{isHuman ? "Your moves will appear here." : "Prompts and replies will appear here."}</p>
        )}
        {entries.map((e, i) => (
          <Entry key={i} entry={e} />
        ))}
      </div>
    </section>
  );
}

function Entry({ entry }: { entry: PanelEntry }) {
  switch (entry.kind) {
    case "prompt":
      return (
        <details className="entry prompt">
          <summary>Prompt ({entry.text.length.toLocaleString()} chars)</summary>
          <pre>{entry.text}</pre>
        </details>
      );
    case "response":
      return (
        <div className="entry response">
          <pre>{entry.text || "(empty reply)"}</pre>
          {entry.usage && (
            <div className="usage">
              {entry.usage.promptTokens} in / {entry.usage.completionTokens} out
              {entry.usage.costUsd !== undefined && ` · $${entry.usage.costUsd.toFixed(5)}`}
            </div>
          )}
        </div>
      );
    case "note":
      return <div className="entry note">{entry.text}</div>;
    case "illegal":
      return <div className="entry illegal">{entry.text}</div>;
    case "turn":
      return <div className="entry turn">{entry.text}</div>;
  }
}
