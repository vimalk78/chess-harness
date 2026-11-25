# Chess Agent Arena: implementation plan

Spec: `docs/superpowers/specs/2026-11-26-chess-agent-arena-design.md`

Each step ends with `npm test` and `npx tsc --noEmit` passing. Tests are written before the code they cover.

1. **Scaffold.** `git init`, then Vite React-TS in the repo root, with dependencies `chess.js` and `react-chessboard` and dev dependency `vitest`. Add a `.gitignore` covering node_modules and dist. Leave `reports/` and `research_notes/` where they are. First commit.
2. **Types.** `src/agents/types.ts` exactly as in the spec.
3. **Move parser.** `src/agents/parse.ts` plus `parse.test.ts`: prefer a `MOVE:` line, then the first SAN/UCI-shaped token; strip markdown, move numbers and `...`; return `null` if nothing is found.
4. **Referee.** `src/game/referee.ts` plus `referee.test.ts`: the turn loop, SAN/UCI acceptance, retries leading to forfeit, pause on a thrown error with resume, the `maxPlies` draw, abort on stop, and events. `src/game/pgn.ts` with a test.
5. **OpenRouter client.** `src/llm/openrouter.ts` plus a test with a mocked fetch: headers, body (`usage.include`, `reasoning.effort`), parsing of usage and cost, and error mapping. Timeout via `AbortSignal.any` with a 5-minute timeout.
6. **Agents.** `raw.ts`, `harnessed.ts`, `human.ts`, `registry.ts`, plus tests with a mock LlmClient: prompt contents, retry wording, and the fallback note.
7. **UI.** `KeyInput`, `SideConfig`, `Board`, `MoveList`, `AgentLog`, and `App` wiring `runGame` events into React state. Controls: Start, Pause/Resume, New game, Swap colours, Copy PGN, Download log.
8. **README.** Run instructions, how the built-in agents differ, and how to write a custom agent (a minimal example).
9. **Verify.** `npm run build`, start the dev server, play a quick Human vs Raw game, check that a missing key disables Start, and check that the log panels fill in. A real LLM game needs the user's OpenRouter key, so the user runs that one.
