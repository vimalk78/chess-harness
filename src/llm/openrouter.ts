import type { ChatMessage, LlmClient, ReasoningEffort, Usage } from "../agents/types";
import { abortableSleep, RateLimiter } from "./rateLimiter";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RATE_LIMIT_RETRIES = 4;
/** Waits (seconds) when the model's own provider is overloaded; these spells often last minutes. */
const UPSTREAM_RETRY_DELAYS_S = [10, 20, 30, 45, 60, 60];

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

interface OpenRouterResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; metadata?: { provider_name?: string; raw?: unknown } };
}

export interface WaitInfo {
  model: string;
  waitMs: number;
  reason: string;
}

export interface OpenRouterOptions {
  /** Throttle for ":free" models (OpenRouter allows 20/min per account). */
  freeLimiter?: RateLimiter;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Called before each rate-limit wait, and with null once a call goes through. */
  onWait?: (info: WaitInfo | null) => void;
}

export const isFreeModel = (model: string) => model.endsWith(":free");

/** Calls OpenRouter straight from the browser. The key never goes anywhere else. */
export class OpenRouterClient implements LlmClient {
  private readonly getKey: () => string;
  private readonly fetchFn: FetchFn;
  private readonly freeLimiter: RateLimiter;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly onWait: (info: WaitInfo | null) => void;

  constructor(getKey: () => string, fetchFn: FetchFn = (u, i) => fetch(u, i), opts: OpenRouterOptions = {}) {
    this.getKey = getKey;
    this.fetchFn = fetchFn;
    this.freeLimiter = opts.freeLimiter ?? new RateLimiter(19, 60_000);
    this.sleep = opts.sleep ?? abortableSleep;
    this.now = opts.now ?? Date.now;
    this.onWait = opts.onWait ?? (() => {});
  }

  async chat(req: {
    model: string;
    messages: ChatMessage[];
    reasoningEffort?: ReasoningEffort;
    signal: AbortSignal;
  }): Promise<{ text: string; usage?: Usage }> {
    const key = this.getKey().trim();
    if (!key) throw new Error("No OpenRouter API key set");

    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      usage: { include: true },
    };
    if (req.reasoningEffort) body.reasoning = { effort: req.reasoningEffort };

    for (let attempt = 0; ; attempt++) {
      if (isFreeModel(req.model)) await this.freeLimiter.acquire(req.signal);

      const res = await this.fetchFn(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Chess Agent Arena",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]),
      });

      let data: OpenRouterResponse;
      try {
        data = (await res.json()) as OpenRouterResponse;
      } catch {
        throw new Error(`OpenRouter ${res.status}: unreadable response`);
      }

      if (res.status === 429) {
        const wait = this.rateLimitWait(req.model, res, data, attempt);
        if (typeof wait === "string") {
          this.onWait(null);
          throw new Error(wait);
        }
        this.onWait({ model: req.model, waitMs: wait.ms, reason: wait.reason });
        await this.sleep(wait.ms, req.signal);
        continue;
      }
      this.onWait(null);
      if (!res.ok) throw new Error(`OpenRouter ${res.status} (${req.model}): ${describeError(data, res.statusText)}`);
      if (data.error) throw new Error(`OpenRouter (${req.model}): ${describeError(data, "unknown error")}`);

      const text = data.choices?.[0]?.message?.content ?? "";
      const u = data.usage;
      const usage: Usage | undefined = u
        ? {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            ...(u.cost !== undefined ? { costUsd: u.cost } : {}),
          }
        : undefined;
      return { text, usage };
    }
  }

  /** How long to wait before retrying, or an error message if retrying won't help. */
  private rateLimitWait(
    model: string,
    res: Response,
    data: OpenRouterResponse,
    attempt: number,
  ): { ms: number; reason: string } | string {
    const msg = data.error?.message ?? "Rate limit exceeded";
    const provider = data.error?.metadata?.provider_name;

    // The model's own provider is overloaded (common for free models at busy times).
    if (provider || /provider returned error/i.test(msg)) {
      const who = provider ? `its provider (${provider})` : "its provider";
      if (attempt >= UPSTREAM_RETRY_DELAYS_S.length) {
        return (
          `${model} is rate-limited by ${who} and still busy after ${attempt + 1} tries over ~4 minutes. ` +
          `This isn't your account limit: free models are shared and often congested. ` +
          `Resume to try again, or pick another free model.${rawDetail(data)}`
        );
      }
      return { ms: UPSTREAM_RETRY_DELAYS_S[attempt] * 1000, reason: `rate-limited by ${who}` };
    }

    const remaining = res.headers.get("X-RateLimit-Remaining");
    const limit = res.headers.get("X-RateLimit-Limit");
    let resetMs = Number(res.headers.get("X-RateLimit-Reset")) || 0;
    if (resetMs && resetMs < 1e12) resetMs *= 1000; // seconds → ms
    const untilReset = resetMs ? resetMs - this.now() : 0;

    const daily = /per[- ]day|daily/i.test(msg) || (remaining === "0" && untilReset > 2 * 60_000);
    if (daily) {
      const at = resetMs ? ` Resets at ${new Date(resetMs).toISOString().slice(11, 16)} UTC.` : " Resets at 00:00 UTC.";
      const hint = limit === "50" || !limit ? " Buying $10 of OpenRouter credits raises the free limit to 1000/day." : "";
      return `Free-model daily limit reached (${limit ?? 50} requests/day).${at}${hint}`;
    }
    if (attempt >= MAX_RATE_LIMIT_RETRIES) return `OpenRouter 429 (${model}): ${msg} (gave up after ${attempt + 1} tries)`;

    const reason = "OpenRouter's per-minute limit for free models";
    const retryAfter = Number(res.headers.get("Retry-After"));
    if (retryAfter > 0) return { ms: Math.min(retryAfter * 1000, 65_000), reason };
    if (untilReset > 0) return { ms: Math.min(untilReset + 250, 65_000), reason };
    return { ms: Math.min(5_000 * 2 ** attempt, 65_000), reason };
  }
}

function rawDetail(data: OpenRouterResponse): string {
  const raw = data.error?.metadata?.raw;
  if (raw === undefined || raw === null || raw === "") return "";
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  return ` Provider said: ${text.slice(0, 200)}`;
}

function describeError(data: OpenRouterResponse, fallback: string): string {
  const provider = data.error?.metadata?.provider_name;
  return `${data.error?.message ?? fallback}${provider ? ` [${provider}]` : ""}${rawDetail(data)}`;
}
