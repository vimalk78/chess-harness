# Chess Agent Arena

**Is it the model, or the harness?** Pit two chess **agents** against each other, or play one yourself, and see whether "model + harness" beats "model alone".

An agent is a model plus a harness. Each turn the referee gives the agent the game so far and asks for a move. The harness is everything the agent does inside that turn. The referee only enforces the rules, and no chess engine picks or suggests moves.

**Try it:** https://vimalk78.github.io/chess-harness/

Everything runs in your browser. You bring an [OpenRouter](https://openrouter.ai/keys) key; it's sent only to openrouter.ai and is saved only if you tick "remember".

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests
npm run build    # static site in dist/, host anywhere
```

## Hosting

The live site is deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`. To host your own copy, fork the repo and enable Pages (Settings → Pages → Source: GitHub Actions), or put the output of `npm run build` on any static host: `dist/` uses relative paths, so it works at a domain root or under a sub-path. There is no server side; visitors' API keys stay in their own browsers.

## Free OpenRouter accounts

The app loads OpenRouter's live model list. "Show free models only" is on by default, and the default matchup uses two free NVIDIA models: a small one with the harness (`nvidia/nemotron-3.5-lightning:free`, 3B active parameters) against an 18x larger one without it (`nvidia/nemotron-3-ultra-550b-a55b:free`, 55B active). Google's free Gemma models are avoided as defaults because they're often rate-limited by their provider.

Free models are limited to **20 requests/minute** and **50 requests/day** (1000/day once you've bought $10 of credits). The app spaces calls out to stay under the per-minute limit and retries if it gets a 429 anyway. When the daily limit is reached, the game pauses with a message; Resume continues it the next day. The game is saved in your browser, so you can close the tab and reopen it later (see [Long games](#long-games)). Requests used today are shown under the key field.

A full game usually takes 80–200 requests, so on 50/day expect part of a game per day. Human vs LLM uses about half as many.

## Harnesses

A **harness** decides what the model sees each turn and what happens to its answer. Several presets come built in, others are shared by the community, and you can build your own in the browser, with no code:

| Preset | What the model gets each turn | What happens with its reply |
|---|---|---|
| **Raw** | "You are playing White. The game so far in PGN: … Reply with only your next move." No board, no legal moves. | Sent to the referee unchecked. A rejected move comes back as one bare line: "Your move X was rejected: … Try again." |
| **Harnessed** | A system prompt with a procedure (threats → opportunities → loose pieces → candidates → safety → `MOVE: <san>`), plus FEN, an ASCII board, the moves so far and the legal-move list. | Pre-checked against the rules, re-asked up to 2 times with the exact problem, and as a last resort a random legal move (noted in the log). |
| **Harnessed + tactical facts** | Everything in Harnessed, plus attacked/undefended pieces, every capture and every check, computed from the rules. | Same as Harnessed. |
| **Harnessed + notes** | Everything in Harnessed, plus memory: the model ends each reply with a short `NOTES:` block (plan, threats), and gets its own notes back next move. | Same as Harnessed. |
| **Facts as lists (no board, no FEN)** | The position in words: every piece and its square, what the opponent's last move newly attacks, material, game state, moves that would leave a piece hanging (borderline: one move ahead), and legal moves grouped by piece. | Same as Harnessed. |
| **Attacker (aggressive style)** | The same turn prompt as Harnessed + tactical facts, with a different system prompt: play for the initiative, forcing moves first (checks, captures, threats), attack the king, sacrifice only with a concrete follow-up, gambits welcome. | Same as Harnessed. |
| **Attacker + notes** | Attacker, plus notes between moves focused on the attack plan (target, next 1–2 moves, threats to watch), so an attack can be carried over several moves. | Same as Harnessed. |
| **Calculator (analysis board)** | Harnessed + tactical facts (plus material and game state), and an **analysis board**: before answering, the model can play out candidate lines (`ANALYZE: Nxe5 Nxe5 d4`) and gets the facts at the end of each, up to 4 rounds per move. The system prompt teaches engine-style thinking: forcing moves first, calculate the opponent's most dangerous replies, judge the ends of lines, blunder-check, then choose. | Same as Harnessed. Several calls per move. |

**Human** is also available on either side: you drag pieces on the board.

### The harnesses folder

Every harness that ships with the site is a JSON file in [`harnesses/`](harnesses/), in the same format the editor exports: the three presets at the top level, and **community** submissions in [`harnesses/community/`](harnesses/community/), which appear in the agent menu under *Community*. A test checks every file (valid harness, id matches the file name, only known variables), and it runs on every pull request.

**Submit yours:** in the harness editor, fill in *Author* and *Description* and click **Submit to community…**. GitHub opens with your file filled in, and a few clicks turn it into a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

### Build your own

Click **View / duplicate** on a preset (or **+ New harness**) to open the editor. You can change:

- **What the model sees each turn.** New harnesses open in the **builder**: tick what goes in the turn prompt (move list, FEN, a board, the piece list, legal moves, the tactical facts below) and edit each item's heading. The builder writes the turn prompt for you, in a fixed order. **Edit as text** switches to the full template for your own wording and order; **Use the builder** switches back, keeping the blocks your text uses.
- **System prompt** (optional): start from a style (Careful, Attacker, Solid, Minimal) and edit the text freely, or write your own.
- **Re-ask prompt**: sent after a failed pre-check.
- **Pre-check moves before submitting**: the harness checks the model's move with the rules and re-asks before the referee sees it, then either plays a random legal move or submits the last answer anyway.
- **Keep notes between moves**: the model has no memory between moves, so the harness can give it one. It saves the `NOTES:` block at the end of each reply and passes it back next move as `{{my_notes}}`. Each side only ever sees its own notes, and notes survive saving and resuming. *Add notes instructions to the prompts* sets this up in one click.
- **Analysis board** (off, or up to 1–8 rounds per move): the model can write `ANALYZE: <moves>` lines before answering. The harness plays each line (up to 6 lines per round, 10 moves per line) on a scratch board and replies with facts from the rules at the end of it: whether it's legal (and where it breaks), captures along the way, material, the side to move's captures and checks, what's attacked and undefended, checkmate or stalemate. No evaluation and no search of its own: the model chooses every line, how deep to go and what the result means. Each round is one more call.

In text mode, prompts are templates. Write a `{{variable}}` wherever you want game information to appear; it's filled in fresh every turn:

| Game | Context blocks (computed from the rules before each call) |
|---|---|
| `{{side}}` `{{opponent}}` `{{fen}}` `{{pgn}}` `{{move_number}}` `{{last_move}}` `{{my_notes}}` (your notes from last move) `{{errors}}` (referee rejections this turn) `{{problem}}` (re-ask only) | `{{board_ascii}}` `{{board_unicode}}` `{{pieces}}` `{{legal_moves}}` `{{legal_moves_by_piece}}` `{{last_move_threats}}` `{{attacks}}` `{{captures}}` `{{checks}}` `{{material}}` `{{game_state}}` `{{move_safety}}` (borderline: looks one move ahead) |

The editor's **Preview** tab shows the exact prompt the model would receive in the current position. Harnesses are saved in your browser; you can export/import them as JSON or **copy a share link** (the harness travels in the URL, nothing goes to a server).

Context blocks are facts, not advice: no engine, no evaluation, no search, no opening books or tablebases. The model never calls them; the harness computes them before each call. (Tools the model calls itself may come later.)

### Rules and transparency

- **The referee** (chess.js) is the only judge of legality, the same for both sides. Moves can be SAN (`Nf3`) or UCI (`g1f3`). Three rejected moves in one turn forfeits the game. A game is a draw after 300 half-moves.
- **No engine helps an agent.** Context blocks and the analysis board report facts from the rules only. The analysis board never looks ahead on its own: it plays exactly the lines the model writes, so any search is the model's. (Stockfish only plays as a declared opponent, and results record it as one.) Every analysis request and result is shown in the side panel and the transcript.
- API errors (bad key, no credit, rate limits) pause the game instead of counting against the agent; Resume replays the turn.
- Model output **streams live** into the side panels, reasoning included when OpenRouter returns it. Every prompt, reply, token count and cost is kept. The downloaded JSON log includes both sides' full harness configs.

### Long games

- **Saved as you go.** After every move the game is saved in your browser (IndexedDB), with every prompt and reasoning text. Reload or close the tab, and the page offers to **reopen** the unfinished game; press Resume to carry on.
- **Continue anywhere.** *Download log (JSON)* saves the whole game. *Load game…* opens it again, in any browser, with the same harnesses and models it started with. A PGN works too: the moves are loaded and the agents picked above play on.
- **Adjudicate.** The agents can't agree a draw, so a dead-drawn position would be played out to the 300 half-move limit. The *Adjudicate* menu ends the game as a draw or a win for either side; the PGN and log record it as adjudicated.
- **Transcript.** *Download transcript (.md)* writes the game as readable Markdown: the players and their harnesses, the PGN, then every turn with the prompt sent, the reasoning, the reply, re-asks, referee rulings, time taken and tokens used.

### Submitting results

When a game ends, **Submit result…** saves it to the project's [`results/`](results/) folder as a pull request: GitHub opens with the file filled in. The file has the PGN, how the game ended, each side's model, effort and harness (the full config for custom harnesses), and counts such as tokens, re-asks, referee rejections and random fallback moves. Your OpenRouter key, prompts and reasoning are not included. CI checks that every result is consistent (legal moves, an ending that matches the final position, known harnesses); results are still self-reported. See [results/README.md](results/README.md).

## Code-level agents

For anything a harness config can't express (several calls per move, voting, critique loops), write an agent in code: add a file to `src/agents/` that exports an `AgentDefinition`, then add it to `CODE_AGENTS` in `src/agents/registry.ts`.

```ts
// src/agents/vote.ts: ask 3 times with the Harnessed prompts, play the most common legal answer
import { HARNESSED_PRESET } from "../harness/presets";
import { renderPrompts } from "../harness/runner";
import { legalSan } from "./chessUtil";
import { extractMove } from "./parse";
import type { AgentDefinition, LogEntry } from "./types";

export const voteAgent: AgentDefinition = {
  id: "vote",
  label: "Majority vote ×3",
  description: "Harnessed prompts, sampled 3 times; the most common legal move wins.",
  needsModel: true,
  create(settings, { llm }) {
    return {
      async nextMove(game) {
        const { system, user } = renderPrompts(HARNESSED_PRESET, game);
        const messages = [
          { role: "system" as const, content: system },
          { role: "user" as const, content: user },
        ];
        const log: LogEntry[] = [{ kind: "prompt", text: user }];
        const replies = await Promise.all(
          [1, 2, 3].map(() => llm.chat({ model: settings.model, messages, reasoningEffort: settings.reasoningEffort, signal: game.signal })),
        );
        const votes = new Map<string, number>();
        for (const r of replies) {
          log.push({ kind: "response", text: r.text, usage: r.usage, reasoning: r.reasoning });
          const m = extractMove(r.text);
          const san = m && legalSan(game.fen, m);
          if (san) votes.set(san, (votes.get(san) ?? 0) + 1);
        }
        const best = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? game.legalMoves[0];
        log.push({ kind: "note", text: `Votes: ${JSON.stringify(Object.fromEntries(votes))}` });
        return { move: best, log };
      },
    };
  },
};
```

What `nextMove` receives (`src/agents/types.ts`):

```ts
interface GameView {
  history: string[];          // SAN moves so far
  fen: string;
  legalMoves: string[];       // SAN
  myColor: "w" | "b";
  previousAttempts: { move: string; error: string }[]; // moves the referee rejected this turn
  myNotes?: string;           // this side's notes from its previous move (log a { kind: "notes" } entry to keep new ones)
  signal: AbortSignal;        // pass to LLM calls so Pause/Stop can cancel them
  onStream?: (delta: { start?: boolean; content?: string; reasoning?: string }) => void; // live output for the UI
}
```

**Keeping it fair:** if your agent calls a chess engine, evaluates positions or uses an opening book, it's no longer testing the model. Say so if you share results.

## Layout

```
harnesses/    Built-in presets and community harnesses (JSON), bundled into the site
results/      Submitted game results (JSON), checked by CI
src/agents/   Agent interface, registry, Human agent, move parser
src/harness/  Harness config format, loading harnesses/, runner, template variables, context blocks, saving/sharing, submissions
src/game/     Referee (turn loop, legality, forfeits, pause, adjudication), PGN, saved games, transcripts, result files
src/llm/      OpenRouter client
src/ui/       React components and the useGame hook
```
