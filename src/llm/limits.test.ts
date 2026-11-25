import { describe, expect, it, vi } from "vitest";
import { fetchFreeQuota, parseModels } from "./models";
import { OpenRouterClient } from "./openrouter";
import { RateLimiter } from "./rateLimiter";

const okBody = { choices: [{ message: { content: "e4" } }] };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const signal = () => new AbortController().signal;

describe("RateLimiter", () => {
  it("lets max calls through per window, then waits for the oldest to expire", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const lim = new RateLimiter(2, 1000, () => t, async (ms) => {
      sleeps.push(ms);
      t += ms;
    });
    await lim.acquire(signal());
    t = 100;
    await lim.acquire(signal());
    expect(sleeps).toEqual([]);
    t = 200;
    await lim.acquire(signal());
    expect(sleeps).toEqual([850]); // until t=1000 (+50ms margin)
  });
});

describe("OpenRouterClient rate limits", () => {
  const noLimit = new RateLimiter(1000, 1);

  it("throttles only :free models", async () => {
    const acquire = vi.fn(async () => {});
    const lim = { acquire } as unknown as RateLimiter;
    const client = new OpenRouterClient(() => "k", async () => json(200, okBody), { freeLimiter: lim });
    await client.chat({ model: "google/gemma-4-31b-it:free", messages: [], signal: signal() });
    await client.chat({ model: "anthropic/claude-haiku-5.5", messages: [], signal: signal() });
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("waits and retries on a per-minute 429", async () => {
    const responses = [json(429, { error: { message: "Rate limit exceeded" } }, { "Retry-After": "3" }), json(200, okBody)];
    const sleep = vi.fn(async () => {});
    const client = new OpenRouterClient(() => "k", async () => responses.shift()!, { freeLimiter: noLimit, sleep });
    const res = await client.chat({ model: "m:free", messages: [], signal: signal() });
    expect(res.text).toBe("e4");
    expect(sleep).toHaveBeenCalledWith(3000, expect.anything());
  });

  it("backs off exponentially without hints, then gives up", async () => {
    const sleep = vi.fn(async () => {});
    const client = new OpenRouterClient(() => "k", async () => json(429, { error: { message: "Rate limit exceeded" } }), {
      freeLimiter: noLimit,
      sleep,
    });
    await expect(client.chat({ model: "m:free", messages: [], signal: signal() })).rejects.toThrow(/gave up after 5 tries/);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([5000, 10000, 20000, 40000]);
  });

  it("waits longer when the model's provider is overloaded, reporting each wait", async () => {
    const upstream = () =>
      json(429, { error: { message: "Provider returned error", metadata: { provider_name: "Google AI Studio", raw: "gemma is temporarily rate-limited upstream" } } });
    const responses = [upstream(), upstream(), json(200, okBody)];
    const sleep = vi.fn(async () => {});
    const waits: unknown[] = [];
    const client = new OpenRouterClient(() => "k", async () => responses.shift()!, {
      freeLimiter: noLimit,
      sleep,
      onWait: (w) => waits.push(w),
    });
    const res = await client.chat({ model: "google/gemma-4-26b-a4b-it:free", messages: [], signal: signal() });
    expect(res.text).toBe("e4");
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([10000, 20000]);
    expect(waits).toEqual([
      { model: "google/gemma-4-26b-a4b-it:free", waitMs: 10000, reason: "rate-limited by its provider (Google AI Studio)" },
      { model: "google/gemma-4-26b-a4b-it:free", waitMs: 20000, reason: "rate-limited by its provider (Google AI Studio)" },
      null,
    ]);
  });

  it("gives up on a busy provider with a message naming the model and provider", async () => {
    const client = new OpenRouterClient(
      () => "k",
      async () => json(429, { error: { message: "Provider returned error", metadata: { provider_name: "Nvidia", raw: "busy" } } }),
      { freeLimiter: noLimit, sleep: async () => {} },
    );
    await expect(client.chat({ model: "nvidia/x:free", messages: [], signal: signal() })).rejects.toThrow(
      /nvidia\/x:free is rate-limited by its provider \(Nvidia\).*7 tries.*isn't your account limit.*Provider said: busy/,
    );
  });

  it("stops immediately on the daily free limit with a useful message", async () => {
    const now = Date.UTC(2026, 10, 26, 15, 0);
    const reset = Date.UTC(2026, 10, 27, 0, 0);
    const sleep = vi.fn(async () => {});
    const client = new OpenRouterClient(
      () => "k",
      async () =>
        json(429, { error: { message: "Rate limit exceeded: free-models-per-day" } }, {
          "X-RateLimit-Limit": "50",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(reset),
        }),
      { freeLimiter: noLimit, sleep, now: () => now },
    );
    const err = client.chat({ model: "m:free", messages: [], signal: signal() });
    await expect(err).rejects.toThrow(/daily limit reached \(50 requests\/day\)\. Resets at 00:00 UTC\. Buying \$10/);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("models", () => {
  it("keeps text models, drops openrouter/free and non-text, flags free, sorts free first", () => {
    const list = parseModels({
      data: [
        { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", pricing: { prompt: "0.000004", completion: "0.00002" } },
        { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B (free)", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["reasoning"] },
        { id: "openrouter/free", name: "Free router", pricing: { prompt: "0", completion: "0" } },
        { id: "google/lyria-3-pro-preview", name: "Lyria", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["text", "audio"] } },
      ],
    });
    expect(list).toEqual([
      { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B (free)", free: true, reasoning: true },
      { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", free: false, reasoning: false },
    ]);
  });

  it("reads the free daily quota from the key endpoint", async () => {
    const q = await fetchFreeQuota("k", async () => json(200, { data: { free_model_daily_requests: { used: 12, limit: 50, remaining: 38 } } }));
    expect(q).toEqual({ used: 12, limit: 50, remaining: 38 });
    expect(await fetchFreeQuota("k", async () => json(200, { data: {} }))).toBeNull();
    await expect(fetchFreeQuota("k", async () => json(401, {}))).rejects.toThrow(/not recognised/);
  });
});

describe("isOftenRateLimited", async () => {
  const { isOftenRateLimited } = await import("./models");
  it("flags only Google-hosted free models", () => {
    expect(isOftenRateLimited("google/gemma-4-26b-a4b-it:free")).toBe(true);
    expect(isOftenRateLimited("google/gemini-3.1-pro-preview")).toBe(false);
    expect(isOftenRateLimited("nvidia/nemotron-3.5-lightning:free")).toBe(false);
  });
});
