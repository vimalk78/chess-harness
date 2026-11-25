// User harnesses: saved in the browser, exported/imported as JSON, shared as links.

import { validateHarness, type HarnessConfig, type Validation } from "./config";
import { PRESETS } from "./presets";

const STORAGE_KEY = "arena.harnesses";
type KV = Pick<Storage, "getItem" | "setItem">;

export function newHarnessId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createHarnessStore(storage: KV | null) {
  let items: HarnessConfig[] = [];
  const listeners = new Set<() => void>();

  try {
    const raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
    for (const entry of Array.isArray(raw) ? raw : []) {
      const v = validateHarness(entry);
      if (v.ok) items.push(v.config);
      else console.warn("Dropping invalid saved harness:", v.error);
    }
  } catch {
    console.warn("Saved harnesses were unreadable; starting empty.");
  }

  const persist = (next: HarnessConfig[]) => {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next)); // throws if storage is full; caller shows it
    items = next;
    listeners.forEach((l) => l());
  };
  const taken = (id: string) => items.some((h) => h.id === id) || PRESETS.some((p) => p.id === id);

  return {
    list: (): HarnessConfig[] => items,
    get: (id: string) => items.find((h) => h.id === id),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Insert or update by id. Validates first. */
    save(config: HarnessConfig): Validation {
      const v = validateHarness(config);
      if (!v.ok) return v;
      const exists = items.some((h) => h.id === config.id);
      persist(exists ? items.map((h) => (h.id === config.id ? v.config : h)) : [...items, v.config]);
      return v;
    },
    remove(id: string) {
      persist(items.filter((h) => h.id !== id));
    },
    /** Saves a copy under a fresh id (used for presets, imports and share links). */
    addCopy(config: HarnessConfig, name = config.name): Validation {
      let id = newHarnessId();
      while (taken(id)) id = newHarnessId();
      return this.save({ ...config, id, name });
    },
  };
}

export type HarnessStore = ReturnType<typeof createHarnessStore>;

export const harnessStore = createHarnessStore(typeof localStorage === "undefined" ? null : localStorage);

export function exportHarnessJson(config: HarnessConfig): string {
  return JSON.stringify(config, null, 2);
}

export function parseHarnessJson(text: string): Validation {
  try {
    return validateHarness(JSON.parse(text));
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
}

// Share links: the config travels in the URL hash, so no server is involved.
export function encodeShare(config: HarnessConfig): string {
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(encoded: string): Validation {
  try {
    const bin = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return validateHarness(JSON.parse(json));
  } catch {
    return { ok: false, error: "This share link is damaged or incomplete." };
  }
}

export function shareUrl(config: HarnessConfig, base = location.href): string {
  const url = new URL(base);
  url.hash = `harness=${encodeShare(config)}`;
  return url.toString();
}

export function readShareFromHash(hash: string): Validation | null {
  const m = /^#harness=(.+)$/.exec(hash);
  return m ? decodeShare(m[1]) : null;
}
