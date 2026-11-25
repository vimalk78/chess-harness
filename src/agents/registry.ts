// Every agent a side can pick:
//   - harness presets (Raw, Harnessed, Harnessed + tactical facts), by preset id
//   - the user's saved harnesses, as "custom:<id>"
//   - code agents listed in CODE_AGENTS (Human, plus anything you add)
// To add a code-level agent, write a file in this folder that exports an
// AgentDefinition and add it to CODE_AGENTS.

import type { HarnessConfig } from "../harness/config";
import { PRESETS } from "../harness/presets";
import { harnessDefinition } from "../harness/runner";
import { harnessStore } from "../harness/store";
import { humanAgent } from "./human";
import type { AgentDefinition } from "./types";

export const CODE_AGENTS: AgentDefinition[] = [humanAgent];

export const customAgentId = (harnessId: string) => `custom:${harnessId}`;

/** The harness config behind an agent id, or null for code agents. */
export function harnessConfigFor(agentId: string): HarnessConfig | null {
  const preset = PRESETS.find((p) => p.id === agentId);
  if (preset) return preset;
  if (agentId.startsWith("custom:")) return harnessStore.get(agentId.slice("custom:".length)) ?? null;
  return null;
}

export function isPreset(agentId: string): boolean {
  return PRESETS.some((p) => p.id === agentId);
}

export function getAgent(id: string): AgentDefinition {
  const config = harnessConfigFor(id);
  if (config) return harnessDefinition(config, id);
  const def = CODE_AGENTS.find((a) => a.id === id);
  if (!def) throw new Error(`Unknown agent: ${id}`);
  return def;
}

export function agentExists(id: string): boolean {
  try {
    getAgent(id);
    return true;
  } catch {
    return false;
  }
}
