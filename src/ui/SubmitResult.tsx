import { useMemo, useState } from "react";
import { buildResultFile, resultFileName, RESULTS_DIR, type ResultSide } from "../game/resultFile";
import type { SavedGame } from "../game/savedGame";
import { COMMUNITY, PRESETS } from "../harness/presets";
import { githubNewFile } from "../harness/submit";

const NAME_KEY = "arena.submitterName";

interface Props {
  game: SavedGame;
  pgn: string;
  onClose: () => void;
  /** Saves a file to the user's downloads. */
  download: (name: string, text: string, type: string) => void;
}

const n = (v: number) => v.toLocaleString();

function SideSummary({ title, side }: { title: string; side: ResultSide }) {
  const s = side.stats;
  return (
    <div className="result-side">
      <strong>{title}</strong>: {side.player}
      {side.harness && (
        <div className="hint">
          Harness: {side.harness.name} ({side.harness.source}
          {side.harness.config && side.harness.source !== "custom" ? ", changed since: full config included" : ""}
          {side.harness.source === "custom" ? ": full config included" : ""})
        </div>
      )}
      {side.engine && (
        <div className="hint">
          Engine: {side.engine.name}, {side.engine.elo ? `limited to Elo ${side.engine.elo}` : "full strength"}
        </div>
      )}
      {s && (
        <div className="hint">
          {n(s.requests)} requests · {n(s.promptTokens)} prompt + {n(s.completionTokens)} reply tokens
          {s.costUsd !== undefined && ` · $${s.costUsd.toFixed(4)}`} · {s.reasks} re-asks · {s.refereeRejections} rejected · {s.randomMoves} random
          moves{!!s.analysisRounds && ` · ${s.analysisRounds} analysis rounds`}
          {s.emptyReplies > 0 && ` · ${s.emptyReplies} empty replies`}
        </div>
      )}
    </div>
  );
}

/** "Submit result": turns a finished game into results/<file>.json and opens a pull request on GitHub. */
export function SubmitResult({ game, pgn, onClose, download }: Props) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [comment, setComment] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const built = useMemo(
    () => buildResultFile(game, { pgn, arenaVersion: __ARENA_VERSION__, submittedBy: name, comment, presets: PRESETS, community: COMMUNITY }),
    [game, pgn, name, comment],
  );

  const submit = () => {
    if (!built.ok) return;
    localStorage.setItem(NAME_KEY, name.trim());
    const fileName = resultFileName(built.file);
    const json = JSON.stringify(built.file, null, 2) + "\n";
    const gh = githubNewFile(RESULTS_DIR, fileName, json);
    if (gh.byUpload) download(fileName, json, "application/json");
    window.open(gh.url, "_blank", "noopener");
    setDone(
      gh.byUpload
        ? `Downloaded ${fileName}. On GitHub, drop it on the upload page, then "Propose changes" and "Create pull request".`
        : `On GitHub, click "Commit changes…", then "Propose changes" and "Create pull request".`,
    );
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal submit-result" role="dialog" aria-modal="true" aria-label="Submit result">
        <header className="editor-head">
          <h2>Submit this game to the arena</h2>
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="submit-body">
          {!built.ok ? (
            <p className="hint warn">{built.error}</p>
          ) : (
            <>
              <p>
                <strong>{built.file.result}</strong> · {built.file.reason} · {Math.ceil(built.file.plies / 2)} moves
                {built.file.termination === "adjudicated" && <em className="tag">adjudicated</em>}
              </p>
              <SideSummary title="White" side={built.file.white} />
              <SideSummary title="Black" side={built.file.black} />

              <label htmlFor="submit-name">Your name or GitHub handle (optional)</label>
              <input id="submit-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              <label htmlFor="submit-comment">Comment (optional)</label>
              <textarea
                id="submit-comment"
                rows={3}
                maxLength={1000}
                value={comment}
                placeholder="Anything worth knowing: what you were testing, a memorable move, a problem you saw…"
                onChange={(e) => setComment(e.target.value)}
              />
              <details>
                <summary>
                  The file: {RESULTS_DIR}/{resultFileName(built.file)}
                </summary>
                <pre className="preview">{JSON.stringify(built.file, null, 2)}</pre>
              </details>
              <p className="hint">
                This opens GitHub with the file filled in; you need a GitHub account. GitHub copies (forks) the project for you and opens a
                pull request. Submitted results are public and self-reported. Your OpenRouter key is never included, and neither are the
                prompts or reasoning (too large). To share those, attach the transcript (.md) to the pull request.
              </p>
            </>
          )}
          {done && <p className="flash ok">{done}</p>}
        </div>
        <footer className="editor-foot">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </button>
          <button type="button" className="primary" disabled={!built.ok} onClick={submit}>
            Open pull request on GitHub…
          </button>
        </footer>
      </div>
    </div>
  );
}
