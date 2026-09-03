# AGENTS.md — Pi-Velpari

Agent-focused guidance for working on the `pi-velpari` Pi extension. Parallels `Pi-Orchestra_v4/AGENTS.md` so contributors learn one mental model.

---

## Project layout

- `.pi/velpari/` — Velpari's local config (currently only `files.json`, written by `/velpari-configure-inputs`).
- `.IDE_Plans/velpari/` — run state, run history, doctor reports. Not a standard Pi directory; Velpari-specific convention.
- `Doc/` — published artifacts (the artifacts of record).
- `.pi/senai/architect-inputs.json` — Velpari's handoff target, consumed by Senai.

## Project overview

`pi-velpari` is a local Pi extension that adds stage-gated orchestration slash commands for the **pre-production** phase of software work:

```
Discussion → PRD → RTM → Feasibility → Design → Pseudocode → Test Plan
```

It mirrors Pi-Senai's discipline model (state-gated runs, working/published copy separation, doctor audit, single-source-of-truth state file) for the upstream half of the lifecycle. Velpari produces the requirements package that Senai's `/senai-generate-architect` consumes.

**Velpari does not spawn subagents.** Subagent orchestration is Senai's job, downstream. Velpari handles each stage inline in the parent session.

## Tech stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js (LTS, currently Node 20+; tests use `node --test`)
- **Package manager:** npm
- **Build:** `tsc` (see `tsconfig.json`)
- **Target layout:** ESM under `dist/`
- **Peer dependency:** `@earendil-works/pi-coding-agent`
- **No runtime dependencies.** No subagent extension, no test framework, no linter.

## Build and test

Always build before testing. The test script builds automatically, but running build first catches TypeScript errors faster.

```bash
npm run build
npm test
```

- `npm run build` — compiles `pi-extension/src/**/*.ts` to `dist/pi-extension/`.
- `npm test` — builds, then runs `node --test dist/pi-extension/test/**/*.test.js`.

## Project structure

```text
.
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
├── AGENTS.md                  # this file
├── .gitignore
├── DevPlan/                   # persistent project roadmap (canonical Phase A→G build order)
│   └── development-order.md
├── pi-extension/src/          # extension source
│   ├── index.ts               # entry point: export default (pi: ExtensionAPI) → registerCommands + session_before_compact hook + (unverified) subagent guard
│   ├── commands.ts            # registerCommands + all 22 handlers
│   ├── constants.ts           # Stage enum, STAGE_TRANSITIONS (19 states), paths, helpers
│   ├── state.ts               # loadState, saveState, createRun, advanceStage, clearRun, publishToDoc
│   ├── prompt.ts              # loadStageSkill, buildStagePrompt
│   ├── compaction.ts          # buildCompactionSummary (zero-LLM)
│   ├── config.ts              # configure-inputs: load/save/validate + runFilesDiscovery
│   ├── doctor.ts              # runDoctor, writeDoctorReport, scanForSecrets, validateSenaiHandoffSchema
│   ├── handoff.ts             # runHandoff, validateSenaiSchema, readApprovedArtifacts
│   ├── show.ts                # showStage (parameterized)
│   ├── discuss.ts             # /velpari-discuss: 4-agent interview (NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, DECISION AGENT)
│   ├── prd.ts                 # /velpari-prd (full rewrite path; usually auto-updated by discuss)
│   ├── rtm.ts                 # /velpari-rtm
│   ├── feasibility.ts         # /velpari-feasibility
│   ├── design.ts              # /velpari-design
│   ├── pseudocode.ts          # /velpari-pseudocode
│   ├── testplan.ts            # /velpari-testplan
│   ├── atomic-function.ts     # /velpari-atomic-function: 4 AF scouts + suggestion picker (optional post-pipeline)
│   └── development-order.ts   # /velpari-development-order: 4 DO scouts + ranking merge + order picker (optional post-pipeline)
├── pi-extension/test/         # one test file per src module (19 files)
├── skills/                    # stage skill markdown files (one per stage + handoff + 8 scout skills)
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
│   └── discuss-subagents/     # 4 subagent skills for the discussion stage
│       ├── extractor.md
│       ├── prd-checker.md
│       ├── rtm-checker.md
│       └── decision-agent.md
├── Doc/                       # human-facing docs
│   ├── PRD.md                 # source PRD (with FR-01..FR-36, NFR-01..NFR-11, ## Helper Functions)
│   ├── RTM_Pi-Velpari.md      # requirements traceability matrix (47 requirements, 163 test cases)
│   ├── feasibility-study.md   # 5-dimension feasibility
│   ├── design.md              # high-level design (19 source modules)
│   ├── pseudocode.md          # algorithm pseudocode (12 scout agents + handoff extension)
│   ├── test-plan.md           # test strategy (19 test files)
│   ├── test-cases.md          # test cases
│   ├── velpari-sequence.md    # 9-stage sequence flow + scout pattern
│   └── step-by-step-guide.md  # hands-on walkthrough
└── .IDE_Plans/                # temporary planning artifacts and run state
    └── *.md
```

## Key design principles

1. **Zero hallucination.** Every claim in every artifact traces back to a user-provided statement in a discussion note or to an earlier approved artifact. Stage skill markdown enforces this; doctor validates it via cross-reference.
2. **Confirm-then-write.** No file under `Doc/` is written without a user-facing preview and explicit `/velpari-approve`. Working copies in `.IDE_Plans/velpari/runs/` are written freely; published copies in `Doc/` are only produced on approval.
3. **Stage gates are enforced.** A stage cannot start until its prerequisites are approved. The transition table in `constants.ts:STAGE_TRANSITIONS` is the single source of truth.
4. **Scout pattern in three stages.** Subagents are used in **discussion** (4 agents: NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, DECISION AGENT), **atomic-function** (4 AF scouts), and **development-order** (4 DO scouts) — 12 scout agents total. Stages 2–7 and the handoff stage do NOT spawn subagents.
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

Published copies (in `Doc/`):
```
Doc/
├── discussion-notes.md
├── PRD_Pi-Velpari.md
├── RTM_Pi-Velpari.md
├── feasibility-study.md
├── design.md
├── pseudocode.md
├── test-plan.md
└── test-cases.md
```

## Stage workflow

| Stage transition | Command that triggers it |
|---|---|
| `none` → `discussing` | `/velpari-discuss <mission>` |
| `discussing` → `discussed` → `drafting-prd` | `/velpari-approve` |
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

### Discipline commands (6)

`/velpari-approve`, `/velpari-status`, `/velpari-reset`, `/velpari-configure-inputs`, `/velpari-doctor`, `/velpari-handoff`

### View commands (7)

`/velpari-show-discussion`, `/velpari-show-prd`, `/velpari-show-rtm`, `/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`, `/velpari-show-testplan`

Total: 22 commands.

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
- **Uniform subagent pattern.** All 12 scout agents follow the `ScoutContract` defined in `pi-extension/src/contracts.ts`. Use `pi-extension/src/scout.ts:spawnScout()` to spawn any scout — do not write bespoke spawn logic per scout. Same 30-second timeout, same JSON output envelope, same picker UI. (FR-54, NFR-13)
- **Framework is one-time setup.** Framework/tech-stack is captured in `/velpari-configure-inputs`, persisted in `.pi/velpari/files.json:framework`, and injected into every stage prompt. It is NOT a pipeline stage. Do not add a `/velpari-framework` command. (FR-49)
- **WEB SEARCH AGENT is user-prompted.** After the multi-turn interview, the user is asked "do you want a web search?" (yes/no). Do not auto-invoke the web search. The decision is per-discussion. (FR-52)
- **Discussion approval uses `/velpari-approve-discuss`, NOT `/velpari-approve`** (v1.6). The discussion stage has its own dedicated approve command. `/velpari-approve-discuss` publishes `Doc/discussion-notes.md` and **auto-invokes `/velpari-prd`** to chain into the PRD stage. `/velpari-approve` errors when in discussion stage. Use `/velpari-approve` only for stages 2–7 (prd, rtm, feasibility, design, pseudocode, testplan). (FR-58, FR-59, NFR-14)
- **Output documents use `projectName` suffix** (v1.7). All output file names are derived from the `projectName` captured in `/velpari-configure-inputs`. Example: `Doc/PRD_TodoApp.md`, not `Doc/PRD_Pi-Velpari.md`. Discussion is per-topic: `Doc/discussion-{topic-slug}.md`. Use `pi-extension/src/paths.ts:buildOutputPath()` and `buildDiscussionPath()` for the naming logic. Never hardcode "Pi-Velpari" in any file path. (FR-67..FR-71, NFR-15)
- No subagent-spawning code anywhere. If you find yourself reaching for a subagent API, re-read the design principles.

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

For local testing, the extension can be symlinked into Pi. **Symlink the built artifact** (`dist/pi-extension/src/index.js`), NOT the project root — Pi needs the compiled output:

```bash
mkdir -p ~/.pi/agent/extensions
ln -sf /path/to/Pi-Velpari/dist/pi-extension/src/index.js ~/.pi/agent/extensions/pi-velpari.js
```

After code changes, run `npm run build` (the symlink auto-reflects the new dist) and restart Pi or run `/reload`.

For project-local install instead of global:

```bash
mkdir -p .pi/extensions
ln -sf /path/to/Pi-Velpari/dist/pi-extension/src/index.js .pi/extensions/pi-velpari.js
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

## Branches

Active development happens on the `development` branch. Do not run git mutations (commit, push, reset, rebase) unless explicitly asked.
