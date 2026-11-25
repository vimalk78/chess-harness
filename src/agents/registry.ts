// Every agent shown in the dropdowns. To add your own harness, write a file in
// this folder that exports an AgentDefinition and add it to this list.

import { harnessedAgent } from "./harnessed";
import { humanAgent } from "./human";
import { rawAgent } from "./raw";
import type { AgentDefinition } from "./types";

export const AGENTS: AgentDefinition[] = [rawAgent, harnessedAgent, humanAgent];

export function getAgent(id: string): AgentDefinition {
  const def = AGENTS.find((a) => a.id === id);
  if (!def) throw new Error(`Unknown agent: ${id}`);
  return def;
}
