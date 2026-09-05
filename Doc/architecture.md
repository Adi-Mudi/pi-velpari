# Velpari Architecture (v0.5.1)

## What this doc is

The canonical reference for **where code goes** and **what Pi APIs we use**. Not a tutorial, not a feature list, not a history. If this disagrees with the code, the code wins. For design rationale, see `Doc/design.md`. For "why we picked X over Y", see `Doc/architecture-discussion.md` (study-only).

## Folder structure

```
pi-extension/
  src/
    index.ts                — entry point; default export (pi: ExtensionAPI); lifecycle hooks, events, shortcuts, flags
    core/                   — pure logic, no UI, no Pi calls
      commands.ts           — registerCommands(pi): the 25 commands live here
      constants.ts          — Stage enum + STAGE_TRANSITIONS (single source of truth)
      state.ts              — loadState / saveState / createRun / advanceStage / appendStageEntry
      prompt.ts             — loadStageSkill / buildStagePrompt (no LLM)
      compaction.ts         — buildCompactionSummary (zero-LLM)
      config.ts             — files.json validation + persistence
      profile.ts            — requirements-profile types + persistence
      profiles-library.ts   — built-in profile library + scoring
      paths.ts              — buildGroupedPath / resolveDocArtifact / slugify
      psrs.ts               — PSRS structural validator (pure)
    stages/                 — 9 stage handlers + registry + 2 wrappers
      discuss.ts            — 2-phase interview + subagent handoff
      prd.ts, rtm.ts, feasibility.ts, design.ts,
      pseudocode.ts, testplan.ts, atomic-function.ts, development-order.ts
      registry.ts           — STAGE_REGISTRY + runStageWithScouts (4-subagent pattern)
      prd-rtm.ts            — /velpari-prd-rtm wrapper (no logic of its own)
      discuss-approve.ts    — /velpari-approve-discuss (chains into /velpari-prd)
    discipline/             — non-stage discipline commands
      status.ts             — /velpari-status (also pushes the footer status bar)
      approve.ts            — /velpari-approve (also pushes the footer status bar)
      reset.ts              — /velpari-reset
      configure-inputs.ts   — /velpari-configure-inputs (projectName, framework)
      handoff.ts            — /velpari-handoff (writes .pi/senai/architect-inputs.json)
      configure-requirements/ — /velpari-configure-requirements (split: index/interview/research/recommend)
      doctor/               — /velpari-doctor (split: index/report + 7 checks/)
    view/                   — /velpari-show-* commands (parameterized show.ts)
    ui/                     — TUI primitives (Pi TUI wrappers)
      entry-renderer.ts     — registerVelpariStatusRenderer (Box+Text via @earendil-works/pi-tui)
    prompts/                — per-stage prompt fragments
    agents-install.ts       — ensureScoutAgents(cwd): bootstraps 4 scouts to .pi/agents/ on first use
  test/                     — one *.test.ts per src module (node --test, no framework)
  src/ (test/) e2e/         — pre-existing pi-coding-agent-test scaffold (left untouched)
skills/
  velpari-*.md              — 9 stage skill markdowns (parent-LLM program)
  velpari-{configure-requirements,handoff,atomic-function,development-order}.md
  agents/                   — 4 bundled Pi agent definitions (extractor, prd-checker, rtm-checker, web-search-agent)
Doc/                        — published artifacts (artifacts of record). Grouped by category since Phase 7.
  discussion/               — discussion-<topic-slug>.md
  requirements/             — PRD_<projectName>.md, RTM_<projectName>.md
  feasibility/              — feasibility-study_<projectName>.md
  design/                   — design_<projectName>.md
  pseudocode/               — pseudocode_<projectName>.md
  tests/                    — test-plan_<projectName>.md, test-cases_<projectName>.md
  atomic-functions/         — atomic-functions_<projectName>.md (optional)
  development-order/        — development-order_<projectName>.md (optional)
.IDE_Plans/velpari/
  state.json                — RunState (single source of truth, persisted)
  runs/<run-id>/            — working copies per stage (NEVER published)
.pi/velpari/
  files.json                — projectName, framework, inputDocuments, outputPaths
  requirements-profile.json — requirements profile (v1.1.0; set via /velpari-configure-requirements)
.pi/senai/
  architect-inputs.json     — handoff target for Senai (schema verified at handoff-test time)
scripts/
  e2e-preflight.sh          — pre-flight gates (build + test + tsc + module-loadable + pkg-metadata + node + pi)
```

## Pi API surface

Only the 10 documented APIs Velpari actually calls. Verify each at the cited docs URL before adding a new one.

| Method | Used at | Docs |
|---|---|---|
| `pi.registerCommand(name, def)` | `core/commands.ts:registerCommands` | docs/extensions.md §Custom commands |
| `pi.on(event, handler)` | `src/index.ts` (5 events) | docs/extensions.md §Events |
| `pi.events.emit(channel, payload)` | `src/index.ts` (velpari:* channel) | docs/extensions.md §Events |
| `pi.registerShortcut(key, def)` | `src/index.ts` (Ctrl+Shift+V/R) | docs/extensions.md §Keyboard shortcuts |
| `pi.registerFlag(name, def)` | `src/index.ts` (--velpari-skip-doctor, --velpari-stage) | docs/extensions.md §Flags |
| `pi.appendEntry(customType, data)` | `core/state.ts:appendStageEntry`, `discipline/status.ts` | docs/extensions.md §State management |
| `pi.registerEntryRenderer(customType, fn)` | `ui/entry-renderer.ts:registerVelpariStatusRenderer` | examples/extensions/status-line.ts |
| `ctx.ui.setStatus(key, text)` | `src/index.ts`, `discipline/{status,approve}.ts`, `stages/discuss-approve.ts` | docs/tui.md §Common Patterns; examples/extensions/plan-mode/index.ts |
| `ctx.ui.{notify,select,input,confirm}` | every command handler | docs/extensions.md §ExtensionCommandContext |
| `pi.sendUserMessage(msg, opts)` | `stages/discuss.ts` (handoff to parent LLM) | docs/extensions.md §User interaction |

**Not used** (verified absent in v0.5.1, intentional): `pi.exec`, `pi.setActiveTools`, `ctx.ui.setWidget`, `ctx.ui.setTitle`, `ctx.ui.editor`, `ctx.ui.custom`. If you need one, cite the docs URL in the commit message first.

## Command surface (25 commands)

Stage commands (9, all chain via `STAGE_TRANSITIONS`):

| Command | Stage | Handler |
|---|---|---|
| `/velpari-discuss` | discussing | stages/discuss.ts |
| `/velpari-prd` | drafting-prd | stages/prd.ts |
| `/velpari-rtm` | building-rtm | stages/rtm.ts |
| `/velpari-feasibility` | analyzing-feasibility | stages/feasibility.ts |
| `/velpari-design` | designing | stages/design.ts |
| `/velpari-pseudocode` | writing-pseudocode | stages/pseudocode.ts |
| `/velpari-testplan` | planning-tests | stages/testplan.ts |
| `/velpari-atomic-function` | (optional post-pipeline) | stages/atomic-function.ts |
| `/velpari-development-order` | (optional post-pipeline) | stages/development-order.ts |

Discipline commands (8):

| Command | Handler |
|---|---|
| `/velpari-approve` | discipline/approve.ts |
| `/velpari-approve-discuss` | stages/discuss-approve.ts (chains into /velpari-prd) |
| `/velpari-status` | discipline/status.ts |
| `/velpari-reset` | discipline/reset.ts |
| `/velpari-configure-inputs` | discipline/configure-inputs.ts |
| `/velpari-configure-requirements` | discipline/configure-requirements/index.ts |
| `/velpari-doctor` | discipline/doctor/index.ts |
| `/velpari-handoff` | discipline/handoff.ts |

View commands (7, all go through view/show.ts):

`/velpari-show-discussion` `/velpari-show-prd` `/velpari-show-rtm` `/velpari-show-feasibility` `/velpari-show-design` `/velpari-show-pseudocode` `/velpari-show-testplan`

Wrapper (1): `/velpari-prd-rtm` → `stages/prd-rtm.ts` (calls handlePrd then handleRtm).

## State + artifacts

- **State file**: `.IDE_Plans/velpari/state.json` (read by `core/state.ts:loadState`).
- **Run directory**: `.IDE_Plans/velpari/runs/<run-id>/<stage>/...` (working copies).
- **Published copies**: `Doc/<category>/<artifact>_<projectName>.md` (read by `core/paths.ts:resolveDocArtifact`).
- **Side configs**: `.pi/velpari/files.json` (projectName + framework), `.pi/velpari/requirements-profile.json` (v1.1.0).
- **Handoff target**: `.pi/senai/architect-inputs.json` (schema validated against Senai at test time).

## How to add a new feature correctly

Checklist. Each step has a verification.

1. **Does it need a new Pi API?** → Verify the docs URL first (`node_modules/@earendil-works/pi-coding-agent/docs/{extensions,tui}.md`). Cite the URL in the commit message.
2. **Does it touch state?** → Use `loadState` / `saveState` / `advanceStage` from `core/state.ts`. Never mutate state in place. Honor `--velpari-stage` in `advanceStage`.
3. **Does it need a command?** → Add to `core/commands.ts:registerCommands` + the matching handler file. Use `core/paths.ts:resolveDocArtifact` for any Doc/ path.
4. **Does it need a test?** → Add `pi-extension/test/<module>.test.ts`. Mock `pi` and `ctx` per `test/index.test.ts:makeMockPi`. Run `npm test`.
5. **Does it need a doc update?** → Touch `Doc/PRD.md` (add or update a FR-N identifier), `Doc/design.md` (§X.Y reference), `Doc/RTM_Pi-Velpari.md` (link FR-N to TCs).
6. **Run the full gate.** `npm run build` + `npm test` + `bash scripts/e2e-preflight.sh`. All gates must pass.
7. **Commit + update `CHANGELOG.md`.** Follow the Keep-a-Changelog format used in the existing `[v0.5.1]` section.

## When you upgrade

- **New Pi API** → cite the docs URL in code AND in `AGENTS.md` (Coding conventions section).
- **New stage** → follow `Doc/design.md` §3.7 (per-command doc scope). Add a `STAGE_TRANSITIONS` entry in `core/constants.ts`.
- **Folder layout changes** → update THIS FILE first, then move code. Out-of-date folder maps cause onboarding bugs.
- **New peer dep** → add to `package.json:peerDependencies`. Run `npm run build` to confirm the new symbol resolves.
- **New external schema** (e.g. Senai handoff) → pin via test that reads the partner's source at test time (mirrors `handoff.ts:validateSenaiSchema`).
