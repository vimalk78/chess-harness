import { useMemo, useRef, useState } from "react";
import type { HarnessConfig } from "../harness/config";
import { validateHarness } from "../harness/config";
import { ALL_VARIABLE_NAMES, BASE_VARIABLES, CONTEXT_BLOCKS, type VariableContext, type VariableInfo } from "../harness/contextBlocks";
import { renderPrompts, renderReask } from "../harness/runner";
import { COMMUNITY } from "../harness/presets";
import { exportHarnessJson, harnessStore, parseHarnessJson, shareUrl } from "../harness/store";
import { prepareSubmission } from "../harness/submit";
import { templateVariables } from "../harness/template";

type Field = "systemPrompt" | "turnPrompt" | "reaskPrompt";

interface Props {
  initial: HarnessConfig;
  /** Presets and community harnesses are read-only: they can be viewed, duplicated, exported and shared. */
  readOnly: boolean;
  /** Not yet saved (a new harness). */
  isNew: boolean;
  /** Position used for the live preview. */
  previewGame: VariableContext["game"];
  onClose: () => void;
  /** Called after a save/copy/import with the stored config, so the side can select it. */
  onSaved: (config: HarnessConfig) => void;
  onDeleted: (id: string) => void;
}

const FIELD_LABEL: Record<Field, string> = {
  systemPrompt: "System prompt (optional)",
  turnPrompt: "Turn prompt (sent every turn)",
  reaskPrompt: "Re-ask prompt (after a failed pre-check)",
};

export function HarnessEditor({ initial, readOnly, isNew, previewGame, onClose, onSaved, onDeleted }: Props) {
  const [draft, setDraft] = useState<HarnessConfig>(initial);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [lastField, setLastField] = useState<Field>("turnPrompt");
  const [tab, setTab] = useState<"vars" | "preview">("vars");
  const refs = { systemPrompt: useRef<HTMLTextAreaElement>(null), turnPrompt: useRef<HTMLTextAreaElement>(null), reaskPrompt: useRef<HTMLTextAreaElement>(null) };
  const fileRef = useRef<HTMLInputElement>(null);

  const used = useMemo(
    () => new Set([draft.systemPrompt, draft.turnPrompt, draft.reaskPrompt].flatMap(templateVariables)),
    [draft.systemPrompt, draft.turnPrompt, draft.reaskPrompt],
  );
  const unknown = [...used].filter((v) => !ALL_VARIABLE_NAMES.has(v));
  const preview = useMemo(() => renderPrompts(draft, previewGame), [draft, previewGame]);
  const reaskPreview = useMemo(
    () => (draft.precheck ? renderReask(draft, previewGame, "Ke3 is not legal in this position.") : ""),
    [draft, previewGame],
  );
  const chars = preview.system.length + preview.user.length;

  const set = <K extends keyof HarnessConfig>(k: K, v: HarnessConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const flash = (kind: "ok" | "error", text: string) => setMessage({ kind, text });

  const insert = (name: string) => {
    if (readOnly) return;
    const el = refs[lastField].current;
    const token = `{{${name}}}`;
    const value = draft[lastField];
    const startPos = el?.selectionStart ?? value.length;
    const endPos = el?.selectionEnd ?? value.length;
    set(lastField, value.slice(0, startPos) + token + value.slice(endPos));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(startPos + token.length, startPos + token.length);
    });
  };

  const trySave = (fn: () => ReturnType<typeof harnessStore.save>) => {
    try {
      const v = fn();
      if (!v.ok) return flash("error", v.error);
      onSaved(v.config);
      flash("ok", `Saved "${v.config.name}".`);
    } catch {
      flash("error", "Couldn't save: your browser's storage may be full.");
    }
  };

  const save = () => trySave(() => harnessStore.save(draft));
  const isCommunity = readOnly && COMMUNITY.some((h) => h.id === initial.id);
  const saveCopy = () =>
    trySave(() => {
      if (!readOnly) return harnessStore.addCopy(draft, `${draft.name} (copy)`);
      const basedOn = isCommunity
        ? `Based on the community harness "${draft.name}"${draft.author ? ` by ${draft.author}` : ""}.`
        : `Based on the "${draft.name}" preset.`;
      // The copy is the user's own: it starts without the original author.
      return harnessStore.addCopy({ ...draft, author: undefined, description: basedOn }, `Copy of ${draft.name}`);
    });

  const remove = () => {
    if (!confirm(`Delete "${draft.name}"? This can't be undone.`)) return;
    harnessStore.remove(draft.id);
    onDeleted(draft.id);
  };

  const downloadFile = (name: string, text: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportJson = () =>
    downloadFile(`${draft.name.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") || "harness"}.harness.json`, exportHarnessJson(draft));

  const submit = () => {
    if (unknown.length) return flash("error", `Fix the unknown variables first: ${unknown.map((u) => `{{${u}}}`).join(", ")}.`);
    const sub = prepareSubmission(draft);
    if (!sub.ok) return flash("error", sub.error);
    const intro = sub.byUpload
      ? `This harness is too long to fill in through a link, so ${sub.id}.json will be downloaded and GitHub's upload page will open. Drag the file onto that page.`
      : `This opens GitHub with your harness filled in as ${sub.path}.`;
    const ok = confirm(
      `${intro}\n\nYou need a GitHub account. GitHub copies (forks) the project for you and opens a pull request; once it's reviewed and merged, your harness appears under "Community" for everyone.\n\nSubmitted harnesses are public. Continue?`,
    );
    if (!ok) return;
    if (sub.byUpload) downloadFile(`${sub.id}.json`, sub.json);
    window.open(sub.url, "_blank", "noopener");
    flash(
      "ok",
      sub.byUpload
        ? `Downloaded ${sub.id}.json. On GitHub, drop it on the page, then "Propose changes" and "Create pull request".`
        : `On GitHub, click "Commit changes…", then "Propose changes" and "Create pull request".`,
    );
  };

  const importJson = async (file: File) => {
    const v = parseHarnessJson(await file.text());
    if (!v.ok) return flash("error", v.error);
    trySave(() => harnessStore.addCopy(v.config));
  };

  const copyLink = async () => {
    const v = validateHarness(draft);
    if (!v.ok) return flash("error", v.error);
    await navigator.clipboard.writeText(shareUrl(v.config));
    flash("ok", "Share link copied. Anyone who opens it can add this harness.");
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal editor" role="dialog" aria-modal="true" aria-label="Harness editor">
        <header className="editor-head">
          <h2>{isCommunity ? "Community harness (read-only)" : readOnly ? "Preset (read-only)" : isNew ? "New harness" : "Edit harness"}</h2>
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="editor-body">
          <section className="editor-form">
            <label htmlFor="h-name">Name</label>
            <input id="h-name" value={draft.name} readOnly={readOnly} onChange={(e) => set("name", e.target.value)} />
            <label htmlFor="h-desc">Description (optional)</label>
            <input id="h-desc" value={draft.description ?? ""} readOnly={readOnly} onChange={(e) => set("description", e.target.value)} />
            {(!readOnly || draft.author) && (
              <>
                <label htmlFor="h-author">Author (optional; needed to submit)</label>
                <input
                  id="h-author"
                  value={draft.author ?? ""}
                  readOnly={readOnly}
                  placeholder="Your name or GitHub handle"
                  onChange={(e) => set("author", e.target.value)}
                />
              </>
            )}

            {(Object.keys(FIELD_LABEL) as Field[]).map((f) => (
              <div key={f} className="field">
                <label htmlFor={`h-${f}`}>{FIELD_LABEL[f]}</label>
                <textarea
                  id={`h-${f}`}
                  ref={refs[f]}
                  value={draft[f]}
                  readOnly={readOnly}
                  spellCheck={false}
                  rows={f === "turnPrompt" ? 10 : f === "systemPrompt" ? 7 : 3}
                  className={lastField === f && !readOnly ? "focused" : ""}
                  onFocus={() => setLastField(f)}
                  onChange={(e) => set(f, e.target.value)}
                />
              </div>
            ))}

            <fieldset className="settings" disabled={readOnly}>
              <label className="check">
                <input type="checkbox" checked={draft.precheck} onChange={(e) => set("precheck", e.target.checked)} />
                Pre-check moves before submitting
              </label>
              <p className="hint">
                The harness checks the model's move against the rules and re-asks before the referee sees it. The referee still
                checks every submitted move.
              </p>
              {draft.precheck && (
                <div className="row">
                  <label htmlFor="h-reasks">Re-asks</label>
                  <select id="h-reasks" value={draft.maxReasks} onChange={(e) => set("maxReasks", Number(e.target.value))}>
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="h-fallback">Then</label>
                  <select id="h-fallback" value={draft.fallback} onChange={(e) => set("fallback", e.target.value as HarnessConfig["fallback"])}>
                    <option value="random">play a random legal move (logged)</option>
                    <option value="submit">submit the last answer to the referee</option>
                  </select>
                </div>
              )}
            </fieldset>
          </section>

          <section className="editor-side">
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "vars"} className={tab === "vars" ? "active" : ""} onClick={() => setTab("vars")}>
                Variables
              </button>
              <button type="button" role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>
                Preview <span className="hint">≈ {Math.round(chars / 4).toLocaleString()} tokens</span>
                {unknown.length > 0 && <em className="tag">{unknown.length} unknown</em>}
              </button>
            </div>

            {tab === "vars" ? (
              <>
                <p className="hint">
                  {readOnly ? "Variables a harness can use." : `Click to insert into the ${FIELD_LABEL[lastField].split(" (")[0].toLowerCase()}.`}{" "}
                  Context blocks are computed from the rules before each call; the model never calls them.
                </p>
                <VariableList title="Game" items={BASE_VARIABLES} used={used} onInsert={insert} disabled={readOnly} />
                <VariableList title="Context blocks" items={CONTEXT_BLOCKS} used={used} onInsert={insert} disabled={readOnly} />
              </>
            ) : (
              <>
                <p className="hint">
                  Exactly what the model receives in the current position ({previewGame.myColor === "w" ? "White" : "Black"} to move).
                </p>
                {unknown.length > 0 && (
                  <p className="hint warn">Unknown variables (sent as-is): {unknown.map((u) => `{{${u}}}`).join(", ")}</p>
                )}
                {preview.system && (
                  <>
                    <div className="preview-label">system</div>
                    <Highlighted text={preview.system} />
                  </>
                )}
                <div className="preview-label">user</div>
                <Highlighted text={preview.user} />
                {reaskPreview && (
                  <>
                    <div className="preview-label">re-ask (example)</div>
                    <Highlighted text={reaskPreview} />
                  </>
                )}
              </>
            )}
          </section>
        </div>

        <footer className="editor-foot">
          {message && <span className={`flash ${message.kind}`}>{message.text}</span>}
          <span className="spacer" />
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <button type="button" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <button type="button" onClick={exportJson}>
            Export JSON
          </button>
          <button type="button" onClick={copyLink}>
            Copy share link
          </button>
          {!readOnly && (
            <button type="button" onClick={submit} title="Propose this harness for the Community list, as a pull request on GitHub">
              Submit to community…
            </button>
          )}
          {!readOnly && !isNew && (
            <button type="button" className="danger" onClick={remove}>
              Delete
            </button>
          )}
          <button type="button" className={readOnly ? "primary" : ""} onClick={saveCopy}>
            {readOnly ? "Duplicate to edit" : "Save as copy"}
          </button>
          {!readOnly && (
            <button type="button" className="primary" onClick={save}>
              Save
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function VariableList({ title, items, used, onInsert, disabled }: { title: string; items: VariableInfo[]; used: Set<string>; onInsert: (n: string) => void; disabled: boolean }) {
  return (
    <div className="vars">
      <div className="vars-title">{title}</div>
      {items.map((v) => (
        <button
          key={v.name}
          type="button"
          className={`var ${used.has(v.name) ? "used" : ""}`}
          title={v.description}
          disabled={disabled}
          onClick={() => onInsert(v.name)}
        >
          <code>{`{{${v.name}}}`}</code>
          <span className="var-label">
            {v.label}
            {v.fairness === "borderline" && <em className="tag">borderline</em>}
          </span>
          <span className="var-desc">{v.description}</span>
        </button>
      ))}
    </div>
  );
}

/** Shows rendered prompt text, highlighting any {{unknown}} variables left in it. */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*[a-z_][a-z0-9_]*\s*\}\})/g);
  return (
    <pre className="preview">
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : p))}
    </pre>
  );
}
