// A readable Markdown transcript of a game: who played, the PGN, then every turn with
// the prompt each side sent, its reasoning, its reply, re-asks and referee rulings.

import type { Color, LogEntry } from "../agents/types";
import type { HarnessConfig } from "../harness/config";
import type { SavedGame } from "./savedGame";

const NAME: Record<Color, string> = { w: "White", b: "Black" };

/** A fenced block that can't be broken by backticks inside the text. */
function fence(text: string, lang = "text"): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text.replace(/\n+$/, "")}\n${f}`;
}

const n = (x: number) => x.toLocaleString("en-US");

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function utc(t: number): string {
  return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function resultLine(g: SavedGame): string {
  if (!g.result || g.result === "*") {
    const toMove = g.history.length % 2 === 0 ? "White" : "Black";
    return g.result === "*" ? `Stopped (${g.reason ?? "unfinished"})` : `In progress, ${toMove} to move`;
  }
  const who = g.result === "1-0" ? "White wins" : g.result === "0-1" ? "Black wins" : "Draw";
  return `${who} (${g.result})${g.reason ? `, ${g.reason}` : ""}`;
}

function playerSection(c: Color, g: SavedGame): string {
  const side = g.sides[c];
  const h: HarnessConfig | null = g.harnesses[c];
  const lines = [`### ${NAME[c]}: ${g.labels[c]}`, ""];
  if (!h) {
    lines.push(`- Agent: \`${side.agentId}\` (not a harness)`);
    return lines.join("\n");
  }
  lines.push(
    `- Harness: **${h.name}** (\`${h.id}\`)${h.description ? `: ${h.description}` : ""}`,
    `- Model: \`${side.model}\`, reasoning effort: ${side.effort || "model default"}`,
    `- Pre-check: ${h.precheck ? `on, up to ${h.maxReasks} re-asks, then ${h.fallback === "random" ? "a random legal move" : "submit the last answer"}` : "off"}`,
    "",
    "System prompt:",
    "",
    h.systemPrompt ? fence(h.systemPrompt) : "_(none)_",
    "",
    "Turn prompt template:",
    "",
    fence(h.turnPrompt),
  );
  return lines.join("\n");
}

/** Splits the runner's "[system]\n…\n\n[user]\n…" prompt log entry. */
function splitPrompt(text: string): { system: string | null; user: string } {
  const marker = "\n\n[user]\n";
  if (!text.startsWith("[system]\n")) return { system: null, user: text };
  const i = text.indexOf(marker);
  if (i < 0) return { system: null, user: text };
  return { system: text.slice("[system]\n".length, i), user: text.slice(i + marker.length) };
}

export function buildTranscript(g: SavedGame, pgn: string): string {
  const out: string[] = [
    `# ${g.labels.w} vs ${g.labels.b}`,
    "",
    `- **Result:** ${resultLine(g)}`,
    `- **Moves played:** ${Math.ceil(g.history.length / 2)} (${g.history.length} half-moves)`,
    `- **Started:** ${utc(g.startedAt)} · **Saved:** ${utc(g.savedAt)}`,
    "- Made with Chess Agent Arena. The referee only enforces the rules; no engine helps either side.",
    "",
    "## Players",
    "",
    playerSection("w", g),
    "",
    playerSection("b", g),
    "",
    "## Game",
    "",
    fence(pgn, "pgn"),
    "",
    "## Turn by turn",
    "",
  ];

  const firstMovePly = g.events.find((e) => e.event.type === "move");
  const loadedPlies = firstMovePly?.event.type === "move" ? firstMovePly.event.history.length - 1 : g.history.length;
  if (loadedPlies > 0) {
    out.push(`_The first ${loadedPlies} half-moves were loaded from a file without a transcript._`, "");
  }
  if (g.events.length === 0) out.push("_No turns recorded._", "");

  const lastSystem: Record<Color, string | null> = { w: null, b: null };
  let turn: { color: Color; since: number; parts: string[] } | null = null;
  const tokens = { w: { in: 0, out: 0 }, b: { in: 0, out: 0 } };

  const entry = (c: Color, e: LogEntry, first: boolean): string => {
    if (e.kind === "prompt") {
      const { system, user } = splitPrompt(e.text);
      const parts = [];
      if (system !== null) {
        if (system === lastSystem[c]) parts.push("**System prompt:** same as before.");
        else parts.push("**System prompt:**", "", fence(system));
        lastSystem[c] = system;
        parts.push("", "**Prompt:**", "", fence(user));
      } else {
        parts.push(first ? "**Prompt:**" : "**Re-ask:**", "", fence(user));
      }
      return parts.join("\n");
    }
    if (e.kind === "response") {
      const parts = [];
      if (e.reasoning) {
        parts.push(
          `<details><summary>Reasoning (${n(e.reasoning.length)} characters)</summary>`,
          "",
          fence(e.reasoning),
          "",
          "</details>",
          "",
        );
      }
      let usage = "";
      if (e.usage) {
        tokens[c].in += e.usage.promptTokens;
        tokens[c].out += e.usage.completionTokens;
        usage = ` (${n(e.usage.promptTokens)} prompt tokens, ${n(e.usage.completionTokens)} reply tokens)`;
      }
      parts.push(`**Reply**${usage}:`, "", e.text.trim() ? fence(e.text) : "_(empty)_");
      return parts.join("\n");
    }
    if (e.kind === "notes") return ["**Notes kept for next move:**", "", fence(e.text)].join("\n");
    return `> ${e.text}`;
  };

  for (const { t, event: ev } of g.events) {
    switch (ev.type) {
      case "turnStart":
        turn ??= { color: ev.color, since: t, parts: [] };
        break;
      case "log":
        turn ??= { color: ev.color, since: t, parts: [] };
        ev.entries.forEach((e, i) => turn!.parts.push(entry(ev.color, e, i === 0)));
        break;
      case "illegalAttempt":
        turn?.parts.push(`> **Referee rejected** \`${ev.move || "(empty)"}\`: ${ev.error}`);
        break;
      case "paused":
        turn?.parts.push(ev.error ? `> Paused: ${ev.error}` : "> Paused by the person watching.");
        break;
      case "move": {
        const ply = ev.history.length;
        const num = `${Math.ceil(ply / 2)}${ev.color === "w" ? "." : "..."}`;
        const took = turn ? `, ${duration(t - turn.since)}` : "";
        out.push(`### ${num} ${ev.san} (${NAME[ev.color]}${took})`, "", ...(turn?.parts ?? []).flatMap((p) => [p, ""]));
        turn = null;
        break;
      }
      case "gameOver":
        if (turn?.parts.length) {
          out.push(`### ${NAME[turn.color]}'s unfinished turn`, "", ...turn.parts.flatMap((p) => [p, ""]));
        }
        turn = null;
        out.push(`**Game over:** ${ev.result === "*" ? "stopped" : ev.result}, ${ev.reason}`, "");
        break;
    }
  }
  if (turn?.parts.length) out.push(`### ${NAME[turn.color]} to move (in progress)`, "", ...turn.parts.flatMap((p) => [p, ""]));

  const totals = (["w", "b"] as Color[])
    .filter((c) => tokens[c].in || tokens[c].out)
    .map((c) => `- ${NAME[c]}: ${n(tokens[c].in)} prompt tokens, ${n(tokens[c].out)} reply tokens`);
  if (totals.length) out.push("## Token totals", "", ...totals, "");

  return out.join("\n");
}
