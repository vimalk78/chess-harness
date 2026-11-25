import { useCallback, useEffect, useRef, useState } from "react";
import { getAgent } from "../agents/registry";
import type { Color } from "../agents/types";
import { buildPgn } from "../game/pgn";
import { AgentLog } from "./AgentLog";
import { Board } from "./Board";
import { KeyInput } from "./KeyInput";
import { MoveList } from "./MoveList";
import { MODEL_SUGGESTIONS, SideConfig } from "./SideConfig";
import { sideLabel, useGame, type SideConfig as Side } from "./useGame";

const KEY_STORAGE = "arena.openrouterKey";
const SIDES_STORAGE = "arena.sides";

const DEFAULT_SIDES: Record<Color, Side> = {
  w: { agentId: "harnessed", model: "anthropic/claude-haiku-5.5", effort: "" },
  b: { agentId: "raw", model: "anthropic/claude-opus-5.5", effort: "" },
};

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

  const keyRef = useRef(key);
  keyRef.current = key;
  const getKey = useCallback(() => keyRef.current, []);
  const { state, start, pause, resume, reset, humanMove, exportLog } = useGame(getKey);

  useEffect(() => {
    if (remember) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  }, [key, remember]);

  useEffect(() => localStorage.setItem(SIDES_STORAGE, JSON.stringify(sides)), [sides]);

  useEffect(() => {
    if (!state.thinking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [state.thinking]);

  const playing = state.status === "running" || state.status === "paused";
  const active = state.sides ?? sides;
  const defs = { w: getAgent(sides.w.agentId), b: getAgent(sides.b.agentId) };
  const needsKey = defs.w.needsModel || defs.b.needsModel;

  const startProblem =
    !defs.w.needsModel && !defs.b.needsModel
      ? "Pick at least one LLM agent"
      : needsKey && !key.trim()
        ? "Enter your OpenRouter key"
        : (defs.w.needsModel && !sides.w.model.trim()) || (defs.b.needsModel && !sides.b.model.trim())
          ? "Enter a model ID"
          : null;

  const humanColors = (["w", "b"] as Color[]).filter((c) => !getAgent(active[c].agentId).needsModel);
  const orientation = humanColors.length === 1 && humanColors[0] === "b" ? "black" : "white";

  const pgn = () =>
    buildPgn(state.history, {
      white: sideLabel(active.w),
      black: sideLabel(active.b),
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
        <div>
          <h1>Chess Agent Arena</h1>
          <p className="tagline">Model vs model, or model + harness vs model. Watch every prompt and decide for yourself.</p>
        </div>
      </header>

      <section className="setup">
        <KeyInput value={key} remember={remember} disabled={playing} onChange={setKey} onRememberChange={setRemember} />
        <SideConfig color="w" value={sides.w} disabled={playing} onChange={(v) => setSides((s) => ({ ...s, w: v }))} />
        <SideConfig color="b" value={sides.b} disabled={playing} onChange={(v) => setSides((s) => ({ ...s, b: v }))} />
        <datalist id="model-suggestions">
          {MODEL_SUGGESTIONS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </section>

      <main className="arena">
        <AgentLog
          color="w"
          title={sideLabel(active.w)}
          entries={state.logs.w}
          thinkingSince={state.thinking?.color === "w" ? state.thinking.since : null}
          isHuman={!getAgent(active.w.agentId).needsModel}
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

          <Status state={state} />

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
          title={sideLabel(active.b)}
          entries={state.logs.b}
          thinkingSince={state.thinking?.color === "b" ? state.thinking.since : null}
          isHuman={!getAgent(active.b.agentId).needsModel}
          now={now}
        />
      </main>

      <footer>
        The referee only enforces the rules. No chess engine picks or suggests moves for any agent.
      </footer>
    </div>
  );
}

function Status({ state }: { state: ReturnType<typeof useGame>["state"] }) {
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
        {state.pauseError ? `Paused: ${state.pauseError}` : "Paused"}. Resume replays the current turn.
      </div>
    );
  }
  if (state.humanToMove) return <div className="status">Your move: drag a piece.</div>;
  if (state.thinking) return <div className="status">{state.thinking.color === "w" ? "White" : "Black"} is thinking…</div>;
  return <div className="status muted">Pick two agents and press Start.</div>;
}
