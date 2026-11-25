# Custom harnesses: implementation plan

Spec: `docs/superpowers/specs/2026-11-26-custom-harness-design.md`. Each step ends with tests and the type-check passing; tests come first.

1. `src/harness/template.ts`: render `{{vars}}` lazily, list the variables a template uses.
2. `src/harness/contextBlocks.ts`: base variables plus the 12 context blocks, each with label, description and fairness tag. Tests on fixed positions.
3. `src/harness/config.ts` + `presets.ts`: types, validation, the three presets. `runner.ts`: `createHarnessAgent`, `renderPrompts`. Parity tests against today's Raw/Harnessed prompts, then remove `raw.ts`/`harnessed.ts`.
4. `src/harness/store.ts`: localStorage, import/export, share links; `getAgent` resolves presets, `custom:<id>` and registry agents.
5. Streaming: SSE parsing in `OpenRouterClient` (JSON responses still handled), `onDelta`; referee `onStream`; runner forwards with a `start` marker per call.
6. UI: grouped agent dropdown, `HarnessEditor` with live preview and insert buttons, share-link banner, live streaming entry in `AgentLog`, harness configs in the JSON log.
7. README; browser check with OpenRouter mocked; commit; push (deploys to GitHub Pages).
