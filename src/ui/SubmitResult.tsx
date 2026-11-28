import { useEffect, useMemo, useRef, useState } from "react";
import { browserEngine, ENGINE_NAME } from "../agents/engine";
import { buildResultFile, resultCommitMessage, resultFileName, RESULTS_DIR, type ResultFile, type ResultSide } from "../game/resultFile";
import { evaluatePositions, REVIEW_DEPTH, reviewMoves, type GameReview } from "../game/review";
import type { SavedGame } from "../game/savedGame";
import { buildTranscript } from "../game/transcript";
import { COMMUNITY, PRESETS } from "../harness/presets";
import { githubNewFile, REPO } from "../harness/submit";
import { copyText } from "./clipboard";

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
          {!!s.stoppedReplies && ` · ${s.stoppedReplies} stopped (looping or too long)`}
        </div>
      )}
    </div>
  );
}

type ReviewState =
  | { status: "running"; done: number; total: number }
  | { status: "done"; review: GameReview }
  | { status: "skipped" }
  | { status: "failed"; error: string };

const moveLabel = (ply: number, san: string) => `${Math.ceil(ply / 2)}${ply % 2 ? "." : "..."} ${san}`;
const mb = (chars: number) => (chars / 1024 / 1024 < 0.1 ? `${Math.max(1, Math.round(chars / 1024))} KB` : `${(chars / 1024 / 1024).toFixed(1)} MB`);

/** Accuracy and error counts per side, then the moves that lost the most. */
function ReviewSummary({ file }: { file: ResultFile }) {
  const r = file.review;
  if (!r) return null;
  const worst = (file.moves ?? []).filter((m) => m.class === "blunder" || m.class === "mistake");
  return (
    <div className="review-summary">
      <table>
        <thead>
          <tr>
            <th />
            <th>Accuracy</th>
            <th>Avg loss</th>
            <th>Inaccuracies</th>
            <th>Mistakes</th>
            <th>Blunders</th>
          </tr>
        </thead>
        <tbody>
          {(["white", "black"] as const).map((k) => (
            <tr key={k}>
              <th>{k === "white" ? "White" : "Black"}</th>
              <td>{r[k].accuracy}%</td>
              <td>{r[k].avgLoss} cp</td>
              <td>{r[k].inaccuracies}</td>
              <td>{r[k].mistakes}</td>
              <td>{r[k].blunders}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {worst.length > 0 && (
        <p className="hint">
          {worst.map((m, i) => (
            <span key={m.ply}>
              {i > 0 && " · "}
              <strong className={m.class}>{moveLabel(m.ply, m.san)}</strong>
              {m.best && ` (best ${m.best})`}
            </span>
          ))}
        </p>
      )}
      <p className="hint">
        {r.engine}, depth {r.depth}. Each move is judged by how much it lowered the mover's winning chances (as on Lichess): 5+ points an
        inaccuracy, 10+ a mistake, 15+ a blunder.
      </p>
    </div>
  );
}

/** One part of the commit message, with a button that copies it. */
function CopyField({ label, text, rows }: { label: string; text: string; rows: number }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    const ok = await copyText(text);
    setCopied(ok);
    if (!ok) area.current?.select(); // so Ctrl+C works
  };
  return (
    <div className="copy-field">
      <div className="copy-head">
        <span>{label}</span>
        <button type="button" onClick={copy}>
          {copied ? "Copied" : copied === false ? "Press Ctrl+C" : "Copy"}
        </button>
      </div>
      <textarea ref={area} readOnly rows={rows} value={text} onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}

/** "Submit result": reviews a finished game with Stockfish, turns it into results/<file>.json (plus, optionally, its transcript) and opens a pull request on GitHub. */
export function SubmitResult({ game, pgn, onClose, download }: Props) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [comment, setComment] = useState("");
  const [done, setDone] = useState<string | null>(null);
  /** Set when the files go through GitHub's upload page, whose commit message can't be filled in by a link. */
  const [message, setMessage] = useState<{ title: string; description: string } | null>(null);
  const [withTranscript, setWithTranscript] = useState(true);
  const [review, setReview] = useState<ReviewState>({ status: "running", done: 0, total: game.history.length + 1 });

  useEffect(() => {
    const abort = new AbortController();
    // A skipped review stays skipped; the engine finishes in the background and is ignored.
    const update = (next: ReviewState) => !abort.signal.aborted && setReview((r) => (r.status === "skipped" ? r : next));
    evaluatePositions(game.history, browserEngine(), {
      signal: abort.signal,
      onProgress: (done, total) => update({ status: "running", done, total }),
    })
      .then((evals) => update({ status: "done", review: reviewMoves(game.history, evals, ENGINE_NAME, REVIEW_DEPTH) }))
      .catch((e) => update({ status: "failed", error: e instanceof Error ? e.message : String(e) }));
    return () => abort.abort();
  }, [game]);

  const built = useMemo(
    () =>
      buildResultFile(game, {
        pgn,
        arenaVersion: __ARENA_VERSION__,
        submittedBy: name,
        comment,
        presets: PRESETS,
        community: COMMUNITY,
        review: review.status === "done" ? review.review : undefined,
      }),
    [game, pgn, name, comment, review],
  );
  const transcript = useMemo(() => buildTranscript(game, pgn), [game, pgn]);
  const reviewing = review.status === "running";

  const submit = () => {
    if (!built.ok) return;
    localStorage.setItem(NAME_KEY, name.trim());
    const fileName = resultFileName(built.file);
    const json = JSON.stringify(built.file, null, 2) + "\n";
    const gh = githubNewFile(RESULTS_DIR, fileName, json);
    if (gh.byUpload || withTranscript) {
      // Copy while this page still has focus: opening GitHub takes it away.
      const msg = resultCommitMessage(built.file);
      setMessage(msg);
      void copyText(msg.title);
      download(fileName, json, "application/json");
      if (withTranscript) download(fileName.replace(/\.json$/, ".md"), transcript, "text/markdown");
      window.open(`https://github.com/${REPO}/upload/main/${RESULTS_DIR}`, "_blank", "noopener");
      setDone(
        `Downloaded ${withTranscript ? `${fileName} and its transcript (.md)` : fileName}. On GitHub, drop ${withTranscript ? "both files" : "it"} on the upload page. Under "Commit changes", paste the title (already copied) and the description below, then "Propose changes" and "Create pull request". (Your browser may ask to allow downloading two files. If it added " (1)" to the names because older copies exist, remove that before uploading: results need the exact names.)`,
      );
      return;
    }
    window.open(gh.url, "_blank", "noopener");
    setDone(`On GitHub, click "Commit changes…", then "Propose changes" and "Create pull request".`);
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

              <h3>Stockfish review</h3>
              {review.status === "running" && (
                <p className="hint">
                  Reviewing every position with {ENGINE_NAME}… {review.done}/{review.total}{" "}
                  <button type="button" className="link" onClick={() => setReview({ status: "skipped" })}>
                    Skip
                  </button>
                </p>
              )}
              {review.status === "skipped" && <p className="hint">Skipped: the file won't have engine evaluations.</p>}
              {review.status === "failed" && <p className="hint warn">The review failed ({review.error}); the file won't have engine evaluations.</p>}
              <ReviewSummary file={built.file} />

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
              <label className="check">
                <input type="checkbox" checked={withTranscript} onChange={(e) => setWithTranscript(e.target.checked)} />
                Also add the full transcript ({mb(transcript.length)}): every prompt, reasoning text and reply, as Markdown
              </label>
              <details>
                <summary>
                  The file: {RESULTS_DIR}/{resultFileName(built.file)}
                </summary>
                <pre className="preview">{JSON.stringify(built.file, null, 2)}</pre>
              </details>
              <p className="hint">
                This opens GitHub; you need a GitHub account. GitHub copies (forks) the project for you and opens a pull request. Submitted
                results are public and self-reported. Your OpenRouter key is never included. The result file has every move's cost, reply and
                notes; prompts and reasoning are only in the transcript.
              </p>
            </>
          )}
          {!window.isSecureContext && (
            <p className="hint warn">
              This page is open over plain http at a network address, so your browser may hold the downloads as "Unconfirmed" until you
              click Keep in its download list, and copying may need Ctrl+C. Open it at localhost or on the live site to avoid that.
            </p>
          )}
          {done && <p className="flash ok">{done}</p>}
          {message && (
            <div className="commit-message">
              <CopyField label="Commit title" text={message.title} rows={2} />
              <CopyField label="Extended description" text={message.description} rows={Math.min(10, message.description.split("\n").length + 1)} />
            </div>
          )}
        </div>
        <footer className="editor-foot">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </button>
          <button type="button" className="primary" disabled={!built.ok || reviewing} title={reviewing ? "Waiting for the review (or skip it)" : ""} onClick={submit}>
            Open pull request on GitHub…
          </button>
        </footer>
      </div>
    </div>
  );
}
