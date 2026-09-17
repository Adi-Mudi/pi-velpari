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

**Velpari spawns visible subagents via `pi-interactive-subagents`.** Stages 2–10 use 4 parallel subagents each (36 total scouts) that run in multiplexer panes and write report files; brainstorm runs read-only scouts at its scan step (see principle #4). The handler prepares the input, builds the prompt, and hands off to the parent LLM via `pi.sendUserMessage(prompt)`; the parent LLM spawns the subagents via the `subagent()` tool.

## Tech stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js (LTS, currently Node 20+; tests use `node --test`)
- **Package manager:** npm
- **Build:** `tsc` (see `tsconfig.json`)
- **Target layout:** ESM under `dist/`
- **Peer dependencies:** `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox` (all Pi core packages — never bundled per official Pi docs).
- **Runtime plugin (NOT a dep).** `pi-interactive-subagents` (≥3.7.2, by HazAT) provides the `subagent` tool used at runtime by the visible subagent panes. It is NOT declared in `dependencies` / `bundledDependencies` (it is not on the public npm registry). Pi itself loads the plugin from the user's Pi install at `~/.pi/agent/git/github.com/HazAT/pi-interactive-subagents/`. End users install it once via Pi's package loader (`pi install github.com/HazAT/pi-interactive-subagents`); velpari assumes it is already present and never imports it directly. Velpari's source code never `import`s or `require`s the package — every reference is text in a markdown comment, a doctor check string, or a scout description.
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
│   │   ├── mvp-coverage.ts        # checkMvpCoverage — Phase-1 (MVP) coverage between published PRD + RTM JSON (shared by doctor + handoff)
│   │   ├── multiplexer.ts         # L0 — env-var multiplexer sniffer (zellij/tmux/wezterm/cmux)
│   │   ├── scan-options.ts        # L0 — config-driven available-scan detection for brainstorm v2.1
│   │   ├── standards-catalogue.ts # L0 — load + validate skills/standards/catalogue.json
│   │   ├── standards-overlay.ts   # L0 — load + merge overlay profile.json (incl. loggingRequirements v1.4.0)
│   │   └── logging-plan.ts        # L0 (v1.4.0) — LoggingPlan schema + validateLoggingPlan + renderLoggingPlanMarkdown + loadPublishedLoggingPlanMarkdown
│   ├── io/                    # L0 — every fs write; atomic helpers
│   │   ├── atomic-write.ts        # atomicWriteFile + atomicWriteJson (temp + rename)
│   │   └── agents-install.ts      # ensureStageAgents + bundledAgentPath (Phase A probe, F collapsed)
│   ├── stages/                # L1 — stage handlers (8 stage handlers, plus brainstorm + brainstorm-approve which are bespoke)
│   │   ├── registry.ts            # STAGE_REGISTRY + runStage (Phase B; the source of truth for stage config)
│   │   ├── brainstorm/            # /velpari-brainstorm (lifecycle v2): index.ts handler + guard/dispatcher/notes/audit modules
│   │   ├── brainstorm-approve.ts  # /velpari-approve-brainstorm (gated approve; atomic publish; manual next-step hint)
│   │   ├── prd.ts                 # /velpari-prd
│   │   ├── rtm.ts                 # /velpari-rtm
│   │   ├── prd-rtm.ts             # /velpari-prd-rtm (wrapper: prd then rtm)
│   │   ├── feasibility.ts         # /velpari-feasibility
│   │   ├── design.ts              # /velpari-architecture-generator
│   │   ├── pseudocode.ts          # /velpari-pseudocode
│   │   ├── testplan.ts            # /velpari-testplan
│   │   ├── atomic-function.ts     # /velpari-atomic-function
│   │   ├── development-order.ts   # /velpari-development-order
│   │   └── final-design.ts        # /velpari-final-design (renamed from /velpari-html-design on 2026-09-14; produces Doc/design/final-design_<project>.md)
│   ├── ops/                   # L1 — ops / approval / setup handlers (velpari-local grouping)
│   │   ├── approve.ts             # /velpari-<stage>-approve (stages 2–10; 9 thin per-stage wrappers added in v1.6.0)
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
│   │   ├── gate.ts            # runPublishGate — doctor checks enforced inside handleApprove / velpari_stage_publish
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
│   ├── atomic-functions/      # required atomic-function output (Stage 6)
│   ├── development-order/     # required development-order output (Stage 9)
│   ├── PRD.md                  # legacy source PRD (readable fallback)
│   ├── RTM_Pi-Velpari.md       # legacy source RTM (readable fallback)
│   ├── velpari-requirements-orchestration-design.md
│   ├── velpari-sequence.md
│   └── step-by-step-guide.md
├── resources/                 # bundled technology resources (sub-agent generator input)
│   └── technologies/          # one .md per technology; see _template.md for the schema
│       ├── _template.md
│       ├── generic.md
│       ├── typescript.md
│       └── node.md
└── .IDE_Plans/                # temporary planning artifacts and run state
    └── *.md
```

## Key design principles

1. **Zero hallucination.** Every claim in every artifact traces back to a user-provided statement in a brainstorm note or to an earlier approved artifact. Stage skill markdown enforces this; doctor validates it via cross-reference.
2. **Auto-publish (v1.6.0).** No file under `Doc/` is written without the parent LLM invoking the `velpari_stage_publish` tool after the working copy exists. Working copies in `.IDE_Plans/velpari/runs/` are written freely; published copies in `Doc/` are produced when the tool completes (revision gate + artifact gate + post-publish doctor audit all pass). The 9 per-stage `/velpari-<stage>-approve` commands exist only as a manual fall-back when the LLM-driven publish is unavailable. Brainstorm keeps its bespoke approve chain (`/velpari-approve-brainstorm`).
3. **Stage gates are enforced.** A stage cannot start until its prerequisites are approved. The transition table in `constants.ts:STAGE_TRANSITIONS` is the single source of truth.
4. **Scout pattern via real visible subagents.** Stages 2–10 (prd, rtm, feasibility, design, atomic-function, pseudocode, testplan, development-order, final-design) all use 4 parallel subagents via the `subagent` tool from `pi-interactive-subagents`. They run in **visible multiplexer panes**. Agent definitions live in `.pi/agents/*.md`, auto-bootstrapped from bundled `skills/agents/*.md` files by `agents-install.ts:ensureStageAgents` on first use. Each scout writes its report to `<runDir>/<stage>/scouts/<name>-report.json`. The parent LLM orchestrates spawning, waiting, optional iterative follow-up rounds, and writes the working-copy artifact. Brainstorm also spawns visible subagents, but only at its SCANS step and read-only (see principle 9). Approve-brainstorm, approve, handoff, show-*, status, reset, configure-inputs, doctor are NOT visible-subagent stages. Agent names are resolved through `.pi/velpari/agents.json` (roles fixed, names swappable — see the coding conventions below); bootstrap installs only default-named roles.
5. **Brainstorm lifecycle v2.1 — understand-first with a hard lock + multiplexer gate.** `/velpari-brainstorm` no longer runs a fixed 6-question interview. The parent LLM runs a conversational UNDERSTAND loop, shows a one-paragraph understanding, and nothing below it (scan gate, scout dispatch, notes writing, approve) may run until the user confirms — persisted via `velpari_brainstorm_session({ action: "confirm-understanding" })` into `state.json:understandingConfirmed`. v2.1 adds a **multiplexer hard gate** at handler entry: visible scout subagents run in multiplexer panes (zellij/tmux/wezterm/cmux), so the handler refuses to start a run unless one is detected. Override via `PI_SUBAGENT_MUX`. v2.2 adds a **stage guard**: brainstorm is single-shot per run. Re-running `/velpari-brainstorm` on a run that has advanced past `brainstorming` hard-blocks with the next command named via `nextCommandsFor(state.currentStage)`; use `/velpari-reset` to discard the current run.
6. **Decision ledger.** During the brainstorm DISCUSS loop, every question has a state (draft → discussing → agreed / not-wanted(+reason) / replaced) tracked in `state.json:brainstormQuestions` and mirrored into the notes' `## Agreed` / `## Not wanted` / `## Open` sections on every change. Rejected ideas keep their reason — deferred, not forgotten. `/velpari-approve-brainstorm` hard-blocks while any question is draft/discussing.
7. **Scan gate with consent (v2.1: ALWAYS asks — no default).** After understanding is confirmed, the parent LLM invokes the SCAN-gate picker via `velpari_brainstorm_session({ action: "request-scan-gate" })`. The picker is config-aware (reads `codePaths` and `inputDocuments` from files.json v4) and hides scans that don't apply. Five branches: Run all / Run code+doc only / Community only / Adjust (per-scan confirm) / Skip. The picker **always** auto-injects a freeform `Type something... (freeform — name the scans)` row at the end (AskUserQuestion parity — Claude Code auto-injects the same). The freeform input is `ctx.ui.input`, parsed comma-separated, case-insensitive, filtered to the available scan set, unknown names silently dropped. The picker returns a rich `ScanGateResult { scans, cancelled, freeform }` so the state tool can distinguish "user skipped scans" from "user pressed Esc" from "user typed a custom subset". The community scan IS the web-search consent (FR-52) and requires explicit `ctx.ui.confirm` before it fires. Brainstorm scouts are read-only (dispatcher strips write/edit/bash; community keeps websearch/fetchurl) and report findings back to the parent. Caps: max 3 dispatches per brainstorm, max 2 per scan type. UX details live in `skills/velpari-scan-gate/SKILL.md`.
8. **Gated approve + audit log.** `/velpari-approve-brainstorm` hard-blocks on unconfirmed understanding, open questions, and missing/empty/`_TBD_` notes sections. On success it publishes atomically, writes `<runDir>/brainstorm/brainstorm-dispatch.md` (audit log), clears the 4 brainstorm session fields, advances the stage, and surfaces a `Next: /velpari-prd` hint (no auto-chain — the user runs the next command by hand, v1.6.2+). While a brainstorm is open, a tool_call hook hard-blocks edit/write outside the run's `brainstorm/` folder.
9. **Helper ↔ atomic relationship.** Helper functions are tracked in `Doc/PRD_Pi-Velpari.md` (`## Helper Functions` section). Atomic functions are tracked in `Doc/atomic-functions.md`. Atomic functions are strictly leaf nodes; helper functions may call atomic functions. The dependency is bidirectional.
10. **Stages 6–10 are required and ordered (industry-standard sequence).** `/velpari-atomic-function`, `/velpari-pseudocode`, `/velpari-testplan`, `/velpari-development-order`, and `/velpari-final-design` are part of the required chain (in that order). They follow V-Model Module Design (LLD) and SA/SD Structured Design (functional decomposition → pseudocode → test plan). None can be skipped. `/velpari-final-design` (renamed from `/velpari-html-design` on 2026-09-14, which itself was renamed from `/velpari-design` per Phase 1) is the final design consolidation — it reads the approved architecture doc, atomic functions, pseudocode, test plan, test cases, and development order, then produces `Doc/design/final-design_<project>.md` so the Senai handoff has one consolidated reference. `/velpari-handoff` requires Stage 10 (finalized-design) to be approved.

10a. **Atomic-function tier-driven schema (ISO/IEC 29110 + IEC 61508 / IEC 62304).** Stage 6 serves every developer tier via a single selection framework: 3 inputs (team size via tier, criticality via safetyClass + sil, domain via standards overlay) → 1 schema. The atomic profile persists in `.pi/velpari/files.json:atomic` and is loaded by `pi-extension/src/core/atomic-tier.ts`. The 4 tiers are ISO/IEC 29110 Entry / Basic / Intermediate / Advanced; criticality uses IEC 62304 Class A/B/C (loss-of-comfort / money / life) plus IEC 61508 SIL 1-4 for industrial contexts. Every tier requires the same 8 base-core fields (afId, name, purpose, signature, source, cohesion, verification, testable); higher tiers add fields. The doctor gate (`pi-extension/src/doctor/checks/atomic-tier.ts`, wired into `doctor/gate.ts:runPublishGate`) enforces tier-aware rigor at publish time. The `## Atomic Profile` block is rendered into every atomic-function stage prompt via `pi-extension/src/core/prompt.ts:renderAtomicProfile`. Defaults to `{ basic / A / none }` when `files.json:atomic` is absent — backward compatible with every existing run. Selection framework is the same one the industry uses (Coplien methodology grid: criticality × team size + IEC criticality classification).

10b. **Reviewer sub-agent — adversarial semantic critique (Plan A + Plan D).** The reviewer is the **only adversarial critic** in Velpari — all source scouts are friendly (they propose); the reviewer critiques. Spawned last by the parent LLM after the source reports are merged into the draft, before the preview gate. Each reviewer writes a structured verdict JSON to `<runDir>/<stage>/scouts/<reviewer-role>-report.json` with shape `{ verdict: approve | needs-fix | block, issues: [{ severity, rule, location, message, suggestion }], summary, timestamp }`. **Plan D** generalizes the reviewer to 4 stages: `atomic-function` (Plan A, original), `pseudocode`, `testplan`, `design` (Plan D additions). Per-stage agents live in `skills/agents/{pseudocode,testplan,design}-reviewer.md`. The doctor gate (`doctor/gate.ts:runPublishGate`) consumes the verdict via `load<Stage>ReviewerVerdict(cwd, profile)` — doctor remains the publish gate but does NOT re-derive any rule; the reviewer is the single source of truth for stage-specific tier checks. Tier gate (shared across all 4 reviewer stages): required at advanced, opt-in at intermediate via `--velpari-run-reviewer` flag, skip at entry/basic. Overlay gate: required when the active standards overlay declares `requiresReviewer: true` (medical / industrial / financial / cloud). Per-project override via `files.json:atomic.reviewerMode` (`tier-default` / `always` / `never`). Each reviewer has 10 deterministic + 4 semantic checks (LLM-only); atomic-function rules are migrated from `doctor/checks/atomic-tier.ts`, the 3 new stages have their own stage-specific rules. Pattern modeled on Anthropic Constitutional AI (adversarial critique), Cursor Composer/Reviewer, SWE-Agent Manager/Editor/Reviewer, ISO/IEC 14764 (independent review per maintenance type). The sub-agent generator stays brainstorm-only — extending it to emit reviewer copies is deferred to v2.
11. **Deterministic, not creative.** File paths, file formats, state JSON shape, stage transitions, and the handoff schema are all fixed by code. Only the artifact contents vary per run.
12. **Mirrors Senai's discipline.** The control surface (approve/status/reset/configure/doctor), state file layout, run directory pattern, and scout-pattern UI (4 parallel agents + user-reviewed suggestion picker) are deliberately aligned with Senai so users learn one mental model.
13. **Feasibility v2 — decision stage with evidence.** `/velpari-feasibility` is read-first (user questions only for verdict-blocking gaps), then runs a consent-gated **reuse scan** (`feasibility-reuse-scout`; deterministic core-function checklist → match %; thresholds 70/30; license + repo-freshness health gate), then **language selection** on the build path (configured framework wins; otherwise mandatory **spikes** — one `feasibility-spike` agent per candidate language builds+runs the core function in `<runDir>/feasibility/spikes/`, which is gitignored; ties are decided by the developer). Mid-stage state lives in `state.json:feasibilitySession` via the `velpari_feasibility_session` tool; the publish tool (and `/velpari-feasibility-approve` fall-back) hard-blocks until decision + selected language are recorded, and the publish gate validates the 13-section v2 template (`core/feasibility-doc.ts`). Schedule/cost/risk sections are lightweight.
14. **Sub-agent generator (v1 — brainstorm-only).** /velpari-generate-sub-agents emits project-specific sub-agents for the 4 brainstorm roles (extractor, prd-checker, rtm-checker, web-search-agent) by deterministic assembly — role template + technology resource(s) + project-context block, no LLM content generation. Three layers of safety: (a) one confirmation gate before any write, (b) the write-with-safety contract in core/agents-generator.ts:writeGeneratedAgents never overwrites files of unknown origin, treats user-edited files as keptDrifted (preserved with manifest hash unchanged), and writes through atomicWriteFile; (c) the drift manifest at .pi/velpari/generated-manifest.json is merged (never wiped) and tracks sha256 per generated file. Custom mappings in agents.json are NEVER overwritten — the generator only touches the default column. Bundled scouts in skills/agents/ remain the bootstrap fallback for projects that never run the generator. Doctor has a dedicated Sub-agent generator completeness section that detects stale generator versions (footer vN < current GENERATOR_VERSION) and recommends a regen. v1 is brainstorm-only; future phases will extend the role table to the stage scouts for Stages 2–10. See Doc/velpari-sequence.md §16 for the full design.

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
  // open; cleared by `velpari_stage_publish` (or by the per-stage
  // `/velpari-<stage>-approve` fall-back command); missing
  // decision/selectedLanguage
  // hard-blocks the publish):
  feasibilitySession?: FeasibilitySession;  // { reuseConsent, decision, reuseSummary, languageCandidates, spikeResults, selectedLanguage, selectedBy }
}

// Full Stage enum (22 values — source: pi-extension/src/core/constants.ts).
// All states are part of the required sequence (industry-standard order):
// Brainstorm → PRD → RTM → Feasibility → Design → Atomic Functions →
// Pseudocode → Test Plan → Development Order → Final Design → Handoff.
type Stage =
  | "none"
  | "brainstorming"
  | "brainstormed"
  | "drafting-prd"
  | "drafted-prd"
  | "building-rtm"
  | "built-rtm"
  | "analyzing-feasibility"
  | "analyzed-feasibility"
  | "designing"
  | "designed"
  | "analyzing-atomic-functions"   // required post-design (Stage 6)
  | "analyzed-atomic-functions"    // required post-design (Stage 6)
  | "writing-pseudocode"           // required post-atomic-functions (Stage 7)
  | "wrote-pseudocode"             // required post-atomic-functions (Stage 7)
  | "planning-tests"               // required post-pseudocode (Stage 8)
  | "planned-tests"                // required post-pseudocode (Stage 8)
  | "ordering-development"         // required post-testplan (Stage 9)
  | "ordered-development"          // required post-testplan (Stage 9)
  | "finalizing-design"            // required post-development-order (Stage 10)
  | "finalized-design"             // required post-development-order (Stage 10)
  | "handoff-ready";
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
| `drafting-prd` → `drafted-prd` → `building-rtm` | `/velpari-prd-approve` |
| `drafted-prd` → `building-rtm` | `/velpari-rtm` |
| `building-rtm` → `built-rtm` → `analyzing-feasibility` | `/velpari-rtm-approve` |
| `built-rtm` → `analyzing-feasibility` | `/velpari-feasibility` |
| `built-rtm` → `designing` (feasibility skip — gated, see conventions) | `/velpari-architecture-generator` |
| `analyzing-feasibility` → `analyzed-feasibility` → `designing` | `/velpari-feasibility-approve` |
| `analyzed-feasibility` → `designing` | `/velpari-architecture-generator` |
| `designing` → `designed` → `analyzing-atomic-functions` | `/velpari-architecture-generator-approve` |
| `designed` → `analyzing-atomic-functions` | `/velpari-atomic-function` |
| `analyzing-atomic-functions` → `analyzed-atomic-functions` → `writing-pseudocode` | `/velpari-atomic-function-approve` |
| `analyzed-atomic-functions` → `writing-pseudocode` | `/velpari-pseudocode` |
| `writing-pseudocode` → `wrote-pseudocode` → `planning-tests` | `/velpari-pseudocode-approve` |
| `wrote-pseudocode` → `planning-tests` | `/velpari-testplan` |
| `planning-tests` → `planned-tests` → `ordering-development` | `/velpari-testplan-approve` |
| `planned-tests` → `ordering-development` | `/velpari-development-order` |
| `ordering-development` → `ordered-development` → `finalizing-design` | `/velpari-development-order-approve` |
| `ordered-development` → `finalizing-design` | `/velpari-final-design` |
| `finalizing-design` → `finalized-design` → `handoff-ready` | `/velpari-final-design-approve` |
| `finalized-design` → `handoff-ready` | `/velpari-handoff` |

Stage transitions are defined in `constants.ts` as `STAGE_TRANSITIONS`.

## Sequence nuances (7 things to remember)

These apply to **every** stage. Keep them in mind whenever you read or
modify a stage handler, and treat any drift as a defect.

1. **Each stage reads ALL prior approved artifacts, not just the
   immediate predecessor.** Example: `/velpari-testplan` reads the
   brainstorm notes + PRD + RTM + feasibility study + design +
   pseudocode — every prior stage's published output, not only
   pseudocode. Same for every other stage.
2. **`files.json` is a global input read by every stage.** Set up once
   via `/velpari-configure-inputs`. Carries the framework (e.g.
   TypeScript) and the path patterns for code / tests / documents /
   excluded folders. Injected into every stage prompt.
3. **`requirements-profile.json` is read by every stage** as compact
   metadata. Set up via `/velpari-configure-requirements`. The stage
   runner receives a `CompactProfileMetadata` projection (never the
   full profile), rendered as a `## Profile (compact)` block in the
   stage prompt.
4. **No auto-chains; user runs each next command by hand (v1.6.2+).**
   When the parent LLM receives the preview-yes confirmation, it calls
   the `velpari_stage_publish` tool (registered in
   `stages/stage-publish-tool.ts`), which runs the same `handleApprove`
   logic and advances the stage. `handleApprove` then surfaces a
   `Next: /velpari-<stage>` hint derived from
   `nextCommandsFor(next.currentStage, { feasibilitySkip })` so the user
   always knows which command to run next. The user types it by hand —
   no command-to-command auto-chain exists anywhere in the pipeline.
   This includes brainstorm-approve (it no longer auto-invokes
   `/velpari-prd`; it surfaces a `Next: /velpari-prd` hint instead).
5. **Feasibility skip:** `/velpari-architecture-generator` can run
   from `built-rtm` *if and only if* a published feasibility study
   already exists (update-cycle path). Otherwise
   `/velpari-feasibility` must run first. The skip is a choice, never
   forced.
6. **Approve commands (v1.6.0).** `/velpari-approve-brainstorm` is
   bespoke to the brainstorm stage. For stages 2–10 the parent LLM
   publishes inline via the `velpari_stage_publish` tool (registered
   by `pi-extension/src/stages/stage-publish-tool.ts`), which calls the
   same `handleApprove` logic — all publish gates, the doctor audit,
   and the stage advance behave identically. The 9 per-stage
   `/velpari-<stage>-approve` commands exist as the manual fall-back
   when the LLM-driven tool path is unavailable; each runs the same
   gate chain the tool calls.
7. **The `/velpari-final-design` command name reflects what it does.**
   It was previously `/velpari-html-design` (renamed on 2026-09-14)
   which was itself renamed from `/velpari-design`. The command today
   produces a final-design consolidation doc, not actual HTML.

> See [Doc/velpari-sequence.md](Doc/velpari-sequence.md) for the full
> sequence doc including per-stage inputs, scout pattern, and
> cross-cutting constraints.

## Command surface

### Stage commands (10)

- **Pre-production 5 (required):** `/velpari-brainstorm`, `/velpari-prd`, `/velpari-rtm`, `/velpari-feasibility`, `/velpari-architecture-generator`
- **Build-planning 3 (required, post-design):** `/velpari-atomic-function`, `/velpari-pseudocode`, `/velpari-testplan`
- **Execution + Consolidation 2 (required, post-testplan):** `/velpari-development-order`, `/velpari-final-design` (final design consolidation — renamed from `/velpari-html-design` on 2026-09-14, which itself was renamed from `/velpari-design`)

### Discipline commands (13 — v1.4.0 added `/velpari-design-logging`)

`/velpari-approve-brainstorm`, `/velpari-prd-approve`, `/velpari-rtm-approve`, `/velpari-feasibility-approve`, `/velpari-architecture-generator-approve`, `/velpari-atomic-function-approve`, `/velpari-pseudocode-approve`, `/velpari-testplan-approve`, `/velpari-development-order-approve`, `/velpari-final-design-approve` (per-stage fall-back, v1.6.0), `/velpari-status`, `/velpari-reset`, `/velpari-configure-inputs`, `/velpari-configure-requirements`, `/velpari-configure-standards`, `/velpari-configure-agents`, `/velpari-agents`, `/velpari-generate-sub-agents`, `/velpari-doctor`, `/velpari-handoff`, **`/velpari-design-logging`** (cross-cutting discipline command — runs after Design is approved)

### Wrapper command (1)

`/velpari-prd-rtm` — calls `/velpari-prd` and `/velpari-rtm` in sequence. Does not duplicate stage logic. Does not auto-approve.

### View commands (8 — v1.4.0 added `/velpari-show-logging`)

`/velpari-show-brainstorm`, `/velpari-show-prd`, `/velpari-show-rtm`, `/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`, `/velpari-show-testplan`, **`/velpari-show-logging`**

Total: 32 commands (v1.4.0).

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
- **Uniform subagent pattern.** All scout agents follow the `subagent()` invocation via `pi-interactive-subagents`. Each stage handler passes `agent:`, `cwd:`, `task:` and `auto-exit: true`. Stages 2–10 route through `pi-extension/src/core/stage-runner.ts:runStageWithScouts()`; brainstorm dispatches are validated by `stages/brainstorm/dispatcher.ts` (read-only tools enforced). No in-process scout API.
- **Roles are fixed, agent names are swappable (Senai parity).** The scout roles are defined in `core/agents-config.ts:VELPARI_ROLES` and include brainstorm roles, stage roles for Stages 2–10, and the two feasibility-conditional roles (`feasibility-reuse-scout`, `feasibility-spike`). `.pi/velpari/agents.json` (managed by `/velpari-configure-agents`, viewable via `/velpari-agents`) maps a role to a custom agent name; absence of the file means all defaults. Report paths stay role-keyed (`<role>-report.json`), so custom names never break report collection. The FR-52 web-search consent is anchored on the `web-search-agent` ROLE, not the spawned agent name — remapping cannot bypass it. Doctor's "Agent mapping (agents.json)" section validates the file and that every mapped agent exists.
- **Framework is one-time setup.** Framework/tech-stack is captured in `/velpari-configure-inputs`, persisted in `.pi/velpari/files.json:framework`, and injected into every stage prompt. The same command also configures code/test/document/excluded paths (files.json v4) through a discovery-backed list editor (`core/files-discovery.ts:discoverProjectFiles` + the `ui/` picker widgets). It is NOT a pipeline stage. Do not add a `/velpari-framework` command. (FR-49)
- **WEB SEARCH AGENT is consented at the scan gate.** The community scan (web-search-agent) runs only when the user picks it at the brainstorm scan-plan gate (run/adjust/skip). Never auto-invoke. The dispatcher hard-rejects web-search-agent for non-community scans. The decision is per-brainstorm. (FR-52)
- **Brainstorm approval uses `/velpari-approve-brainstorm`, NOT the per-stage fall-back commands** (v1.6). The brainstorm stage has its own dedicated approve command. `/velpari-approve-brainstorm` hard-blocks on unconfirmed understanding, open (draft/discussing) questions, and missing/empty/`_TBD_` notes sections; on success it publishes `Doc/brainstorm/brainstorm-<topic-slug>.md`, writes the dispatch audit log, clears the brainstorm session fields, advances the stage, and surfaces a `Next: /velpari-prd` hint (the user runs it by hand — v1.6.2 dropped the auto-chain so each stage boundary is a manual confirm-then-write step). Stage-publish fall-back commands (`/velpari-<stage>-approve`) error when in brainstorm stage. Use the per-stage fall-back commands for stages 2–10 (prd, rtm, feasibility, design, atomic-function, pseudocode, testplan, development-order, final-design). (FR-58, FR-59, NFR-14)
- **Output documents use `projectName` suffix** (v1.7). All output file names are derived from the `projectName` captured in `/velpari-configure-inputs`. Example: `Doc/requirements/PRD_TodoApp.md`, not `Doc/PRD_Pi-Velpari.md`. Brainstorm is per-topic: `Doc/brainstorm/brainstorm-{topic-slug}.md`. Use `pi-extension/src/paths.ts:buildGroupedPath()` and `resolveDocArtifact()` for the naming + lookup logic. Never hardcode "Pi-Velpari" in any file path. (FR-67..FR-71, NFR-15)
- **Grouped Doc/ layout (Phase 7 / Requirements Factory).** New writes go to category subfolders under `Doc/` (`Doc/brainstorm/`, `Doc/requirements/`, `Doc/feasibility/`, `Doc/design/`, `Doc/pseudocode/`, `Doc/tests/`, `Doc/atomic-functions/`, `Doc/development-order/`). Legacy flat paths remain readable as fallback everywhere; nothing is moved, deleted, or overwritten. Use `pi-extension/src/paths.ts:resolveDocArtifact()` for cross-layout reads.
- **PSRS shape (Phase 7).** The PRD document is a combined Product and Software Requirements Specification. Keep the file name `PRD_<projectName>.md` for compatibility. Required sections (validated by `pi-extension/src/core/psrs.ts`, strict — all 20 are errors when missing): Objective, Problem, System Actors, User Stories, Scope, MVP, Success Metrics, Phases, Functional Requirements, Non-Functional Requirements, Data and Interfaces, Errors and Edge Cases, Constraints, Dependencies and Risks, Out of Scope, Open Questions, Acceptance Criteria, Helper Function Candidates, Glossary, Change Log. The User Stories, Success Metrics, Functional Requirements, and Non-Functional Requirements tables must carry a `Status` column (`proposed | approved | implemented | verified | deferred | deprecated`). RTM is a separate document.
- **Living documents / update mode.** Any change to an approved artifact starts at `/velpari-brainstorm` (change mode: the prompt carries `## Existing Project Context` with published paths + config + history) and flows through the sequence — stages revise, never regenerate. When a stage's published artifact exists, `runStage` auto-detects update mode and injects the baseline + 5 revision rules into the prompt: append-only IDs (never renumber/reuse), deprecate-don't-delete (removals stay with status `deprecated` + reason), version bump (minor for additions-only, major for deprecations or acceptance-criteria changes), mandatory Change Log entry, new rows start `proposed`. The publish gate (run via `velpari_stage_publish` tool or per-stage `/velpari-<stage>-approve` fall-back) enforces this at publish time: PRD revisions must pass `comparePsrs` (no dropped IDs, version bumped, new Change Log line); every other artifact must add a new Change Log line. A blocked revision publishes nothing and does not advance the stage.
- **Sequence hardening.** The stage order is enforced, not advisory: `STAGE_GATE` in `stages/registry.ts` rejects any stage command run from the wrong stage and names the correct command; `io/run-lock.ts` serializes every `state.json` mutation (mkdir lock + heartbeat + stale-steal) so concurrent sessions cannot corrupt the run; the `tool_call` hook locks edit/write to the active stage's run folder while a draft is in progress (publishing goes through the publish tool or the per-stage `/velpari-<stage>-approve` fall-back only) and requires every scout `subagent` spawn to declare its `-report.json` path; the `before_agent_start` hook injects a `<velpari_status>` block (stage, run, next command, hard rule) into the system prompt every turn so the discipline survives compaction. Doctor audits the wiring (`Sequence hardening` section) and flags stale downstream artifacts.
- **Feasibility skip (update cycles).** When a run sits at `built-rtm` and a published feasibility study already exists (`core/paths.ts:hasPublishedFeasibility` — grouped layout or legacy fallback), `/velpari-architecture-generator` is allowed from `built-rtm` and advances straight to `designing`. The skip is a choice, never forced: `/velpari-feasibility` stays available to revise the study. The conditional transition lives in `STAGE_TRANSITIONS`; the registry gate unblocks it only when the published doc exists; `nextCommandsFor(stage, { feasibilitySkip })` hides the skip from every suggestion surface (status block, gate errors) unless the flag is set; the `before_agent_start` hook and the post-RTM-approve notification compute the flag from the live Doc/ tree.
- **Design stage command is `/velpari-architecture-generator`.** The former `/velpari-design` name was retired (no stub left behind; the name is reserved for a future command). Only the command string, the registry StageKey (`architecture-generator`), the command file (`commands/architecture-generator.ts`), and the skill file (`skills/velpari-architecture-generator.md`) moved — stage STATE values (`designing`/`designed`), artifact names (`Doc/design/design_<project>.md`), scout roles (`design-*`), and `/velpari-show-design` are unchanged.
- **Final-design consolidation command is `/velpari-final-design`** (required post-development-order, Stage 10). Phase 1 (2026-09-13) renamed the user-facing command from `/velpari-design` to `/velpari-html-design`; on 2026-09-14 it was renamed again to `/velpari-final-design` so the name matches what the command actually does today (a final-design consolidation doc, not actual HTML). The `/velpari-html-design` name was reserved for a future HTML/CSS/JS front-end mockup generator that has not shipped. The rename is pure-surface: the StageKey (`final-design`), state values (`finalizing-design` / `finalized-design`), artifact path (`Doc/design/final-design_<project>.md`), and scout roles (`design-consistency-checker`, `design-coverage-checker`, `design-contract-checker`, `design-finalizer`) are all unchanged.
- **Requirements profile (Phase 7, v1.1).** `/velpari-configure-requirements` is the only entrypoint that mutates `.pi/velpari/requirements-profile.json`. The handler uses native Pi selectors (`ctx.ui.select(title, options)`) for fixed choices, `ctx.ui.input(title, placeholder)` for free text, and `ctx.ui.confirm(title, message)` for yes/no. Profile selection is **optional**. Web-research consent is collected immediately after the answers and before recommendations; the research prompt explicitly states `Profile selection: PENDING`, says `MUST NOT save or write a profile`, and never includes a final selected profile id. The handler surfaces up to three deterministic `ProfileRecommendation` entries: the **common PSRS core** (`core-psrs-v1`, always present, a real choice) plus up to two closest built-in profiles, each with a 0–100 score, reasons, and trade-offs. When no built-in matches exactly, the handler offers `Use common PSRS core` / `Use closest built-in profile` / `Update Velpari` / `Stop` via native selector — no fake custom-profile action. Doctor reports profile mode (`common-core` or `built-in`), id, version, research consent + source count, and the report-only stance; it never selects, fixes, or mutates a profile.
- **Stage runner carries only compact profile metadata.** `StageRunConfig.profileMetadata` is a `CompactProfileMetadata` projection, never the full profile. The prompt renders it as a `## Profile (compact)` block; the block is omitted when the field is absent.
- No subagent-spawning code anywhere. If you find yourself reaching for a subagent API, re-read the design principles.
- **`ctx.ui.setStatus(key, text)` is the TUI footer status API** (v0.5.1). Per `@earendil-works/pi-coding-agent/docs/extensions.md` and `docs/tui.md`, the API lives on `ctx.ui`, NOT on `pi` directly. Pass `text: undefined` to clear the entry for that key. Velpari uses the key `"velpari"` exclusively. `session_start` clears any leftover bar from a prior session; `handleStatus`, `handleApprove`, and `handleApproveBrainstorm` push `stage: <s> | mission/run: <m>` after every state transition.
- **`--velpari-skip-doctor` and `--velpari-stage` flags** (v0.5.0 + v0.5.1). Both flags are registered via `pi.registerFlag` in `index.ts`. `handleDoctor` honors `--velpari-skip-doctor` to skip the doctor check pass. `advanceStage` honors `--velpari-stage` as a hard override of the target stage when present.
- **RTM JSON sidecar is the source of truth.** The RTM stage writes `<runDir>/rtm/RTM_<projectName>.json` (validated by `core/rtm-data.ts:validateRtmData`); the publish tool (or `/velpari-rtm-approve` fall-back) regenerates the published markdown from the JSON via `renderRtmMarkdown`, so the markdown can never drift from the data. Edit the JSON, never the published markdown.
- **SHA-256 fingerprints on every RTM link.** `core/fingerprints.ts` hashes the published PSRS requirement each RTM row traces to; the publish tool (or `/velpari-rtm-approve` fall-back) stamps the hashes at publish time. Doctor's `Fingerprints` section reports `suspect` (source changed), `unknown-id`, and `orphan` (no target) links as errors and `untracked` rows as warnings. `fingerprints.ts:countTraceIssues` feeds the session-start status-bar notice (`trace: N suspect/orphan link(s)`).
- **Publish gate + automatic doctor audit.** The publish tool (or per-stage `/velpari-<stage>-approve` fall-back) runs `doctor/gate.ts:runPublishGate` before publishing (the artifact-correctness subset). After the file writes, `handleApprove` ALSO runs `doctor/index.ts:runDoctor` — the full audit. Errors AND warnings in the doctor report block the state advance; the user is shown the summary + a one-line message per problematic check + the path to the full report at `.IDE_Plans/velpari/doctor-report.md`. Clean (errors=0, warnings=0) advances normally. The standalone `/velpari-doctor` slash command still works for ad-hoc audit. The plan-v1.2.1 policy: doctor errors + warnings both stop the chain.
- **RFC 2119 + EARS requirement wording.** FR/NFR rows must use `shall`/`should`/`may` (RFC 2119) and EARS patterns (see `skills/velpari-prd.md`). `core/psrs.ts:findFrRowsMissingKeywords` flags rows without keywords; doctor reports them as warnings in the PSRS section.
- **YAML frontmatter on published artifacts.** Every published artifact carries frontmatter (`artifact`, `runId`, `stage`, `version`, `generatedAt`) stamped by `core/frontmatter.ts` at approve time; all 7 stage skill templates show the block. Doctor's `Frontmatter` section validates it.
- **Phase vocabulary (MVP traceability).** Every FR/NFR row carries a mandatory `Phase` column (positive integer; **Phase 1 = MVP**, matching PRD §8 Phases). Enforced by `validatePsrs`; the MVP §6 "MVP Requirements" list must name only Phase-1 ids. The RTM JSON requires `phase` per row, must equal the PRD phase (publish gate + doctor `Phase consistency` section), and renders as a Phase column. Phase edits in the PRD flag RTM rows as suspect via fingerprints.
- **MVP coverage gate.** `core/mvp-coverage.ts:checkMvpCoverage` compares the published PRD's Phase-1 ids against the RTM JSON. Doctor's `MVP coverage` section reports `X/Y covered` (no-row/uncovered = error, partial/no-tests = warning). `/velpari-handoff` blocks on errors, warns otherwise — handoff is the "MVP is ready" signal.
- **Architecture generator is standards-aligned (v1.7.0 + v1.2.2 + v1.3.0, plan 8 phases).** The design template is built per arc42 + Rozanski & Woods + SEI ATAM/ADD + C4 + Nygard ADR + Bass/Clements/Kazman SEI Tactics. Required sections are `## 0` (Introduction & Goals), `## 0.4` (Architecture Constraints), `## 5` (Quality Attribute Scenarios in SEI 6-part form), `## 9` (Context View), `## 10` (Deployment View), `## 11` (Crosscutting Concepts), `## 12` (Risks & Tech Debt), `## 13` (Glossary), `## 14` (Diagrams (C4)). The doctor gate enforces every one. **Style choice is the architectural decision** — recorded as ADR-001 (mandatory, accepted status, ≥2 options, stage `design`). The chosen style id must be in `core/style-catalog.ts:STYLE_CATALOG`. Every `Approach` cell in §5 must name a tactic from `core/tactic-catalog.ts:TACTIC_CATALOG`. The style-selector scout (`design-style-selector`) runs first in the design stage and emits ADR-001's content. **C4 diagrams are mandatory** (System Context / Container / Component — all three as Mermaid blocks). Templates are modified ⇒ doctor gate must update. Tactics are added ⇒ the tactic-catalog must update. Never hand-edit the templates outside the standard section set. **Shape compatibility (v1.2.2 + v1.3.0):** the published architecture doc carries a `version:` (frontmatter, SemVer 2.0.0) and a section count (per arc42 catalogue). The ShapeCompatibility doctor check (`core/shape.ts:computeShapeVerdict`) emits one of three verdicts: `fresh` (no prior design), `upgrade` (current major + 14 sections, minor additions only), `migration` (older shape — re-run `/velpari-architecture-generator` in update mode). For multi-design cwds (v1.3.0+) the doctor emits one verdict per projectName via `checkShapeCompatibilityAll(cwd)`. The verdict appears in (a) the auto-doctor report on every approve (since v1.2.1), (b) `/velpari-status` (one line per projectName design), (c) the architecture-generator prelude (one line per projectName via `computeShapeStatusLinesForConfig`). **No new slash command** — the recommendation surfaces in the existing life cycle. The optional `sunset:` frontmatter field (RFC 8594) lets an old design carry an end-of-life date; the doctor emits an error once the date is past. The optional `deprecatedAt:` frontmatter field is stamped by the sunset auto-archive (v1.3.0+) when the next publish run (via the publish tool or `/velpari-architecture-generator-approve` fall-back) happens after a design's `sunset:` date. Auto-archive bumps `version:` to the next MAJOR (SemVer) and sets `status: deprecated`; subsequent publishes on the archived design re-stamp `deprecatedAt: <today>` but no longer bump the major or modify the body — the doctor does not re-block. Standards cited: SemVer 2.0.0 (semver.org), arc42 section catalogue (arc42.org/overview), RFC 8594 (datatracker.ietf.org/doc/html/rfc8594). `CURRENT_SHAPE_MAJOR` + `REQUIRED_SECTION_COUNT` in `core/shape.ts` are the single source of truth — bump `CURRENT_SHAPE_MAJOR` when the template's mandatory sections change. **Multi-design (v1.3.0+):** a single cwd can carry several design subjects via `.pi/velpari/files.json:projectNames: ["alpha", "beta"]` (a non-empty array). The legacy `projectName: string` (single) is preserved. Exactly one of the two must be set. `getEffectiveProjectNames(cfg)` in `core/projectnames.ts` is the canonical accessor; every consumer (paths / doctor / status / prelude) uses it. Per-design publishing paths are `Doc/<group>/<artifact>_<projectName>.md`; `resolveDocArtifactAll(cwd, artifact)` scans for all such files.

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
