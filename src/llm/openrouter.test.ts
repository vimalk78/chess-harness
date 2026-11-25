import { describe, expect, it, vi } from "vitest";
import { OpenRouterClient } from "./openrouter";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

const ok = {
  choices: [{ message: { content: "MOVE: e4" } }],
  usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0004 },
};

describe("OpenRouterClient", () => {
  it("sends the right request and parses text, usage and cost", async () => {
    const fetchFn = mockFetch(200, ok);
    const client = new OpenRouterClient(() => "sk-or-test", fetchFn);
    const res = await client.chat({
      model: "anthropic/claude-haiku-5.5",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "high",
      signal: new AbortController().signal,
    });
    expect(res).toEqual({ text: "MOVE: e4", usage: { promptTokens: 120, completionTokens: 30, costUsd: 0.0004 } });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "anthropic/claude-haiku-5.5",
      messages: [{ role: "user", content: "hi" }],
      usage: { include: true },
      reasoning: { effort: "high" },
    });
  });

  it("omits reasoning when no effort is set", async () => {
    const fetchFn = mockFetch(200, ok);
    await new OpenRouterClient(() => "k", fetchFn).chat({ model: "m", messages: [], signal: new AbortController().signal });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body as string).reasoning).toBeUndefined();
  });

  it("throws with OpenRouter's error message on non-2xx", async () => {
    const client = new OpenRouterClient(() => "k", mockFetch(402, { error: { message: "Insufficient credits" } }));
    await expect(client.chat({ model: "m", messages: [], signal: new AbortController().signal })).rejects.toThrow(
      "OpenRouter 402: Insufficient credits",
    );
  });

  it("throws on an error body even with status 200", async () => {
    const client = new OpenRouterClient(() => "k", mockFetch(200, { error: { message: "Provider returned error" } }));
    await expect(client.chat({ model: "m", messages: [], signal: new AbortController().signal })).rejects.toThrow(
      "Provider returned error",
    );
  });

  it("throws when no key is set", async () => {
    const client = new OpenRouterClient(() => "", mockFetch(200, ok));
    await expect(client.chat({ model: "m", messages: [], signal: new AbortController().signal })).rejects.toThrow(/key/);
  });

  it("treats null content as empty text", async () => {
    const client = new OpenRouterClient(() => "k", mockFetch(200, { choices: [{ message: { content: null } }] }));
    const res = await client.chat({ model: "m", messages: [], signal: new AbortController().signal });
    expect(res.text).toBe("");
  });
});
