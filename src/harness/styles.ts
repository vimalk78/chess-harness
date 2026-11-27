// Starting points for the system prompt in the harness editor. Picking one replaces the
// system prompt text, which stays fully editable afterwards: a style is not stored.

import { ANALYSIS_SYSTEM_INSTRUCTIONS } from "./analysis";
import { NOTES_SYSTEM_INSTRUCTIONS } from "./notes";
import { ATTACKER_PRESET, HARNESSED_PRESET } from "./presets";

export interface Style {
  id: string;
  label: string;
  description: string;
  text: string;
}

const MOVE_LINE = "End your reply with a final line in exactly this form:\nMOVE: <move in SAN, copied from the legal-move list>";

export const STYLES: Style[] = [
  {
    id: "careful",
    label: "Careful",
    description: "Threats first, then captures, loose pieces, 2-3 candidates and a safety check. (The Harnessed preset.)",
    text: HARNESSED_PRESET.systemPrompt,
  },
  {
    id: "attacker",
    label: "Attacker",
    description: "Plays for the initiative: forcing moves, king attacks, sacrifices with a concrete follow-up. (The Attacker preset.)",
    text: ATTACKER_PRESET.systemPrompt,
  },
  {
    id: "solid",
    label: "Solid",
    description: "Safety first: keep pieces defended, trade when ahead, avoid weaknesses near the king.",
    text: [
      "You are a solid, patient chess player. You win by not making mistakes and by punishing your opponent's.",
      "Each turn you get the position and the list of legal moves. Think in this order:",
      "1. Threats: what is your opponent threatening after their last move? Deal with real threats first.",
      "2. Safety: which of your pieces are attacked, or attacked more times than they are defended? Keep every piece defended.",
      "3. Free material: if your opponent left a piece undefended, check that taking it is safe, then take it.",
      "4. Improve: otherwise pick a quiet move that improves your worst piece, keeps your king's pawn shelter intact, and creates no new weakness.",
      "5. Trades: when you are ahead in material, trade pieces. When you are behind, avoid trades.",
      "Never play a move that leaves one of your pieces hanging.",
      MOVE_LINE,
    ].join("\n"),
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Just the answer format, no advice on how to think.",
    text: `You are playing chess.\n${MOVE_LINE}`,
  },
];

const withoutAddOns = (text: string) => text.replace(NOTES_SYSTEM_INSTRUCTIONS, "").replace(ANALYSIS_SYSTEM_INSTRUCTIONS, "").trim();

/** The style a system prompt matches (ignoring the notes and analysis instructions), or undefined if it's been edited. */
export function matchStyle(systemPrompt: string): Style | undefined {
  const t = withoutAddOns(systemPrompt);
  return STYLES.find((s) => s.text.trim() === t);
}

/** The system prompt for a style, plus the notes and analysis-board instructions when the harness uses them. */
export function styleText(style: Style, keepNotes: boolean, analysis = false): string {
  return [style.text.trimEnd(), analysis ? ANALYSIS_SYSTEM_INSTRUCTIONS : null, keepNotes ? NOTES_SYSTEM_INSTRUCTIONS : null].filter(Boolean).join("\n\n");
}
