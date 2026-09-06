# AGENTS.md — Pi-Velpari

Agent-focused guidance for working on the `pi-velpari` Pi extension. Parallels `Pi-Orchestra_v4/AGENTS.md` so contributors learn one mental model.

---

## Project layout

- `.pi/velpari/` — Velpari's local project config (`files.json` for framework/inputs and `requirements-profile.json` for the selected requirements profile).
- `.IDE_Plans/velpari/` — run state, run history, doctor reports. Not a standard Pi directory; Velpari-specific convention.
- `Doc/` — published artifacts (the artifacts of record).
- `.pi/senai/architect-inputs.json` — Velpari's handoff target, consumed by Senai.

## Project overview

`pi-velpari` is a local Pi extension that adds stage-gated orchestration slash commands for the **pre-production** phase of software work:

```
Discussion → PRD → RTM → Feasibility → Design → Pseudocode → Test Plan
```

It mirrors Pi-Senai's discipline model (state-gated runs, working/published copy separation, doctor audit, single-source-of-truth state file) for the upstream half of the lifecycle. Velpari produces the requirements package that Senai's `/senai-generate-architect` consumes.

**Velpari spawns visible subagents via `pi-interactive-subagents`.** Each of the 9 stage commands uses 4 parallel subagents (36 total scouts) that run in multiplexer panes. The handler prepares the input, builds the prompt, and hands off to the parent LLM via `pi.sendUserMessage(prompt)`; the parent LLM spawns the subagents via the `subagent()` tool. See principle #4 below.

## Tech stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js (LTS, currently Node 20+; tests use `node --test`)
- **Package manager:** npm
- **Build:** `tsc` (see `tsconfig.json`)
- **Target layout:** ESM under `dist/`
- **Peer dependencies:** `@earendil-works/pi-coding-agent`, `@earendil-works/pi-interactive-subagents` (≥3.7.2 — provides the `subagent` tool for visible subagent panes).
- **No runtime dependencies.** No test framework, no linter.

## Build and test

Always build before testing. The test script builds automatically, but running build first catches TypeScript errors faster.

```bash
npm run build
npm test
```

- `npm run build` — compiles `pi-extension/src/**/*.ts` to `dist/pi-extension/`.
- `npm test` — builds, then runs `node --test dist/pi-extension/test/**/*.test.js`.

## Layered architecture

`pi-extension/src/` is organized into 8 layers, mirroring Senai's `architecture-upgrade` convention. Each layer has a single concern and a strict dependency direction: lower-numbered layers can be imported by higher-numbered ones, never the reverse.

| # | Layer | Folder | Rule |
|---|---|---|---|
| 1 | **Domain** | `core/` | Pure logic only. No IO. Touches `node:path` only for string-building. |
| 2 | **IO** | `io/` | Every `fs.write*Sync` lives here. Atomic writes mandatory for `state.json` and any artifact. |
| 3 | **Hooks** | `hooks/` | One file per lifecycle event (`session_start`, `resources_discover`, `session_shutdown`). Imports only from `core/` and `io/`. |
| 4 | **Stages** | `stages/` | One file per stage handler. Imports from `core/`, `io/`, `commands/`. |
| 5 | **Discipline** | `discipline/` | Ops / approval / setup / doctor. Imports from any lower layer. Never directly from `io/` (goes through `commands/`). |
| 6 | **View** | `view/` | Read-only display. No mutation. `readFileSync` is OK; writes are not. |
| 7 | **UI** | `ui/` | TUI widgets. Imports only from `@earendil-works/pi-tui` and `core/`. Never touches IO directly. |
| 8 | **Commands** | `commands/` | Composition root (`index.ts` exports `registerCommands`). Imports from all other layers; orchestrator only. |

**Layering is enforced by `pi-extension/test/architecture-alignment.test.ts`** — it asserts no source file imports the moved paths (`core/agents-install`, `core/commands`). Adding a new layer requires adding a corresponding assertion.

The `prompts/` placeholder folder was removed in Phase 0; future prompt modules live alongside `core/prompt.ts`.

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
├── pi-extension/src/          # extension source — organized by concern (Phase A)
│   ├── index.ts               # entry point: default factory + Pi lifecycle hooks + shortcuts/flags/events (Phases A, E, F)
│   ├── core/                  # cross-cutting primitives
│   │   ├── commands.ts            # registerCommands + 25 handler shells
│   │   ├── constants.ts           # Stage enum, STAGE_TRANSITIONS (19 states), PATHS
│   │   ├── state.ts               # load/save/createRun/advanceStage/clearRun/appendStageEntry (Phase E)
│   │   ├── paths.ts               # grouped + legacy helpers (Phase 7 + Phase F probes collapsed)
│   │   ├── compaction.ts          # buildCompactionSummary (zero-LLM)
│   │   ├── agents-install.ts       # ensureStageAgents + bundledAgentPath (Phase A probe, F collapsed)
│   │   ├── stage-runner.ts        # generic two-phase flow (Phase B)
│   │   ├── prompt.ts              # loadStageSkill + buildStagePrompt
│   │   ├── config.ts              # files.json load/save/validate
│   │   ├── profile.ts             # requirements profile types + persistence (Phase C)
│   │   └── profiles-library.ts    # built-in profile library + scoring (Phase C)
│   ├── stages/                 # stage handlers (8 stage handlers, plus discuss + discuss-approve which are bespoke)
│   │   ├── registry.ts            # STAGE_REGISTRY + runStage (Phase B; the source of truth for stage config)
│   │   ├── discuss.ts             # /velpari-discuss (v2.0): bespoke 6-question interview + web-search consent
│   │   ├── discuss-approve.ts     # /velpari-approve-discuss (chains into prd)
│   │   ├── prd.ts                 # /velpari-prd
│   │   ├── rtm.ts                 # /velpari-rtm
│   │   ├── feasibility.ts         # /velpari-feasibility
│   │   ├── design.ts              # /velpari-design
│   │   ├── pseudocode.ts          # /velpari-pseudocode
│   │   ├── testplan.ts            # /velpari-testplan
│   │   ├── atomic-function.ts     # /velpari-atomic-function
│   │   └── development-order.ts   # /velpari-development-order
│   ├── discipline/             # ops / approval / setup handlers
│   │   ├── approve.ts             # /velpari-approve (stages 2–7)
│   │   ├── status.ts              # /velpari-status (Phase E: switched to pi.appendEntry)
│   │   ├── reset.ts               # /velpari-reset
│   │   ├── doctor/                # v3 (Phase 0–5): structured DiagnosticReport + verdict
│   │   │   ├── index.ts           # runDoctor + handleDoctor + re-exports
│   │   │   ├── _types.ts          # DiagnosticStatus / Item / Section / Report
│   │   │   ├── _helpers.ts        # (reserved for shared helpers)
│   │   │   ├── report.ts          # writeDoctorReport + formatDiagnosticReport
│   │   │   └── checks/
│   │   │       ├── fix-suggestions.ts       # SUGGESTIONS table + suggestionFor()
│   │   │       ├── setup-progress.ts        # 6-step first-time-user guide
│   │   │       ├── secrets.ts               # scanForSecrets + checkSecretScan (Phase 5)
│   │   │       ├── multiplexer.ts           # detectMultiplexer + detectInteractiveSubagentsVersion
│   │   │       ├── subagent-extension.ts    # Phase 4a: pi package list health
│   │   │       ├── stray-files.ts           # Phase 4b: tmp_*.sh / tmp_*.ts debris
│   │   │       ├── web-tool-lock.ts         # Phase 4c: websearch/fetchurl lock
│   │   │       ├── agents.ts                # scout file presence + skill markdown integrity + file integrity
│   │   │       ├── psrs.ts                  # checkPsrsSection
│   │   │       ├── rtm.ts                   # checkRtmTraceabilitySection
│   │   │       ├── paths.ts                 # checkGroupedLegacyPathsSection
│   │   │       ├── working-published.ts     # checkWorkingPublishedSeparationSection
│   │   │       └── profile.ts               # checkRequirementsProfileSection
│   │   ├── handoff.ts             # /velpari-handoff (Senai export)
│   │   ├── configure-inputs.ts    # /velpari-configure-inputs
│   │   └── configure-requirements/   # Phase C split — interview + research + recommend + UI
│   │       ├── index.ts           # UI orchestrator
│   │       ├── interview.ts       # 7-step ask block
│   │       ├── research.ts        # web-research prompt composer
│   │       └── recommend.ts       # labelled pickers + fallbacks
│   ├── view/                   # read-only display handlers
│   │   └── show.ts                # /velpari-show-*
│   ├── prompts/                # (reserved for future prompt sub-modules)
│   └── ui/                     # (reserved for future UI sub-modules)
├── pi-extension/test/         # one test file per src module + per-check (37+ files)
│   # Phase A follow-up: agents-install-path.test.ts + prompt-path.test.ts
│   # Phase B follow-up: registry.test.ts (4 edge tests)
│   # Phase C follow-up: requirements-profile.test.ts (migration test)
│   # Phase D follow-up: doctor.test.ts (handleDoctor + truncation)
│   # Phase E follow-up: index.test.ts (events + registration tests)
│   # Phase F follow-up: index.test.ts (resources_discover test)
├── skills/                    # stage skill markdown files + bundled scout agents
│   ├── velpari-discuss.md
│   ├── velpari-prd.md
│   ├── velpari-rtm.md
│   ├── velpari-feasibility.md
│   ├── velpari-design.md
│   ├── velpari-pseudocode.md
│   ├── velpari-testplan.md
│   ├── velpari-handoff.md
│   ├── velpari-atomic-function.md
│   ├── velpari-development-order.md
│   ├── velpari-configure-requirements.md
│   └── agents/                # 36 bundled scout agent definitions
├── skills/                    # stage skill markdown files + bundled scout agents
│   ├── velpari-discuss.md     # parent-LLM program: spawn 4 subagents, wait, iterate, write working copy, preview
│   ├── velpari-prd.md
│   ├── velpari-rtm.md
│   ├── velpari-feasibility.md
│   ├── velpari-design.md
│   ├── velpari-pseudocode.md
│   ├── velpari-testplan.md
│   ├── velpari-handoff.md
│   ├── velpari-atomic-function.md
│   ├── velpari-development-order.md
│   └── agents/                # 4 bundled Pi agent definitions (bootstrapped to .pi/agents/ on first /velpari-discuss)
│       ├── extractor.md
│       ├── prd-checker.md
│       ├── rtm-checker.md
│       └── web-search-agent.md
├── Doc/                       # published artifacts (artifacts of record)
│   ├── requirements/          # PRD/PSRS + RTM outputs
│   ├── discussion/            # discussion notes
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

1. **Zero hallucination.** Every claim in every artifact traces back to a user-provided statement in a discussion note or to an earlier approved artifact. Stage skill markdown enforces this; doctor validates it via cross-reference.
2. **Confirm-then-write.** No file under `Doc/` is written without a user-facing preview and explicit `/velpari-approve`. Working copies in `.IDE_Plans/velpari/runs/` are written freely; published copies in `Doc/` are only produced on approval.
3. **Stage gates are enforced.** A stage cannot start until its prerequisites are approved. The transition table in `constants.ts:STAGE_TRANSITIONS` is the single source of truth.
4. **Scout pattern via real visible subagents (v2.0 — all 9 stages).** All 9 stage commands (discuss, prd, rtm, feasibility, design, pseudocode, testplan, atomic-function, development-order) use 4 parallel subagents (36 total scouts) via the `subagent` tool from `@earendil-works/pi-interactive-subagents`. They run in **visible multiplexer panes**. Agent definitions live in `.pi/agents/*.md`, auto-bootstrapped from bundled `skills/agents/*.md` files by `agents-install.ts:ensureStageAgents` on first use. Each scout writes its report to `<runDir>/<stage>/scouts/<name>-report.json`. The parent LLM orchestrates spawning, waiting, optional iterative follow-up rounds, and writes the working-copy artifact. Stages 2–7 (prd, rtm, feasibility, design, pseudocode, testplan) follow the pattern; the optional post-pipeline stages (atomic-function, development-order) also follow it. Discussion, approve-discuss, approve, handoff, show-*, status, reset, configure-inputs, doctor are NOT visible-subagent stages.
5. **Helper ↔ atomic relationship.** Helper functions are tracked in `Doc/PRD_Pi-Velpari.md` (`## Helper Functions` section). Atomic functions are tracked in `Doc/atomic-functions.md`. Atomic functions are strictly leaf nodes; helper functions may call atomic functions. The dependency is bidirectional.
6. **Optional stages stay optional.** `/velpari-atomic-function` and `/velpari-development-order` are post-pipeline stages that can be invoked in any order or skipped entirely. `/velpari-handoff` works with or without their output.
7. **Deterministic, not creative.** File paths, file formats, state JSON shape, stage transitions, and the handoff schema are all fixed by code. Only the artifact contents vary per run.
8. **Mirrors Senai's discipline.** The control surface (approve/status/reset/configure/doctor), state file layout, run directory pattern, and scout-pattern UI (4 parallel agents + user-reviewed suggestion picker) are deliberately aligned with Senai so users learn one mental model.

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
}
```

Run artifacts (working copies):
```
.IDE_Plans/velpari/runs/<run-id>/
├── discuss/discussion-notes.md
├── prd/PRD_Pi-Velpari.md
├── rtm/RTM_Pi-Velpari.md
├── feasibility/feasibility-study.md
├── design/design.md
├── pseudocode/pseudocode.md
└── testplan/
    ├── test-plan.md
    └── test-cases.md
```

Published copies (new grouped layout, in `Doc/`):
```
Doc/
├── discussion/discussion-<topic-slug>.md
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
| `none` → `discussing` | `/velpari-discuss <mission>` |
| `discussing` → `discussed` → `drafting-prd` | `/velpari-approve-discuss` |
| `discussed` → `drafting-prd` | `/velpari-prd` |
| `drafting-prd` → `drafted-prd` → `building-rtm` | `/velpari-approve` |
| `drafted-prd` → `building-rtm` | `/velpari-rtm` |
| `building-rtm` → `built-rtm` → `analyzing-feasibility` | `/velpari-approve` |
| `built-rtm` → `analyzing-feasibility` | `/velpari-feasibility` |
| `analyzing-feasibility` → `analyzed-feasibility` → `designing` | `/velpari-approve` |
| `analyzed-feasibility` → `designing` | `/velpari-design` |
| `designing` → `designed` → `writing-pseudocode` | `/velpari-approve` |
| `designed` → `writing-pseudocode` | `/velpari-pseudocode` |
| `writing-pseudocode` → `wrote-pseudocode` → `planning-tests` | `/velpari-approve` |
| `wrote-pseudocode` → `planning-tests` | `/velpari-testplan` |
| `planning-tests` → `planned-tests` → `handoff-ready` | `/velpari-approve` |
| `planned-tests` → `handoff-ready` | `/velpari-handoff` |

Stage transitions are defined in `constants.ts` as `STAGE_TRANSITIONS`.

## Command surface

### Stage commands (9)

- **Core 7 (required):** `/velpari-discuss`, `/velpari-prd`, `/velpari-rtm`, `/velpari-feasibility`, `/velpari-design`, `/velpari-pseudocode`, `/velpari-testplan`
- **Post-pipeline 2 (optional):** `/velpari-atomic-function`, `/velpari-development-order`

### Discipline commands (8)

`/velpari-approve`, `/velpari-approve-discuss`, `/velpari-status`, `/velpari-reset`, `/velpari-configure-inputs`, `/velpari-configure-requirements`, `/velpari-doctor`, `/velpari-handoff`

### Wrapper command (1)

`/velpari-prd-rtm` — calls `/velpari-prd` and `/velpari-rtm` in sequence. Does not duplicate stage logic. Does not auto-approve.

### View commands (7)

`/velpari-show-discussion`, `/velpari-show-prd`, `/velpari-show-rtm`, `/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`, `/velpari-show-testplan`

Total: 25 commands.

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
- **Uniform subagent pattern.** All 36 scout agents follow the `subagent()` invocation via `@earendil-works/pi-interactive-subagents`. Each stage handler passes `agent:`, `cwd:`, `task:` and `auto-exit: true`. Use `pi-extension/src/stage-runner.ts:runStageWithScouts()` for any stage that spawns subagents. No in-process scout API.
- **Framework is one-time setup.** Framework/tech-stack is captured in `/velpari-configure-inputs`, persisted in `.pi/velpari/files.json:framework`, and injected into every stage prompt. It is NOT a pipeline stage. Do not add a `/velpari-framework` command. (FR-49)
- **WEB SEARCH AGENT is user-prompted.** After the multi-turn interview, the user is asked "do you want a web search?" (yes/no). Do not auto-invoke the web search. The decision is per-discussion. (FR-52)
- **Discussion approval uses `/velpari-approve-discuss`, NOT `/velpari-approve`** (v1.6). The discussion stage has its own dedicated approve command. `/velpari-approve-discuss` publishes `Doc/discussion/discussion-<topic-slug>.md` and **auto-invokes `/velpari-prd`** to chain into the PRD stage. `/velpari-approve` errors when in discussion stage. Use `/velpari-approve` only for stages 2–7 (prd, rtm, feasibility, design, pseudocode, testplan). (FR-58, FR-59, NFR-14)
- **Output documents use `projectName` suffix** (v1.7). All output file names are derived from the `projectName` captured in `/velpari-configure-inputs`. Example: `Doc/requirements/PRD_TodoApp.md`, not `Doc/PRD_Pi-Velpari.md`. Discussion is per-topic: `Doc/discussion/discussion-{topic-slug}.md`. Use `pi-extension/src/paths.ts:buildGroupedPath()` and `resolveDocArtifact()` for the naming + lookup logic. Never hardcode "Pi-Velpari" in any file path. (FR-67..FR-71, NFR-15)
- **Grouped Doc/ layout (Phase 7 / Requirements Factory).** New writes go to category subfolders under `Doc/` (`Doc/discussion/`, `Doc/requirements/`, `Doc/feasibility/`, `Doc/design/`, `Doc/pseudocode/`, `Doc/tests/`, `Doc/atomic-functions/`, `Doc/development-order/`). Legacy flat paths remain readable as fallback everywhere; nothing is moved, deleted, or overwritten. Use `pi-extension/src/paths.ts:resolveDocArtifact()` for cross-layout reads.
- **PSRS shape (Phase 7).** The PRD document is a combined Product and Software Requirements Specification. Keep the file name `PRD_<projectName>.md` for compatibility. Required sections (validated by `pi-extension/src/psrs.ts`): Objective, Problem, System Actors, Scope, MVP, Phases, Functional Requirements, Non-Functional Requirements, Data and Interfaces, Errors and Edge Cases, Constraints, Dependencies and Risks, Out of Scope, Open Questions, Acceptance Criteria, Helper Function Candidates. RTM is a separate document.
- **Requirements profile (Phase 7, v1.1).** `/velpari-configure-requirements` is the only entrypoint that mutates `.pi/velpari/requirements-profile.json`. The handler uses native Pi selectors (`ctx.ui.select(title, options)`) for fixed choices, `ctx.ui.input(title, placeholder)` for free text, and `ctx.ui.confirm(title, message)` for yes/no. Profile selection is **optional**. Web-research consent is collected immediately after the answers and before recommendations; the research prompt explicitly states `Profile selection: PENDING`, says `MUST NOT save or write a profile`, and never includes a final selected profile id. The handler surfaces up to three deterministic `ProfileRecommendation` entries: the **common PSRS core** (`core-psrs-v1`, always present, a real choice) plus up to two closest built-in profiles, each with a 0–100 score, reasons, and trade-offs. When no built-in matches exactly, the handler offers `Use common PSRS core` / `Use closest built-in profile` / `Update Velpari` / `Stop` via native selector — no fake custom-profile action. Doctor reports profile mode (`common-core` or `built-in`), id, version, research consent + source count, and the report-only stance; it never selects, fixes, or mutates a profile.
- **Stage runner carries only compact profile metadata.** `StageRunConfig.profileMetadata` is a `CompactProfileMetadata` projection, never the full profile. The prompt renders it as a `## Profile (compact)` block; the block is omitted when the field is absent.
- No subagent-spawning code anywhere. If you find yourself reaching for a subagent API, re-read the design principles.
- **`ctx.ui.setStatus(key, text)` is the TUI footer status API** (v0.5.1). Per `@earendil-works/pi-coding-agent/docs/extensions.md` and `docs/tui.md`, the API lives on `ctx.ui`, NOT on `pi` directly. Pass `text: undefined` to clear the entry for that key. Velpari uses the key `"velpari"` exclusively. `session_start` clears any leftover bar from a prior session; `handleStatus`, `handleApprove`, and `handleApproveDiscuss` push `stage: <s> | mission/run: <m>` after every state transition.
- **`--velpari-skip-doctor` and `--velpari-stage` flags** (v0.5.0 + v0.5.1). Both flags are registered via `pi.registerFlag` in `index.ts`. `handleDoctor` honors `--velpari-skip-doctor` to skip the doctor check pass. `advanceStage` honors `--velpari-stage` as a hard override of the target stage when present.

## Testing

- Tests are in `pi-extension/test/` using Node's built-in test runner.
- Each test file focuses on one module.
- Tests use temporary directories created with `fs.mkdtempSync`.
- When testing commands, build the handler map by calling `registerCommands` with a mock `ExtensionAPI`.
- The handoff test reads `Pi-Orchestra_v4/pi-extension/src/architect-inputs-config.ts` at test time to verify schema compatibility.

## Extension loading

The extension has a guard against loading inside subagent processes. **This guard is unverified** — `PI_SUBAGENT_NAME` is not documented in the official Pi extension API (verified 2026-09-02 against github.com/earendil-works/pi). The guard is kept as a defensive check; Phase A includes a smoke test to confirm whether the env var is set inside a subagent.

```typescript
if (process.env.PI_SUBAGENT_NAME) return;
```

If the smoke test fails, remove the guard and rely on the in-session command registration model (Pi does not pass `/velpari-*` commands to subagents because subagents run their own command namespace).

## Development symlink

For local testing, the extension can be symlinked into Pi. **Symlink the built directory** (`dist/pi-extension/src/`), NOT a single file or the project root — Pi auto-discovers `index.{ts,js}` inside the symlinked directory, and the relative imports (`./commands.js`, `./state.js`, etc.) resolve correctly only when siblings are present.

Per the official docs:
- Single-file extensions: `~/.pi/agent/extensions/*.ts` (one file only — no relative imports)
- Multi-file extensions: `~/.pi/agent/extensions/*/index.{ts,js}` (subdirectory with index entry)

```bash
mkdir -p ~/.pi/agent/extensions
ln -sf /path/to/Pi-Velpari/dist/pi-extension/src ~/.pi/agent/extensions/pi-velpari
```

After code changes, run `npm run build` (the symlink auto-reflects the new dist) and restart Pi or run `/reload`.

For project-local install instead of global:

```bash
mkdir -p .pi/extensions
ln -sf /path/to/Pi-Velpari/dist/pi-extension/src .pi/extensions/pi-velpari
```

## Cross-extension compatibility

`/velpari-handoff` writes `.pi/senai/architect-inputs.json` whose schema must remain compatible with Senai's `/senai-configure-architect-inputs` and `/senai-generate-architect`. The schema is verified by reading Senai's `architect-inputs-config.ts` at test time. When Senai updates its schema, update `pi-extension/src/handoff.ts:validateSenaiSchema` in lockstep.

## Documentation

When changing behavior, update both code-facing docs (`README.md`, `CHANGELOG.md`) and design docs (`Doc/*.md`) plus stage skill files (`skills/*.md`) if the user-facing workflow changes.

### Doc map

- `Doc/PRD.md` — source PRD with stable FR-N identifiers (FR-01..FR-48, NFR-01..NFR-12).
- `Doc/RTM_Pi-Velpari.md` — requirements traceability matrix (54 requirements, 183 test cases).
- `Doc/feasibility-study.md` — 5-dimension feasibility analysis.
- `Doc/design.md` — high-level design (19 source modules, plus §3.7 per-command doc scope).
- `Doc/pseudocode.md` — algorithm pseudocode (includes §17 per-command gate pseudocode).
- `Doc/test-plan.md` — test strategy (20 test files).
- `Doc/test-cases.md` — test cases (TC-001..TC-188).
- `Doc/velpari-sequence.md` — 9-stage sequence flow + scout pattern + §11 sub-sequence table.
- `Doc/step-by-step-guide.md` — hands-on walkthrough (includes §0a on gates).
- `Doc/architecture-discussion.md` — study-only architecture doc with pending decisions list (v1.4).
- `Doc/velpari-requirements-orchestration-design.md` — Phase 7 Requirements Factory design (PSRS, profiles, grouped paths, Doctor, wrapper command). Source of truth for the shape added in Phase 7.

## Branches

Active development happens on the `development` branch. Do not run git mutations (commit, push, reset, rebase) unless explicitly asked.
