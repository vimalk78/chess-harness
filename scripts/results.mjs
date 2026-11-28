// Summarizes results/*.json per player and opponent, as a Markdown table.
// Usage: npm run results [-- --engines] [-- --write]
//   --engines  adds Stockfish's own rows
//   --write    writes results/SUMMARY.md instead of printing (CI does this after each push to main)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { summarize, summaryTable } from "../src/game/resultsSummary.ts";

const dir = join(import.meta.dirname, "..", "results");
const files = readdirSync(dir)
  .filter((n) => n.endsWith(".json"))
  .sort()
  .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")));
const table = summaryTable(summarize(files, { engines: process.argv.includes("--engines") }));
const legend =
  "Moves: own moves per game. Accuracy, avg loss, blunders and mistakes come from Stockfish's review (– when a result has none). " +
  "Back-and-forth: a piece moving straight back to the square it came from. Longest quiet run: most own moves in a row without a pawn move or capture. " +
  "Stopped: replies the loop guard cut off.";

if (process.argv.includes("--write")) {
  const doc = [
    "# Results summary",
    "",
    `${files.length} submitted games, grouped by player and opponent. CI rewrites this file from the results in this folder after each push to main (\`npm run results -- --write\`), so don't edit it by hand.`,
    "",
    table,
    "",
    legend,
    "",
  ].join("\n");
  writeFileSync(join(dir, "SUMMARY.md"), doc);
  console.log(`Wrote results/SUMMARY.md (${files.length} results).`);
} else {
  console.log(`${files.length} results\n`);
  console.log(table);
  console.log(`\n${legend}`);
}
