import type { Color } from "../agents/types";
import { isOftenRateLimited, type ModelInfo } from "../llm/models";
import type { SideConfig } from "./useGame";

/**
 * Free models to fall back to, best first. Default matchup: a small model with the
 * harness (White) against a much larger one from the same family without it (Black).
 * Google AI Studio's free Gemma endpoints are left out: they're often rate-limited upstream.
 */
export const FREE_MODEL_PREFERENCES: Record<Color, string[]> = {
  w: ["nvidia/nemotron-3.5-lightning:free", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "inclusionai/ling-3.2-flash:free"],
  b: ["nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3.5-super-vl:free", "baidu/ernie-5.5-flash-preview:free"],
};

/** First available free model for a side: the preference list, then any free model not known to be throttled. */
export function pickFreeModel(color: Color, free: ModelInfo[], preferences = FREE_MODEL_PREFERENCES): string | null {
  const ids = new Set(free.map((m) => m.id));
  return (
    preferences[color].find((id) => ids.has(id)) ??
    free.find((m) => !isOftenRateLimited(m.id))?.id ??
    free[0]?.id ??
    null
  );
}

/**
 * Replaces any paid or unknown model with a free one (see pickFreeModel).
 * Used once the live model list loads, so settings saved from an earlier visit
 * (e.g. paid models) don't override the free filter.
 */
export function withFreeModels(
  sides: Record<Color, SideConfig>,
  models: ModelInfo[],
  preferences = FREE_MODEL_PREFERENCES,
): Record<Color, SideConfig> {
  const free = models.filter((m) => m.free);
  if (!free.length) return sides;
  const fix = (c: Color): SideConfig => {
    const side = sides[c];
    if (free.some((m) => m.id === side.model.trim())) return side;
    const pick = pickFreeModel(c, free, preferences);
    return pick ? { ...side, model: pick } : side;
  };
  const w = fix("w");
  const b = fix("b");
  return w === sides.w && b === sides.b ? sides : { w, b };
}
