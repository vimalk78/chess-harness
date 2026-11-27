import { describe, expect, it } from "vitest";
import { BUILDER_ITEMS, DEFAULT_BUILDER, buildTurnPrompt, builderFromTemplate, defaultItem, validateBuilder } from "./builder";
import { validateHarness } from "./config";
import { ALL_VARIABLE_NAMES, CONTEXT_BLOCKS } from "./contextBlocks";
import { HARNESSED_PRESET, TACTICAL_PRESET } from "./presets";
import { renderPrompts } from "./runner";
import { STYLES, matchStyle, styleText } from "./styles";
import { templateVariables } from "./template";
import { NOTES_SYSTEM_INSTRUCTIONS } from "./notes";
import { Chess } from "chess.js";

const START = { history: [], fen: new Chess().fen(), legalMoves: new Chess().moves(), myColor: "w" as const, previousAttempts: [] };

describe("harness builder", () => {
  it("offers every context block, and only real variables", () => {
    for (const i of BUILDER_ITEMS) expect(ALL_VARIABLE_NAMES.has(i.name)).toBe(true);
    for (const b of CONTEXT_BLOCKS) expect(BUILDER_ITEMS.some((i) => i.name === b.name)).toBe(true);
  });

  it("builds the turn prompt in a fixed order, with headings, and errors at the end", () => {
    const prompt = buildTurnPrompt({ items: [defaultItem("legal_moves"), defaultItem("board_ascii"), defaultItem("side")] });
    expect(prompt).toBe(
      "You are playing {{side}}\n\nBoard (uppercase = White, lowercase = Black):\n{{board_ascii}}\n\nLegal moves: {{legal_moves}}{{errors}}",
    );
    expect(buildTurnPrompt({ items: [{ name: "fen", heading: "  " }] })).toBe("{{fen}}{{errors}}");
  });

  it("the default checklist shows what the Harnessed preset shows", () => {
    const used = (t: string) => templateVariables(t).filter((v) => v !== "errors").sort();
    expect(used(buildTurnPrompt(DEFAULT_BUILDER))).toEqual(used(HARNESSED_PRESET.turnPrompt));
    const rendered = renderPrompts({ ...HARNESSED_PRESET, turnPrompt: buildTurnPrompt(DEFAULT_BUILDER) }, START).user;
    expect(rendered).toContain("You are playing White");
    expect(rendered).not.toContain("{{");
  });

  it("picks up the blocks a hand-written prompt uses", () => {
    const spec = builderFromTemplate(templateVariables(TACTICAL_PRESET.turnPrompt));
    expect(spec.items.map((i) => i.name)).toEqual(["side", "pgn", "fen", "board_ascii", "attacks", "captures", "checks", "legal_moves"]);
  });

  it("validation rejects unknown items and drops a checklist that no longer matches the prompt", () => {
    expect(validateBuilder({ items: [{ name: "engine_eval", heading: "x" }] }).ok).toBe(false);
    const base = { ...HARNESSED_PRESET, builder: DEFAULT_BUILDER };
    const ok = validateHarness({ ...base, turnPrompt: buildTurnPrompt(DEFAULT_BUILDER) });
    expect(ok.ok && ok.config.builder?.items.length).toBe(5);
    const edited = validateHarness({ ...base, turnPrompt: "hand edited {{fen}}" });
    expect(edited.ok && edited.config.builder).toBeUndefined();
  });
});

describe("styles", () => {
  it("each style ends with the MOVE line and is recognised, with or without notes", () => {
    for (const s of STYLES) {
      expect(s.text).toMatch(/MOVE: <move in SAN/);
      expect(matchStyle(s.text)?.id).toBe(s.id);
      expect(matchStyle(styleText(s, true))?.id).toBe(s.id);
      expect(styleText(s, true)).toContain(NOTES_SYSTEM_INSTRUCTIONS);
    }
    expect(matchStyle(STYLES[0].text + " Also be brave.")).toBeUndefined();
  });
});
