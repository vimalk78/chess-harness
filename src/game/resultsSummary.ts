// Adds up submitted results per player (harness + model, or Stockfish level) and opponent:
// results, Stockfish's review, cost, and two signs of aimless play. Used by
// scripts/results.mjs (`npm run results`); only type imports, so Node can run it as is.

import { Chess } from "chess.js";
import type { ResultFile, ResultSide } from "./resultFile";

type Side = "white" | "black";

/** One side of one game. */
export interface SideGame {
  player: string;
  opponent: string;
  kind: ResultSide["kind"];
  color: Side;
  score: 1 | 0.5 | 0;
  /** Own moves played. */
  moves: number;
  accuracy?: number;
  avgLoss?: number;
  blunders?: number;
  mistakes?: number;
  costUsd?: number;
  requests?: number;
  reasks?: number;
  stopped?: number;
  /** A piece going straight back to the square it came from on its next move. */
  backAndForth: number;
  /** Longest run of own moves with no pawn move and no capture. */
  longestQuiet: number;
}

export interface PlayerSummary {
  player: string;
  opponent: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  avgMoves: number;
  accuracy?: number;
  avgLoss?: number;
  blundersPerGame?: number;
  mistakesPerGame?: number;
  costPerGame?: number;
  reasksPerGame?: number;
  stopped: number;
  backAndForthPerGame: number;
  longestQuiet: number;
}

const shortModel = (id = "?") => id.replace(/^[^/]*\//, "").replace(/:free$/, " (free)");

export function playerName(s: ResultSide): string {
  if (s.kind === "engine" && s.engine) return `Stockfish ${s.engine.elo ?? "full"}`;
  if (s.kind === "llm") return `${s.harness?.name ?? "?"} · ${shortModel(s.model)}`;
  return "Human";
}

/** Back-and-forth moves and the longest quiet stretch, for one colour. */
export function aimlessness(history: string[], color: "w" | "b"): { backAndForth: number; longestQuiet: number } {
  const chess = new Chess();
  /** Where each piece (tracked by its current square) last came from. */
  const cameFrom = new Map<string, string>();
  let backAndForth = 0;
  let quiet = 0;
  let longestQuiet = 0;
  for (const san of history) {
    const m = chess.move(san);
    if (m.color !== color) {
      cameFrom.delete(m.to); // a captured piece's history goes with it
      continue;
    }
    if (cameFrom.get(m.from) === m.to) backAndForth++;
    cameFrom.delete(m.from);
    cameFrom.set(m.to, m.from);
    quiet = m.piece === "p" || m.captured ? 0 : quiet + 1;
    longestQuiet = Math.max(longestQuiet, quiet);
  }
  return { backAndForth, longestQuiet };
}

function historyOf(file: ResultFile): string[] {
  const chess = new Chess();
  chess.loadPgn(file.pgn);
  return chess.history();
}

export function sideGames(file: ResultFile): SideGame[] {
  const history = historyOf(file);
  const out: SideGame[] = [];
  for (const color of ["white", "black"] as Side[]) {
    const me = file[color];
    const them = file[color === "white" ? "black" : "white"];
    const c = color === "white" ? "w" : "b";
    const mine = (file.moves ?? []).filter((m) => m.color === c);
    const s = me.stats;
    out.push({
      player: playerName(me),
      opponent: playerName(them),
      kind: me.kind,
      color,
      score: file.result === "1/2-1/2" ? 0.5 : (file.result === "1-0") === (color === "white") ? 1 : 0,
      moves: Math.ceil((history.length - (color === "white" ? 0 : 1)) / 2),
      ...(file.review ? { accuracy: file.review[color].accuracy, avgLoss: file.review[color].avgLoss, blunders: file.review[color].blunders, mistakes: file.review[color].mistakes } : {}),
      ...(s ? { costUsd: s.costUsd, requests: s.requests, reasks: s.reasks } : {}),
      ...(mine.length ? { stopped: mine.reduce((n, m) => n + (m.stopped ?? 0), 0) } : {}),
      ...aimlessness(history, c),
    });
  }
  return out;
}

const mean = (xs: (number | undefined)[]): number | undefined => {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};

/** One row per player and opponent; Stockfish's own rows are left out unless asked for. */
export function summarize(files: ResultFile[], opts: { engines?: boolean } = {}): PlayerSummary[] {
  const groups = new Map<string, SideGame[]>();
  for (const g of files.flatMap(sideGames)) {
    if (g.kind === "engine" && !opts.engines) continue;
    const key = `${g.player}\u0000${g.opponent}`;
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  return [...groups.values()]
    .map((gs) => ({
      player: gs[0].player,
      opponent: gs[0].opponent,
      games: gs.length,
      wins: gs.filter((g) => g.score === 1).length,
      draws: gs.filter((g) => g.score === 0.5).length,
      losses: gs.filter((g) => g.score === 0).length,
      avgMoves: mean(gs.map((g) => g.moves))!,
      accuracy: mean(gs.map((g) => g.accuracy)),
      avgLoss: mean(gs.map((g) => g.avgLoss)),
      blundersPerGame: mean(gs.map((g) => g.blunders)),
      mistakesPerGame: mean(gs.map((g) => g.mistakes)),
      costPerGame: mean(gs.map((g) => g.costUsd)),
      reasksPerGame: mean(gs.map((g) => g.reasks)),
      stopped: gs.reduce((n, g) => n + (g.stopped ?? 0), 0),
      backAndForthPerGame: mean(gs.map((g) => g.backAndForth))!,
      longestQuiet: Math.max(...gs.map((g) => g.longestQuiet)),
    }))
    .sort((a, b) => a.opponent.localeCompare(b.opponent) || b.wins / b.games - a.wins / a.games || (a.avgLoss ?? 1e9) - (b.avgLoss ?? 1e9));
}

const f1 = (n?: number) => (n === undefined ? "–" : n.toFixed(1));
const f0 = (n?: number) => (n === undefined ? "–" : Math.round(n).toString());

/** A Markdown table of the summary. */
export function summaryTable(rows: PlayerSummary[]): string {
  const head = ["Player", "Opponent", "Games", "W-D-L", "Moves", "Accuracy", "Avg loss (cp)", "Blunders/game", "Mistakes/game", "Re-asks/game", "Stopped", "Back-and-forth/game", "Longest quiet run", "Cost/game"];
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const r of rows) {
    lines.push(
      `| ${[
        r.player,
        r.opponent,
        r.games,
        `${r.wins}-${r.draws}-${r.losses}`,
        f0(r.avgMoves),
        r.accuracy === undefined ? "–" : `${r.accuracy.toFixed(1)}%`,
        f0(r.avgLoss),
        f1(r.blundersPerGame),
        f1(r.mistakesPerGame),
        f1(r.reasksPerGame),
        r.stopped,
        f1(r.backAndForthPerGame),
        r.longestQuiet,
        r.costPerGame === undefined ? "–" : `$${r.costPerGame.toFixed(2)}`,
      ].join(" | ")} |`,
    );
  }
  return lines.join("\n");
}
