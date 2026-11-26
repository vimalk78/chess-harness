import { useCallback, useLayoutEffect, useRef } from "react";
import type { Color } from "../agents/types";
import type { LiveOutput, PanelEntry } from "./useGame";

interface Props {
  color: Color;
  title: string;
  entries: PanelEntry[];
  /** Model output streaming in right now, if any. */
  live?: LiveOutput | null;
  thinkingSince: number | null;
  /** While a rate-limit wait is on: when it began and when the retry happens. */
  waiting?: { since: number; until: number } | null;
  isHuman: boolean;
  now: number;
}

/**
 * Keeps a scrollable element pinned to its bottom as content grows, unless the user has
 * scrolled up to read; scrolling back to the bottom pins it again.
 */
function useStickToBottom<T extends HTMLElement>(trigger: unknown) {
  const ref = useRef<T>(null);
  const pinned = useRef(true);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [trigger]);
  return { ref, onScroll };
}

/** Streaming reasoning in its own scroll box; remounts (and re-pins) for each model call. */
function LiveReasoning({ text }: { text: string }) {
  const { ref, onScroll } = useStickToBottom<HTMLPreElement>(text.length);
  return (
    <pre className="live-reasoning" ref={ref} onScroll={onScroll}>
      {text}
    </pre>
  );
}

export function AgentLog({ color, title, entries, live, thinkingSince, waiting, isHuman, now }: Props) {
  const list = useStickToBottom<HTMLDivElement>(`${entries.length}:${live?.text.length ?? 0}:${live?.reasoning.length ?? 0}`);

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
          <div className={waiting ? "thinking waiting" : "thinking"}>
            {isHuman
              ? "Your move"
              : waiting
                ? // The thinking clock stops during the wait (it's shifted forward when the wait ends).
                  `Thinking… ${Math.max(0, Math.floor((waiting.since - thinkingSince) / 1000))}s · rate-limited, retrying in ${Math.max(0, Math.ceil((waiting.until - now) / 1000))}s`
                : `Thinking… ${Math.max(0, Math.floor((now - thinkingSince) / 1000))}s`}
          </div>
        )}
      </header>
      <div className="log" ref={list.ref} onScroll={list.onScroll}>
        {entries.length === 0 && !(live && (live.reasoning || live.text)) && (
          <p className="empty">{isHuman ? "Your moves will appear here." : "Prompts and replies will appear here."}</p>
        )}
        {entries.map((e, i) => (
          <Entry key={i} entry={e} />
        ))}
        {live && (live.reasoning || live.text) && (
          <div className="entry live">
            <div className="live-label">Live</div>
            {live.reasoning && <LiveReasoning text={live.reasoning} />}
            {live.text && <pre>{live.text}</pre>}
          </div>
        )}
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
          {entry.reasoning && (
            <details className="reasoning">
              <summary>Reasoning ({entry.reasoning.length.toLocaleString()} chars)</summary>
              <pre>{entry.reasoning}</pre>
            </details>
          )}
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
    case "notes":
      return (
        <div className="entry notes">
          <div className="notes-label">Notes kept for next move</div>
          <pre>{entry.text}</pre>
        </div>
      );
    case "illegal":
      return <div className="entry illegal">{entry.text}</div>;
    case "turn":
      return <div className="entry turn">{entry.text}</div>;
  }
}
