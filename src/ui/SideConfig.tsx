import { AGENTS, getAgent } from "../agents/registry";
import type { Color, ReasoningEffort } from "../agents/types";
import type { SideConfig as Side } from "./useGame";

export const MODEL_SUGGESTIONS = [
  "anthropic/claude-haiku-5.5",
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-opus-5.5",
  "openai/gpt-5.5",
  "google/gemini-3-flash-preview",
  "google/gemini-3.1-pro-preview",
];

interface Props {
  color: Color;
  value: Side;
  disabled: boolean;
  onChange: (v: Side) => void;
}

export function SideConfig({ color, value, disabled, onChange }: Props) {
  const def = getAgent(value.agentId);
  const id = `side-${color}`;
  return (
    <fieldset className={`side side-${color}`} disabled={disabled}>
      <legend>
        <span className={`dot dot-${color}`} />
        {color === "w" ? "White" : "Black"}
      </legend>
      <label htmlFor={`${id}-agent`}>Agent</label>
      <select id={`${id}-agent`} value={value.agentId} onChange={(e) => onChange({ ...value, agentId: e.target.value })}>
        {AGENTS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      <p className="hint">{def.description}</p>
      {def.needsModel && (
        <>
          <label htmlFor={`${id}-model`}>OpenRouter model ID</label>
          <input
            id={`${id}-model`}
            list="model-suggestions"
            value={value.model}
            placeholder="e.g. anthropic/claude-haiku-5.5"
            spellCheck={false}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
          />
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
