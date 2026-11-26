// Harnesses that ship with the site, read from the harnesses/ folder at the repo root:
//   harnesses/*.json            the built-in presets
//   harnesses/community/*.json  harnesses submitted by pull request (see CONTRIBUTING.md)
// Each file is one harness in the same JSON format the editor exports. The file name
// (without .json) is the harness id. src/harness/library.test.ts checks every file.

import { validateHarness, type HarnessConfig } from "./config";

// Files are read as text and parsed here, so one malformed file is skipped (and named)
// instead of breaking the whole site.
function load(files: Record<string, string>): HarnessConfig[] {
  const out: HarnessConfig[] = [];
  for (const [path, text] of Object.entries(files)) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error(`Skipping ${path}: not valid JSON (${e instanceof Error ? e.message : e})`);
      continue;
    }
    const v = validateHarness(data);
    const id = path.split("/").pop()!.replace(/\.json$/, "");
    if (!v.ok) console.error(`Skipping ${path}: ${v.error}`);
    else if (v.config.id !== id) console.error(`Skipping ${path}: its id is "${v.config.id}", expected "${id}".`);
    else out.push(v.config);
  }
  return out;
}

const builtIn = load(import.meta.glob<string>("../../harnesses/*.json", { eager: true, query: "?raw", import: "default" }));

function preset(id: string): HarnessConfig {
  const p = builtIn.find((h) => h.id === id);
  if (!p) throw new Error(`Missing preset harnesses/${id}.json`);
  return p;
}

export const RAW_PRESET = preset("raw");
export const HARNESSED_PRESET = preset("harnessed");
export const TACTICAL_PRESET = preset("harnessed-tactics");
export const NOTES_PRESET = preset("harnessed-notes");

/** Built-in presets, in menu order. */
export const PRESETS: HarnessConfig[] = [RAW_PRESET, HARNESSED_PRESET, TACTICAL_PRESET, NOTES_PRESET];

/** Community harnesses, sorted by name. */
export const COMMUNITY: HarnessConfig[] = load(
  import.meta.glob<string>("../../harnesses/community/*.json", { eager: true, query: "?raw", import: "default" }),
).sort((a, b) => a.name.localeCompare(b.name));

/** Every harness that ships with the site (read-only in the editor). */
export const LIBRARY: HarnessConfig[] = [...PRESETS, ...COMMUNITY];
