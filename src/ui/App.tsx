import { Chess } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentExists, customAgentId, getAgent, harnessConfigFor } from "../agents/registry";
import type { HarnessConfig, Validation } from "../harness/config";
import { HARNESSED_PRESET } from "../harness/presets";
import { harnessStore, newHarnessId, readShareFromHash } from "../harness/store";
import { HarnessEditor } from "./HarnessEditor";
import { useHarnesses } from "./useHarnesses";
import type { Color } from "../agents/types";
import { buildPgn } from "../game/pgn";
import { AgentLog } from "./AgentLog";
import { Board } from "./Board";
import { KeyInput } from "./KeyInput";
import { MoveList } from "./MoveList";
import { SideConfig } from "./SideConfig";
import { withFreeModels } from "./sides";
import { fetchFreeQuota, fetchModels, type FreeQuota, type ModelInfo } from "../llm/models";
import { sideLabel, useGame, type SideConfig as Side } from "./useGame";

const KEY_STORAGE = "arena.openrouterKey";
const SIDES_STORAGE = "arena.sides";
const FREE_ONLY_STORAGE = "arena.freeOnly";

const DEFAULT_SIDES: Record<Color, Side> = {
  // Free models, so the defaults work on a free OpenRouter account:
  // a small model with the harness vs a much larger model without it.
  w: { agentId: "harnessed", model: "google/gemma-4-26b-a4b-it:free", effort: "" },
  b: { agentId: "raw", model: "nvidia/nemotron-3-ultra-550b-a55b:free", effort: "" },
};

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
  const { state, live, rateWait, start, pause, resume, reset, humanMove, exportLog } = useGame(getKey);
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

  const openHarness = (color: Color, action: "view" | "edit" | "new") => {
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

  useEffect(() => localStorage.setItem(SIDES_STORAGE, JSON.stringify(sides)), [sides]);
  useEffect(() => localStorage.setItem(FREE_ONLY_STORAGE, String(freeOnly)), [freeOnly]);

  useEffect(() => {
    fetchModels()
      .then((list) => {
        setModels(list);
        // Settings saved from an earlier visit may name paid models; swap those for free ones.
        if (freeOnlyAtLoad.current) setSides((s) => withFreeModels(s, list, DEFAULT_SIDES));
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
    const blob = new Blob([JSON.stringify({ pgn: pgn(), ...exportLog() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chess-agent-arena-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="app">
      <header className="top">
        <p className="brand">Chess Agent Arena</p>
        <h1>Is it the model, or the harness?</h1>
        <p className="lede">
          People say what wraps an AI model matters more than the model itself. Test it at chess: you control what the model
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

      <section className="setup">
        <KeyInput
          value={key}
          remember={remember}
          disabled={playing}
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
          isHuman={!usesModel(active.w.agentId)}
          now={now}
        />

        <div className="center">
          <div className="controls">
            {!playing && (
              <button className="primary" disabled={!!startProblem} title={startProblem ?? ""} onClick={() => start(sides)}>
                {state.status === "over" ? "Play again" : "Start game"}
              </button>
            )}
            {state.status === "running" && <button onClick={pause}>Pause</button>}
            {state.status === "paused" && (
              <button className="primary" onClick={resume}>
                Resume
              </button>
            )}
            {(playing || state.status === "over") && <button onClick={reset}>New game</button>}
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

          <MoveList history={state.history} />

          {state.history.length > 0 && (
            <div className="controls">
              <button onClick={copyPgn}>{copied ? "Copied!" : "Copy PGN"}</button>
              <button onClick={downloadLog}>Download log (JSON)</button>
            </div>
          )}
        </div>

        <AgentLog
          color="b"
          title={label("b")}
          entries={state.logs.b}
          live={live.b}
          thinkingSince={state.thinking?.color === "b" ? state.thinking.since : null}
          isHuman={!usesModel(active.b.agentId)}
          now={now}
        />
      </main>

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
      </footer>
    </div>
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
