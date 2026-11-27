// Browse every harness as a card (presets, community, your own) and pick one for a side.

import { useMemo } from "react";
import { CODE_AGENTS, communityAgentId, customAgentId } from "../agents/registry";
import type { Color } from "../agents/types";
import type { HarnessConfig } from "../harness/config";
import { COMMUNITY, PRESETS } from "../harness/presets";
import { summarizeHarness } from "../harness/summary";

interface Props {
  color: Color;
  /** The side's current agent id, marked on its card. */
  current: string;
  harnesses: HarnessConfig[];
  onPick: (agentId: string) => void;
  onView: (agentId: string) => void;
  onClose: () => void;
}

export function HarnessPicker({ color, current, harnesses, onPick, onView, onClose }: Props) {
  const side = color === "w" ? "White" : "Black";
  const groups = useMemo(
    () =>
      [
        { title: "Presets", note: "Built in.", items: PRESETS.map((h) => ({ id: h.id, h })) },
        { title: "Community", note: "Submitted by players.", items: COMMUNITY.map((h) => ({ id: communityAgentId(h.id), h })) },
        { title: "My harnesses", note: "Saved in this browser.", items: harnesses.map((h) => ({ id: customAgentId(h.id), h })) },
      ].filter((g) => g.items.length > 0),
    [harnesses],
  );

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal picker" role="dialog" aria-modal="true" aria-label={`Choose a harness for ${side}`}>
        <header className="editor-head">
          <h2>Choose a harness for {side}</h2>
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="picker-body">
          {groups.map((g) => (
            <section key={g.title}>
              <h3>
                {g.title} <span className="hint">{g.note}</span>
              </h3>
              <div className="cards">
                {g.items.map(({ id, h }) => (
                  <HarnessCard key={id} config={h} selected={id === current} side={side} onUse={() => onPick(id)} onView={() => onView(id)} />
                ))}
              </div>
            </section>
          ))}
          <section>
            <h3>
              Other <span className="hint">Not a harness.</span>
            </h3>
            <div className="cards">
              {CODE_AGENTS.map((a) => (
                <article key={a.id} className={`card ${a.id === current ? "selected" : ""}`}>
                  <h4>{a.label}</h4>
                  <p className="card-desc">{a.description}</p>
                  <div className="card-actions">
                    <button type="button" className="primary" onClick={() => onPick(a.id)} disabled={a.id === current}>
                      {a.id === current ? `Playing ${side}` : `Use for ${side}`}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function HarnessCard({ config, selected, side, onUse, onView }: { config: HarnessConfig; selected: boolean; side: string; onUse: () => void; onView: () => void }) {
  const s = useMemo(() => summarizeHarness(config), [config]);
  return (
    <article className={`card ${selected ? "selected" : ""}`}>
      <h4>{config.name}</h4>
      {config.author && <p className="hint">by {config.author}</p>}
      {config.description && <p className="card-desc">{config.description}</p>}
      <div className="chips" aria-label="Context blocks used">
        {s.usesFen && <span className="chip">FEN</span>}
        {s.blocks.map((b) => (
          <span key={b.name} className={`chip ${b.borderline ? "borderline" : ""}`} title={b.borderline ? "Borderline: looks one move ahead" : `{{${b.name}}}`}>
            {b.label}
            {b.borderline && " ⚠"}
          </span>
        ))}
        {s.usesNotes && <span className="chip notes">Notes between moves</span>}
        {!s.usesFen && s.blocks.length === 0 && <span className="chip muted">Moves only (PGN)</span>}
      </div>
      <p className="card-meta">
        {s.usesSystemPrompt ? "System prompt · " : ""}
        {s.checking} · ≈ {s.approxTokens.toLocaleString()} tokens per turn
      </p>
      <div className="card-actions">
        <button type="button" onClick={onView}>
          View
        </button>
        <button type="button" className="primary" onClick={onUse} disabled={selected}>
          {selected ? `Playing ${side}` : `Use for ${side}`}
        </button>
      </div>
    </article>
  );
}
