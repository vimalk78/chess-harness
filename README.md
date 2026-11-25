# Chess Agent Arena

Pit two chess **agents** against each other, or play one yourself, and decide whether "model + harness" beats "model alone".

An agent is a model plus a harness. Each turn the referee gives the agent the game so far and asks for a move. The harness is everything the agent does inside that turn. The referee only enforces the rules, and no chess engine picks or suggests moves.

Everything runs in your browser. You bring an [OpenRouter](https://openrouter.ai/keys) key; it's sent only to openrouter.ai and is saved only if you tick "remember".

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests
npm run build    # static site in dist/, host anywhere
```

## Self-hosting with Tailscale Funnel

The build is a static site, so any static file server works. One way to publish it from your own machine:

```bash
npm run build
# serve dist/ on localhost (systemd user service shown; any static server works)
cat > ~/.config/systemd/user/chess-arena.service <<'UNIT'
[Service]
ExecStart=/usr/bin/python3 -m http.server 4173 --bind 127.0.0.1 --directory /path/to/chess-harness/dist
Restart=on-failure
[Install]
WantedBy=default.target
UNIT
systemctl --user enable --now chess-arena.service
tailscale funnel --bg 4173          # public https://<machine>.<tailnet>.ts.net/
```

To update the site, run `npm run build` again. To take it down, run `tailscale funnel --https=443 off`. Visitors' API keys stay in their own browsers; nothing secret is stored on the server.

## Free OpenRouter accounts

The app loads OpenRouter's live model list. "Show free models only" is on by default, and the default matchup uses two free models: a small one with the harness (`google/gemma-4-26b-a4b-it:free`) against a much larger one without it (`nvidia/nemotron-3-ultra-550b-a55b:free`).

Free models are limited to **20 requests/minute** and **50 requests/day** (1000/day once you've bought $10 of credits). The app spaces calls out to stay under the per-minute limit and retries if it gets a 429 anyway. When the daily limit is reached, the game pauses with a message; Resume continues it the next day (keep the tab open, or note the PGN). Requests used today are shown under the key field.

A full game usually takes 80–200 requests, so on 50/day expect part of a game per day. Human vs LLM uses about half as many.

## Built-in agents

| Agent | What the model gets each turn | What happens with its reply |
|---|---|---|
| **Raw** | "You are playing White. The game so far in PGN: … Reply with only your next move." No board, no legal moves. | The first move-shaped word is sent to the referee unchecked. A rejected move comes back as one bare line: "Your move X was rejected: … Try again." |
| **Harnessed** | System prompt with a procedure (threats → candidates → safety check → `MOVE: <san>`), plus FEN, an ASCII board, the move history and the full legal-move list. | Checks the move itself, re-asks up to 2 times quoting the exact problem, and as a last resort plays a random legal move (noted in the log). |
| **Harnessed + tactical facts** | Everything in Harnessed, plus a "Board facts" block computed from the rules each turn: which pieces are attacked and by what, which are undefended, every capture (and what it takes), every checking move. | Same as Harnessed. The facts use no evaluation, search or piece values; the model still decides what matters. |
| **Human** | – | You drag pieces on the board. |

Both LLM agents work with any OpenRouter model ID, and each side has its own model and reasoning-effort setting, so you can test the same model with and without a harness, or a cheap model with a harness against an expensive one without.

**Referee rules:** a move can be SAN (`Nf3`) or UCI (`g1f3`). Three rejected moves in one turn forfeits the game. API errors (bad key, no credit, rate limits) pause the game instead of counting against the agent, and Resume replays the turn. A game is a draw after 300 half-moves.

Every prompt, reply, token count and cost is shown in the side panels, along with the model's reasoning when OpenRouter returns it. You can copy the PGN or download the full log as JSON.

## Write your own harness

Add a file to `src/agents/` that exports an `AgentDefinition`, then add it to the list in `src/agents/registry.ts`. Your agent can make as many LLM calls as it likes and use `chess.js`; whatever it puts in `log` shows up in its panel.

```ts
// src/agents/vote.ts: ask 3 times, play the most common legal answer
import { legalSan } from "./chessUtil";
import { buildUserPrompt, SYSTEM_PROMPT } from "./harnessed";
import { extractMove } from "./parse";
import type { AgentDefinition, LogEntry } from "./types";

export const voteAgent: AgentDefinition = {
  id: "vote",
  label: "Majority vote ×3",
  description: "Harnessed prompt, sampled 3 times; the most common legal move wins.",
  needsModel: true,
  create(settings, { llm }) {
    return {
      async nextMove(game) {
        const messages = [
          { role: "system" as const, content: SYSTEM_PROMPT },
          { role: "user" as const, content: buildUserPrompt(game) },
        ];
        const log: LogEntry[] = [{ kind: "prompt", text: messages[1].content }];
        const replies = await Promise.all(
          [1, 2, 3].map(() => llm.chat({ model: settings.model, messages, reasoningEffort: settings.reasoningEffort, signal: game.signal })),
        );
        const votes = new Map<string, number>();
        for (const r of replies) {
          log.push({ kind: "response", text: r.text, usage: r.usage });
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
  signal: AbortSignal;        // pass to LLM calls so Pause/Stop can cancel them
}
```

**Keeping it fair:** if your harness calls a chess engine, evaluates positions or uses an opening book, it's no longer testing the model. Say so if you share results.

## Layout

```
src/agents/   Agent interface, built-in agents, move parser, registry
src/game/     Referee (turn loop, legality, forfeits, pause) and PGN
src/llm/      OpenRouter client
src/ui/       React components and the useGame hook
docs/         Design spec, plan, and background research
```
