// Notes between moves: a harness can ask the model to end its reply with a "NOTES:" block
// (its plan, threats it is watching). The harness saves that block, and next move the
// model gets it back through {{my_notes}}. Each side only ever sees its own notes.

export const DEFAULT_NOTES_MAX_CHARS = 800;
export const NOTES_MAX_CHAR_CHOICES = [300, 800, 1500, 3000];

/** Added to the system prompt by the editor's "Add notes instructions" button (and used by the preset). */
export const NOTES_SYSTEM_INSTRUCTIONS = `Memory: you don't remember earlier moves, but you can leave yourself notes. Just before your final MOVE line, write a line starting with "NOTES:" followed by a few short lines for your next move: your plan, threats you are watching, ideas to try. Keep them brief. Notes from your previous move may be out of date or wrong: check them against the current position before relying on them.`;

/** Added to the turn prompt by the same button. */
export const NOTES_TURN_LINE = `Your notes from your previous move (check them against the position): {{my_notes}}`;

// "NOTES:", "**NOTES:**", "Notes -" at the start of a line.
const NOTES_START = /^[ \t>*_#]*notes[ \t*_]*[:\-][ \t*_]*/gim;
const MOVE_LINE = /^[ \t>*_#]*move[ \t*_]*:/im;

/** The last NOTES block in a reply (up to a MOVE line or the end), trimmed to maxChars; null if none. */
export function extractNotes(text: string, maxChars = DEFAULT_NOTES_MAX_CHARS): string | null {
  if (!text) return null;
  const starts = [...text.matchAll(NOTES_START)];
  const last = starts.at(-1);
  if (!last) return null;
  let body = text.slice(last.index! + last[0].length);
  const end = body.search(MOVE_LINE);
  if (end >= 0) body = body.slice(0, end);
  body = body.trim();
  if (!body) return null;
  return body.length > maxChars ? `${body.slice(0, maxChars - 1).trimEnd()}…` : body;
}
