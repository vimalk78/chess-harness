// Live model list from OpenRouter's public catalogue (no key needed).

export interface ModelInfo {
  id: string;
  name: string;
  free: boolean;
  reasoning: boolean;
}

interface RawModel {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { output_modalities?: string[] };
  supported_parameters?: string[];
}

const MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Chat-capable text models, free ones first, then by name. */
export function parseModels(json: unknown): ModelInfo[] {
  const data = (json as { data?: RawModel[] })?.data ?? [];
  return data
    .filter((m) => {
      const out = m.architecture?.output_modalities;
      if (out && (out.length !== 1 || out[0] !== "text")) return false; // music/image generators
      // "openrouter/free" routes each call to a random free model, so the two sides
      // wouldn't be comparable from one move to the next.
      return m.id !== "openrouter/free";
    })
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      free: m.id.endsWith(":free") || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0),
      reasoning: m.supported_parameters?.includes("reasoning") ?? false,
    }))
    .sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
}

export async function fetchModels(fetchFn: typeof fetch = fetch): Promise<ModelInfo[]> {
  const res = await fetchFn(MODELS_URL);
  if (!res.ok) throw new Error(`Could not load models (${res.status})`);
  return parseModels(await res.json());
}

export interface FreeQuota {
  used: number;
  limit: number;
  remaining: number;
}

/** Today's free-model request usage for this key (UTC day), if OpenRouter reports it. */
export async function fetchFreeQuota(key: string, fetchFn: typeof fetch = fetch): Promise<FreeQuota | null> {
  const res = await fetchFn("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(res.status === 401 ? "Key not recognised by OpenRouter" : `Key check failed (${res.status})`);
  const json = (await res.json()) as { data?: Record<string, unknown> } & Record<string, unknown>;
  const q = (json.data ?? json).free_model_daily_requests as Partial<FreeQuota> | undefined;
  if (!q || typeof q.limit !== "number") return null;
  const used = q.used ?? (q.remaining !== undefined ? q.limit - q.remaining : 0);
  return { used, limit: q.limit, remaining: q.remaining ?? q.limit - used };
}
