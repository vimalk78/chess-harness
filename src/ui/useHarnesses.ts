import { useSyncExternalStore } from "react";
import { harnessStore } from "../harness/store";

/** The user's saved harnesses, re-rendering when they change. */
export function useHarnesses() {
  return useSyncExternalStore(harnessStore.subscribe, harnessStore.list);
}
