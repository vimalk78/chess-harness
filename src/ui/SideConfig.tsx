import { AGENTS, getAgent } from "../agents/registry";
import type { Color, ReasoningEffort } from "../agents/types";
import type { ModelInfo } from "../llm/models";
import type { SideConfig as Side } from "./useGame";

interface Props {
  color: Color;
  value: Side;
  disabled: boolean;
  models: ModelInfo[] | null;
  freeOnly: boolean;
  onChange: (v: Side) => void;
}

export function SideConfig({ color, value, disabled, models, freeOnly, onChange }: Props) {
  const def = getAgent(value.agentId);
  const id = `side-${color}`;
  const modelId = value.model.trim();
  const known = models?.find((m) => m.id === modelId);
  const warning =
    !models || !modelId
      ? null
      : !known
        ? "Not in OpenRouter's current model list."
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
            placeholder={freeOnly ? "pick a :free model" : "e.g. anthropic/claude-haiku-5.5"}
            spellCheck={false}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
          />
          {known && <p className="hint">{known.name}</p>}
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
