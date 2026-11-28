# Results

Finished games submitted from the arena, one JSON file per game. On the site, finish a game and click **Submit result…**: GitHub opens with the file filled in, and a few clicks turn it into a pull request.

Each file has the PGN, how the game ended, and for each side (an LLM harness, a human, or Stockfish with its Elo setting: `"kind": "engine"`) the model, reasoning effort, harness (by id for presets and community harnesses; the full config for custom ones or presets changed since) and counts: requests, tokens, cost, pre-check re-asks, referee rejections, random fallback moves and empty replies. `arenaVersion` is the site's commit the game was played on.

`moves` has one entry per half-move: thinking time, calls, tokens, cost, reasoning length, re-asks, rejected moves, analysis rounds, the visible reply and the notes kept (both trimmed). When the game was reviewed before submitting, each move also has Stockfish's verdict: the evaluation after it (centipawns from White's side), the best move, the loss, and `class` (inaccuracy, mistake or blunder, judged by the drop in winning chances as on Lichess). `review` has each side's accuracy, average loss and error counts.

Prompts and reasoning run to megabytes, so they're not in the JSON. A result can come with its transcript, `<same name>.md`: every prompt, reasoning text and reply.

Results are **self-reported**. CI (`src/game/results.test.ts`) checks that each file is consistent: the PGN is legal, the claimed ending matches the final position (checkmate, stalemate, repetition, …), and the harnesses exist. It can't check that the game was really played by the models named. Games ended by the person watching are marked `"termination": "adjudicated"`.

[SUMMARY.md](SUMMARY.md) compares the results; CI rewrites it after every push to main. To see the same table locally, run `npm run results`: a table per player (harness and model, or Stockfish level) and opponent, with wins, draws and losses, Stockfish's accuracy and average loss, blunders, re-asks, stopped replies, cost, and two signs of aimless play (pieces moving straight back to where they came from, and the longest run of moves without a pawn move or capture). `npm run results -- --engines` adds Stockfish's own rows.
