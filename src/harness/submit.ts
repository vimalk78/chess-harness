// "Submit to the community": opens GitHub's new-file page with the harness filled in at
// harnesses/community/<id>.json. GitHub forks the repo for the contributor and opens a
// pull request; CI then validates the file (src/harness/library.test.ts).

import { validateHarness, type HarnessConfig } from "./config";
import { LIBRARY } from "./presets";

/** The repo submissions go to. Change this in a fork. */
export const REPO = "vimalk78/chess-harness";
export const COMMUNITY_DIR = "harnesses/community";

/** GitHub's new-file links stop working somewhere past ~8 KB; longer harnesses are uploaded as a file instead. */
export const MAX_LINK_LENGTH = 8000;

/** "My Harness: v2!" -> "my-harness-v2" */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "harness"
  );
}

export type Submission =
  | { ok: true; id: string; path: string; json: string; url: string; byUpload: boolean }
  | { ok: false; error: string };

/** Prepares a harness for submission: checks it, gives it an id from its name, and builds the GitHub link. */
export function prepareSubmission(config: HarnessConfig, library: HarnessConfig[] = LIBRARY): Submission {
  const v = validateHarness(config);
  if (!v.ok) return v;
  if (!v.config.author) return { ok: false, error: "Add your name or GitHub handle as Author before submitting." };
  if (!v.config.description?.trim()) {
    return { ok: false, error: "Add a description: one or two sentences on the idea behind this harness." };
  }
  const id = slugify(v.config.name);
  if (library.some((h) => h.id === id || h.name.toLowerCase() === v.config.name.toLowerCase())) {
    return { ok: false, error: `A harness named "${v.config.name}" is already on the site. Rename yours before submitting.` };
  }
  const json = JSON.stringify({ ...v.config, id }, null, 2) + "\n";
  const path = `${COMMUNITY_DIR}/${id}.json`;
  const link =
    `https://github.com/${REPO}/new/main/${COMMUNITY_DIR}` +
    `?filename=${encodeURIComponent(`${id}.json`)}&value=${encodeURIComponent(json)}`;
  if (link.length <= MAX_LINK_LENGTH) return { ok: true, id, path, json, url: link, byUpload: false };
  return { ok: true, id, path, json, url: `https://github.com/${REPO}/upload/main/${COMMUNITY_DIR}`, byUpload: true };
}
