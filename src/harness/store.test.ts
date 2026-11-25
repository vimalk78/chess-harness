import { describe, expect, it } from "vitest";
import { HARNESSED_PRESET } from "./presets";
import { createHarnessStore, decodeShare, encodeShare, parseHarnessJson, readShareFromHash, exportHarnessJson } from "./store";

function memory(initial?: string) {
  const data = new Map<string, string>(initial ? [["arena.harnesses", initial]] : []);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}
const mine = { ...HARNESSED_PRESET, id: "abc", name: "Mine ♞" };

describe("harness store", () => {
  it("saves, updates, lists, removes and notifies", () => {
    const kv = memory();
    const store = createHarnessStore(kv);
    let calls = 0;
    store.subscribe(() => calls++);
    expect(store.save(mine).ok).toBe(true);
    expect(store.save({ ...mine, name: "Renamed" }).ok).toBe(true);
    expect(store.list().map((h) => h.name)).toEqual(["Renamed"]);
    expect(createHarnessStore(kv).get("abc")?.name).toBe("Renamed"); // persisted
    store.remove("abc");
    expect(store.list()).toEqual([]);
    expect(calls).toBe(3);
  });

  it("refuses invalid configs", () => {
    const store = createHarnessStore(memory());
    expect(store.save({ ...mine, turnPrompt: "" })).toMatchObject({ ok: false });
    expect(store.list()).toEqual([]);
  });

  it("drops invalid entries on load and survives junk", () => {
    expect(createHarnessStore(memory(JSON.stringify([mine, { version: 9 }]))).list()).toHaveLength(1);
    expect(createHarnessStore(memory("not json")).list()).toEqual([]);
  });

  it("addCopy gives a fresh id that never collides with presets", () => {
    const store = createHarnessStore(memory());
    const v = store.addCopy(HARNESSED_PRESET, "Copy of Harnessed");
    expect(v.ok && v.config.id).not.toBe("harnessed");
    expect(store.list()[0].name).toBe("Copy of Harnessed");
  });
});

describe("import, export, share links", () => {
  it("JSON export round-trips; bad JSON is reported", () => {
    expect(parseHarnessJson(exportHarnessJson(mine))).toEqual({ ok: true, config: mine });
    expect(parseHarnessJson("{oops")).toEqual({ ok: false, error: "That file isn't valid JSON." });
  });

  it("share links round-trip, including non-ASCII text", () => {
    const encoded = encodeShare(mine);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeShare(encoded)).toEqual({ ok: true, config: mine });
    expect(readShareFromHash(`#harness=${encoded}`)).toEqual({ ok: true, config: mine });
    expect(readShareFromHash("#other")).toBeNull();
  });

  it("damaged links are reported", () => {
    expect(decodeShare("!!!")).toMatchObject({ ok: false, error: expect.stringMatching(/damaged/) });
    expect(decodeShare(encodeShare(mine).slice(0, 20))).toMatchObject({ ok: false });
  });
});
