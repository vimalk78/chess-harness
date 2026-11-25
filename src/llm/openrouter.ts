import type { ChatMessage, LlmClient, ReasoningEffort, Usage } from "../agents/types";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 5 * 60 * 1000;

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

interface OpenRouterResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string };
}

/** Calls OpenRouter straight from the browser. The key never goes anywhere else. */
export class OpenRouterClient implements LlmClient {
  private readonly getKey: () => string;
  private readonly fetchFn: FetchFn;

  constructor(getKey: () => string, fetchFn: FetchFn = (u, i) => fetch(u, i)) {
    this.getKey = getKey;
    this.fetchFn = fetchFn;
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
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${data.error?.message ?? res.statusText}`);
    if (data.error) throw new Error(`OpenRouter: ${data.error.message ?? "unknown error"}`);

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
