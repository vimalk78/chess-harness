import type { Color } from "../agents/types";
import type { ModelInfo } from "../llm/models";
import type { SideConfig } from "./useGame";

/**
 * Replaces any paid or unknown model with a free one, preferring the side's default.
 * Used once the live model list loads, so settings saved from an earlier visit
 * (e.g. paid models) don't override the free filter.
 */
export function withFreeModels(
  sides: Record<Color, SideConfig>,
  models: ModelInfo[],
  defaults: Record<Color, SideConfig>,
): Record<Color, SideConfig> {
  const free = models.filter((m) => m.free);
  if (!free.length) return sides;
  const isFree = (id: string) => free.some((m) => m.id === id);
  const fix = (c: Color): SideConfig => {
    const side = sides[c];
    if (isFree(side.model.trim())) return side;
    const fallback = isFree(defaults[c].model) ? defaults[c].model : free[0].id;
    return { ...side, model: fallback };
  };
  const w = fix("w");
  const b = fix("b");
  return w === sides.w && b === sides.b ? sides : { w, b };
}
