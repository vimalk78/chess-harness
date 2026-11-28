import { describe, expect, it } from "vitest";
import { OpenRouterClient } from "./openrouter";
import { RateLimiter } from "./rateLimiter";

/** A text/event-stream response delivered in the given pieces (to test splits mid-line). */
function sse(pieces: string[]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(ctrl) {
        for (const p of pieces) ctrl.enqueue(enc.encode(p));
        ctrl.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}
const signal = () => new AbortController().signal;
const client = (res: () => Response) => new OpenRouterClient(() => "k", async () => res(), { freeLimiter: new RateLimiter(1000, 1) });
const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

describe("OpenRouter streaming", () => {
  it("assembles reasoning and content, forwards deltas, reads usage, ignores keep-alives", async () => {
    const body =
      ": OPENROUTER PROCESSING\n\n" +
      chunk({ choices: [{ delta: { reasoning: "Threats: " } }] }) +
      chunk({ choices: [{ delta: { reasoning: "none." } }] }) +
      ": OPENROUTER PROCESSING\n\n" +
      chunk({ choices: [{ delta: { content: "MOVE: " } }] }) +
      chunk({ choices: [{ delta: { content: "e4" } }] }) +
      chunk({ choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0 } }) +
      "data: [DONE]\n\n";
    // Split into awkward 7-byte pieces so events straddle reads.
    const pieces = body.match(/[\s\S]{1,7}/g)!;
    const deltas: unknown[] = [];
    const res = await client(() => sse(pieces)).chat({ model: "m", messages: [], signal: signal(), onDelta: (d) => deltas.push(d) });
    expect(res).toEqual({ text: "MOVE: e4", reasoning: "Threats: none.", usage: { promptTokens: 100, completionTokens: 20, costUsd: 0 } });
    expect(deltas).toEqual([{ reasoning: "Threats: " }, { reasoning: "none." }, { content: "MOVE: " }, { content: "e4" }]);
  });

  it("handles CRLF line endings and a stream that ends without [DONE]", async () => {
    const res = await client(() => sse([`data: ${JSON.stringify({ choices: [{ delta: { content: "Nf3" } }] })}\r\n\r\n`])).chat({
      model: "m",
      messages: [],
      signal: signal(),
    });
    expect(res).toEqual({ text: "Nf3" });
  });

  it("throws on an error chunk mid-stream, naming the model and provider", async () => {
    const body =
      chunk({ choices: [{ delta: { content: "MO" } }] }) +
      chunk({ error: { message: "Provider disconnected", metadata: { provider_name: "Nvidia" } }, choices: [{ finish_reason: "error" }] });
    await expect(client(() => sse([body])).chat({ model: "x/y:free", messages: [], signal: signal() })).rejects.toThrow(
      "OpenRouter (x/y:free): Provider disconnected [Nvidia]",
    );
  });

  it("requests streaming", async () => {
    let sent: Record<string, unknown> = {};
    const c = new OpenRouterClient(() => "k", async (_u, init) => {
      sent = JSON.parse(init.body as string);
      return sse(["data: [DONE]\n\n"]);
    });
    await c.chat({ model: "m", messages: [], signal: signal() });
    expect(sent.stream).toBe(true);
  });
});

describe("OpenRouter streaming: loop guard", () => {
  it("stops reading a reply that repeats itself and closes the stream", async () => {
    let cancelled = false;
    let sent = 0;
    const enc = new TextEncoder();
    const endless = new ReadableStream({
      pull(ctrl) {
        // A model stuck in a loop: never ends on its own.
        ctrl.enqueue(enc.encode(chunk({ choices: [{ delta: { reasoning: sent++ ? "Q? " : "Is Qxb2 safe? " } }] })));
      },
      cancel() {
        cancelled = true;
      },
    });
    const res = await client(() => new Response(endless, { status: 200, headers: { "content-type": "text/event-stream" } })).chat({
      model: "m",
      messages: [],
      signal: signal(),
    });
    expect(res.cutOff).toMatchObject({ reason: "loop" });
    expect(res.text).toBe("");
    expect(res.reasoning).toMatch(/^Is Qxb2 safe\? (Q\? )+/);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(1000);
  });
});
