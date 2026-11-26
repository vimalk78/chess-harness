// Keeps the current game in the browser's IndexedDB, so a reload or a closed tab doesn't
// lose it. IndexedDB rather than localStorage because reasoning text is large: one game
// can be several megabytes, past localStorage's ~5 MB limit. Failures are swallowed:
// saving is a convenience, and the downloadable log is always available.

import type { SavedGame } from "./savedGame";

const DB_NAME = "chess-agent-arena";
const STORE = "games";
const CURRENT = "current";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const available = () => typeof indexedDB !== "undefined";

export async function saveCurrentGame(game: SavedGame): Promise<void> {
  if (!available()) return;
  try {
    await run("readwrite", (s) => s.put(game, CURRENT));
  } catch (e) {
    console.warn("Couldn't save the game in this browser:", e);
  }
}

export async function loadCurrentGame(): Promise<SavedGame | null> {
  if (!available()) return null;
  try {
    return ((await run("readonly", (s) => s.get(CURRENT))) as SavedGame | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearCurrentGame(): Promise<void> {
  if (!available()) return;
  try {
    await run("readwrite", (s) => s.delete(CURRENT));
  } catch {
    /* nothing to clear */
  }
}
