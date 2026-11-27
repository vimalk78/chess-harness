# Results

Finished games submitted from the arena, one JSON file per game. On the site, finish a game and click **Submit result…**: GitHub opens with the file filled in, and a few clicks turn it into a pull request.

Each file has the PGN, how the game ended, and for each side the model, reasoning effort, harness (by id for presets and community harnesses; the full config for custom ones or presets changed since) and counts: requests, tokens, cost, pre-check re-asks, referee rejections, random fallback moves and empty replies. `arenaVersion` is the site's commit the game was played on. Prompts and reasoning aren't included (they run to megabytes); attach the transcript to the pull request if you want to share them.

Results are **self-reported**. CI (`src/game/results.test.ts`) checks that each file is consistent: the PGN is legal, the claimed ending matches the final position (checkmate, stalemate, repetition, …), and the harnesses exist. It can't check that the game was really played by the models named. Games ended by the person watching are marked `"termination": "adjudicated"`.
