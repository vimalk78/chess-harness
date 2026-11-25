import type { AgentDefinition } from "./types";

export const humanAgent: AgentDefinition = {
  id: "human",
  label: "Human",
  description: "You move by dragging pieces on the board.",
  needsModel: false,
  create(_settings, { waitForHumanMove }) {
    return {
      async nextMove(game) {
        return { move: await waitForHumanMove(game), log: [] };
      },
    };
  },
};
