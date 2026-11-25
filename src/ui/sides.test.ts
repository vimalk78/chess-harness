import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../llm/models";
import { withFreeModels } from "./sides";

const m = (id: string, free: boolean): ModelInfo => ({ id, name: id, free, reasoning: false });
const models = [m("small:free", true), m("big:free", true), m("anthropic/claude-opus-5.5", false)];
const defaults = {
  w: { agentId: "harnessed", model: "small:free", effort: "" as const },
  b: { agentId: "raw", model: "big:free", effort: "" as const },
};

describe("withFreeModels", () => {
  it("swaps saved paid models for the free defaults, keeping agent and effort", () => {
    const saved = {
      w: { agentId: "raw", model: "anthropic/claude-haiku-5.5", effort: "low" as const },
      b: { agentId: "harnessed", model: "anthropic/claude-opus-5.5", effort: "" as const },
    };
    expect(withFreeModels(saved, models, defaults)).toEqual({
      w: { agentId: "raw", model: "small:free", effort: "low" },
      b: { agentId: "harnessed", model: "big:free", effort: "" },
    });
  });

  it("leaves free choices alone (same object)", () => {
    const saved = { w: { ...defaults.w, model: "big:free" }, b: defaults.b };
    expect(withFreeModels(saved, models, defaults)).toBe(saved);
  });

  it("falls back to the first free model if a default disappeared", () => {
    const out = withFreeModels(
      { w: { ...defaults.w, model: "gone" }, b: defaults.b },
      [m("other:free", true), m("big:free", true)],
      defaults,
    );
    expect(out.w.model).toBe("other:free");
  });
});
