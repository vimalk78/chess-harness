import { Chess } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentExists, customAgentId, getAgent, harnessConfigFor, isLibraryHarness } from "../agents/registry";
import type { HarnessConfig, Validation } from "../harness/config";
import { HARNESSED_PRESET } from "../harness/presets";
import { harnessStore, newHarnessId, readShareFromHash } from "../harness/store";
import { HarnessEditor } from "./HarnessEditor";
import { HarnessPicker } from "./HarnessPicker";
import { useHarnesses } from "./useHarnesses";
import { fetchPublicCount, GOATCOUNTER_CODE } from "../analytics";
import type { Color } from "../agents/types";
import { buildPgn } from "../game/pgn";
import { clearCurrentGame, loadCurrentGame } from "../game/gameStore";
import { historyFromPgn, isUnfinished, parseSavedGame, type SavedGame } from "../game/savedGame";
import { buildTranscript } from "../game/transcript";
import { AgentLog } from "./AgentLog";
import { Board } from "./Board";
import { KeyInput } from "./KeyInput";
import { MoveList } from "./MoveList";
import { SideConfig } from "./SideConfig";
import { FREE_MODEL_PREFERENCES, withFreeModels } from "./sides";
import { fetchFreeQuota, fetchModels, type FreeQuota, type ModelInfo } from "../llm/models";
import { sideLabel, useGame, type SideConfig as Side } from "./useGame";

const KEY_STORAGE = "arena.openrouterKey";
const SIDES_STORAGE = "arena.sides";
const FREE_ONLY_STORAGE = "arena.freeOnly";

const DEFAULT_SIDES: Record<Color, Side> = {
  // Free models, so the defaults work on a free OpenRouter account:
  // a small model with the harness vs a much larger model without it (see sides.ts).
  w: { agentId: "harnessed", model: FREE_MODEL_PREFERENCES.w[0], effort: "" },
  b: { agentId: "raw", model: FREE_MODEL_PREFERENCES.b[0], effort: "" },
};

/** Saves text as a file in the user's downloads. */
function download(filename: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const fileStamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

/** Harness behind an agent id, or null (Human, or a harness that no longer exists). */
function harnessOrNull(agentId: string): HarnessConfig | null {
  try {
    return harnessConfigFor(agentId);
  } catch {
    return null;
  }
}

const parseGame = (data: unknown) => parseSavedGame(data, harnessOrNull, sideLabel);

/** "Nov 26, 14:05: Harnessed · x vs Raw · y, move 39, Black to move" */
function describeGame(g: SavedGame): string {
  const when = new Date(g.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const toMove = g.history.length % 2 === 0 ? "White" : "Black";
  return `${g.labels.w} vs ${g.labels.b}, ${g.history.length} half-moves played, ${toMove} to move (saved ${when})`;
}

/** True for agents that call a model (everything except Human); safe for deleted harnesses. */
function usesModel(agentId: string): boolean {
  try {
    return getAgent(agentId).needsModel;
  } catch {
    return true;
  }
}

function loadSides(): Record<Color, Side> {
  try {
    const saved = JSON.parse(localStorage.getItem(SIDES_STORAGE) ?? "null");
    if (saved?.w && saved?.b) {
      getAgent(saved.w.agentId);
      getAgent(saved.b.agentId);
      // One-time update: White was saved with the old default (often rate-limited) Gemma model.
      if (saved.w.agentId === "harnessed" && saved.w.model === "google/gemma-4-26b-a4b-it:free") {
        saved.w = { ...saved.w, model: DEFAULT_SIDES.w.model };
      }
      return saved;
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_SIDES;
}

export default function App() {
  const [key, setKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? "");
  const [remember, setRemember] = useState(() => localStorage.getItem(KEY_STORAGE) !== null);
  const [sides, setSides] = useState(loadSides);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [freeOnly, setFreeOnly] = useState(() => localStorage.getItem(FREE_ONLY_STORAGE) !== "false");
  const freeOnlyAtLoad = useRef(freeOnly);
  const [quota, setQuota] = useState<FreeQuota | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  const keyRef = useRef(key);
  keyRef.current = key;
  const getKey = useCallback(() => keyRef.current, []);
  const { state, live, rateWait, start, load, adjudicate, pause, resume, reset, humanMove, exportGame } = useGame(getKey);
  // An unfinished game saved in this browser, offered for resuming after a reload.
  const [stored, setStored] = useState<SavedGame | null>(null);
  const [loadMessage, setLoadMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const gameFileRef = useRef<HTMLInputElement>(null);
  const harnesses = useHarnesses();
  const [editor, setEditor] = useState<{ color: Color; config: HarnessConfig; readOnly: boolean; isNew: boolean } | null>(null);
  const [shared, setShared] = useState<Validation | null>(() => readShareFromHash(location.hash));
  const [sharedAdded, setSharedAdded] = useState<string | null>(null);

  // A side whose saved harness was deleted falls back to the Harnessed preset.
  useEffect(() => {
    setSides((s) => {
      const fix = (side: Side): Side => (agentExists(side.agentId) ? side : { ...side, agentId: "harnessed" });
      const w = fix(s.w);
      const b = fix(s.b);
      return w === s.w && b === s.b ? s : { w, b };
    });
  }, [harnesses]);

  const clearShareHash = () => history.replaceState(null, "", location.pathname + location.search);
  const addShared = () => {
    if (!shared?.ok) return;
    try {
      const v = harnessStore.addCopy(shared.config);
      setSharedAdded(v.ok ? v.config.name : null);
    } catch {
      setSharedAdded(null);
    }
    setShared(null);
    clearShareHash();
  };

  const [picker, setPicker] = useState<Color | null>(null);

  const openHarness = (color: Color, action: "view" | "edit" | "new" | "browse") => {
    if (action === "browse") return setPicker(color);
    if (action === "new") {
      const config: HarnessConfig = { ...HARNESSED_PRESET, id: newHarnessId(), name: "My harness", description: "" };
      return setEditor({ color, config, readOnly: false, isNew: true });
    }
    const config = harnessConfigFor(sides[color].agentId);
    if (config) setEditor({ color, config, readOnly: action === "view", isNew: false });
  };

  // The editor previews prompts in the current position (start position before a game).
  const previewGame = useMemo(() => {
    const chess = new Chess();
    for (const san of state.history) chess.move(san);
    return { history: state.history, fen: chess.fen(), legalMoves: chess.moves(), myColor: chess.turn(), previousAttempts: [] };
  }, [state.history]);

  useEffect(() => {
    if (remember) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  }, [key, remember]);

  useEffect(() => {
    loadCurrentGame().then((g) => {
      const parsed = g && parseGame(g);
      if (parsed?.ok && isUnfinished(parsed.game) && parsed.game.history.length > 0) setStored(parsed.game);
    });
  }, []);

  /** Opens a saved game; returns an error message if it can't be played here. */
  const openGame = (game: SavedGame): string | null => {
    try {
      load(game);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return /Unknown agent/.test(msg)
        ? `${msg}. The game used a harness that isn't in this browser and the log doesn't include it.`
        : msg;
    }
    setStored(null);
    return null;
  };

  const loadGameFile = async (file: File) => {
    setLoadMessage(null);
    const text = await file.text();
    let game: SavedGame;
    if (/^\s*[{[]/.test(text)) {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return setLoadMessage({ ok: false, text: `${file.name} isn't valid JSON.` });
      }
      const parsed = parseGame(data);
      if (!parsed.ok) return setLoadMessage({ ok: false, text: `Couldn't load ${file.name}: ${parsed.error}.` });
      game = parsed.game;
    } else {
      // A PGN has only the moves: continue it with the agents currently picked above.
      const pgnMoves = historyFromPgn(text);
      if (!pgnMoves.ok) return setLoadMessage({ ok: false, text: `Couldn't load ${file.name}: ${pgnMoves.error}.` });
      const harnesses = { w: harnessOrNull(sides.w.agentId), b: harnessOrNull(sides.b.agentId) };
      const now = Date.now();
      game = {
        version: 1,
        startedAt: now,
        savedAt: now,
        sides,
        labels: { w: sideLabel(sides.w, harnesses.w), b: sideLabel(sides.b, harnesses.b) },
        harnesses,
        history: pgnMoves.history,
        result: null,
        reason: null,
        events: [],
      };
    }
    const error = openGame(game);
    if (error) return setLoadMessage({ ok: false, text: `Couldn't load ${file.name}: ${error}` });
    setLoadMessage({
      ok: true,
      text: isUnfinished(game)
        ? `Loaded ${file.name}. Press Resume to continue the game.`
        : `Loaded ${file.name}. This game is finished; you can replay it on the board below or download its transcript.`,
    });
  };

  useEffect(() => localStorage.setItem(SIDES_STORAGE, JSON.stringify(sides)), [sides]);
  useEffect(() => localStorage.setItem(FREE_ONLY_STORAGE, String(freeOnly)), [freeOnly]);

  useEffect(() => {
    fetchModels()
      .then((list) => {
        setModels(list);
        // Settings saved from an earlier visit may name paid models; swap those for free ones.
        if (freeOnlyAtLoad.current) setSides((s) => withFreeModels(s, list));
      })
      .catch((e: Error) => setModelsError(e.message));
  }, []);

  // Free-model quota: check when the key changes and whenever a game pauses or ends.
  useEffect(() => {
    const k = key.trim();
    if (!k) {
      setQuota(null);
      setQuotaError(null);
      return;
    }
    const id = setTimeout(() => {
      fetchFreeQuota(k)
        .then((q) => {
          setQuota(q);
          setQuotaError(null);
        })
        .catch((e: Error) => {
          setQuota(null);
          setQuotaError(e.message);
        });
    }, 600);
    return () => clearTimeout(id);
  }, [key, state.status]);

  useEffect(() => {
    if (!state.thinking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [state.thinking]);

  const playing = state.status === "running" || state.status === "paused";
  const active = state.sides ?? sides;
  const llm = { w: usesModel(sides.w.agentId), b: usesModel(sides.b.agentId) };
  const needsKey = llm.w || llm.b;

  const startProblem =
    !llm.w && !llm.b
      ? "Pick at least one LLM agent"
      : needsKey && !key.trim()
        ? "Enter your OpenRouter key"
        : (llm.w && !sides.w.model.trim()) || (llm.b && !sides.b.model.trim())
          ? "Enter a model ID"
          : null;

  // A paused game (e.g. one just reopened) needs a key if either side calls a model.
  const gameNeedsKey = !!(state.harnesses?.w || state.harnesses?.b);
  const resumeProblem = gameNeedsKey && !key.trim() ? "Enter your OpenRouter key above to resume" : null;

  const label = (c: Color) => state.labels?.[c] ?? sideLabel(active[c]);
  const humanColors = (["w", "b"] as Color[]).filter((c) => !usesModel(active[c].agentId));
  const orientation = humanColors.length === 1 && humanColors[0] === "b" ? "black" : "white";

  const pgn = () =>
    buildPgn(state.history, {
      white: label("w"),
      black: label("b"),
      result: state.result ?? "*",
      termination: state.reason ?? undefined,
    });

  const copyPgn = async () => {
    await navigator.clipboard.writeText(pgn());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadLog = () => {
    const game = exportGame();
    if (game) download(`chess-agent-arena-${fileStamp()}.json`, JSON.stringify({ pgn: pgn(), ...game }, null, 2), "application/json");
  };

  const downloadTranscript = () => {
    const game = exportGame();
    if (game) download(`chess-agent-arena-${fileStamp()}.md`, buildTranscript(game, pgn()), "text/markdown");
  };

  const newGame = () => {
    const unfinished = (state.status === "running" || state.status === "paused") && state.history.length > 0;
    if (unfinished && !confirm("Abandon this game? It will no longer be saved in this browser. Download the log first if you want to keep it.")) return;
    setLoadMessage(null);
    reset();
  };

  const onAdjudicate = (value: string) => {
    if (value !== "1/2-1/2" && value !== "1-0" && value !== "0-1") return;
    const what = value === "1/2-1/2" ? "a draw" : value === "1-0" ? "a win for White" : "a win for Black";
    if (confirm(`End the game now as ${what}? The PGN and log will record it as adjudicated.`)) adjudicate(value);
  };

  return (
    <div className="app">
      <header className="top">
        <p className="brand">Chess Agent Arena</p>
        <h1>Is it the model, or the harness?</h1>
        <p className="lede">
          A common claim in AI engineering is that the harness around a model matters more than the model itself. Test it at
          chess: you control what the model
          sees each turn, what it's told to check, and what happens when it tries an illegal move. Pit a small model with a
          good harness against a big model without one, and watch every prompt.
        </p>
        <ol className="steps">
          <li>
            <span>
              <strong>Pick a model for each side.</strong> Free OpenRouter models work.
            </span>
          </li>
          <li>
            <span>
              <strong>Pick or build a harness.</strong> Prompts, plus facts computed from the board.
            </span>
          </li>
          <li>
            <span>
              <strong>Watch them play.</strong> Every prompt and move is shown; one referee judges both sides.
            </span>
          </li>
        </ol>
      </header>

      {shared && (
        <div className={`banner ${shared.ok ? "" : "error"}`}>
          {shared.ok ? (
            <>
              Shared harness <strong>{shared.config.name}</strong>
              {shared.config.description ? `: ${shared.config.description}` : ""}
              <span className="spacer" />
              <button className="primary" onClick={addShared}>
                Add to my harnesses
              </button>
            </>
          ) : (
            <>
              Couldn't load the shared harness: {shared.error}
              <span className="spacer" />
            </>
          )}
          <button
            onClick={() => {
              setShared(null);
              clearShareHash();
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {sharedAdded && (
        <div className="banner">
          Added <strong>{sharedAdded}</strong> to My harnesses. Pick it in a side's Agent menu.
          <span className="spacer" />
          <button onClick={() => setSharedAdded(null)}>OK</button>
        </div>
      )}

      {stored && state.status === "setup" && (
        <div className="banner">
          <span>
            <strong>Unfinished game:</strong> {describeGame(stored)}.
          </span>
          <span className="spacer" />
          <button
            className="primary"
            onClick={() => {
              const error = openGame(stored);
              setLoadMessage(error ? { ok: false, text: `Couldn't reopen the game: ${error}` } : { ok: true, text: "Game reopened. Press Resume to continue." });
            }}
          >
            Reopen
          </button>
          <button
            onClick={() => {
              if (!confirm("Discard the unfinished game saved in this browser?")) return;
              void clearCurrentGame();
              setStored(null);
            }}
          >
            Discard
          </button>
        </div>
      )}
      {loadMessage && (
        <div className={`banner ${loadMessage.ok ? "" : "error"}`}>
          {loadMessage.text}
          <span className="spacer" />
          <button onClick={() => setLoadMessage(null)}>OK</button>
        </div>
      )}

      <section className="setup">
        <KeyInput
          value={key}
          remember={remember}
          // The key is read at each call, so it can be entered or changed while a game is paused.
          disabled={state.status === "running"}
          quota={quota}
          quotaError={quotaError}
          freeOnly={freeOnly}
          onChange={setKey}
          onRememberChange={setRemember}
          onFreeOnlyChange={setFreeOnly}
        />
        {(["w", "b"] as Color[]).map((c) => (
          <SideConfig
            key={c}
            color={c}
            value={sides[c]}
            disabled={playing}
            models={models}
            freeOnly={freeOnly}
            harnesses={harnesses}
            onChange={(v) => setSides((s) => ({ ...s, [c]: v }))}
            onHarness={(action) => openHarness(c, action)}
          />
        ))}
        {modelsError && <p className="hint">Couldn't load OpenRouter's model list ({modelsError}); you can still type any model ID.</p>}
      </section>

      <main className="arena">
        <AgentLog
          color="w"
          title={label("w")}
          entries={state.logs.w}
          live={live.w}
          thinkingSince={state.thinking?.color === "w" ? state.thinking.since : null}
          waiting={state.thinking?.color === "w" ? rateWait : null}
          isHuman={!usesModel(active.w.agentId)}
          now={now}
        />

        <div className="center">
          <div className="controls">
            {!playing && (
              <button className="primary" disabled={!!startProblem} title={startProblem ?? ""} onClick={() => {
                  setLoadMessage(null);
                  start(sides);
                }}>
                {state.status === "over" ? "Play again" : "Start game"}
              </button>
            )}
            {state.status === "running" && <button onClick={pause}>Pause</button>}
            {state.status === "paused" && (
              <button className="primary" onClick={resume} disabled={!!resumeProblem} title={resumeProblem ?? ""}>
                Resume
              </button>
            )}
            {state.status === "paused" && resumeProblem && <span className="hint">{resumeProblem}</span>}
            {playing && (
              <select
                value=""
                onChange={(e) => onAdjudicate(e.target.value)}
                aria-label="Adjudicate"
                title="End the game now with a result you decide, e.g. a dead-drawn position the agents would keep playing"
              >
                <option value="">Adjudicate…</option>
                <option value="1/2-1/2">Draw (½-½)</option>
                <option value="1-0">White wins (1-0)</option>
                <option value="0-1">Black wins (0-1)</option>
              </select>
            )}
            {(playing || state.status === "over") && <button onClick={newGame}>New game</button>}
            {!playing && (
              <>
                <input
                  ref={gameFileRef}
                  type="file"
                  accept=".json,.pgn,application/json,application/x-chess-pgn"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void loadGameFile(f);
                  }}
                />
                <button
                  onClick={() => gameFileRef.current?.click()}
                  title="Continue a game from a downloaded log (JSON), or from a PGN using the agents picked above"
                >
                  Load game…
                </button>
              </>
            )}
            {!playing && (
              <button onClick={() => setSides((s) => ({ w: s.b, b: s.w }))} title="Swap the White and Black setups">
                Swap colours
              </button>
            )}
            {startProblem && !playing && <span className="hint">{startProblem}</span>}
          </div>

          <Status state={state} rateWait={rateWait} now={now} />

          <Board
            fen={state.fen}
            history={state.history}
            orientation={orientation}
            humanToMove={state.humanToMove}
            onHumanMove={humanMove}
          />

          <MoveList history={state.history} result={state.result} />

          {state.history.length > 0 && (
            <div className="controls">
              <button onClick={copyPgn}>{copied ? "Copied!" : "Copy PGN"}</button>
              <button onClick={downloadTranscript} title="Every prompt, reasoning and reply, turn by turn, as a readable Markdown file">
                Download transcript (.md)
              </button>
              <button onClick={downloadLog} title="The whole game as data; load it later with Load game… to continue">
                Download log (JSON)
              </button>
            </div>
          )}
        </div>

        <AgentLog
          color="b"
          title={label("b")}
          entries={state.logs.b}
          live={live.b}
          thinkingSince={state.thinking?.color === "b" ? state.thinking.since : null}
          waiting={state.thinking?.color === "b" ? rateWait : null}
          isHuman={!usesModel(active.b.agentId)}
          now={now}
        />
      </main>

      {picker && (
        <HarnessPicker
          color={picker}
          current={sides[picker].agentId}
          harnesses={harnesses}
          onPick={(agentId) => {
            setSides((s) => ({ ...s, [picker]: { ...s[picker], agentId } }));
            setPicker(null);
          }}
          onView={(agentId) => {
            const config = harnessConfigFor(agentId);
            if (!config) return;
            setPicker(null);
            setEditor({ color: picker, config, readOnly: isLibraryHarness(agentId), isNew: false });
          }}
          onClose={() => setPicker(null)}
        />
      )}

      {editor && (
        <HarnessEditor
          key={`${editor.config.id}-${editor.readOnly}`}
          initial={editor.config}
          readOnly={editor.readOnly}
          isNew={editor.isNew}
          previewGame={previewGame}
          onClose={() => setEditor(null)}
          onSaved={(config) => {
            setSides((s) => ({ ...s, [editor.color]: { ...s[editor.color], agentId: customAgentId(config.id) } }));
            setEditor({ color: editor.color, config, readOnly: false, isNew: false });
          }}
          onDeleted={(id) => {
            setSides((s) => {
              const fix = (side: Side): Side => (side.agentId === customAgentId(id) ? { ...side, agentId: "harnessed" } : side);
              return { w: fix(s.w), b: fix(s.b) };
            });
            setEditor(null);
          }}
        />
      )}

      <footer>
        The referee only enforces the rules. No chess engine picks or suggests moves for any agent.
        <UsageLine />
      </footer>
    </div>
  );
}

/** "1,234 visits · 321 games played", if counting is on and the counts are public. */
function UsageLine() {
  const [counts, setCounts] = useState<{ visits: string | null; games: string | null } | null>(null);
  useEffect(() => {
    if (!GOATCOUNTER_CODE) return;
    Promise.all([fetchPublicCount("TOTAL"), fetchPublicCount("game-start")]).then(([visits, games]) => setCounts({ visits, games }));
  }, []);
  if (!GOATCOUNTER_CODE) return null;
  const parts = [counts?.visits && `${counts.visits} visits`, counts?.games && `${counts.games} games played`].filter(Boolean);
  return (
    <p className="usage">
      {parts.length > 0 && <strong>{parts.join(" · ")}</strong>}
      {parts.length > 0 && " · "}
      Visits and games are counted anonymously with{" "}
      <a href="https://www.goatcounter.com" target="_blank" rel="noreferrer">
        GoatCounter
      </a>{" "}
      (no cookies; no keys, prompts or moves are sent).
    </p>
  );
}

function Status({ state, rateWait, now }: Pick<ReturnType<typeof useGame>, "state" | "rateWait"> & { now: number }) {
  if (state.status === "over") {
    const who = state.result === "1-0" ? "White wins" : state.result === "0-1" ? "Black wins" : state.result === "*" ? "Game stopped" : "Draw";
    return (
      <div className="status over">
        <strong>{who}</strong> {state.result !== "*" && `(${state.result})`} · {state.reason}
      </div>
    );
  }
  if (state.status === "paused") {
    return (
      <div className={`status ${state.pauseError ? "error" : ""}`}>
        {state.pauseError ? `Paused: ${state.pauseError.replace(/\.$/, "")}` : "Paused"}. Resume replays the current turn.
      </div>
    );
  }
  if (state.humanToMove) return <div className="status">Your move: drag a piece.</div>;
  if (rateWait) {
    const secs = Math.max(0, Math.ceil((rateWait.until - now) / 1000));
    return (
      <div className="status waiting">
        {rateWait.model} is {rateWait.reason}. Retrying in {secs}s…
      </div>
    );
  }
  if (state.thinking) return <div className="status">{state.thinking.color === "w" ? "White" : "Black"} is thinking…</div>;
  return <div className="status muted">Pick two agents and press Start.</div>;
}
