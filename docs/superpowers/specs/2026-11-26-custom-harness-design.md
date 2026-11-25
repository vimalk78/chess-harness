# Custom harnesses: design

Date: 2026-11-26
Status: draft, awaiting review
Builds on: `2026-11-26-chess-agent-arena-design.md`

## Purpose

Let users build their own harness in the browser, with no code, and play it against other harnesses, against the same model unaided, or against themselves. A harness controls exactly what the model sees each turn and what happens to its answer. Users can see, change and share every part of it.

## Terms

- **Harness config**: a JSON object describing one harness (prompts, settings). The built-in Raw, Harnessed and Tactical agents become read-only **presets** of this format.
- **Harness runner**: the code that executes a harness config for one turn: it renders the prompts, calls the model, extracts the move, and optionally pre-checks it. (Not a chess engine; no chess engine is used anywhere.)
- **Context block**: a piece of information computed from the current position by the harness *before* the model call and inserted into the prompt through a `{{variable}}`. The model never invokes a context block.
- **Tool**: reserved for functions the model itself calls during its turn. Out of scope here (see "Later").
- **Referee**: unchanged. The one authority on legality for both players (chess.js). Every submitted move is checked by it; 3 rejected moves in one turn forfeit the game.

## Scope

In:
- Harness config format, harness runner, presets (Raw, Harnessed, Harnessed + tactical facts).
- Template variables: base variables plus context blocks (below).
- Harness editor with live prompt preview.
- Saving in the browser, JSON export/import, share links.
- Streaming of model output (reasoning and reply) into the side panels.

Out (later): tools called by the model (built-in or user-defined), multi-call strategies in configs (voting, critique loops), conditional template logic. Code-level agents (`src/agents/*.ts` + registry) remain for anything a config can't express.

## Harness config

```ts
interface HarnessConfig {
  version: 1;
  id: string;                 // presets: "raw" | "harnessed" | "harnessed-tactics"; user: random id
  name: string;               // shown in dropdowns, PGN headers, logs
  systemPrompt: string;       // "" = no system message
  turnPrompt: string;         // template, sent as the user message each turn
  reaskPrompt: string;        // template, sent after a failed pre-check; may use {{problem}}
  precheck: boolean;          // "Pre-check moves before submitting"
  maxReasks: number;          // 0-5, used only when precheck is on
  fallback: "random" | "submit"; // after re-asks run out: play a random legal move (logged)
                                 // or submit the last answer to the referee anyway
}
```

A context block is included **if and only if its variable appears in a template**. There is no separate on/off list, so the prompt text is the single source of truth.

Validation (on load, import, share link): `version === 1`, string fields present, `maxReasks` an integer 0-5, `fallback` one of the two values, each prompt at most 20,000 characters. Invalid configs are rejected with a message naming the problem.

## Template variables

Syntax: `{{name}}`, whitespace inside the braces allowed. No conditionals or loops. An unknown variable is left in the text unchanged and flagged in the editor.

**Base variables** (always cheap, always available):

| Variable | Value |
|---|---|
| `{{side}}` / `{{opponent}}` | `White` / `Black` |
| `{{fen}}` | Current FEN |
| `{{pgn}}` | Movetext so far (`1. e4 e5 2. Nf3`), or `(no moves yet)` |
| `{{move_number}}` | Full-move number |
| `{{last_move}}` | `Black played Nf6`, or `none` |
| `{{errors}}` | Referee rejections earlier this turn, each as a new line (prefixed with a line break, so it can follow a sentence): `Your move X was rejected: <reason>. Try again.` Empty when there are none |
| `{{problem}}` | Only in `reaskPrompt`: why the pre-check failed, e.g. `Ke3 is not legal in this position.` |

**Context blocks** (computed from the rules only; each has a label, description and fairness tag in a registry):

| Variable | Content | Fairness |
|---|---|---|
| `{{board_ascii}}` | chess.js ASCII grid, White at the bottom | rules |
| `{{board_unicode}}` | Same grid with ♔♕♖♗♘♙ / ♚♛♜♝♞♟ and `·` for empty squares | rules |
| `{{pieces}}` | `White: Kg1, Qd1, Ra1, … / Black: …` | rules |
| `{{legal_moves}}` | Comma-separated SAN list | rules |
| `{{legal_moves_by_piece}}` | One line per piece: `Knight f3: Ne5, Nd4, Ng5` | rules |
| `{{last_move_threats}}` | What the opponent's last-moved piece now attacks, and whether it gives check | rules |
| `{{attacks}}` | Attacked pieces of both sides with attackers and defenders; undefended ones flagged (existing `tactics.ts` logic) | rules |
| `{{captures}}` | `Nxd8 (takes queen), …` or `none` | rules |
| `{{checks}}` | Moves that give check, or `none` | rules |
| `{{material}}` | Piece counts per side (`White: 8 pawns, 2 knights, …`), no point values | rules |
| `{{game_state}}` | In check?, castling rights, en passant square, repetition count, half-move clock | rules |
| `{{move_safety}}` | For each legal move: does the moved piece land on a square the opponent attacks and you don't defend? | borderline (looks one move ahead) |

Excluded on principle: engine evaluations, search, opening books, endgame tablebases, piece-value scores.

## Presets

They reproduce today's built-in agents exactly. A parity test checks that each preset sends the same messages as the current code for the same position.

- **Raw**: no system prompt. Turn prompt: `You are playing chess as {{side}}. The game so far in PGN: {{pgn}}\nReply with only your next move in standard algebraic notation.{{errors}}` (each `{{errors}}` line starts with a newline). Pre-check off.
- **Harnessed**: today's `SYSTEM_PROMPT`. Turn prompt: side, `{{fen}}`, `{{board_ascii}}`, `{{pgn}}`, `{{legal_moves}}`. Re-ask: `{{problem}} Choose one move from this list and end with "MOVE: <san>": {{legal_moves}}`. Pre-check on, 2 re-asks, fallback random.
- **Harnessed + tactical facts**: Harnessed plus `{{attacks}}`, `{{captures}}` and `{{checks}}` in the turn prompt.

Preset ids stay `raw`, `harnessed` and `harnessed-tactics`, so sides saved in browsers keep working. Presets cannot be edited; "Duplicate" creates an editable copy.

## Harness runner

`createHarnessAgent(config, settings, deps): Agent`. Per turn:

1. Build the variable context from `GameView`. Compute only the context blocks whose variables appear in the templates.
2. Messages: optional system message plus the rendered turn prompt as the user message.
3. Call `llm.chat` with streaming; forward deltas to `game.onStream`.
4. Extract the move with the existing `extractMove` (prefers a `MOVE:` line, never looks at legal moves).
5. Pre-check off: return the extracted move, or the raw text if none was found. The referee judges it.
6. Pre-check on: if the move isn't legal (the same chess.js rules the referee uses), append the reply and the rendered `reaskPrompt`, then call again, up to `maxReasks` times. When re-asks run out: `random` returns a random legal move and logs a note; `submit` returns the last answer and lets the referee reject it.
7. Log every prompt, response (with reasoning and usage) and note, as today.

The pre-check is a harness feature: it saves rejected moves at the cost of extra model calls, every one of which is visible in the log. It cannot overrule the referee, which still checks every submitted move.

## Agent selection (wiring)

The side dropdown groups:
- **Presets**: Raw, Harnessed, Harnessed + tactical facts
- **My harnesses**: saved configs
- **Other**: Human, plus any code agents in the registry

Side settings keep `{ agentId, model, effort }`. `agentId` is a preset id, `custom:<id>` for a saved config, or a registry id.

## Editor

Opened from a side card ("Edit" on a custom harness, "Duplicate" on a preset, or "New harness" in the dropdown). It's a panel with:
- Name, system prompt, turn prompt, re-ask prompt (monospace textareas).
- The variable list: each base variable and context block with its description and fairness tag, and an Insert button that adds it at the cursor of the last-focused prompt. Variables used in the prompts are marked as used.
- Settings: pre-check toggle, re-asks (0-5), fallback.
- **Live preview**: the exact system and user messages the model would receive in the current game position (or the start position), for the side being edited, with a character count and a rough token estimate (characters / 4). Unknown variables are highlighted.
- Buttons: Save, Save as copy, Delete, Export JSON, Import JSON, Copy share link.

The editor is disabled during a game; harness changes apply from the next game.

## Storage and sharing

- Saved configs: localStorage `arena.harnesses` (an array), validated on load. Invalid entries are dropped with a console warning.
- Export: downloads `<name>.harness.json`. Import: file picker, validate, save as a new config (new id if it would collide).
- Share link: `<site>#harness=<base64url(JSON)>`. On load, the app validates it and shows a banner: "Shared harness '<name>': Add to my harnesses / Dismiss". Nothing is added without a click. The hash is cleared after the choice. Works on GitHub Pages because nothing goes to a server.

## Streaming

`OpenRouterClient.chat` sends `stream: true` and parses server-sent events from the response body:
- `data: {json}` lines carry `choices[0].delta.content` and `choices[0].delta.reasoning`, accumulated into the final text and reasoning.
- Lines starting with `:` (keep-alive comments) are ignored. `data: [DONE]` ends the stream.
- The final chunk carries `usage` (with `usage: { include: true }`), parsed as today.
- A chunk with an `error` field throws, with the same message formatting as non-streamed errors.
- Non-200 responses arrive as JSON before any stream and go through the existing 429/402 handling.
- Events may be split across network reads. The parser buffers until it has a full line.

`LlmClient.chat` gets an optional `onDelta({ content?, reasoning? })`. `GameView` gets an optional `onStream(delta)`, which the referee wires to a new `onStream(color, delta)` option. The UI shows a live entry at the bottom of that side's panel (reasoning, then reply), throttled to one render per animation frame, and replaced by the final log entry when the turn's log arrives.

The 20-minute timeout applies to the whole call. Pause aborts the stream as it aborts a call today.

## Fairness record

The PGN `White`/`Black` headers use the harness name and model. The JSON log download includes both sides' full harness configs.

## Error handling

| Situation | Behaviour |
|---|---|
| Unknown `{{variable}}` | Left as-is in the prompt; highlighted in editor preview |
| Invalid import or share link | Message naming the problem; nothing saved |
| Turn prompt renders empty | Save is blocked ("Turn prompt is empty") |
| Stream error chunk / dropped connection | Same as today's call errors: game pauses with the message, Resume replays the turn |
| localStorage full | Save fails with a message; existing harnesses untouched |

## Testing

- `template.test.ts`: substitution, whitespace in braces, unknown variables left as-is, repeated variables.
- `contextBlocks.test.ts`: each block on fixed positions, including the fork position from the real game, a check position, castling and en passant, and the start position.
- `runner.test.ts`: pre-check off passes text through; pre-check on re-asks with `{{problem}}`; random fallback logs a note; submit fallback returns the illegal move; `{{errors}}` carries referee rejections; only referenced blocks are computed; stream deltas are forwarded.
- `presets.test.ts`: parity with today's Raw and Harnessed prompts.
- `harnessStore.test.ts`: validation, save/load, import collision, share-link encode/decode round trip, oversized and malformed input.
- `openrouter.test.ts` (streaming): chunked SSE split mid-line, keep-alive comments, `[DONE]`, usage in the final chunk, reasoning deltas, mid-stream error chunk, 429 before the stream.
- Browser check (Playwright, OpenRouter mocked): create a harness from a preset, insert variables, check the preview, save, pick it for a side, play a few moves with streamed output visible, copy a share link and open it in a new page to see the import banner.

## Later

Tools the model calls itself (function calling): built-in ones mirroring the context blocks, then user-defined ones. These come with their own call budget per move, since each tool round trip is another model call.
