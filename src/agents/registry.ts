// Every agent a side can pick:
//   - harness presets (Raw, Harnessed, Harnessed + tactical facts), by preset id
//   - community harnesses from harnesses/community/, as "community:<id>"
//   - the user's saved harnesses, as "custom:<id>"
//   - code agents listed in CODE_AGENTS (Human, plus anything you add)
//   - Stockfish at a few strengths (ENGINE_AGENTS), as "stockfish:<elo>" or "stockfish:full"
// To add a code-level agent, write a file in this folder that exports an
// AgentDefinition and add it to CODE_AGENTS.

import type { HarnessConfig } from "../harness/config";
import { COMMUNITY, PRESETS } from "../harness/presets";
import { harnessDefinition } from "../harness/runner";
import { harnessStore } from "../harness/store";
import { ENGINE_AGENTS } from "./engine";
import { humanAgent } from "./human";
import type { AgentDefinition } from "./types";

export const CODE_AGENTS: AgentDefinition[] = [humanAgent];

export const customAgentId = (harnessId: string) => `custom:${harnessId}`;
export const communityAgentId = (harnessId: string) => `community:${harnessId}`;

/** The harness config behind an agent id, or null for code agents. */
export function harnessConfigFor(agentId: string): HarnessConfig | null {
  const preset = PRESETS.find((p) => p.id === agentId);
  if (preset) return preset;
  if (agentId.startsWith("custom:")) return harnessStore.get(agentId.slice("custom:".length)) ?? null;
  if (agentId.startsWith("community:")) return COMMUNITY.find((h) => h.id === agentId.slice("community:".length)) ?? null;
  return null;
}

/** Presets and community harnesses ship with the site: they can be viewed and duplicated, not edited. */
export function isLibraryHarness(agentId: string): boolean {
  return PRESETS.some((p) => p.id === agentId) || agentId.startsWith("community:");
}

export function getAgent(id: string): AgentDefinition {
  const config = harnessConfigFor(id);
  if (config) return harnessDefinition(config, id);
  const def = CODE_AGENTS.find((a) => a.id === id) ?? ENGINE_AGENTS.find((a) => a.id === id);
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
