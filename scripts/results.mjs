// Prints a summary of results/*.json per player and opponent, as a Markdown table.
// Usage: npm run results [-- --engines]   (--engines adds Stockfish's own rows)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { summarize, summaryTable } from "../src/game/resultsSummary.ts";

const dir = join(import.meta.dirname, "..", "results");
const files = readdirSync(dir)
  .filter((n) => n.endsWith(".json"))
  .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")));
console.log(`${files.length} results\n`);
console.log(summaryTable(summarize(files, { engines: process.argv.includes("--engines") })));
console.log(
  "\nMoves: own moves per game. Accuracy, avg loss, blunders and mistakes come from Stockfish's review (– when a result has none). " +
    "Back-and-forth: a piece moving straight back to the square it came from. Longest quiet run: most own moves in a row without a pawn move or capture. " +
    "Stopped: replies the loop guard cut off.",
);
