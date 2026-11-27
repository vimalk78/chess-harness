// Checks every harness file in harnesses/ (presets and community submissions).
// CI runs this on every pull request, so a broken submission can't be merged unnoticed.

import { describe, expect, it } from "vitest";
import { validateHarness } from "./config";
import { ALL_VARIABLE_NAMES } from "./contextBlocks";
import { COMMUNITY, PRESETS } from "./presets";
import { templateVariables } from "./template";

// Raw file contents, read by Vite, so a file that isn't valid JSON is reported rather than skipped.
const raw = {
  ...import.meta.glob<string>("../../harnesses/*", { eager: true, query: "?raw", import: "default" }),
  ...import.meta.glob<string>("../../harnesses/community/*", { eager: true, query: "?raw", import: "default" }),
};
const KNOWN_KEYS = new Set(["version", "id", "name", "description", "author", "systemPrompt", "turnPrompt", "reaskPrompt", "precheck", "maxReasks", "fallback", "keepNotes", "notesMaxChars", "builder"]);

const files = Object.entries(raw)
  .filter(([p]) => p.endsWith(".json"))
  .map(([p, text]) => ({
    path: p.replace("../../", ""),
    id: p.split("/").pop()!.replace(/\.json$/, ""),
    community: p.includes("/community/"),
    text,
  }));

describe("harnesses/ folder", () => {
  it("has the built-in presets", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["raw", "harnessed", "harnessed-tactics", "harnessed-notes", "facts-as-lists", "attacker", "attacker-notes"]);
  });

  it("has only .json harness files in community/ (plus its README)", () => {
    const other = Object.keys(raw)
      .filter((p) => p.includes("/community/"))
      .map((p) => p.split("/").pop()!)
      .filter((f) => !f.endsWith(".json") && f !== "README.md");
    expect(other).toEqual([]);
  });

  for (const file of files) {
    describe(file.path, () => {
      let data: Record<string, unknown> = {};
      it("is valid JSON", () => {
        data = JSON.parse(file.text);
      });

      it("is a valid harness whose id matches the file name", () => {
        const v = validateHarness(data);
        expect(v.ok ? "ok" : v.error).toBe("ok");
        expect(data.id).toBe(file.id);
        expect(file.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      });

      it("has no unknown fields", () => {
        expect(Object.keys(data).filter((k) => !KNOWN_KEYS.has(k))).toEqual([]);
      });

      it("uses only known {{variables}}", () => {
        const used = [data.systemPrompt, data.turnPrompt, data.reaskPrompt].flatMap((t) => templateVariables(String(t ?? "")));
        expect(used.filter((v) => !ALL_VARIABLE_NAMES.has(v))).toEqual([]);
      });

      if (file.community) {
        it("credits an author and explains the idea", () => {
          expect(String(data.author ?? "").trim()).not.toBe("");
          expect(String(data.description ?? "").trim().length).toBeGreaterThanOrEqual(20);
        });
      }
    });
  }

  it("has unique ids and names", () => {
    const parsed = files.map((f) => JSON.parse(f.text) as { id: string; name: string });
    const dup = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
    expect(dup(parsed.map((h) => h.id))).toEqual([]);
    expect(dup(parsed.map((h) => h.name.trim().toLowerCase()))).toEqual([]);
  });

  it("loads every community file into the app", () => {
    expect(COMMUNITY).toHaveLength(files.filter((f) => f.community).length);
  });
});
