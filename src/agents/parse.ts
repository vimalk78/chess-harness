// Pulls a move-shaped token out of free-form model output.
// Deliberately never looks at the legal-move list: the parser must not quietly
// help an agent. Legality is the referee's (or the harness's) job.

const UCI = "[a-h][1-8][a-h][1-8][qrbn]?";
const SAN = "[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?";
const CASTLE = "(?:O-O-O|O-O|0-0-0|0-0)[+#]?";
const TOKEN = new RegExp(
  `(?<![A-Za-z0-9])(${CASTLE}|${UCI}|${SAN})(?![A-Za-z0-9=])`,
  "g",
);
const MOVE_LINE = /move\s*:\s*(.+)/gi;

function firstToken(text: string): string | null {
  TOKEN.lastIndex = 0;
  const m = TOKEN.exec(text);
  if (!m) return null;
  // Only castling tokens can contain "0" (ranks are 1-8), so this just normalises 0-0 to O-O.
  return m[1].replace(/0/g, "O");
}

export function extractMove(text: string): string | null {
  if (!text) return null;
  const lines = [...text.matchAll(MOVE_LINE)];
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = firstToken(lines[i][1]);
    if (found) return found;
  }
  return firstToken(text);
}
