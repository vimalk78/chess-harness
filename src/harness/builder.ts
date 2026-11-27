// Builder mode: pick what the model sees from a checklist instead of writing the turn
// prompt by hand. Each ticked item becomes one paragraph of the turn prompt, a heading
// followed by its {{variable}}, in a fixed order. Headings are editable.
//
// A builder harness is still an ordinary harness: the generated turn prompt is stored in
// turnPrompt (that's what the runner sends), and `builder` records the checklist so the
// editor can show it again. The system prompt and re-ask prompt are always plain text.

export interface BuilderItem {
  name: string;
  heading: string;
}

export interface BuilderSpec {
  items: BuilderItem[];
}

export type BuilderGroup = "Game" | "Position" | "Facts from the rules" | "Your moves" | "Memory";

export interface BuilderItemInfo {
  name: string;
  group: BuilderGroup;
  defaultHeading: string;
  /** Multi-line values go on the line after the heading; short ones follow it. */
  multiline: boolean;
}

/** Every item the builder offers, in the order they appear in the turn prompt. */
export const BUILDER_ITEMS: BuilderItemInfo[] = [
  { name: "side", group: "Game", defaultHeading: "You are playing", multiline: false },
  { name: "move_number", group: "Game", defaultHeading: "Move number:", multiline: false },
  { name: "last_move", group: "Game", defaultHeading: "Last move:", multiline: false },
  { name: "pgn", group: "Game", defaultHeading: "Moves so far:", multiline: false },
  { name: "fen", group: "Position", defaultHeading: "FEN:", multiline: false },
  { name: "board_ascii", group: "Position", defaultHeading: "Board (uppercase = White, lowercase = Black):", multiline: true },
  { name: "board_unicode", group: "Position", defaultHeading: "Board:", multiline: true },
  { name: "pieces", group: "Position", defaultHeading: "All pieces and their squares:", multiline: true },
  { name: "material", group: "Position", defaultHeading: "Material:", multiline: true },
  { name: "game_state", group: "Position", defaultHeading: "Game state:", multiline: true },
  { name: "my_notes", group: "Memory", defaultHeading: "Your notes from your previous move (check them against the position):", multiline: false },
  { name: "last_move_threats", group: "Facts from the rules", defaultHeading: "Your opponent's last move:", multiline: false },
  { name: "attacks", group: "Facts from the rules", defaultHeading: "Attacked pieces (computed from the rules, not an engine; pins are ignored):", multiline: true },
  { name: "captures", group: "Facts from the rules", defaultHeading: "Your captures:", multiline: false },
  { name: "checks", group: "Facts from the rules", defaultHeading: "Your checking moves:", multiline: false },
  { name: "move_safety", group: "Facts from the rules", defaultHeading: "Warning, from the rules (one move ahead):", multiline: false },
  { name: "legal_moves", group: "Your moves", defaultHeading: "Legal moves:", multiline: false },
  { name: "legal_moves_by_piece", group: "Your moves", defaultHeading: "Your legal moves, by piece:", multiline: true },
];

export const BUILDER_GROUPS: BuilderGroup[] = ["Game", "Position", "Memory", "Facts from the rules", "Your moves"];

const INFO = new Map(BUILDER_ITEMS.map((i) => [i.name, i]));
export const BUILDER_ITEM_NAMES = new Set(INFO.keys());
export const MAX_HEADING_CHARS = 300;

export function builderItemInfo(name: string): BuilderItemInfo | undefined {
  return INFO.get(name);
}

export function defaultItem(name: string): BuilderItem {
  return { name, heading: INFO.get(name)?.defaultHeading ?? "" };
}

/** The checklist a new harness starts with: the same things the Harnessed preset shows. */
export const DEFAULT_BUILDER: BuilderSpec = { items: ["side", "pgn", "fen", "board_ascii", "legal_moves"].map(defaultItem) };

/** Items in prompt order, one per name, unknown names dropped. */
export function normalizeItems(items: BuilderItem[]): BuilderItem[] {
  const byName = new Map<string, BuilderItem>();
  for (const it of items) if (INFO.has(it.name) && !byName.has(it.name)) byName.set(it.name, it);
  return BUILDER_ITEMS.filter((i) => byName.has(i.name)).map((i) => byName.get(i.name)!);
}

/**
 * The turn prompt for a checklist. Referee rejections ({{errors}}, empty when there are
 * none) always go at the end, so a model that skips the pre-check hears why a move failed.
 */
export function buildTurnPrompt(spec: BuilderSpec): string {
  const parts = normalizeItems(spec.items).map((it) => {
    const heading = it.heading.trim();
    const token = `{{${it.name}}}`;
    if (!heading) return token;
    return `${heading}${INFO.get(it.name)!.multiline ? "\n" : " "}${token}`;
  });
  return `${parts.join("\n\n")}{{errors}}`;
}

/** Turns a hand-written turn prompt into a checklist: every builder variable it uses, with default headings. */
export function builderFromTemplate(variables: Iterable<string>): BuilderSpec {
  const used = new Set(variables);
  return { items: BUILDER_ITEMS.filter((i) => used.has(i.name)).map((i) => defaultItem(i.name)) };
}

export type BuilderValidation = { ok: true; spec: BuilderSpec } | { ok: false; error: string };

export function validateBuilder(input: unknown): BuilderValidation {
  if (!input || typeof input !== "object" || !Array.isArray((input as { items?: unknown }).items)) {
    return { ok: false, error: '"builder" must be an object with an "items" list.' };
  }
  const items: BuilderItem[] = [];
  for (const raw of (input as { items: unknown[] }).items) {
    if (!raw || typeof raw !== "object") return { ok: false, error: '"builder" items must be objects.' };
    const { name, heading } = raw as Record<string, unknown>;
    if (typeof name !== "string" || !INFO.has(name)) return { ok: false, error: `Unknown builder item ${JSON.stringify(name)}.` };
    if (typeof heading !== "string" || heading.length > MAX_HEADING_CHARS) {
      return { ok: false, error: `The heading for "${name}" must be text of at most ${MAX_HEADING_CHARS} characters.` };
    }
    items.push({ name, heading });
  }
  return { ok: true, spec: { items: normalizeItems(items) } };
}
