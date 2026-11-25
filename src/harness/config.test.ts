import { describe, expect, it } from "vitest";
import { validateHarness } from "./config";
import { PRESETS } from "./presets";

const good = { ...PRESETS[1], id: "x", name: "Mine" };

describe("validateHarness", () => {
  it("accepts every preset and a copy", () => {
    for (const p of PRESETS) expect(validateHarness(p).ok).toBe(true);
    expect(validateHarness(good)).toEqual({ ok: true, config: good });
  });

  it.each([
    [null, /JSON object/],
    [{ ...good, version: 2 }, /version/],
    [{ ...good, turnPrompt: "  " }, /turn prompt is empty/],
    [{ ...good, name: "" }, /needs a name/],
    [{ ...good, maxReasks: 9 }, /0 to 5/],
    [{ ...good, fallback: "forfeit" }, /fallback/],
    [{ ...good, precheck: "yes" }, /precheck/],
    [{ ...good, systemPrompt: "x".repeat(20_001) }, /longer than/],
  ])("rejects %#", (input, msg) => {
    const r = validateHarness(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });

  it("drops unknown fields", () => {
    const r = validateHarness({ ...good, evil: "<script>" });
    expect(r.ok && "evil" in r.config).toBe(false);
  });
});
