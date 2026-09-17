# src/ — Layer contract for the Pi-Velpari extension

This file is for AI agents and human contributors working inside `pi-extension/src/`. The root `AGENTS.md` covers the whole repo; this one is scoped to the extension source.

## Layer contract

The extension source is organised in 4 layers (official Pi extension orchestrator architecture: domain → stage-logic → presentation → composition).

| Layer | Folder | Purpose | May import from |
|---|---|---|---|
| 0 — Domain | `core/`, `io/` | Stage state, paths, constants, stage-runner, prompt, config, profiles, psrs, compaction, logging-plan, standards-overlay; atomic-write + agents-install | nothing else in `src/` |
| 1 — Stage logic | `stages/`, `ops/`, `doctor/`, `view/` | Per-stage handlers + registry; ops commands (approve/status/reset/handoff/configure-* + design-logging v1.4.0); diagnostics; read-only display | Layer 0 |
| 2 — Presentation | `ui/`, `hooks/` | TUI widgets (entry renderer, pickers, list editor, path browser), Pi lifecycle hooks (one file per event) | Layer 0, 1 |
| 3 — Composition | `commands/`, `index.ts` | 32 slash commands (v1.4.0: + velpari-design-logging + velpari-show-logging), one file per command; extension entry point | Layer 0, 1, 2 |

**Rule:** a file in layer N may import from any layer &lt; N. Files in the same layer may import each other freely. **Never import upward.** Enforced by `pi-extension/test/architecture-alignment.test.ts`.

The full map is also in [`layers.ts`](./layers.ts).

## Composition roots

There are exactly **two composition roots** in this extension. Both are wiring only — they contain no business logic.

### `src/index.ts`

The Pi extension entry point. Default-exports the extension factory and calls `registerCommands(pi)`, `registerHooks(pi)`, `registerVelpariStatusRenderer(pi)`, then registers the two keyboard shortcuts and two CLI flags.

### `src/commands/index.ts`

The command composition root. Imports each per-command file and registers all 27 commands in `COMMAND_NAMES` order.

## File conventions

- One concern per file. One slash command per file under `commands/`; one lifecycle event per file under `hooks/`; keep handlers thin.
- Use atomic writes (`io/atomic-write.ts`) for every file the extension owns. Never `fs.writeFileSync` directly outside `io/`.
- Use `path.join` for all paths. Never concatenate path strings.
- ESM imports with explicit `.js` extensions.

## Adding new code

1. **A new domain concept** (state, I/O helper, path) → `core/` or `io/`.
2. **A new stage handler or ops/diagnostic concern** → the matching layer-1 folder (`stages/`, `ops/`, `doctor/`, `view/`).
3. **A new UI widget or Pi hook** → layer-2 folder (`ui/`, `hooks/`).
4. **A new slash command** → add `commands/<name>.ts`, register it in `commands/index.ts`, and add the name to `COMMAND_NAMES`.
5. **Update [`layers.ts`](./layers.ts)** if you added a new folder.

## Brainstorm lifecycle v2.1 — new helpers (added 2026-09-14)

When working on the brainstorm command, these helpers are part of the v2.1 upgrade:

| Helper | Layer | Purpose |
|---|---|---|
| `core/multiplexer.ts` | L0 | Env-var multiplexer detection (zellij/tmux/wezterm/cmux). Promoted from `doctor/checks/multiplexer.ts` so the brainstorm handler can gate on it. |
| `core/scan-options.ts` | L0 | Config-driven available-scan detection. Reads files.json v4 (`codePaths`, `inputDocuments`) + probes filesystem. |
| `stages/brainstorm/scan-gate.ts` | L1 | The mandatory SCAN-gate picker (`ctx.ui.select` + `ctx.ui.confirm`). Lives at L1 (not L2) because the brainstorm state tool needs to invoke it and L1 cannot import from L2. |
| `stages/brainstorm-state-tool.ts` (new action: `request-scan-gate`) | L1 | The parent-LLM-callable bridge. Calls `runScanGatePicker` via `ctx.ui` and persists the result via `setScansSelected`. |
| `doctor/checks/scan-options.ts` | L1 | Doctor audit: reports which scans are available given the current files.json. Informational only, never errors. |

These are enforced by:
- Hard multiplexer gate at the top of `stages/brainstorm/index.ts:handleBrainstorm`
- Removed `DEFAULT_SCANS` auto-apply in `stages/brainstorm/dispatcher.ts` (kept as frozen empty sentinel)
- The state tool's `request-scan-gate` action is the only way the SCAN gate proceeds

## Brainstorm lifecycle v2.2 — single-shot per run (added 2026-09-14)

| Helper | Layer | Purpose |
|---|---|---|
| `stages/brainstorm/guard.ts:guardStageForBrainstorm` | L1 | Pure guard: only `none` (fresh) and `brainstorming` (resume) are allowed at `/velpari-brainstorm` entry. Anything else names the next command via `nextCommandsFor` and hints at `/velpari-reset`. |

Enforced by:
- Stage guard wired at `stages/brainstorm/index.ts:handleBrainstorm` step 2b — runs AFTER `loadState` (to know the stage) and BEFORE `createRun` (so a refused re-run does not overwrite the existing run). Runs AFTER the multiplexer gate.

## Tests

Tests mirror this structure under `pi-extension/test/`. Run with `npm test` (builds, then `node --test` on compiled `dist/`). E2E tests live under `test/e2e/` and require `RUN_E2E=1` plus `pi` on PATH (`npm run test:e2e`).
