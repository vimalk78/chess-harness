import { useState } from "react";
import { CODE_AGENTS, communityAgentId, customAgentId, getAgent, harnessConfigFor, isLibraryHarness } from "../agents/registry";
import type { HarnessConfig } from "../harness/config";
import { COMMUNITY, PRESETS } from "../harness/presets";
import type { Color, ReasoningEffort } from "../agents/types";
import { isOftenRateLimited, type ModelInfo } from "../llm/models";
import type { SideConfig as Side } from "./useGame";

const OTHER = "__other__";

interface Props {
  color: Color;
  value: Side;
  disabled: boolean;
  models: ModelInfo[] | null;
  freeOnly: boolean;
  harnesses: HarnessConfig[];
  onChange: (v: Side) => void;
  /** Open the harness editor: view a preset, edit a saved harness, or start a new one. */
  onHarness: (action: "view" | "edit" | "new" | "browse") => void;
}

export function SideConfig({ color, value, disabled, models, freeOnly, harnesses, onChange, onHarness }: Props) {
  const def = getAgent(value.agentId);
  const author = harnessConfigFor(value.agentId)?.author;
  const id = `side-${color}`;
  const modelId = value.model.trim();
  const offered = (models ?? []).filter((m) => !freeOnly || m.free);
  const choices = offered.filter((m) => !isOftenRateLimited(m.id));
  const hiddenCount = offered.length - choices.length;
  const inList = choices.some((m) => m.id === modelId);
  const [typing, setTyping] = useState(false);
  // Free text when the list didn't load, when the user picked "Other", or when the saved ID isn't offered.
  const showInput = !models || typing || (modelId !== "" && !inList);

  const known = models?.find((m) => m.id === modelId);
  const warning =
    !models || !modelId
      ? null
      : !known
        ? "Not in OpenRouter's current model list."
        : isOftenRateLimited(known.id)
          ? "Often rate-limited by its provider, so it's hidden from the list. Games may pause while it waits."
          : freeOnly && !known.free
          ? "This is a paid model."
          : null;

  return (
    <fieldset className={`side side-${color}`} disabled={disabled}>
      <legend>
        <span className={`dot dot-${color}`} />
        {color === "w" ? "White" : "Black"}
      </legend>
      <label htmlFor={`${id}-agent`}>Agent</label>
      <select id={`${id}-agent`} value={value.agentId} onChange={(e) => onChange({ ...value, agentId: e.target.value })}>
        <optgroup label="Presets">
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
        {COMMUNITY.length > 0 && (
          <optgroup label="Community">
            {COMMUNITY.map((h) => (
              <option key={h.id} value={communityAgentId(h.id)}>
                {h.name}
              </option>
            ))}
          </optgroup>
        )}
        {harnesses.length > 0 && (
          <optgroup label="My harnesses">
            {harnesses.map((h) => (
              <option key={h.id} value={customAgentId(h.id)}>
                {h.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Other">
          {CODE_AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </optgroup>
      </select>
      <p className="hint">
        {def.description}
        {author && ` By ${author}.`}
      </p>
      <div className="harness-actions">
        <button type="button" onClick={() => onHarness("browse")}>
          Browse harnesses…
        </button>
        {isLibraryHarness(value.agentId) && (
          <button type="button" onClick={() => onHarness("view")}>
            View / duplicate
          </button>
        )}
        {value.agentId.startsWith("custom:") && (
          <button type="button" onClick={() => onHarness("edit")}>
            Edit harness
          </button>
        )}
        <button type="button" onClick={() => onHarness("new")}>
          + New harness
        </button>
      </div>
      {def.needsModel && (
        <>
          <label htmlFor={`${id}-model`}>Model {models && `(${choices.length} ${freeOnly ? "free" : "available"})`}</label>
          {models && (
            <select
              id={`${id}-model`}
              value={showInput ? OTHER : modelId}
              onChange={(e) => {
                if (e.target.value === OTHER) {
                  setTyping(true);
                } else {
                  setTyping(false);
                  onChange({ ...value, model: e.target.value });
                }
              }}
            >
              {!modelId && !showInput && <option value="">Choose a model…</option>}
              {choices.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.reasoning ? " · reasoning" : ""}
                </option>
              ))}
              <option value={OTHER}>Other model ID…</option>
            </select>
          )}
          {showInput && (
            <input
              id={models ? `${id}-model-id` : `${id}-model`}
              aria-label="OpenRouter model ID"
              value={value.model}
              placeholder={freeOnly ? "e.g. vendor/model-name:free" : "e.g. anthropic/claude-haiku-5.5"}
              spellCheck={false}
              onChange={(e) => onChange({ ...value, model: e.target.value })}
            />
          )}
          <p className="hint mono">{modelId || "no model selected"}</p>
          {hiddenCount > 0 && (
            <p className="hint">
              {hiddenCount} Google-hosted free model{hiddenCount === 1 ? " is" : "s are"} hidden: their provider often
              rate-limits them. You can still type the ID under "Other model ID…".
            </p>
          )}
          {warning && <p className="hint warn">{warning}</p>}
          <label htmlFor={`${id}-effort`}>Reasoning effort</label>
          <select
            id={`${id}-effort`}
            value={value.effort}
            onChange={(e) => onChange({ ...value, effort: e.target.value as ReasoningEffort | "" })}
          >
            <option value="">Model default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </>
      )}
    </fieldset>
  );
}
