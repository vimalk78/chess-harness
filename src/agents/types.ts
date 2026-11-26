export type Color = "w" | "b";

export interface GameView {
  /** SAN moves from the start, e.g. ["e4", "e5", "Nf3"] */
  history: string[];
  /** Current position */
  fen: string;
  /** Legal moves in SAN */
  legalMoves: string[];
  myColor: Color;
  /** Moves rejected by the referee earlier in this same turn; empty on first try */
  previousAttempts: { move: string; error: string }[];
  /** This side's own notes from its previous move (see the "notes" log entry); never the opponent's. */
  myNotes?: string;
  /** Fires on pause/stop; agents must pass it to fetch */
  signal: AbortSignal;
  /** Live model output for the UI. Send { start: true } before each model call. */
  onStream?: (delta: StreamDelta) => void;
}

export interface StreamDelta {
  start?: boolean;
  content?: string;
  reasoning?: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  costUsd?: number;
}

export type LogEntry =
  | { kind: "prompt"; text: string }
  | { kind: "response"; text: string; usage?: Usage; reasoning?: string }
  | { kind: "note"; text: string }
  /** Notes the agent keeps for its next move. The referee hands the latest back as GameView.myNotes. */
  | { kind: "notes"; text: string };

export interface AgentResult {
  /** SAN or UCI */
  move: string;
  log: LogEntry[];
}

export interface Agent {
  nextMove(game: GameView): Promise<AgentResult>;
}

export type ReasoningEffort = "low" | "medium" | "high";

export interface AgentSettings {
  model: string;
  reasoningEffort?: ReasoningEffort;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  chat(req: {
    model: string;
    messages: ChatMessage[];
    reasoningEffort?: ReasoningEffort;
    signal: AbortSignal;
    /** Called with each streamed piece of reply or reasoning text. */
    onDelta?: (delta: { content?: string; reasoning?: string }) => void;
  }): Promise<{ text: string; usage?: Usage; reasoning?: string }>;
}

export interface AgentDeps {
  llm: LlmClient;
  /** Used only by the Human agent */
  waitForHumanMove: (game: GameView) => Promise<string>;
}

export interface AgentDefinition {
  id: string;
  label: string;
  /** One line shown under the dropdown */
  description: string;
  /** false for Human */
  needsModel: boolean;
  create(settings: AgentSettings, deps: AgentDeps): Agent;
}
