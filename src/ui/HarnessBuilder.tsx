import { BUILDER_GROUPS, BUILDER_ITEMS, defaultItem, normalizeItems, type BuilderSpec } from "../harness/builder";
import { BASE_VARIABLES, CONTEXT_BLOCKS } from "../harness/contextBlocks";

interface Props {
  spec: BuilderSpec;
  readOnly: boolean;
  onChange: (spec: BuilderSpec) => void;
  /** "Your notes" is ticked together with "Keep notes between moves": both turn notes on or off. */
  onToggleNotes: (on: boolean) => void;
}

const ALL_VARIABLES = new Map([...BASE_VARIABLES, ...CONTEXT_BLOCKS].map((v) => [v.name, v]));
const POSITION = ["pgn", "fen", "board_ascii", "board_unicode", "pieces"];

/** The checklist of what the model sees each turn, with an editable heading for each ticked item. */
export function HarnessBuilder({ spec, readOnly, onChange, onToggleNotes }: Props) {
  const ticked = new Map(spec.items.map((i) => [i.name, i]));
  const toggle = (name: string, on: boolean) =>
    onChange({ items: on ? normalizeItems([...spec.items, defaultItem(name)]) : spec.items.filter((i) => i.name !== name) });
  const setHeading = (name: string, heading: string) =>
    onChange({ items: spec.items.map((i) => (i.name === name ? { ...i, heading } : i)) });

  const noMoves = !ticked.has("legal_moves") && !ticked.has("legal_moves_by_piece");
  const noPosition = !POSITION.some((n) => ticked.has(n));

  return (
    <div className="builder">
      {BUILDER_GROUPS.map((group) => (
        <div key={group} className="builder-group">
          <div className="vars-title">{group}</div>
          {BUILDER_ITEMS.filter((i) => i.group === group).map((info) => {
            const v = ALL_VARIABLES.get(info.name);
            const item = ticked.get(info.name);
            const isNotes = info.name === "my_notes";
            return (
              <div key={info.name} className={`builder-item ${item ? "on" : ""}`}>
                <label className="check" title={v?.description}>
                  <input
                    type="checkbox"
                    checked={!!item}
                    disabled={readOnly}
                    onChange={(e) => (isNotes ? onToggleNotes(e.target.checked) : toggle(info.name, e.target.checked))}
                  />
                  {v?.label ?? info.name}
                  {v?.fairness === "borderline" && <em className="tag">borderline</em>}
                  <span className="hint">{isNotes ? "The model's own notes from its previous move. Also turns on “Keep notes between moves” and adds the notes instructions to the system prompt." : v?.description}</span>
                </label>
                {item && (
                  <input
                    className="builder-heading"
                    aria-label={`Heading for ${v?.label ?? info.name}`}
                    value={item.heading}
                    readOnly={readOnly}
                    placeholder="(no heading)"
                    onChange={(e) => setHeading(info.name, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
      {noPosition && <p className="hint warn">Nothing shows the position: tick the move list, FEN, a board or the piece list.</p>}
      {noMoves && (
        <p className="hint warn">
          No legal-move list: the model must work out its legal moves itself. If your system prompt says “copied from the legal-move list”,
          change that line.
        </p>
      )}
      <p className="hint">
        Ticked items go into the turn prompt in this order, each under its heading. Referee rejections are always added at the end. For
        your own order or wording, use “Edit as text”.
      </p>
    </div>
  );
}
