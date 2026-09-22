# src/ — Layer contract for the Pi-Velpari extension

For AI agents and human contributors working inside `pi-extension/src/`. The root `AGENTS.md` covers the whole repo; this one is scoped to the extension source.

## Layer contract

The extension source is organised in 4 layers (official Pi extension orchestrator architecture: domain → stage-logic → presentation → composition).

| Layer | Folder | Purpose | May import from |
|---|---|---|---|
| 0 — Domain | `core/`, `io/` | Stage state, paths, constants, stage-runner, prompt, config, profiles, psrs, compaction, logging-plan, standards-overlay; atomic-write + agents-install | nothing else in `src/` |
| 1 — Stage logic | `stages/`, `ops/`, `doctor/`, `view/` | Per-stage handlers + registry; ops commands; diagnostics; read-only display | Layer 0 |
| 2 — Presentation | `ui/`, `hooks/` | TUI widgets; Pi lifecycle hooks (one file per event) | Layer 0, 1 |
| 3 — Composition | `commands/`, `index.ts` | 42 slash commands; extension entry point | Layer 0, 1, 2 |

**Rule:** a file in layer N may import from any layer < N. Files in the same layer may import each other freely. **Never import upward.** Enforced by `pi-extension/test/architecture-alignment.test.ts`. Full map in [`layers.ts`](./layers.ts).

## Composition roots

Two composition roots in this extension. Both are wiring only — no business logic.

- `src/index.ts` — Pi extension entry point. Default-exports the extension factory and calls `registerCommands(pi)`, `registerHooks(pi)`, `registerVelpariStatusRenderer(pi)`, then registers the keyboard shortcuts and CLI flags.
- `src/commands/index.ts` — command composition root. Imports each per-command file and registers all commands in `COMMAND_NAMES` order.

## File conventions

- One concern per file. One slash command per file under `commands/`; one lifecycle event per file under `hooks/`; keep handlers thin.
- Use atomic writes (`io/atomic-write.ts`) for every file the extension owns. Never `fs.writeFileSync` directly outside `io/`.
- Use `path.join` for all paths. Never concatenate path strings.
- ESM imports with explicit `.js` extensions.

## Adding new code

1. **A new domain concept** (state, I/O helper, path) → `core/` or `io/`.
2. **A new stage handler or ops/diagnostic concern** → the matching layer-1 folder.
3. **A new UI widget or Pi hook** → layer-2 folder.
4. **A new slash command** → add `commands/<name>.ts`, register it in `commands/index.ts`, add the name to `COMMAND_NAMES`.
5. Update [`layers.ts`](./layers.ts) if you added a new folder.

## Brainstorm lifecycle v2.1 — new helpers (added 2026-09-14)

When working on the brainstorm command, these helpers are part of the v2.1 upgrade:

| Helper | Layer | Purpose |
|---|---|---|
| `core/multiplexer.ts` | L0 | Env-var multiplexer detection (zellij/tmux/wezterm/cmux). Promoted from `doctor/checks/multiplexer.ts` so the brainstorm handler can gate on it. |
| `core/scan-options.ts` | L0 | Config-driven available-scan detection. Reads files.json v4 (`codePaths`, `inputDocuments`) + probes filesystem. |
| `stages/brainstorm/scan-gate.ts` | L1 | The mandatory SCAN-gate picker (`ctx.ui.select` + `ctx.ui.confirm`). Lives at L1 (not L2) because the brainstorm state tool needs to invoke it and L1 cannot import from L2. |
| `stages/brainstorm-state-tool.ts` (new action: `request-scan-gate`) | L1 | The parent-LLM-callable bridge. Calls `runScanGatePicker` via `ctx.ui` and persists the result via `setScansSelected`. |
| `doctor/checks/scan-options.ts` | L1 | Doctor audit: reports which scans are available given the current files.json. Informational only, never errors. |

## Brainstorm lifecycle v2.3 — brainstorm-anytime (added 2026-09-20)

The v2.2 single-shot guard is replaced by pause/resume sessions (A2) and one
legal-command function (A1):

| Helper | Layer | Purpose |
|---|---|---|
| `core/state.ts:pausedStage` + `openBrainstormSession` / `resumeFromBrainstorm` / `discardBrainstormSession` | L0 | Run-locked, history-appending session primitives. Open pauses the current stage (recorded on `pausedStage`, dispatch count reset); resume lands on the paused stage (door `"continue"`) or `brainstormed` (door `"restart-prd"`); discard closes without an artifact. NOT STAGE_TRANSITIONS rows — `advanceStage` untouched. |
| `stages/brainstorm/guard.ts:guardStageForBrainstorm` | L1 | Pure guard: only a nested open (session already open) blocks; every other stage may open a brainstorm. |
| `stages/transition-lock.ts:computeLegalCommands` | L1 | THE legal-command function (A1): two-door collapse while a session is open, stale declared-input blocks, earliest-stale routing, update-mode self-loops. Consumed by runStage, the publish tool, ops/approve, ops/status, and the before_agent_start hook. Stage data arrives via `stages/registry.ts:STAGE_LOCK_SPECS` (pipeline execution order). |

## Tests

Tests mirror this structure under `pi-extension/test/`. Run with `npm test` (builds, then `node --test` on compiled `dist/`). E2E tests live under `test/e2e/` and require `RUN_E2E=1` plus `pi` on PATH (`npm run test:e2e`).
