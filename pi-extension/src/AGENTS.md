# src/ — Layer contract for the Pi-Velpari extension

This file is for AI agents and human contributors working inside `pi-extension/src/`. The root `AGENTS.md` covers the whole repo; this one is scoped to the extension source.

## Layer contract

The extension source is organised in 4 layers (official Pi extension orchestrator architecture: domain → stage-logic → presentation → composition).

| Layer | Folder | Purpose | May import from |
|---|---|---|---|
| 0 — Domain | `core/`, `io/` | Stage state, paths, constants, stage-runner, prompt, config, profiles, psrs, compaction; atomic-write + agents-install | nothing else in `src/` |
| 1 — Stage logic | `stages/`, `ops/`, `doctor/`, `view/` | Per-stage handlers + registry; ops commands (approve/status/reset/handoff/configure-*); diagnostics; read-only display | Layer 0 |
| 2 — Presentation | `ui/`, `hooks/` | TUI widgets (entry renderer, pickers, list editor, path browser), Pi lifecycle hooks (one file per event) | Layer 0, 1 |
| 3 — Composition | `commands/`, `index.ts` | 27 slash commands, one file per command; extension entry point | Layer 0, 1, 2 |

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

## Tests

Tests mirror this structure under `pi-extension/test/`. Run with `npm test` (builds, then `node --test` on compiled `dist/`). E2E tests live under `test/e2e/` and require `RUN_E2E=1` plus `pi` on PATH (`npm run test:e2e`).
