import { describe, expect, it } from "vitest";
import { HARNESSED_PRESET, PRESETS } from "./presets";
import { MAX_LINK_LENGTH, prepareSubmission, REPO, slugify } from "./submit";

const mine = { ...HARNESSED_PRESET, id: "h-123", name: "Board First", description: "Shows the board before anything else.", author: "someone" };

describe("slugify", () => {
  it("makes a file-safe id", () => {
    expect(slugify("My Harness: v2!")).toBe("my-harness-v2");
    expect(slugify("Café  tactics")).toBe("cafe-tactics");
    expect(slugify("!!!")).toBe("harness");
  });
});

describe("prepareSubmission", () => {
  it("builds a GitHub new-file link with the harness filled in", () => {
    const s = prepareSubmission(mine, PRESETS);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.id).toBe("board-first");
    expect(s.path).toBe("harnesses/community/board-first.json");
    expect(JSON.parse(s.json)).toMatchObject({ id: "board-first", author: "someone" });
    expect(s.byUpload).toBe(false);
    const url = new URL(s.url);
    expect(url.pathname).toBe(`/${REPO}/new/main/harnesses/community`);
    expect(url.searchParams.get("filename")).toBe("board-first.json");
    expect(url.searchParams.get("value")).toBe(s.json);
  });

  it("falls back to the upload page for long harnesses", () => {
    const s = prepareSubmission({ ...mine, systemPrompt: "x".repeat(MAX_LINK_LENGTH) }, PRESETS);
    expect(s.ok && s.byUpload).toBe(true);
    expect(s.ok && s.url).toBe(`https://github.com/${REPO}/upload/main/harnesses/community`);
  });

  it("requires an author and a description", () => {
    expect(prepareSubmission({ ...mine, author: undefined }, PRESETS)).toMatchObject({ ok: false, error: expect.stringMatching(/Author/) });
    expect(prepareSubmission({ ...mine, description: "" }, PRESETS)).toMatchObject({ ok: false, error: expect.stringMatching(/description/) });
  });

  it("refuses a name that's already on the site", () => {
    expect(prepareSubmission({ ...mine, name: "Harnessed (example harness)" }, PRESETS)).toMatchObject({ ok: false });
  });
});
