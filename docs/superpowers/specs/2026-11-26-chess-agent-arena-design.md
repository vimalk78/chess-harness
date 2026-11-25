# Chess Agent Arena: design

Date: 2026-11-26
Status: draft, awaiting review

## Purpose

A single web page where two **agents** play chess against each other, or a person plays one of them, so users can see for themselves whether "model + harness" beats "model alone". An agent is a model plus a harness. Each turn it receives the game so far and returns its next move. The harness is whatever the agent does inside that turn, and that is the variable users get to compare.

The app proves nothing on its own; it lets users run the comparison with their own key and judge the result.

## Scope

In:
- LLM vs LLM and Human vs LLM, one game at a time, watched live.
- Three built-in agents: `Raw`, `Harnessed`, `Human`.
- Custom harnesses are added by writing a new agent file in `src/agents/` and registering it.
- OpenRouter as the only model provider: one key, any model by ID.
- Everything runs in the browser. There is no backend; the API key never leaves the user's browser except in calls to OpenRouter.

Out (possible later): match series and statistics, Stockfish analysis, direct Anthropic/OpenAI/Google providers, harness config editors, sandboxed user plugins, any backend.

## Stack

Vite + React + TypeScript, `chess.js` (rules), `react-chessboard` (board), Vitest (tests). Built as a static site that can be hosted anywhere.

## Core interface

```ts
// src/agents/types.ts
export type Color = "w" | "b";

export interface GameView {
  history: string[];          // SAN moves from the start, e.g. ["e4", "e5", "Nf3"]
  fen: string;                // current position
  legalMoves: string[];       // SAN
  myColor: Color;
  previousAttempts: { move: string; error: string }[]; // this turn's rejected moves, empty on first try
  signal: AbortSignal;        // fires on pause/stop; agents must pass it to fetch
}

export interface AgentResult {
  move: string;               // SAN or UCI
  log: LogEntry[];            // shown in that side's panel
}

export type LogEntry =
  | { kind: "prompt"; text: string }
  | { kind: "response"; text: string; usage?: Usage }
  | { kind: "note"; text: string };

export interface Usage { promptTokens: number; completionTokens: number; costUsd?: number }

export interface AgentSettings { model: string; reasoningEffort?: "low" | "medium" | "high" }

export interface AgentDefinition {
  id: string;                 // "raw" | "harnessed" | "human" | custom
  label: string;
  needsModel: boolean;        // false for Human
  create(settings: AgentSettings, deps: AgentDeps): Agent;
}

export interface Agent {
  nextMove(game: GameView): Promise<AgentResult>;
}

export interface AgentDeps {
  llm: LlmClient;             // see "Model client"
  waitForHumanMove: (game: GameView) => Promise<string>; // used only by Human
}
```

Agents are stateless between turns: everything they need is in `GameView`. The same model can therefore play both sides with different harnesses.

## Components

```
src/
  agents/
    types.ts         interfaces above
    registry.ts      list of AgentDefinitions shown in the dropdowns
    raw.ts           Raw agent
    harnessed.ts     Harnessed agent
    human.ts         Human agent
    parse.ts         extractMove(text): first SAN/UCI-shaped token, preferring a "MOVE:" line; never consults legal moves
  llm/
    openrouter.ts    LlmClient implementation (fetch to OpenRouter)
  game/
    referee.ts       runGame(): the turn loop, independent of the UI
    pgn.ts           build PGN with headers (agents, models, result)
  ui/
    App.tsx          layout + state
    SideConfig.tsx   agent dropdown, model ID, reasoning effort, for one side
    Board.tsx        react-chessboard wrapper; draggable only on a human turn
    MoveList.tsx
    AgentLog.tsx     prompts / responses / notes / running token + cost totals for one side
    KeyInput.tsx     OpenRouter key, "remember in this browser" checkbox
```

### Referee (`game/referee.ts`)

`runGame({ white, black, onEvent, signal, maxRetries = 3, maxPlies = 300 })`:

1. While the game is not over: build a `GameView` for the side to move and call `agent.nextMove`.
2. Accept the move if it parses as SAN or UCI (`^[a-h][1-8][a-h][1-8][qrbn]?$`) and is legal. Apply it and emit `move`.
3. Otherwise add `{move, error}` to `previousAttempts` and ask again. The error says what was wrong: "not a legal move in this position", "could not parse", or "empty response". After `maxRetries` rejected attempts in one turn, that side **forfeits**.
4. The game ends on checkmate, stalemate, threefold repetition, insufficient material or the 50-move rule (from chess.js), on a forfeit, when `maxPlies` is reached (adjudicated as a draw), or when the user stops it.
5. If `nextMove` throws (network or API error), the game **pauses** and shows the error with a Resume button. API errors are not counted as illegal attempts or forfeits.

Events emitted (consumed by the UI): `turnStart`, `log`, `illegalAttempt`, `move`, `paused`, `gameOver {result, reason}`.

The referee has no UI or network code, so it can be tested with fake agents.

### Model client (`llm/openrouter.ts`)

```ts
interface LlmClient {
  chat(req: { model: string; messages: {role: "system"|"user"|"assistant"; content: string}[];
              reasoningEffort?: "low"|"medium"|"high"; signal: AbortSignal })
    : Promise<{ text: string; usage?: Usage }>;
}
```

POST `https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer <key>`, `usage: { include: true }` (so the response reports cost), and `reasoning: { effort }` when set. There is no streaming in this version; each call returns once complete. Each call times out after 5 minutes. A non-2xx response throws an error that includes OpenRouter's error message.

### Built-in agents

**Raw**: the baseline. It gets the board each turn but no help.
- One user message: "You are playing chess as {White|Black}. The game so far in PGN: {pgn or '(no moves yet)'}. Reply with only your next move in standard algebraic notation."
- On a retry, append: "Your move {m} was rejected: {error}. Try again." This is the only feedback it gets, like Kaggle Game Arena's baseline.
- Move extraction: `extractMove(text)`, which takes the first move-shaped word without looking at legal moves, so the parser never quietly helps the baseline. The referee checks legality; Raw does not.

**Harnessed**: the example harness.
- System prompt: describes the output format and a short procedure: (1) list the opponent's threats after their last move, (2) list 2-3 candidate moves, (3) for each, check whether it leaves a piece undefended or allows mate, (4) end with `MOVE: <san>`.
- User message: the side to play, FEN, an ASCII board, history in PGN, and the full list of legal moves.
- It checks the move itself with chess.js before returning. If the move is illegal or can't be parsed, it re-asks up to 2 times, quoting the exact problem and the legal-move list. If those fail, it returns a random legal move and logs a note saying so (disclosed in the log, not hidden).
- No engine, no evaluation, no search: only rules-derived information. It is meant as a readable starting point for custom harnesses, not the strongest possible harness.

**Human**: calls `deps.waitForHumanMove(game)`, which resolves when the user drops a legal piece on the board. Promotion defaults to a queen. Illegal drops snap back and never reach the referee.

### Custom harnesses

To add one: create `src/agents/my-agent.ts` that exports an `AgentDefinition`, then add it to `registry.ts`. It can make any number of LLM calls, use chess.js, and log whatever it likes. The README documents this with a minimal example.

## UI behaviour

- **Setup:** an OpenRouter key field at the top, which is not stored unless "remember in this browser" is ticked; it then goes in localStorage. Two side cards, White and Black, each with an agent dropdown and a model ID text field with suggestions such as `anthropic/claude-haiku-5.5` and `anthropic/claude-opus-5.5`; any ID is allowed. Reasoning effort can be default, low, medium or high. The model fields are hidden for Human.
- **Controls:** Start, Pause/Resume, New game, Swap colours.
- **During the game:** the board in the middle, the move list below it, and an AgentLog panel on each side showing every prompt, response and note, with running totals of tokens and dollars. Illegal attempts are highlighted. A banner shows "White is thinking…" with elapsed time.
- **End:** the result and reason ("Black forfeits: 3 illegal moves", "Checkmate", and so on), plus "Copy PGN" and "Download log (JSON)".
- At least one side must be non-human; Start is disabled for Human vs Human.

## Error handling

| Situation | Behaviour |
|---|---|
| Missing key with an LLM agent selected | Start disabled, with a hint |
| 401 or 402 from OpenRouter | Pause with the message (bad key or no credit) |
| 429 or 5xx, or a timeout | Pause with the message and a Resume button |
| Unknown model ID | OpenRouter's error is shown and the game pauses |
| Illegal or unparseable move | Retried as a referee attempt; forfeit after `maxRetries` |
| User clicks Pause | Abort the in-flight request; Resume replays the turn |

## Testing

- `referee.test.ts`: scripted fake agents cover a scholar's-mate game ending in checkmate, an illegal move followed by a legal retry, forfeit after 3 illegal moves, a thrown error leading to a pause, the `maxPlies` draw, and UCI input being accepted.
- `parse.test.ts`: move extraction from noisy replies ("I'll play **Nf3**.", "MOVE: e4", "1... e5", UCI, nothing usable).
- `harnessed.test.ts` and `raw.test.ts`: a mock LlmClient checks the prompt contents (FEN and legal moves present in Harnessed, absent in Raw), the retry wording, and the random fallback.
- `openrouter.test.ts`: a mocked fetch checks headers, request body, usage and cost parsing, and how errors are mapped.
- Manual check: one real game per mode using a cheap model.
