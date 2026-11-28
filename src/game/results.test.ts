// Checks every submitted result in results/ (runs on every pull request).
import { describe, expect, it } from "vitest";
import { LIBRARY } from "../harness/presets";
import { validateResultFile } from "./resultFile";

const files = import.meta.glob<string>("../../results/*.json", { eager: true, query: "?raw", import: "default" });

describe("results/", () => {
  it("has only .json results, their .md transcripts, a README and the summary", () => {
    const all = Object.keys(import.meta.glob("../../results/*", { query: "?raw" })).map((p) => p.split("/").pop()!);
    const isTranscript = (n: string) => n.endsWith(".md") && all.includes(n.replace(/\.md$/, ".json"));
    expect(all.filter((n) => n !== "README.md" && n !== "SUMMARY.md" && !n.endsWith(".json") && !isTranscript(n))).toEqual([]);
  });

  for (const [path, text] of Object.entries(files)) {
    const name = path.split("/").pop()!;
    it(name, () => {
      expect(name, "file name: lowercase letters, digits and dashes").toMatch(/^[a-z0-9-]+\.json$/);
      let data: unknown;
      expect(() => (data = JSON.parse(text)), "valid JSON").not.toThrow();
      const v = validateResultFile(data, LIBRARY);
      expect(v.ok ? "ok" : v.error).toBe("ok");
    });
  }
});
