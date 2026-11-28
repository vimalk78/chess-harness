// Stockfish as an opponent, for testing harnesses against a known strength. It runs in the
// browser (Stockfish 19, lite net, single-threaded WebAssembly, in a Web Worker); no model
// calls. Each level is its own agent id ("stockfish:1600", "stockfish:full"), so saved games
// and results record the strength without any extra settings.

import { Chess } from "chess.js";
import { sanToUci, uciToSan, UciEngine, type SearchResult } from "../engine/uci";
import type { AgentDefinition, Color, GameView } from "./types";

export const ENGINE_NAME = "Stockfish 19 lite";
/** Stockfish's UCI_Elo range is 1320–3190; null means full strength. */
export const ENGINE_LEVELS: (number | null)[] = [1320, 1600, 2000, 2400, null];
export const ENGINE_MOVETIME_MS = 1000;
/** Served from public/engine/ (copied from the stockfish package by vite.config.ts). */
export const ENGINE_SCRIPT = "engine/stockfish-19-lite-single.js";

export const engineAgentId = (elo: number | null) => `stockfish:${elo ?? "full"}`;

/** The level behind an engine agent id: a number, null for full strength, undefined if it isn't one. */
export function engineLevel(agentId: string): number | null | undefined {
  const m = /^stockfish:(full|\d+)$/.exec(agentId);
  if (!m) return undefined;
  if (m[1] === "full") return null;
  const elo = Number(m[1]);
  return ENGINE_LEVELS.includes(elo) ? elo : undefined;
}

export const engineLabel = (elo: number | null) => `${ENGINE_NAME} · ${elo ? `Elo ${elo}` : "full strength"}`;

let shared: UciEngine | null = null;

/** One engine for the page, started on first use (shared by the engine agents and game reviews). */
export function browserEngine(): UciEngine {
  if (!shared) {
    const worker = new Worker(import.meta.env.BASE_URL + ENGINE_SCRIPT);
    const listeners: ((line: string) => void)[] = [];
    worker.onmessage = (e: MessageEvent) => {
      for (const line of String(e.data).split("\n")) if (line) for (const l of listeners) l(line);
    };
    shared = new UciEngine({ send: (c) => worker.postMessage(c), onLine: (l) => listeners.push(l) });
  }
  return shared;
}

/** "12. Nf3 Nc6 13. Bb5" or "12... Nc6 13. Bb5", numbered from the position. */
function numbered(fen: string, sans: string[]): string {
  const parts = fen.split(" ");
  let turn = parts[1] as Color;
  let full = Number(parts[5]) || 1;
  return sans
    .map((san, i) => {
      const label = turn === "w" ? `${full}. ` : i === 0 ? `${full}... ` : "";
      if (turn === "b") full++;
      turn = turn === "w" ? "b" : "w";
      return label + san;
    })
    .join(" ");
}

/**
 * The engine's score from White's side, with the usual advantage symbol: "+0.85 ± White is
 * clearly better", "−0.20 = equal", "mate in 3 for Black". Cut-offs (in pawns) are the common
 * ones for these symbols: under 0.3 =, under 0.7 ⩲/⩱, under 1.5 ±/∓, otherwise +−/−+.
 */
export function formatEval(res: Pick<SearchResult, "cp" | "mate">, toMove: Color): string {
  const flip = toMove === "w" ? 1 : -1;
  if (res.mate !== undefined) {
    const white = res.mate * flip;
    return white === 0 ? "mated" : `mate in ${Math.abs(white)} for ${white > 0 ? "White" : "Black"}`;
  }
  if (res.cp === undefined) return "no score";
  const white = (res.cp * flip) / 100;
  const a = Math.abs(white);
  const who = white > 0 ? "White" : "Black";
  const label =
    a < 0.3
      ? "= equal"
      : a < 0.7
        ? `${white > 0 ? "⩲" : "⩱"} ${who} is slightly better`
        : a < 1.5
          ? `${white > 0 ? "±" : "∓"} ${who} is clearly better`
          : `${white > 0 ? "+−" : "−+"} ${who} is winning`;
  return `${white >= 0 ? "+" : "−"}${a.toFixed(2)} ${label}`;
}

/** Stockfish's own chances, for White: "White wins 34% · draw 60% · Black wins 6%". */
export function formatWdl(wdl: [number, number, number], toMove: Color): string {
  const [win, draw, loss] = toMove === "w" ? wdl : [wdl[2], wdl[1], wdl[0]];
  const pct = (n: number) => `${Math.round(n / 10)}%`;
  return `White wins ${pct(win)} · draw ${pct(draw)} · Black wins ${pct(loss)}`;
}

export function engineDefinition(elo: number | null, getEngine: () => UciEngine = browserEngine): AgentDefinition {
  return {
    id: engineAgentId(elo),
    label: engineLabel(elo),
    description: `Chess engine, for testing harnesses against a known strength: ${ENGINE_NAME} running in your browser${
      elo ? `, limited to about ${elo} Elo${elo === 1320 ? " (its weakest setting)" : ""}` : " at full strength"
    }, ${ENGINE_MOVETIME_MS / 1000} s per move. No model calls, so it costs nothing.`,
    needsModel: false,
    create() {
      return {
        async nextMove(game: GameView) {
          const res = await getEngine().search({
            moves: sanToUci(game.history),
            options: { UCI_ShowWDL: true, ...(elo ? { UCI_LimitStrength: true, UCI_Elo: elo } : { UCI_LimitStrength: false }) },
            movetimeMs: ENGINE_MOVETIME_MS,
            newGame: game.history.length < 2,
            signal: game.signal,
          });
          const toMove = new Chess(game.fen).turn();
          const line = uciToSan(game.fen, res.pv.slice(0, 8));
          const played = uciToSan(game.fen, [res.bestmove])[0] ?? res.bestmove;
          const text = [
            `Engine: depth ${res.depth ?? "?"} · eval ${formatEval(res, toMove)}`,
            res.wdl ? `Stockfish's chances: ${formatWdl(res.wdl, toMove)}` : null,
            line.length ? `Main line: ${numbered(game.fen, line)}` : null,
            line[0] && line[0] !== played ? `Plays ${played} instead (strength limit).` : null,
          ]
            .filter(Boolean)
            .join("\n");
          return { move: res.bestmove, log: [{ kind: "note", text }] };
        },
      };
    },
  };
}

export const ENGINE_AGENTS: AgentDefinition[] = ENGINE_LEVELS.map((elo) => engineDefinition(elo));
