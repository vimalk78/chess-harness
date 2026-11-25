interface Props {
  value: string;
  remember: boolean;
  disabled: boolean;
  onChange: (key: string) => void;
  onRememberChange: (remember: boolean) => void;
}

export function KeyInput({ value, remember, disabled, onChange, onRememberChange }: Props) {
  return (
    <div className="key">
      <label htmlFor="or-key">OpenRouter API key</label>
      <input
        id="or-key"
        type="password"
        value={value}
        placeholder="sk-or-…"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => onRememberChange(e.target.checked)} />
        Remember in this browser
      </label>
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
