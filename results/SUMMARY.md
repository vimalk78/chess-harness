# Results summary

6 submitted games, grouped by player and opponent. CI rewrites this file from the results in this folder after each push to main (`npm run results -- --write`), so don't edit it by hand.

| Player | Opponent | Games | W-D-L | Moves | Accuracy | Avg loss (cp) | Blunders/game | Mistakes/game | Re-asks/game | Stopped | Back-and-forth/game | Longest quiet run | Cost/game |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Attacker + notes · kimi-k3.1-pro | Attacker + notes · gemini-4-hydrogen | 1 | 0-0-1 | 51 | – | – | – | – | 2.0 | 0 | 7.0 | 9 | $5.18 |
| Attacker + notes · gemini-4-hydrogen | Attacker + notes · kimi-k3.1-pro | 1 | 1-0-0 | 52 | – | – | – | – | 0.0 | 0 | 3.0 | 7 | $1.70 |
| Planner + notes · particle-1 (free) | Stockfish 1320 | 1 | 1-0-0 | 46 | 93.0% | 39 | 3.0 | 0.0 | 0.0 | 0 | 0.0 | 5 | $0.00 |
| Attacker + notes · particle-1 (free) | Stockfish 1320 | 1 | 1-0-0 | 22 | 91.9% | 46 | 1.0 | 1.0 | 0.0 | 0 | 0.0 | 2 | $0.00 |
| Raw (no harness) · particle-1 (free) | Stockfish 1320 | 1 | 0-0-1 | 29 | 86.0% | 68 | 1.0 | 3.0 | 0.0 | 0 | 2.0 | 9 | $0.00 |
| Attacker + notes · ernie-5.5-flash-preview (free) | Stockfish 1600 | 1 | 0-0-1 | 13 | 86.1% | 98 | 1.0 | 0.0 | 0.0 | 0 | 0.0 | 3 | $0.00 |
| Calculator (analysis board) · particle-1 (free) | Stockfish full | 1 | 0-0-1 | 22 | 91.8% | 53 | 1.0 | 1.0 | 0.0 | 0 | 2.0 | 6 | $0.00 |

Moves: own moves per game. Accuracy, avg loss, blunders and mistakes come from Stockfish's review (– when a result has none). Back-and-forth: a piece moving straight back to the square it came from. Longest quiet run: most own moves in a row without a pawn move or capture. Stopped: replies the loop guard cut off.
