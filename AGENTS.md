# AGENTS.md — Pi-Velpari

Agent-focused guidance for working on the `pi-velpari` Pi extension. Parallels `Pi-Orchestra_v4/AGENTS.md` so contributors learn one mental model.

---

## Project layout

- `.pi/velpari/` — Velpari's local project config (`files.json` v4 for framework/inputs + code/test/document/excluded paths, `agents.json` for the role→agent mapping, and `requirements-profile.json` for the selected requirements profile).
- `.IDE_Plans/velpari/` — run state, run history, doctor reports. Not a standard Pi directory; Velpari-specific convention.
- `Doc/` — published artifacts (the artifacts of record).
- `.pi/senai/architect-inputs.json` — Velpari's handoff target, consumed by Senai.

## Project overview

`pi-velpari` is a local Pi extension that adds stage-gated orchestration slash commands for the **pre-production** phase of software work:

```
Brainstorm → PRD → RTM → Feasibility → Design → Pseudocode → Test Plan
```

It mirrors Pi-Senai's discipline model (state-gated runs, working/published copy separation, doctor audit, single-source-of-truth state file) for the upstream half of the lifecycle. Velpari produces the requirements package that Senai's `/senai-generate-architect` consumes.

**Velpari spawns visible subagents via `pi-interactive-subagents`.** Stages 2–7 plus the optional post-pipeline stages use 4 parallel subagents each (32 total scouts) that run in multiplexer panes and write report files; brainstorm runs read-only scouts at its scan step (see principle #4). The handler prepares the input, builds the prompt, and hands off to the parent LLM via `pi.sendUserMessage(prompt)`; the parent LLM spawns the subagents via the `subagent()` tool.

## Tech stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js (LTS, currently Node 20+; tests use `node --test`)
- **Package manager:** npm
- **Build:** `tsc` (see `tsconfig.json`)
- **Target layout:** ESM under `dist/`
- **Peer dependencies:** `@earendil-works/pi-coding-agent`, `pi-interactive-subagents` (≥3.7.2 — provides the `subagent` tool for visible subagent panes).
- **No runtime dependencies.** No test framework, no linter.

## Build and test

Always build before testing. The test script builds automatically, but running build first catches TypeScript errors faster.

```bash
npm run build
npm test
```

- `npm run build` — compiles `pi-extension/src/**/*.ts` and `pi-extension/test/**/*.ts` to `dist/pi-extension/`.
- `npm test` — builds, then runs the unit tests: `node --test` over `dist/pi-extension/test/**/*.test.js` excluding `test/e2e/` (Node's built-in runner; no test framework).
- `npm run test:e2e` — builds, then runs the e2e suite (`test/e2e/`, requires `RUN_E2E=1` and `pi` on PATH).

## Layered architecture

`pi-extension/src/` follows the official Pi extension orchestrator architecture: 4 layers — domain → stage-logic → presentation → composition. Each layer has a single concern and a strict dependency direction: a file in layer N may import from any layer < N, never upward. The full map is in `pi-extension/src/layers.ts`; the contributor-facing contract is in `pi-extension/src/AGENTS.md`.

| # | Layer | Folder | Rule |
|---|---|---|---|
| 0 | **Domain** | `core/`, `io/` | Pure logic + atomic-write/io helpers. Imports nothing else from `src/`. Every `fs.write*` goes through `io/atomic-write.ts`. |
| 1 | **Stage logic** | `stages/`, `ops/`, `doctor/`, `view/` | Per-stage handlers + registry; ops commands (approve/status/reset/handoff/configure-*); diagnostics; read-only display. Imports Layer 0 only. |
| 2 | **Presentation** | `ui/`, `hooks/` | TUI widgets; Pi lifecycle hooks (one file per event). Imports Layers 0–1. |
| 3 | **Composition** | `commands/`, `index.ts` | 25 slash commands (one file per command) + `commands/index.ts` wiring; extension entry point. Imports all lower layers; wiring only. |

`ops/` is a velpari-local L1 grouping — the official layer map is silent on ops grouping; it follows the sibling convention of flat per-concern L1 folders. `view/` is likewise velpari-local (read-only display) and kept at L1.

**Layering is enforced by `pi-extension/test/architecture-alignment.test.ts`** — it walks the compiled `dist/pi-extension/src/**` output and asserts no file imports upward across the layer boundary. Adding a new folder requires adding it to the layer map there and in `src/layers.ts`.

## Project structure

```text
.
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
├── AGENTS.md                  # this file
├── .gitignore
├── DevPlan/                   # persistent project roadmap (Phase A→G build order)
│   └── development-order.md
├── pi-extension/src/          # extension source — official 4-layer layout (Phase 0 reorg)
│   ├── index.ts               # composition root: default factory + registerHooks + registerCommands + shortcuts/flags
│   ├── layers.ts              # 4-layer map + dependency rules (machine-readable)
│   ├── AGENTS.md              # layer contract scoped to src/
│   ├── core/                  # L0 — cross-cutting primitives
│   │   ├── constants.ts           # Stage enum, STAGE_TRANSITIONS (19 states), PATHS
│   │   ├── state.ts               # load/save/createRun/advanceStage/clearRun/appendStageEntry (Phase E; atomic save)
│   │   ├── paths.ts               # grouped + legacy helpers (Phase 7 + Phase F probes collapsed)
│   │   ├── compaction.ts          # buildCompactionSummary (zero-LLM)
│   │   ├── stage-runner.ts        # generic two-phase flow (Phase B)
│   │   ├── prompt.ts              # loadStageSkill + buildStagePrompt
│   │   ├── config.ts              # files.json v4 load/save/validate + v3→v4 migration + default excludes
│   │   ├── files-discovery.ts     # discoverProjectFiles — top-level code/doc/test classification (Senai port)
│   │   ├── agents-config.ts       # agents.json role→agent mapping + 3-source agent discovery (Senai port)
│   │   ├── profile.ts             # requirements profile types + persistence (Phase C)
│   │   ├── profiles-library.ts    # built-in profile library + scoring (Phase C)
│   │   ├── psrs.ts                # PSRS section validation + summary rendering + findFrRowsMissingKeywords (RFC 2119)
│   │   ├── frontmatter.ts         # YAML frontmatter stamp/parse for published artifacts
│   │   ├── rtm-data.ts            # RTM JSON sidecar: validateRtmData/diffRtmData/renderRtmMarkdown
│   │   ├── fingerprints.ts        # SHA-256 link fingerprints: hash/extract/check/stamp/countTraceIssues
│   │   └── mvp-coverage.ts        # checkMvpCoverage — Phase-1 (MVP) coverage between published PRD + RTM JSON (shared by doctor + handoff)
│   ├── io/                    # L0 — every fs write; atomic helpers
│   │   ├── atomic-write.ts        # atomicWriteFile + atomicWriteJson (temp + rename)
│   │   └── agents-install.ts      # ensureStageAgents + bundledAgentPath (Phase A probe, F collapsed)
│   ├── stages/                # L1 — stage handlers (8 stage handlers, plus brainstorm + brainstorm-approve which are bespoke)
│   │   ├── registry.ts            # STAGE_REGISTRY + runStage (Phase B; the source of truth for stage config)
│   │   ├── brainstorm/            # /velpari-brainstorm (lifecycle v2): index.ts handler + guard/dispatcher/notes/audit modules
│   │   ├── brainstorm-approve.ts  # /velpari-approve-brainstorm (gated approve; chains into prd; atomic publish)
│   │   ├── prd.ts                 # /velpari-prd
│   │   ├── rtm.ts                 # /velpari-rtm
│   │   ├── prd-rtm.ts             # /velpari-prd-rtm (wrapper: prd then rtm)
│   │   ├── feasibility.ts         # /velpari-feasibility
│   │   ├── design.ts              # /velpari-architecture-generator
│   │   ├── pseudocode.ts          # /velpari-pseudocode
│   │   ├── testplan.ts            # /velpari-testplan
│   │   ├── atomic-function.ts     # /velpari-atomic-function
│   │   ├── development-order.ts   # /velpari-development-order
│   │   └── final-design.ts        # /velpari-design (plan 3; final design consolidation)
│   ├── ops/                   # L1 — ops / approval / setup handlers (velpari-local grouping)
│   │   ├── approve.ts             # /velpari-approve (stages 2–7)
│   │   ├── status.ts              # /velpari-status (Phase E: switched to pi.appendEntry)
│   │   ├── reset.ts               # /velpari-reset
│   │   ├── handoff.ts             # /velpari-handoff (Senai export)
│   │   ├── configure-inputs.ts    # /velpari-configure-inputs pure helpers (ask/buildFilesConfig/buildPathCategoryItems); interactive flow lives in commands/
│   │   └── configure-requirements/   # Phase C split — interview + research + recommend + UI
│   │       ├── index.ts           # UI orchestrator
│   │       ├── interview.ts       # 7-step ask block
│   │       ├── research.ts        # web-research prompt composer
│   │       └── recommend.ts       # labelled pickers + fallbacks
│   ├── doctor/                # L1 — diagnostics (promoted from discipline/doctor/): structured DiagnosticReport + verdict
│   │   ├── index.ts           # runDoctor + handleDoctor + re-exports
│   │   ├── _types.ts          # DiagnosticStatus / Item / Section / Report
│   │   ├── report.ts          # writeDoctorReport + formatDiagnosticReport
│   │   ├── gate.ts            # runPublishGate — doctor checks enforced inside /velpari-approve
│   │   └── checks/
│   │       ├── fix-suggestions.ts       # SUGGESTIONS table + suggestionFor()
│   │       ├── setup-progress.ts        # 6-step first-time-user guide
│   │       ├── secrets.ts               # scanForSecrets + checkSecretScan (Phase 5)
│   │       ├── multiplexer.ts           # detectMultiplexer + detectInteractiveSubagentsVersion
│   │       ├── subagent-extension.ts    # Phase 4a: pi package list health
│   │       ├── stray-files.ts           # Phase 4b: tmp_*.sh / tmp_*.ts debris
│   │       ├── web-tool-lock.ts         # Phase 4c: websearch/fetchurl lock
│   │       ├── official-readiness.ts    # official-artifact readiness check
│   │       ├── agents.ts                # scout file presence + skill markdown integrity + file integrity
│   │       ├── psrs.ts                  # checkPsrsSection (+ RFC 2119 wording warnings)
│   │       ├── rtm.ts                   # checkRtmTraceabilitySection
│   │       ├── frontmatter.ts           # published-artifact frontmatter check
│   │       ├── rtm-data.ts              # RTM JSON sidecar validity + markdown drift check
│   │       ├── fingerprints.ts          # stale-link check: suspect/unknown-id/orphan = error, untracked = warning
│   │       ├── phase-consistency.ts     # PRD Phase column ↔ RTM JSON phase mismatch = error
│   │       ├── mvp-coverage.ts          # MVP coverage X/Y: Phase-1 no-row/uncovered = error, partial/no-tests = warning
│   │       ├── stale-downstream.ts      # adjacent published pairs compared by mtime; deprecated PRD IDs must reach the RTM
│   │       ├── paths.ts                 # checkGroupedLegacyPathsSection
│   │       ├── working-published.ts     # checkWorkingPublishedSeparationSection
│   │       └── profile.ts               # checkRequirementsProfileSection
│   ├── view/                  # L1 — read-only display handlers
│   │   └── show.ts                # /velpari-show-*
│   ├── ui/                    # L2 — TUI widgets
│   │   ├── entry-renderer.ts      # velpari-status entry renderer (Box+Text via @earendil-works/pi-tui)
│   │   ├── simple-picker.ts       # runSimplePicker + runSimpleConfirm (Senai port)
│   │   ├── list-editor.ts         # runListEditor — suggestion/selection list editor (Senai port)
│   │   ├── role-picker.ts         # runRolePicker — role→agent picker (Senai port)
│   │   ├── browse-path.ts         # browsePath interactive fs browser + path helpers (Senai port)
│   │   └── is-tui.ts              # shared TUI-capability check
│   ├── hooks/                 # L2 — one file per Pi lifecycle event
│   │   ├── index.ts               # registerHooks(pi): wires the per-event registrars
│   │   ├── session-start.ts       # status rehydrate/clear + velpari:start emit + stale-link notice
│   │   ├── session-before-compact.ts  # compaction summary + velpari:before-compact emit
│   │   ├── resources-discover.ts  # skillPaths contribution
│   │   ├── before-agent-start.ts  # injects <velpari_status> block into the system prompt every turn
│   │   ├── tool-call.ts           # mutation lock (edit/write scoped to active run folder) + scout report-path requirement
│   │   └── session-shutdown.ts    # velpari:shutdown emit
│   └── commands/              # L3 — one file per command + index.ts wiring only
│       ├── index.ts               # registerCommands + COMMAND_NAMES (composition root)
│       └── <command>.ts           # 27 per-command files (brainstorm, prd, ..., configure-agents, show-testplan)
├── pi-extension/test/         # unit tests run on compiled dist via `npm test` (node:test)
│   ├── architecture-alignment.test.ts  # asserts the 4-layer import rule on dist output
│   └── e2e/                   # live-RPC e2e suite (RUN_E2E=1; run via `npm run test:e2e`)
├── skills/                    # stage skill markdown files + bundled scout agents
│   ├── velpari-brainstorm.md
│   ├── velpari-prd.md
│   ├── velpari-rtm.md
│   ├── velpari-feasibility.md
│   ├── velpari-architecture-generator.md
│   ├── velpari-pseudocode.md
│   ├── velpari-testplan.md
│   ├── velpari-handoff.md
│   ├── velpari-atomic-function.md
│   ├── velpari-development-order.md
│   ├── velpari-configure-requirements.md
│   └── agents/                # 38 bundled scout agent definitions
├── skills/                    # stage skill markdown files + bundled scout agents
│   ├── velpari-brainstorm.md  # parent-LLM program: spawn 4 subagents, wait, iterate, write working copy, preview
│   ├── velpari-prd.md
│   ├── velpari-rtm.md
│   ├── velpari-feasibility.md
│   ├── velpari-architecture-generator.md
│   ├── velpari-pseudocode.md
│   ├── velpari-testplan.md
│   ├── velpari-handoff.md
│   ├── velpari-atomic-function.md
│   ├── velpari-development-order.md
│   └── agents/                # 4 bundled Pi agent definitions (bootstrapped to .pi/agents/ on first /velpari-brainstorm)
│       ├── extractor.md
│       ├── prd-checker.md
│       ├── rtm-checker.md
│       └── web-search-agent.md
├── Doc/                       # published artifacts (artifacts of record)
│   ├── requirements/          # PRD/PSRS + RTM outputs
│   ├── brainstorm/            # brainstorm notes
│   ├── feasibility/          # feasibility studies
│   ├── design/                # design documents
│   ├── pseudocode/            # pseudocode documents
│   ├── tests/                 # test plans and test cases
│   ├── atomic-functions/      # optional atomic-function output
│   ├── development-order/     # optional development-order output
│   ├── PRD.md                  # legacy source PRD (readable fallback)
│   ├── RTM_Pi-Velpari.md       # legacy source RTM (readable fallback)
│   ├── velpari-requirements-orchestration-design.md
│   ├── velpari-sequence.md
│   └── step-by-step-guide.md
└── .IDE_Plans/                # temporary planning artifacts and run state
    └── *.md
```

## Key design principles

1. **Zero hallucination.** Every claim in every artifact traces back to a user-provided statement in a brainstorm note or to an earlier approved artifact. Stage skill markdown enforces this; doctor validates it via cross-reference.
2. **Confirm-then-write.** No file under `Doc/` is written without a user-facing preview and explicit `/velpari-approve`. Working copies in `.IDE_Plans/velpari/runs/` are written freely; published copies in `Doc/` are only produced on approval.
3. **Stage gates are enforced.** A stage cannot start until its prerequisites are approved. The transition table in `constants.ts:STAGE_TRANSITIONS` is the single source of truth.
4. **Scout pattern via real visible subagents.** Stages 2–7 (prd, rtm, feasibility, design, pseudocode, testplan) and the optional post-pipeline stages (atomic-function, development-order) use 4 parallel subagents via the `subagent` tool from `pi-interactive-subagents`. They run in **visible multiplexer panes**. Agent definitions live in `.pi/agents/*.md`, auto-bootstrapped from bundled `skills/agents/*.md` files by `agents-install.ts:ensureStageAgents` on first use. Each scout writes its report to `<runDir>/<stage>/scouts/<name>-report.json`. The parent LLM orchestrates spawning, waiting, optional iterative follow-up rounds, and writes the working-copy artifact. Brainstorm also spawns visible subagents, but only at its SCANS step and read-only (see principle 9). Approve-brainstorm, approve, handoff, show-*, status, reset, configure-inputs, doctor are NOT visible-subagent stages. Agent names are resolved through `.pi/velpari/agents.json` (roles fixed, names swappable — see the coding conventions below); bootstrap installs only default-named roles.
5. **Brainstorm lifecycle v2 — understand-first with a hard lock.** `/velpari-brainstorm` no longer runs a fixed 6-question interview. The parent LLM runs a conversational UNDERSTAND loop, shows a one-paragraph understanding, and nothing below it (scan gate, scout dispatch, notes writing, approve) may run until the user confirms — persisted via `velpari_brainstorm_session({ action: "confirm-understanding" })` into `state.json:understandingConfirmed`.
6. **Decision ledger.** During the brainstorm DISCUSS loop, every question has a state (draft → discussing → agreed / not-wanted(+reason) / replaced) tracked in `state.json:brainstormQuestions` and mirrored into the notes' `## Agreed` / `## Not wanted` / `## Open` sections on every change. Rejected ideas keep their reason — deferred, not forgotten. `/velpari-approve-brainstorm` hard-blocks while any question is draft/discussing.
7. **Scan gate with consent.** After understanding is confirmed, the user picks scans at a single gate: code+doc by default; the community scan IS the web-search consent (FR-52), with run/adjust/skip options. Brainstorm scouts are read-only (dispatcher strips write/edit/bash; community keeps websearch/fetchurl) and report findings back to the parent. Caps: max 3 dispatches per brainstorm, max 2 per scan type.
8. **Gated approve + audit log.** `/velpari-approve-brainstorm` hard-blocks on unconfirmed understanding, open questions, and missing/empty/`_TBD_` notes sections. On success it publishes atomically, writes `<runDir>/brainstorm/brainstorm-dispatch.md` (audit log), clears the 4 brainstorm session fields, advances the stage, and chains into `/velpari-prd`. While a brainstorm is open, a tool_call hook hard-blocks edit/write outside the run's `brainstorm/` folder.
9. **Helper ↔ atomic relationship.** Helper functions are tracked in `Doc/PRD_Pi-Velpari.md` (`## Helper Functions` section). Atomic functions are tracked in `Doc/atomic-functions.md`. Atomic functions are strictly leaf nodes; helper functions may call atomic functions. The dependency is bidirectional.
10. **Optional stages stay optional.** `/velpari-atomic-function`, `/velpari-development-order`, and `/velpari-design` are post-pipeline stages that can be invoked in any order or skipped entirely. `/velpari-design` is the final design consolidation — it reads the approved architecture doc, pseudocode, test plan, and test cases, then produces `Doc/design/final-design_<project>.md` so the Senai handoff has one consolidated reference. `/velpari-handoff` works with or without their output.
11. **Deterministic, not creative.** File paths, file formats, state JSON shape, stage transitions, and the handoff schema are all fixed by code. Only the artifact contents vary per run.
12. **Mirrors Senai's discipline.** The control surface (approve/status/reset/configure/doctor), state file layout, run directory pattern, and scout-pattern UI (4 parallel agents + user-reviewed suggestion picker) are deliberately aligned with Senai so users learn one mental model.
13. **Feasibility v2 — decision stage with evidence.** `/velpari-feasibility` is read-first (user questions only for verdict-blocking gaps), then runs a consent-gated **reuse scan** (`feasibility-reuse-scout`; deterministic core-function checklist → match %; thresholds 70/30; license + repo-freshness health gate), then **language selection** on the build path (configured framework wins; otherwise mandatory **spikes** — one `feasibility-spike` agent per candidate language builds+runs the core function in `<runDir>/feasibility/spikes/`, which is gitignored; ties are decided by the developer). Mid-stage state lives in `state.json:feasibilitySession` via the `velpari_feasibility_session` tool; `/velpari-approve` hard-blocks until decision + selected language are recorded, and the publish gate validates the 13-section v2 template (`core/feasibility-doc.ts`). Schedule/cost/risk sections are lightweight.

## State and artifacts

State file: `.IDE_Plans/velpari/state.json`

Shape:
```ts
interface RunState {
  version: 1;
  runId: string;              // "YYYY-MM-DD-HH-MM-<mission-slug>"
  mission: string;
  currentStage: Stage;
  history: HistoryEntry[];
  updatedAt: string;
  // Brainstorm lifecycle v2 session fields (present only while a
  // brainstorm is open; cleared by /velpari-approve-brainstorm):
  understandingConfirmed?: boolean;   // hard lock — set via the session tool
  scansSelected?: ScanType[];         // scan-gate choice (code/doc/community)
  brainstormQuestions?: BrainstormQuestion[];  // DISCUSS ledger
  brainstormDispatchCount?: number;   // dispatch cap bookkeeping
  // Feasibility v2 session (present only while the feasibility stage is
  // open; cleared by /velpari-approve; missing decision/selectedLanguage
  // hard-blocks the publish):
  feasibilitySession?: FeasibilitySession;  // { reuseConsent, decision, reuseSummary, languageCandidates, spikeResults, selectedLanguage, selectedBy }
}
```

Run artifacts (working copies):
```
.IDE_Plans/velpari/runs/<run-id>/
├── brainstorm/
│   ├── brainstorm-notes.md
│   └── brainstorm-dispatch.md   (audit log, written at approve)
├── prd/PRD_Pi-Velpari.md
├── rtm/
│   ├── RTM_<projectName>.json     (source of truth — validated, fingerprinted)
│   └── RTM_<projectName>.md       (rendered from the JSON at approve)
├── feasibility/
│   ├── feasibility-study.md
│   ├── reuse/<candidate>-checklist.json   (feasibility v2 reuse scan)
│   └── spikes/<language>/ + <language>-result.json   (feasibility v2 spikes; gitignored)
├── design/design.md
├── pseudocode/pseudocode.md
└── testplan/
    ├── test-plan.md
    └── test-cases.md
```

Published copies (new grouped layout, in `Doc/`):
```
Doc/
├── brainstorm/brainstorm-<topic-slug>.md
├── requirements/
│   ├── PRD_<projectName>.md
│   └── RTM_<projectName>.md
├── feasibility/feasibility-study_<projectName>.md
├── design/design_<projectName>.md
├── pseudocode/pseudocode_<projectName>.md
├── tests/
│   ├── test-plan_<projectName>.md
│   └── test-cases_<projectName>.md
├── atomic-functions/atomic-functions_<projectName>.md
└── development-order/development-order_<projectName>.md
```

Legacy flat `Doc/PRD*.md`, `Doc/RTM*.md`, and other old filenames remain readable as fallback paths.

## Stage workflow

| Stage transition | Command that triggers it |
|---|---|
| `none` → `brainstorming` | `/velpari-brainstorm <mission>` |
| `brainstorming` → `brainstormed` → `drafting-prd` | `/velpari-approve-brainstorm` |
| `brainstormed` → `drafting-prd` | `/velpari-prd` |
| `drafting-prd` → `drafted-prd` → `building-rtm` | `/velpari-approve` |
| `drafted-prd` → `building-rtm` | `/velpari-rtm` |
| `building-rtm` → `built-rtm` → `analyzing-feasibility` | `/velpari-approve` |
| `built-rtm` → `analyzing-feasibility` | `/velpari-feasibility` |
| `built-rtm` → `designing` (feasibility skip — gated, see conventions) | `/velpari-architecture-generator` |
| `analyzing-feasibility` → `analyzed-feasibility` → `designing` | `/velpari-approve` |
| `analyzed-feasibility` → `designing` | `/velpari-architecture-generator` |
| `designing` → `designed` → `writing-pseudocode` | `/velpari-approve` |
| `designed` → `writing-pseudocode` | `/velpari-pseudocode` |
| `writing-pseudocode` → `wrote-pseudocode` → `planning-tests` | `/velpari-approve` |
| `wrote-pseudocode` → `planning-tests` | `/velpari-testplan` |
| `planning-tests` → `planned-tests` → `handoff-ready` | `/velpari-approve` |
| `planned-tests` → `finalizing-design` → `finalized-design` | `/velpari-design` (post-pipeline optional; see principle 10) |
| `planned-tests` → `handoff-ready` | `/velpari-handoff` |

Stage transitions are defined in `constants.ts` as `STAGE_TRANSITIONS`.

## Command surface

### Stage commands (10)

- **Core 7 (required):** `/velpari-brainstorm`, `/velpari-prd`, `/velpari-rtm`, `/velpari-feasibility`, `/velpari-architecture-generator`, `/velpari-pseudocode`, `/velpari-testplan`
- **Post-pipeline 3 (optional):** `/velpari-atomic-function`, `/velpari-development-order`, `/velpari-design` (final design consolidation — plan 3)

### Discipline commands (10)

`/velpari-approve`, `/velpari-approve-brainstorm`, `/velpari-status`, `/velpari-reset`, `/velpari-configure-inputs`, `/velpari-configure-requirements`, `/velpari-configure-agents`, `/velpari-agents`, `/velpari-doctor`, `/velpari-handoff`

### Wrapper command (1)

`/velpari-prd-rtm` — calls `/velpari-prd` and `/velpari-rtm` in sequence. Does not duplicate stage logic. Does not auto-approve.

### View commands (7)

`/velpari-show-brainstorm`, `/velpari-show-prd`, `/velpari-show-rtm`, `/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`, `/velpari-show-testplan`

Total: 28 commands.

## Coding conventions

- Use TypeScript strict mode.
- Prefer explicit types; export public interfaces from their modules.
- Use `path.join` for all file-system paths.
- Keep command handlers thin. State logic belongs in `state.ts`; prompt logic belongs in `prompt.ts`.
- Do not mutate loaded state objects in place. Use `advanceStage()` and `saveState()` helpers.
- Notifications should be concise and tell the user the next command to run.
- **Per-command doc scope is the source of truth.** Every stage command's reads and writes are declared in `commands.ts:COMMAND_SCOPE`. Before any LLM call, `checkDocScope` validates that every required input exists and is non-empty. The PRD row for the command, sequence doc §11, design §3.7, pseudocode §17, and test cases §35 must all agree. Drift is a defect.
- **No `/velpari-architect` command.** Velpari produces inputs; Senai generates architecture. Do not add architecture-related commands to Velpari in v1.x. The rationale is in `Doc/design.md` §7.7 and `Doc/PRD.md` (FR-47).
- **No runtime dependency on Senai.** `package.json` does not list Senai. TUI patterns are re-implemented in `pi-extension/src/ui/` using Pi's TUI primitives. Either extension can be removed or refactored without breaking the other. (FR-55)
- **Uniform subagent pattern.** All scout agents follow the `subagent()` invocation via `pi-interactive-subagents`. Each stage handler passes `agent:`, `cwd:`, `task:` and `auto-exit: true`. Stages 2–9 route through `pi-extension/src/core/stage-runner.ts:runStageWithScouts()`; brainstorm dispatches are validated by `stages/brainstorm/dispatcher.ts` (read-only tools enforced). No in-process scout API.
- **Roles are fixed, agent names are swappable (Senai parity).** The 38 scout ids (4 brainstorm + 32 stage + 2 feasibility-conditional: `feasibility-reuse-scout`, `feasibility-spike`) are roles defined in `core/agents-config.ts:VELPARI_ROLES`. `.pi/velpari/agents.json` (managed by `/velpari-configure-agents`, viewable via `/velpari-agents`) maps a role to a custom agent name; absence of the file means all defaults. Report paths stay role-keyed (`<role>-report.json`), so custom names never break report collection. The FR-52 web-search consent is anchored on the `web-search-agent` ROLE, not the spawned agent name — remapping cannot bypass it. Doctor's "Agent mapping (agents.json)" section validates the file and that every mapped agent exists.
- **Framework is one-time setup.** Framework/tech-stack is captured in `/velpari-configure-inputs`, persisted in `.pi/velpari/files.json:framework`, and injected into every stage prompt. The same command also configures code/test/document/excluded paths (files.json v4) through a discovery-backed list editor (`core/files-discovery.ts:discoverProjectFiles` + the `ui/` picker widgets). It is NOT a pipeline stage. Do not add a `/velpari-framework` command. (FR-49)
- **WEB SEARCH AGENT is consented at the scan gate.** The community scan (web-search-agent) runs only when the user picks it at the brainstorm scan-plan gate (run/adjust/skip). Never auto-invoke. The dispatcher hard-rejects web-search-agent for non-community scans. The decision is per-brainstorm. (FR-52)
- **Brainstorm approval uses `/velpari-approve-brainstorm`, NOT `/velpari-approve`** (v1.6). The brainstorm stage has its own dedicated approve command. `/velpari-approve-brainstorm` hard-blocks on unconfirmed understanding, open (draft/discussing) questions, and missing/empty/`_TBD_` notes sections; on success it publishes `Doc/brainstorm/brainstorm-<topic-slug>.md`, writes the dispatch audit log, clears the brainstorm session fields, and **auto-invokes `/velpari-prd`** to chain into the PRD stage. `/velpari-approve` errors when in brainstorm stage. Use `/velpari-approve` only for stages 2–7 (prd, rtm, feasibility, design, pseudocode, testplan). (FR-58, FR-59, NFR-14)
- **Output documents use `projectName` suffix** (v1.7). All output file names are derived from the `projectName` captured in `/velpari-configure-inputs`. Example: `Doc/requirements/PRD_TodoApp.md`, not `Doc/PRD_Pi-Velpari.md`. Brainstorm is per-topic: `Doc/brainstorm/brainstorm-{topic-slug}.md`. Use `pi-extension/src/paths.ts:buildGroupedPath()` and `resolveDocArtifact()` for the naming + lookup logic. Never hardcode "Pi-Velpari" in any file path. (FR-67..FR-71, NFR-15)
- **Grouped Doc/ layout (Phase 7 / Requirements Factory).** New writes go to category subfolders under `Doc/` (`Doc/brainstorm/`, `Doc/requirements/`, `Doc/feasibility/`, `Doc/design/`, `Doc/pseudocode/`, `Doc/tests/`, `Doc/atomic-functions/`, `Doc/development-order/`). Legacy flat paths remain readable as fallback everywhere; nothing is moved, deleted, or overwritten. Use `pi-extension/src/paths.ts:resolveDocArtifact()` for cross-layout reads.
- **PSRS shape (Phase 7).** The PRD document is a combined Product and Software Requirements Specification. Keep the file name `PRD_<projectName>.md` for compatibility. Required sections (validated by `pi-extension/src/core/psrs.ts`, strict — all 20 are errors when missing): Objective, Problem, System Actors, User Stories, Scope, MVP, Success Metrics, Phases, Functional Requirements, Non-Functional Requirements, Data and Interfaces, Errors and Edge Cases, Constraints, Dependencies and Risks, Out of Scope, Open Questions, Acceptance Criteria, Helper Function Candidates, Glossary, Change Log. The User Stories, Success Metrics, Functional Requirements, and Non-Functional Requirements tables must carry a `Status` column (`proposed | approved | implemented | verified | deferred | deprecated`). RTM is a separate document.
- **Living documents / update mode.** Any change to an approved artifact starts at `/velpari-brainstorm` (change mode: the prompt carries `## Existing Project Context` with published paths + config + history) and flows through the sequence — stages revise, never regenerate. When a stage's published artifact exists, `runStage` auto-detects update mode and injects the baseline + 5 revision rules into the prompt: append-only IDs (never renumber/reuse), deprecate-don't-delete (removals stay with status `deprecated` + reason), version bump (minor for additions-only, major for deprecations or acceptance-criteria changes), mandatory Change Log entry, new rows start `proposed`. `/velpari-approve` enforces this at publish time: PRD revisions must pass `comparePsrs` (no dropped IDs, version bumped, new Change Log line); every other artifact must add a new Change Log line. A blocked revision publishes nothing and does not advance the stage.
- **Sequence hardening.** The stage order is enforced, not advisory: `STAGE_GATE` in `stages/registry.ts` rejects any stage command run from the wrong stage and names the correct command; `io/run-lock.ts` serializes every `state.json` mutation (mkdir lock + heartbeat + stale-steal) so concurrent sessions cannot corrupt the run; the `tool_call` hook locks edit/write to the active stage's run folder while a draft is in progress (publishing goes through `/velpari-approve` only) and requires every scout `subagent` spawn to declare its `-report.json` path; the `before_agent_start` hook injects a `<velpari_status>` block (stage, run, next command, hard rule) into the system prompt every turn so the discipline survives compaction. Doctor audits the wiring (`Sequence hardening` section) and flags stale downstream artifacts.
- **Feasibility skip (update cycles).** When a run sits at `built-rtm` and a published feasibility study already exists (`core/paths.ts:hasPublishedFeasibility` — grouped layout or legacy fallback), `/velpari-architecture-generator` is allowed from `built-rtm` and advances straight to `designing`. The skip is a choice, never forced: `/velpari-feasibility` stays available to revise the study. The conditional transition lives in `STAGE_TRANSITIONS`; the registry gate unblocks it only when the published doc exists; `nextCommandsFor(stage, { feasibilitySkip })` hides the skip from every suggestion surface (status block, gate errors) unless the flag is set; the `before_agent_start` hook and the post-RTM-approve notification compute the flag from the live Doc/ tree.
- **Design stage command is `/velpari-architecture-generator`.** The former `/velpari-design` name was retired (no stub left behind; the name is reserved for a future command). Only the command string, the registry StageKey (`architecture-generator`), the command file (`commands/architecture-generator.ts`), and the skill file (`skills/velpari-architecture-generator.md`) moved — stage STATE values (`designing`/`designed`), artifact names (`Doc/design/design_<project>.md`), scout roles (`design-*`), and `/velpari-show-design` are unchanged.
- **Requirements profile (Phase 7, v1.1).** `/velpari-configure-requirements` is the only entrypoint that mutates `.pi/velpari/requirements-profile.json`. The handler uses native Pi selectors (`ctx.ui.select(title, options)`) for fixed choices, `ctx.ui.input(title, placeholder)` for free text, and `ctx.ui.confirm(title, message)` for yes/no. Profile selection is **optional**. Web-research consent is collected immediately after the answers and before recommendations; the research prompt explicitly states `Profile selection: PENDING`, says `MUST NOT save or write a profile`, and never includes a final selected profile id. The handler surfaces up to three deterministic `ProfileRecommendation` entries: the **common PSRS core** (`core-psrs-v1`, always present, a real choice) plus up to two closest built-in profiles, each with a 0–100 score, reasons, and trade-offs. When no built-in matches exactly, the handler offers `Use common PSRS core` / `Use closest built-in profile` / `Update Velpari` / `Stop` via native selector — no fake custom-profile action. Doctor reports profile mode (`common-core` or `built-in`), id, version, research consent + source count, and the report-only stance; it never selects, fixes, or mutates a profile.
- **Stage runner carries only compact profile metadata.** `StageRunConfig.profileMetadata` is a `CompactProfileMetadata` projection, never the full profile. The prompt renders it as a `## Profile (compact)` block; the block is omitted when the field is absent.
- No subagent-spawning code anywhere. If you find yourself reaching for a subagent API, re-read the design principles.
- **`ctx.ui.setStatus(key, text)` is the TUI footer status API** (v0.5.1). Per `@earendil-works/pi-coding-agent/docs/extensions.md` and `docs/tui.md`, the API lives on `ctx.ui`, NOT on `pi` directly. Pass `text: undefined` to clear the entry for that key. Velpari uses the key `"velpari"` exclusively. `session_start` clears any leftover bar from a prior session; `handleStatus`, `handleApprove`, and `handleApproveBrainstorm` push `stage: <s> | mission/run: <m>` after every state transition.
- **`--velpari-skip-doctor` and `--velpari-stage` flags** (v0.5.0 + v0.5.1). Both flags are registered via `pi.registerFlag` in `index.ts`. `handleDoctor` honors `--velpari-skip-doctor` to skip the doctor check pass. `advanceStage` honors `--velpari-stage` as a hard override of the target stage when present.
- **RTM JSON sidecar is the source of truth.** The RTM stage writes `<runDir>/rtm/RTM_<projectName>.json` (validated by `core/rtm-data.ts:validateRtmData`); `/velpari-approve` regenerates the published markdown from the JSON via `renderRtmMarkdown`, so the markdown can never drift from the data. Edit the JSON, never the published markdown.
- **SHA-256 fingerprints on every RTM link.** `core/fingerprints.ts` hashes the published PSRS requirement each RTM row traces to; `/velpari-approve` stamps the hashes at publish time. Doctor's `Fingerprints` section reports `suspect` (source changed), `unknown-id`, and `orphan` (no target) links as errors and `untracked` rows as warnings. `fingerprints.ts:countTraceIssues` feeds the session-start status-bar notice (`trace: N suspect/orphan link(s)`).
- **Publish gate.** `/velpari-approve` runs `doctor/gate.ts:runPublishGate` before publishing: the PRD must pass `validatePsrs` and RTM rows are checked against PSRS fingerprints. Errors block the publish (nothing written, stage not advanced); warnings are shown but do not block. Doctor stays the manual full audit; the gate is the automatic subset that runs on every approve.
- **RFC 2119 + EARS requirement wording.** FR/NFR rows must use `shall`/`should`/`may` (RFC 2119) and EARS patterns (see `skills/velpari-prd.md`). `core/psrs.ts:findFrRowsMissingKeywords` flags rows without keywords; doctor reports them as warnings in the PSRS section.
- **YAML frontmatter on published artifacts.** Every published artifact carries frontmatter (`artifact`, `runId`, `stage`, `version`, `generatedAt`) stamped by `core/frontmatter.ts` at approve time; all 7 stage skill templates show the block. Doctor's `Frontmatter` section validates it.
- **Phase vocabulary (MVP traceability).** Every FR/NFR row carries a mandatory `Phase` column (positive integer; **Phase 1 = MVP**, matching PRD §8 Phases). Enforced by `validatePsrs`; the MVP §6 "MVP Requirements" list must name only Phase-1 ids. The RTM JSON requires `phase` per row, must equal the PRD phase (publish gate + doctor `Phase consistency` section), and renders as a Phase column. Phase edits in the PRD flag RTM rows as suspect via fingerprints.
- **MVP coverage gate.** `core/mvp-coverage.ts:checkMvpCoverage` compares the published PRD's Phase-1 ids against the RTM JSON. Doctor's `MVP coverage` section reports `X/Y covered` (no-row/uncovered = error, partial/no-tests = warning). `/velpari-handoff` blocks on errors, warns otherwise — handoff is the "MVP is ready" signal.

## Testing

- Tests are in `pi-extension/test/` using Node's built-in test runner.
- Each test file focuses on one module.
- Tests use temporary directories created with `fs.mkdtempSync`.
- When testing commands, build the handler map by calling `registerCommands` with a mock `ExtensionAPI`.
- The handoff test reads `Pi-Orchestra_v4/pi-extension/src/architect-inputs-config.ts` at test time to verify schema compatibility.
- E2E tests are in `pi-extension/test/e2e/` (6 suites: registration, doctor, config, stage-gates, brainstorm-gates, ops-doctor). They drive a real `pi --mode rpc` process and call the built modules through the RPC `bash` channel with capture fakes for `ctx.ui.*` / `pi.sendUserMessage`. Run with `npm run test:e2e` (needs `RUN_E2E=1` + `pi` on PATH). Embedded bash-channel scripts must not contain backticks or `${...}` — use string concatenation (see the e2e README).

## Extension loading

The extension has a guard against loading inside subagent processes:

```typescript
if (process.env.PI_SUBAGENT_NAME) return;
```

**This guard is unverified** — `PI_SUBAGENT_NAME` is not documented in the official Pi extension API (verified 2026-09-02 against github.com/earendil-works/pi). The guard is kept as a defensive check. If it ever breaks a real subagent spawn, remove it and rely on the in-session command registration model (Pi does not pass `/velpari-*` commands to subagents because subagents run their own command namespace).

## Install (canonical)

The canonical install path is `pi install npm:@adi-mudi/pi-velpari`. For local dev with hot-reload, build then symlink `dist/pi-extension/src` to `~/.pi/agent/extensions/pi-velpari`. Both paths are equivalent; the npm install is canonical. See `README.md` "Install" section for the full sequence.

## Cross-extension compatibility

`/velpari-handoff` writes `.pi/senai/architect-inputs.json` whose schema must remain compatible with Senai's `/senai-configure-architect-inputs` and `/senai-generate-architect`. The schema is verified by reading Senai's `architect-inputs-config.ts` at test time. When Senai updates its schema, update `pi-extension/src/ops/handoff.ts:validateSenaiSchema` in lockstep.

## Documentation

When changing behavior, update both code-facing docs (`README.md`, `CHANGELOG.md`) and design docs (`Doc/*.md`) plus stage skill files (`skills/*.md`) if the user-facing workflow changes.

### Doc map

- `Doc/velpari-sequence.md` — 9-stage sequence flow + scout pattern + sub-sequence table + traceability discipline (frontmatter, RTM JSON sidecar, fingerprints, phase/MVP coverage).

The historical design docs (PRD.md, RTM_Pi-Velpari.md, feasibility-study.md, design.md, pseudocode.md, test-plan.md, test-cases.md, step-by-step-guide.md, architecture-discussion.md, velpari-requirements-orchestration-design.md) were deliberately removed in commit `5640e43` (non-code docs cleanup). Current behavior is specified by this file, `CHANGELOG.md`, `Doc/velpari-sequence.md`, and the `skills/*.md` stage programs; recover historical content from git history if ever needed.

## Branches

Active development happens on the `dev` branch. Do not run git mutations (commit, push, reset, rebase) unless explicitly asked.
