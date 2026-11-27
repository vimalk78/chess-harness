// A minimal UCI engine driver. The engine runs elsewhere (a Web Worker in the browser, a
// child process in tests); this only sends commands and reads lines back. Searches are
// queued, so two engine sides can share one engine.

import { Chess } from "chess.js";

export interface UciTransport {
  send(command: string): void;
  onLine(listener: (line: string) => void): void;
}

export interface SearchResult {
  /** The move the engine plays, in UCI (e2e4, e7e8q). */
  bestmove: string;
  depth?: number;
  /** Score in centipawns from the side to move's point of view (absent when mate is found). */
  cp?: number;
  /** Mate in N moves from the side to move's point of view (negative: being mated). */
  mate?: number;
  /** The engine's main line, in UCI. */
  pv: string[];
}

export interface SearchRequest {
  /** UCI moves from the starting position, so the engine knows about repetitions. */
  moves: string[];
  /** setoption values sent before this search, e.g. { UCI_Elo: 1600 }. */
  options?: Record<string, string | number | boolean>;
  /** Think for this long… */
  movetimeMs?: number;
  /** …or search to this depth (used when movetimeMs isn't given). */
  depth?: number;
  newGame?: boolean;
  signal?: AbortSignal;
}

/** Reads the fields this driver uses from an "info …" line. Ignores secondary lines (multipv 2+). */
export function parseInfo(line: string): Partial<SearchResult> | null {
  if (!line.startsWith("info ") || !/ score /.test(line)) return null;
  const multipv = / multipv (\d+)/.exec(line);
  if (multipv && multipv[1] !== "1") return null;
  const out: Partial<SearchResult> = {};
  const depth = / depth (\d+)/.exec(line);
  if (depth) out.depth = Number(depth[1]);
  const score = / score (cp|mate) (-?\d+)/.exec(line);
  if (score) out[score[1] === "cp" ? "cp" : "mate"] = Number(score[2]);
  const pv = / pv (.+)$/.exec(line);
  out.pv = pv ? pv[1].trim().split(/\s+/) : [];
  return out;
}

export class UciEngine {
  private listeners: ((line: string) => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly ready: Promise<void>;
  private readonly transport: UciTransport;

  constructor(transport: UciTransport) {
    this.transport = transport;
    transport.onLine((line) => {
      for (const l of [...this.listeners]) l(line);
    });
    this.ready = this.waitFor((l) => l === "uciok").then(() => undefined);
    transport.send("uci");
  }

  private waitFor(test: (line: string) => boolean, onLine?: (line: string) => void): Promise<string> {
    return new Promise((resolve) => {
      const listener = (line: string) => {
        onLine?.(line);
        if (!test(line)) return;
        this.listeners = this.listeners.filter((l) => l !== listener);
        resolve(line);
      };
      this.listeners.push(listener);
    });
  }

  /** Runs one search after any earlier ones finish. Aborting stops the engine and rejects. */
  search(req: SearchRequest): Promise<SearchResult> {
    const run = async (): Promise<SearchResult> => {
      await this.ready;
      if (req.signal?.aborted) throw abortError();
      const t = this.transport;
      if (req.newGame) t.send("ucinewgame");
      for (const [name, value] of Object.entries(req.options ?? {})) t.send(`setoption name ${name} value ${value}`);
      t.send("isready");
      await this.waitFor((l) => l === "readyok");
      t.send(req.moves.length ? `position startpos moves ${req.moves.join(" ")}` : "position startpos");

      let info: Partial<SearchResult> = { pv: [] };
      const done = this.waitFor(
        (l) => l.startsWith("bestmove"),
        (l) => {
          const parsed = parseInfo(l);
          if (parsed) info = { ...parsed, ...(parsed.mate === undefined ? { mate: undefined } : { cp: undefined }) };
        },
      );
      const stop = () => t.send("stop");
      req.signal?.addEventListener("abort", stop, { once: true });
      t.send(req.movetimeMs !== undefined ? `go movetime ${Math.max(1, Math.round(req.movetimeMs))}` : `go depth ${req.depth ?? 12}`);
      const line = await done;
      req.signal?.removeEventListener("abort", stop);
      if (req.signal?.aborted) throw abortError();
      const bestmove = line.split(/\s+/)[1];
      if (!bestmove || bestmove === "(none)") throw new Error("The engine found no move.");
      return { ...info, pv: info.pv ?? [], bestmove };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

/** SAN history from the starting position -> UCI moves (e2e4, e7e8q). */
export function sanToUci(history: string[]): string[] {
  const chess = new Chess();
  return history.map((san) => {
    const m = chess.move(san);
    return m.from + m.to + (m.promotion ?? "");
  });
}

/** UCI moves played from `fen` -> SAN, stopping at the first one that isn't legal. */
export function uciToSan(fen: string, uci: string[]): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const u of uci) {
    try {
      out.push(chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}
