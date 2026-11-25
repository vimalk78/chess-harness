import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../llm/models";
import { FREE_MODEL_PREFERENCES, pickFreeModel, withFreeModels } from "./sides";

const m = (id: string, free = true): ModelInfo => ({ id, name: id, free, reasoning: false });
const prefs = { w: ["small:free"], b: ["big:free"] };
const models = [m("small:free"), m("big:free"), m("anthropic/claude-opus-5.5", false)];

describe("withFreeModels", () => {
  it("swaps saved paid models for preferred free ones, keeping agent and effort", () => {
    const saved = {
      w: { agentId: "raw", model: "anthropic/claude-haiku-5.5", effort: "low" as const },
      b: { agentId: "harnessed", model: "anthropic/claude-opus-5.5", effort: "" as const },
    };
    expect(withFreeModels(saved, models, prefs)).toEqual({
      w: { agentId: "raw", model: "small:free", effort: "low" },
      b: { agentId: "harnessed", model: "big:free", effort: "" },
    });
  });

  it("leaves free choices alone (same object)", () => {
    const saved = { w: { agentId: "harnessed", model: "big:free", effort: "" as const }, b: { agentId: "raw", model: "small:free", effort: "" as const } };
    expect(withFreeModels(saved, models, prefs)).toBe(saved);
  });
});

describe("pickFreeModel", () => {
  it("uses the preference list in order", () => {
    expect(pickFreeModel("w", [m("x:free"), m("b2:free"), m("b1:free")], { w: ["b1:free", "b2:free"], b: [] })).toBe("b1:free");
  });

  it("avoids Google-hosted free models when no preference is available", () => {
    expect(pickFreeModel("w", [m("google/gemma-4-26b-a4b-it:free"), m("baidu/ernie:free")], { w: [], b: [] })).toBe("baidu/ernie:free");
    expect(pickFreeModel("w", [m("google/gemma-4-26b-a4b-it:free")], { w: [], b: [] })).toBe("google/gemma-4-26b-a4b-it:free");
  });

  it("default preferences pair a small White model with a large Black one, and never Gemma", () => {
    expect(FREE_MODEL_PREFERENCES.w[0]).toBe("nvidia/nemotron-3.5-lightning:free");
    expect(FREE_MODEL_PREFERENCES.b[0]).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
    expect([...FREE_MODEL_PREFERENCES.w, ...FREE_MODEL_PREFERENCES.b].some((id) => id.startsWith("google/"))).toBe(false);
  });
});
