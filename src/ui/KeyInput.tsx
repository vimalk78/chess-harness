import type { FreeQuota } from "../llm/models";

interface Props {
  value: string;
  remember: boolean;
  disabled: boolean;
  quota: FreeQuota | null;
  quotaError: string | null;
  freeOnly: boolean;
  onChange: (key: string) => void;
  onRememberChange: (remember: boolean) => void;
  onFreeOnlyChange: (freeOnly: boolean) => void;
}

export function KeyInput(p: Props) {
  return (
    <div className="key">
      <label htmlFor="or-key">OpenRouter API key</label>
      <input
        id="or-key"
        type="password"
        value={p.value}
        placeholder="sk-or-…"
        autoComplete="off"
        spellCheck={false}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.target.value)}
      />
      <label className="check">
        <input type="checkbox" checked={p.remember} onChange={(e) => p.onRememberChange(e.target.checked)} />
        Remember in this browser
      </label>
      <label className="check">
        <input type="checkbox" checked={p.freeOnly} onChange={(e) => p.onFreeOnlyChange(e.target.checked)} />
        Show free models only
      </label>
      {p.quota && (
        <p className={`quota ${p.quota.remaining < 20 ? "low" : ""}`}>
          Free-model requests today: <strong>{p.quota.used}</strong> of {p.quota.limit} used ({p.quota.remaining} left)
        </p>
      )}
      {p.quotaError && <p className="quota low">{p.quotaError}</p>}
      <p className="hint">
        Free models allow 20 requests/min and 50/day (1000/day once you've bought $10 of credits). A full game usually
        needs 80–200 requests; the app spaces calls out and waits out per-minute limits for you.
      </p>
      <p className="hint">
        Your key stays in this browser and is sent only to openrouter.ai. Get one at{" "}
        <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
          openrouter.ai/keys
        </a>
        .
      </p>
    </div>
  );
}
