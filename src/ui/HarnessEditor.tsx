import { useMemo, useRef, useState } from "react";
import type { HarnessConfig } from "../harness/config";
import { validateHarness } from "../harness/config";
import { ALL_VARIABLE_NAMES, BASE_VARIABLES, CONTEXT_BLOCKS, type VariableContext, type VariableInfo } from "../harness/contextBlocks";
import { renderPrompts, renderReask } from "../harness/runner";
import { COMMUNITY } from "../harness/presets";
import { exportHarnessJson, harnessStore, parseHarnessJson, shareUrl } from "../harness/store";
import { prepareSubmission } from "../harness/submit";
import { DEFAULT_NOTES_MAX_CHARS, NOTES_MAX_CHAR_CHOICES, NOTES_SYSTEM_INSTRUCTIONS, NOTES_TURN_LINE } from "../harness/notes";
import { templateVariables } from "../harness/template";
import { buildTurnPrompt, builderFromTemplate, defaultItem, normalizeItems, type BuilderSpec } from "../harness/builder";
import { STYLES, matchStyle, styleText } from "../harness/styles";
import { HarnessBuilder } from "./HarnessBuilder";
import { ANALYSIS_ROUND_CHOICES, ANALYSIS_SYSTEM_INSTRUCTIONS } from "../harness/analysis";
import { copyText } from "./clipboard";

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

const addAnalysisText = (system: string) => `${system.trimEnd()}${system.trim() ? "\n\n" : ""}${ANALYSIS_SYSTEM_INSTRUCTIONS}`;

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

  // Builder mode: the turn prompt is generated from a checklist (see harness/builder.ts).
  const builder = draft.builder;
  const setBuilder = (spec: BuilderSpec) => setDraft((d) => ({ ...d, builder: spec, turnPrompt: buildTurnPrompt(spec) }));
  const toText = () =>
    setDraft((d) => {
      const { builder: _b, ...rest } = d;
      return rest;
    });
  const toBuilder = () => {
    const spec = builderFromTemplate(templateVariables(draft.turnPrompt));
    if (draft.keepNotes && !spec.items.some((i) => i.name === "my_notes")) spec.items = normalizeItems([...spec.items, defaultItem("my_notes")]);
    const changes = buildTurnPrompt(spec) !== draft.turnPrompt;
    if (changes && !confirm("The builder keeps the blocks this turn prompt uses, but replaces its wording and order with standard headings (which you can edit). Continue?")) return;
    setBuilder(spec);
  };
  const toggleNotes = (on: boolean) =>
    setDraft((d) => {
      const next: HarnessConfig = { ...d, keepNotes: on };
      if (!d.builder) return next;
      // In builder mode notes are all or nothing: the {{my_notes}} item and the instructions follow the checkbox.
      const items = on ? normalizeItems([...d.builder.items, defaultItem("my_notes")]) : d.builder.items.filter((i) => i.name !== "my_notes");
      const style = matchStyle(d.systemPrompt);
      const systemPrompt = style
        ? styleText(style, on, d.systemPrompt.includes(ANALYSIS_SYSTEM_INSTRUCTIONS))
        : on
          ? /notes\s*:/i.test(d.systemPrompt)
            ? d.systemPrompt
            : `${d.systemPrompt.trimEnd()}${d.systemPrompt.trim() ? "\n\n" : ""}${NOTES_SYSTEM_INSTRUCTIONS}`
          : d.systemPrompt.replace(NOTES_SYSTEM_INSTRUCTIONS, "").trimEnd();
      return { ...next, systemPrompt, builder: { items }, turnPrompt: buildTurnPrompt({ items }) };
    });
  const currentStyle = matchStyle(draft.systemPrompt);
  const pickStyle = (id: string) => {
    const style = STYLES.find((s) => s.id === id);
    if (!style) return;
    if (draft.systemPrompt.trim() && !currentStyle && !confirm(`Replace your system prompt with the "${style.label}" style?`)) return;
    set("systemPrompt", styleText(style, !!draft.keepNotes, draft.systemPrompt.includes(ANALYSIS_SYSTEM_INSTRUCTIONS)));
  };

  // Analysis board: turning it on adds the ANALYZE instructions to the system prompt; turning it off removes them.
  const asksForAnalysis = /analy[sz]e\s*:/i.test(draft.systemPrompt + draft.turnPrompt);
  const setAnalysis = (rounds: number) =>
    setDraft((d) => {
      const { analysisRounds: _a, ...rest } = d;
      if (!rounds) return { ...rest, systemPrompt: d.systemPrompt.replace(`\n\n${ANALYSIS_SYSTEM_INSTRUCTIONS}`, "").replace(ANALYSIS_SYSTEM_INSTRUCTIONS, "").trimEnd() };
      const has = /analy[sz]e\s*:/i.test(d.systemPrompt + d.turnPrompt);
      return { ...rest, analysisRounds: rounds, systemPrompt: has ? d.systemPrompt : addAnalysisText(d.systemPrompt) };
    });

  // Notes only work if the prompts ask for a NOTES block and pass {{my_notes}} back.
  const asksForNotes = /notes\s*:/i.test(draft.systemPrompt + draft.turnPrompt);
  const notesProblem = !draft.keepNotes
    ? null
    : !used.has("my_notes")
      ? "No prompt uses {{my_notes}}, so the model never gets its notes back."
      : !asksForNotes
        ? 'No prompt asks the model to write a "NOTES:" block.'
        : null;
  const addNotesInstructions = () =>
    setDraft((d) => ({
      ...d,
      keepNotes: true,
      systemPrompt: /notes\s*:/i.test(d.systemPrompt) ? d.systemPrompt : `${d.systemPrompt.trimEnd()}${d.systemPrompt.trim() ? "\n\n" : ""}${NOTES_SYSTEM_INSTRUCTIONS}`,
      turnPrompt: d.turnPrompt.includes("{{my_notes}}") ? d.turnPrompt : `${d.turnPrompt.trimEnd()}\n\n${NOTES_TURN_LINE}`,
    }));
  const flash = (kind: "ok" | "error", text: string) => setMessage({ kind, text });

  // In builder mode the turn prompt isn't a text box, so variables go into the system prompt.
  const target: Field = builder && lastField === "turnPrompt" ? "systemPrompt" : lastField;
  const insert = (name: string) => {
    if (readOnly) return;
    const el = refs[target].current;
    const token = `{{${name}}}`;
    const value = draft[target];
    const startPos = el?.selectionStart ?? value.length;
    const endPos = el?.selectionEnd ?? value.length;
    set(target, value.slice(0, startPos) + token + value.slice(endPos));
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
    setTimeout(() => URL.revokeObjectURL(a.href), 5 * 60_000); // after any save dialog
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
    const url = shareUrl(v.config);
    if (!(await copyText(url))) return void window.prompt("Copy the share link (Ctrl+C):", url);
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
                <div className="field-head">
                  <label htmlFor={`h-${f}`}>{f === "turnPrompt" && builder ? "What the model sees each turn" : FIELD_LABEL[f]}</label>
                  {f === "systemPrompt" && (
                    <select
                      aria-label="Start from a style"
                      value={currentStyle?.id ?? ""}
                      disabled={readOnly}
                      onChange={(e) => pickStyle(e.target.value)}
                      title={currentStyle?.description ?? "Pick a style to start from; you can edit the text afterwards."}
                    >
                      <option value="" disabled>
                        {draft.systemPrompt.trim() ? "Style: custom" : "Start from a style…"}
                      </option>
                      {STYLES.map((st) => (
                        <option key={st.id} value={st.id} title={st.description}>
                          Style: {st.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {f === "turnPrompt" && !readOnly && (
                    <button type="button" className="link" onClick={builder ? toText : toBuilder}>
                      {builder ? "Edit as text" : "Use the builder"}
                    </button>
                  )}
                </div>
                {f === "turnPrompt" && builder ? (
                  <HarnessBuilder spec={builder} readOnly={readOnly} onChange={setBuilder} onToggleNotes={toggleNotes} />
                ) : (
                  <textarea
                    id={`h-${f}`}
                    ref={refs[f]}
                    value={draft[f]}
                    readOnly={readOnly}
                    spellCheck={false}
                    rows={f === "turnPrompt" ? 10 : f === "systemPrompt" ? 7 : 3}
                    className={target === f && !readOnly ? "focused" : ""}
                    onFocus={() => setLastField(f)}
                    onChange={(e) => set(f, e.target.value)}
                  />
                )}
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
              <label className="check">
                <input type="checkbox" checked={!!draft.keepNotes} onChange={(e) => toggleNotes(e.target.checked)} />
                Keep notes between moves
              </label>
              <p className="hint">
                The harness saves the "NOTES:" block from each reply and gives it back next move as {"{{my_notes}}"}. Each side only
                ever sees its own notes.
              </p>
              {draft.keepNotes && (
                <div className="row">
                  <label htmlFor="h-notes-max">Keep up to</label>
                  <select
                    id="h-notes-max"
                    value={draft.notesMaxChars ?? DEFAULT_NOTES_MAX_CHARS}
                    onChange={(e) => set("notesMaxChars", Number(e.target.value))}
                  >
                    {NOTES_MAX_CHAR_CHOICES.map((n) => (
                      <option key={n} value={n}>
                        {n.toLocaleString()} characters
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {draft.keepNotes && notesProblem && <p className="hint warn">{notesProblem}</p>}
              <div className="row">
                <label htmlFor="h-analysis">Analysis board</label>
                <select id="h-analysis" value={draft.analysisRounds ?? 0} onChange={(e) => setAnalysis(Number(e.target.value))}>
                  <option value={0}>off</option>
                  {ANALYSIS_ROUND_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      up to {n} round{n === 1 ? "" : "s"} per move
                    </option>
                  ))}
                </select>
              </div>
              <p className="hint">
                Before answering, the model can write "ANALYZE: Nxe5 Nxe5 d4" to play out lines; the harness replies with facts from the
                rules at the end of each line (captures, material, what's attacked, checks, mate). No evaluation: the model picks the lines and
                judges them. Each round is one more call.
              </p>
              {!!draft.analysisRounds && !asksForAnalysis && (
                <p className="hint warn">
                  No prompt explains ANALYZE lines, so the model won't know it can analyze.{" "}
                  {!readOnly && (
                    <button type="button" className="link" onClick={() => set("systemPrompt", addAnalysisText(draft.systemPrompt))}>
                      Add the instructions
                    </button>
                  )}
                </p>
              )}
              {!readOnly && (!used.has("my_notes") || !asksForNotes) && (
                <button type="button" onClick={builder ? () => toggleNotes(true) : addNotesInstructions}>
                  Add notes instructions to the prompts
                </button>
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
                  {readOnly ? "Variables a harness can use." : `Click to insert into the ${FIELD_LABEL[target].split(" (")[0].toLowerCase()}.`}{" "}
                  Context blocks are computed from the rules before each call; the model never calls them.{" "}
                  <span className="used-key">Highlighted</span> = used by this harness.
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
