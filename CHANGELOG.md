# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed (all-stages visible subagents, 2026-09-03 to 2026-09-04)

Extended the v2.0 visible-subagent pattern from `/velpari-discuss` to **all 9 stage commands**. Each stage now spawns 4 real subagents in parallel visible multiplexer panes via the `subagent` tool from `@earendil-works/pi-interactive-subagents`. Total: **36 subagent definitions** across 9 stages.

| Stage | 4 scouts |
|---|---|
| discuss | extractor, prd-checker, rtm-checker, web-search-agent |
| prd | fr-extractor, nfr-checker, helper-detector, consolidator |
| rtm | rtm-requirement-tracer, rtm-test-case-linker, rtm-coverage-analyzer, rtm-consolidator |
| feasibility | feasibility-tech, feasibility-schedule, feasibility-cost, feasibility-risk |
| design | design-module-decomposer, design-contract-definer, design-data-flow-mapper, design-error-definer |
| pseudocode | pseudo-algorithm-extractor, pseudo-edge-case-handler, pseudo-complexity-analyzer, pseudo-consolidator |
| testplan | testplan-strategy-designer, testplan-unit-test-generator, testplan-integration-test-generator, testplan-coverage-tracer |
| atomic-function (optional) | af-source-rtm, af-source-pseudocode, af-source-prd, af-source-testcases |
| development-order (optional) | do-topology, do-risk, do-test, do-value |

**Phase 1 (commit `4d64b18`) — Scaffolding:**
- `pi-extension/src/stage-runner.ts` (NEW) — `StageRunConfig` + `runStageWithScouts` generic two-phase flow.
- `pi-extension/src/prompt.ts` — real `loadStageSkill` + `buildStagePrompt` with scout paths, input artifact, working copy.
- `pi-extension/src/agents-install.ts` — generic `ensureStageAgents(agentIds, cwd)` helper.
- 11 tests for stage-runner scaffolding.

**Phase 2 (commit `4f68d05`) — `/velpari-prd`:**
- 4 prd-scouts created, skill rewritten, handler uses runStageWithScouts, 13 tests.
- `src/discuss-approve.ts` updated to pass `pi` through for the auto-chain.

**Phase 3 (commits `c1b5ca5` + `adbaad5`) — `/velpari-rtm` + `/velpari-feasibility`:**
- 8 new agents (4 each), skills rewritten, handlers + tests. 16 + 12 = 28 new tests.

**Phase 4 (commit `9f51538`) — `/velpari-design` + `/velpari-pseudocode` + `/velpari-testplan`:**
- 12 new agents (4 each), skills rewritten, handlers + tests. 42 new tests.
- `StageRunConfig` extended with `additionalWorkingCopies` (testplan writes 2 outputs).

**Phase 5 (commit `0289aef`) — `/velpari-atomic-function` + `/velpari-development-order`:**
- 8 new agents, skills rewritten, NEW handlers + tests. 30 new tests.
- `BuildStagePromptInput` extended with `inputArtifactContent` (multi-doc stages concatenate 5-7 published artifacts into the prompt).
- All 23 commands now wired; no more "Phase A stub" handlers.

**Phase 6 (commit `TBD`) — Docs only:**
- `src/doctor.ts` extended to enumerate all 9 stages' scouts + check all 9 stage skill markdowns.
- `AGENTS.md` principle #4 updated.
- Doc sweep for stale scout references in `Doc/pseudocode.md`, `Doc/test-plan.md`, `Doc/test-cases.md`, `Doc/velpari-sequence.md`, `Doc/step-by-step-guide.md`.

**Cumulative test count:** 343/343 passing (was 169 before any of this work, +174 net).

**New peer dep (added in v2.0):** `@earendil-works/pi-interactive-subagents` (≥3.7.2).

**Cumulative files added:** 36 agent files in `skills/agents/`, 9 skill markdowns, 7 new src files, 5 new test files. Files removed: `src/scout.ts`, `src/contracts.ts`, `src/scouts/*` (4), `skills/discuss-subagents/*` (4).

### Changed (v2.0 — visible subagents, 2026-09-03)

The discussion stage now uses **real visible subagents** spawned via the `subagent` tool from `@earendil-works/pi-interactive-subagents` (new peer dep, ≥3.7.2). This replaces the v1.0 design that mirrored `pi-seani`'s `/senai-discussion` (parent-LLM-only, no subagents).

**Breaking changes vs. v1.x:**

- `/velpari-discuss <topic>` is now a **two-phase flow**:
  1. **Handler phase** (deterministic, in the extension): validates mission, loads state, bootstraps 4 scout agents into `.pi/agents/` if missing, asks 6 fixed interview questions via `ctx.ui.input`, asks web-search yes/no via `ctx.ui.confirm`, then calls `pi.sendUserMessage(prompt)` to hand off to the parent LLM.
  2. **LLM phase** (orchestrated by the parent LLM, driven by `skills/velpari-discuss.md`): spawns the 4 scouts in parallel via the `subagent` tool (visible multiplexer panes), waits for completion, reads their reports, optionally iterates with `AskUserQuestion` follow-ups (up to 3 rounds), writes the working-copy `discussion-notes.md`, and shows the preview gate.
- **Handler no longer writes the working copy.** The parent LLM does that after reading the 4 scout reports. The handler still creates the run directory and the `discuss/` + `scouts/` subdirectories so the LLM knows where to write artifacts.
- **State is not mutated by `/velpari-discuss`.** Discussion is orthogonal: `createRun()` already advanced to `discussing`; the next transition (`discussed`) happens in `/velpari-approve-discuss`.

**New files:**

- `skills/agents/{extractor,prd-checker,rtm-checker,web-search-agent}.md` — 4 Pi agent definitions (real subagents) with YAML frontmatter, role description, input contract, output contract, completion contract, and `auto-exit: true / spawning: false / session-mode: standalone` flags. Bundled with the extension.
- `pi-extension/src/agents-install.ts` — `ensureScoutAgents(cwd)` helper that copies the 4 bundled agent definitions from `skills/agents/` into `.pi/agents/` on first use. Called automatically by `handleDiscuss`.
- `pi-extension/test/agents-install.test.ts` — 6 tests covering the bootstrap helper (fresh dir, skip present, create `.pi/agents/`, idempotent, format helper).

**Removed files:**

- `pi-extension/src/scout.ts` — `runScout`, `withTimeout`, `readScoutSkill` runner (in-process 30s-timeout wrapper, no longer used).
- `pi-extension/src/contracts.ts` — `ScoutContract`, `ScoutId`, `ScoutFn`, `ScoutOutput`, `ScoutProposal`, `ScoutInput`, `emptyScoutOutput` (in-process scout contract, no longer used).
- `pi-extension/src/scouts/{extractor,prd-checker,rtm-checker,web-search-agent}.ts` — 4 stub scout implementations returning empty proposals. Replaced by real Pi agent files.
- `skills/discuss-subagents/{extractor,prd-checker,rtm-checker,web-search-agent}.md` — 4 markdown skill stubs (replaced by `skills/agents/*.md`).
- `pi-extension/test/scout.test.ts` — tests for the deleted runner.

**Modified files:**

- `pi-extension/src/prompt.ts` — full rewrite. `loadStageSkill(stage)` now actually reads `skills/velpari-<skill>.md` (stripping YAML frontmatter); `buildStagePrompt(input)` assembles the `<pi-velpari stage="...">` metadata block with mission, framework, run ID, scout paths, embedded answers, web-search flag, and the stage skill content. Mirrors `pi-seani/src/prompt.ts:loadSkill + buildStagePrompt`.
- `pi-extension/src/discuss.ts` — full rewrite. New two-phase flow described above. `ctx` no longer accepts the 6 questions itself; the handler does. Handler no longer calls `mergeProposals`; the LLM does the deterministic merge.
- `pi-extension/src/commands.ts` — `REAL_HANDLERS` signature widened to accept optional `pi: ExtensionAPI`; `registerCommands` threads `pi` into the wrapper. Only `velpari-discuss` uses `pi` today.
- `skills/velpari-discuss.md` — full rewrite. Now describes the LLM-orchestrated sequence: spawn 4 subagents in parallel, wait, read reports, iterate up to 3 rounds, write working copy, show preview gate. Mirrors `pi-seani/skills/senai-plan.md` (scout spawning + sync rules) + `pi-seani/skills/senai-discussion.md` (iterative questioning).
- `pi-extension/test/prompt.test.ts` — full rewrite. 11 tests covering `loadStageSkill` (real file read, frontmatter strip, error cases) and `buildStagePrompt` (metadata block, framework line, embedded answers, web-search flag, scout paths, skill content inclusion).
- `pi-extension/test/discuss.test.ts` — full rewrite. 11 tests covering the two-phase flow: 6-question interview, skip-on-empty, web-search prompt, `pi.sendUserMessage` call shape, handler does NOT write working copy, state.stage not mutated, run directories created, agents bootstrapped on first use, no re-bootstrap on second call, follow-up notify, web-search flag embedded.
- `package.json` — added `@earendil-works/pi-interactive-subagents` (≥3.7.2) to `peerDependencies`. Required for the `subagent` tool.

**New peer dependency:**

`@earendil-works/pi-interactive-subagents` (≥3.7.2) — provides the `subagent` tool the parent LLM uses to spawn the 4 visible scout panes. Without it installed, the LLM has no way to spawn scouts and the discussion flow breaks. Install via Pi's package manager alongside Velpari.

**Risks / behavior changes:**

- First-run now silently creates 4 agent files in `.pi/agents/`. A `ctx.ui.notify` informs the user which files were installed.
- The 30s-per-scout timeout (v1.x) is gone; scouts run as long as they need to. Use the live subagent widget to monitor progress.
- The handler no longer writes the working copy synchronously; the LLM does that after all scouts complete. Users see a brief loading period between the interview finishing and the working copy appearing.

**Patched after doc-verification pass (2026-09-03, later):**

Verified against the official [`pi-interactive-subagents`](https://github.com/HazAT/pi-interactive-subagents) README and fixed 6 mismatches between our plan and the actual tool API:

- **`max_turns` removed** from `skills/velpari-discuss.md`. The `subagent` tool does NOT accept a turn cap; the parameter was hallucinated. Interrupt stuck scouts via `subagent_interrupt` instead.
- **Agent frontmatter updated.** All 4 agent files (`extractor`, `prd-checker`, `rtm-checker`, `web-search-agent`) now declare `tools: read, write, bash` and `thinking: minimal` per the docs' recommended fast-reconnaissance profile.
- **`caller_ping` documented.** Scouts can request help from the parent mid-task via `caller_ping({ message })`; the child exits and the parent is steered. Added to skill markdown.
- **`cwd` parameter documented.** Spawns should pass `cwd: <runDir>` so scouts can use relative paths.
- **`subagent_interrupt` clarified.** Works only for Pi-backed subagents; Claude-backed runs return an error.
- **Live widget status states** (`active`, `waiting`, `stalled`, `running`, `starting`) added to skill markdown for sync-rule decisions.

**Known issue carried forward:** [pi-interactive-subagents Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) — the zellij backend's `close-pane` step can close the parent session instead of the subagent pane. Workaround documented in `skills/velpari-discuss.md`: do NOT manually focus a subagent pane during the discussion.

### Fixed (Q1 verification — 2026-09-02)

Verified the architecture against the official Pi extension docs (github.com/earendil-works/pi) and corrected six stale references:

- **AGENTS.md line 33:** peer dependency corrected from `@mariozechner/pi-coding-agent` to `@earendil-works/pi-coding-agent`.
- **AGENTS.md line 61:** entry-point comment updated to reflect the verified `export default (pi: ExtensionAPI)` shape.
- **AGENTS.md line 116:** removed the unverifiable claim that `PI_SUBAGENT_NAME` guard applies. The guard itself is retained defensively; Phase A smoke-tests it.
- **AGENTS.md §Extension Loading:** added a note that the `PI_SUBAGENT_NAME` guard cannot be verified in current Pi docs and may be removed in Phase A if the smoke test fails.
- **README.md line 80:** clarified the two install modes (project-local `.pi/extensions/` vs npm-distributed `pi install npm:...`).
- **DevPlan/development-order.md:** added a "Verified architecture" section as the canonical reference for the entry-point shape, package metadata, and event names. (Committed separately in `1b227bc`.)

### Added (docs-first scope — v1.7 plan)

**v1.7 changes (project-name output documents + topic-scoped discussion):**

- **`projectName` captured in `/velpari-configure-inputs`** (FR-67). One-time setup, persisted in `.pi/velpari/files.json` (version 3). Validated by `config.ts:validateFilesConfig`. Missing → error from any stage command.
- **Output documents use `projectName` suffix** (FR-68). The previous hardcoded "Pi-Velpari" prefix is replaced. Example: a "TodoApp" project produces `Doc/PRD_TodoApp.md`, `Doc/RTM_TodoApp.md`, `Doc/design_TodoApp.md`, `Doc/pseudocode_TodoApp.md`, `Doc/test-plan_TodoApp.md`, `Doc/test-cases_TodoApp.md`, `Doc/feasibility-study_TodoApp.md`, `Doc/atomic-functions_TodoApp.md`, `Doc/development-order_TodoApp.md`.
- **Discussion output is per-topic** (FR-69). First `/velpari-discuss <topic>` produces `Doc/discussion-{topic-slug}.md`. Subsequent runs of the same topic append a timestamp suffix (`Doc/discussion-{topic-slug}-{YYYYMMDD-HHMMSS}.md`).
- **`topic-slug` derived from `/velpari-discuss <mission>`** (FR-70). Slugification: lowercase, hyphens for spaces, no special characters, max 64 chars.
- **Handoff schema uses project-suffixed paths** (FR-71). `.pi/senai/architect-inputs.json` documents reference `Doc/PRD_{projectName}.md` etc.
- **`paths.ts` module** — new central module with `buildOutputPath()`, `buildDiscussionPath()`, `slugify()`, `buildHandoffDocuments()`. Centralizes naming logic so all 22 commands produce consistent paths.
- **NFR-15** — output file names are deterministic and project-derived. The same `projectName` always produces the same file name. No "Pi-Velpari" hardcoding.
- **Sequence doc §5, §8, §9, §11** — artifact layout, handoff schema, end-to-end example, and sub-sequence table updated for project-suffixed output paths.
- **Design §3.2** — `files.json` schema upgraded to version 3 with `projectName`. §7.11 new architecture decision: why project-name output documents.
- **Pseudocode §20** — new `paths.ts` module pseudocode: `buildOutputPath`, `buildDiscussionPath`, `slugify`, `buildHandoffDocuments`, updated `publishToDoc`.
- **Test cases §38** — 11 new TCs (TC-209..TC-219) covering project name capture, output path derivation, discussion naming, slugify, handoff.
- **Test plan** — 24 test files (added `paths.test.ts`).
- **Step-by-step guide §1** — `/velpari-configure-inputs` now prompts for `projectName` first; example output file names listed.

**v1.6 changes (discussion-approve split + chain + stage-aware approval):**

- **`/velpari-approve-discuss` command (NEW).** Dedicated discussion-approve. Publishes `Doc/discussion-notes.md`, then **auto-invokes `/velpari-prd`** to chain through to PRD. The single user action that closes discussion and opens PRD.
- **`/velpari-approve` scope restricted.** Now applies only to stages 2–7 (prd, rtm, feasibility, design, pseudocode, testplan). Errors when invoked in discussion stage: "Use `/velpari-approve-discuss` for the discussion stage."
- **FR-28 removed.** `/velpari-discuss` no longer auto-updates PRD. PRD update is driven by `/velpari-prd`, which is auto-invoked by `/velpari-approve-discuss`.
- **FR-29 changed.** `/velpari-prd` is now the **primary** PRD path, not the "full-rewrite exception." Triggered automatically by `/velpari-approve-discuss`.
- **Stage-aware approval hint.** UI hint reflects `currentStage`: in `discussed`, suggests `/velpari-approve-discuss`; in any other stage, suggests `/velpari-approve`.
- **23 commands total** (was 22). New: `/velpari-approve-discuss`.
- **Sequence doc §2** — transition table updated: `discussing → discussed` is now triggered by `/velpari-approve-discuss`, not `/velpari-approve`. `discussed → drafting-prd → drafted-prd` happens in the chain.
- **Sequence doc §6** — command surface updated: 23 commands, discipline section now lists `/velpari-approve-discuss` first.
- **Design §2.23** — new `discuss-approve.ts` module documented.
- **Design §3.10** — new approval model section: table of stage-vs-approve behavior.
- **Design §7.10** — new architecture decision: why `/velpari-approve-discuss` is separate.
- **Pseudocode §19** — new module pseudocode: `handleApproveDiscuss`, `publishDiscussionNotes`, `chainToPrd`, `renderApproveHint`. Updated `handleApprove` to refuse discussion stage.
- **Test cases §37** — 8 new TCs (TC-201..TC-208): chain behavior, stage-aware errors, hint per stage, PRD canonical path.
- **Test plan** — 23 test files (added `discuss-approve.test.ts`).
- **Step-by-step guide §3** — `/velpari-approve-discuss` is the dedicated discussion-approve command. Auto-invokes `/velpari-prd`.

**v1.5 changes (framework as one-time setup + WEB SEARCH AGENT + uniform subagent pattern + TUI independence):**

- **Framework as one-time setup (FR-49, FR-57).** `/velpari-configure-inputs` now captures framework/language/libraries/runtime, persisted in `.pi/velpari/files.json:framework` (version 2). Injected into every stage prompt via `prompt.ts:buildStagePrompt()`. Not a pipeline stage.
- **WEB SEARCH AGENT replaces DECISION AGENT (FR-50..FR-53).** Discussion stage has 4 scouts: NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, WEB SEARCH AGENT. The web search agent is user-prompted (yes/no after interview) and collects (a) community resources (Stack Overflow, Reddit, blogs, GitHub issues), (b) official documentation (language, framework, library), (c) similar OSS projects. DECISION AGENT logic moved to the main handler as deterministic post-scout processing.
- **Uniform subagent pattern (FR-54, FR-56, NFR-13).** All 12 scout agents follow the `ScoutContract` defined in `pi-extension/src/contracts.ts`. `spawnScout()` helper enforces 30-second timeout, JSON output envelope, and error handling uniformly. Scout files live at `skills/scouts/{scoutId}.md`. Same picker UI used across all stages.
- **TUI independence (FR-55).** Velpari does NOT depend on Senai at runtime. TUI patterns (simple-picker, list-editor, role-picker) are re-implemented in `pi-extension/src/ui/` using Pi's TUI primitives. Both extensions work standalone. TC-199 verifies `package.json` has no Senai dependency; TC-200 verifies zero imports from Senai's source.
- **Sequence doc §10.4** — new section documenting the discussion scout pattern with WEB SEARCH AGENT activation flow.
- **Pseudocode §13, §18** — rewritten discussion pseudocode (4 scouts + main-handler merge); new §18 with `ScoutContract`, `spawnScout()`, `FrameworkInfo`, and prompt injection.
- **Design §2.20, §2.21, §2.22** — `contracts.ts`, `scout.ts`, `ui/` modules documented. §3.8 framework handling. §3.9 TUI independence. §7.8 + §7.9 architecture decisions (DECISION → main handler; TUI re-implementation rationale).
- **Test cases §36** — 12 new TCs (TC-189..TC-200) covering framework, web search, uniform subagent pattern, TUI independence.
- **Test plan** — 22 test files now (added `framework.test.ts`, `scout.test.ts`).
- **Step-by-step guide §1a** — framework setup section; §2 updated for web search prompt.

**v1.4 changes (per-command doc scope + gates + architecture discussion):**

- **`Doc/architecture-discussion.md`** — NEW FILE. Study-only doc cataloging Pi's layered monorepo, Senai's 16 architecture patterns, and 12+ community patterns. Includes 12 pending decisions; makes no recommendations.
- **Per-command doc scope definition (FR-43).** Every stage command declares its **reads** (Doc/ artifacts required) and **writes** (artifact produced). The full table is in `Doc/velpari-sequence.md` §11.
- **Per-command gate enforcement (FR-44).** Before any LLM call, the gate checks that all required input docs exist and are non-empty. Failure → clear error message, no LLM call, state unchanged. Implemented as `commands.ts:checkDocScope()`.
- **Sub-agent inventory documented (FR-45).** `Doc/velpari-sequence.md` §10 lists which commands spawn sub-agents today (3 commands, 12 scouts total) and which might in the future. No automatic sub-agent generation is performed.
- **No architecture command in Velpari (FR-47).** Velpari produces inputs; Senai generates architecture. Rationale: Velpari is pre-production; Senai is production. Documented in `Doc/design.md` §7.7.
- **PRD and RTM remain separate (FR-48).** Different audiences (stakeholder vs engineering), different review cycles. Merging would lose this separation.
- **Doc scope is the source of truth (NFR-12).** `Doc/PRD.md`, `Doc/velpari-sequence.md` §11, `Doc/design.md` §3.7, `Doc/pseudocode.md` §17, and `Doc/test-cases.md` §35 must all agree on per-command doc scope. Drift is a defect caught by doctor.
- **Sequence doc §11** — new "Sub-sequence: per-command doc scope and gate" section with the full table for all 10 stage commands + discipline commands + view commands + the gate enforcement contract.
- **Pseudocode §17** — gate function pseudocode (`COMMAND_SCOPE`, `checkDocScope`) plus per-command gate behavior for all 10 stage commands.
- **Test cases §35** — 22 new TCs (TC-167..TC-188) covering gate failure paths, gate success paths, empty-file detection, `COMMAND_SCOPE` consistency, sub-agent inventory, architecture decisions.
- **Test plan updated** to 20 test files (added `gate.test.ts`).

**v1.3 changes (post-pipeline stages + helper↔atomic model):**

- **`/velpari-atomic-function`** stage command — optional post-pipeline stage with 4 scout agents (AF-SCOUT-1 helper splitter, AF-SCOUT-2 duplicate pattern finder, AF-SCOUT-3 requirement helper, AF-SCOUT-4 test helper) that propose atomic functions; user reviews in unified picker UI; only accepted entries land in `Doc/atomic-functions.md`.
- **`/velpari-development-order`** stage command — optional post-pipeline stage with 4 scout agents (DO-SCOUT-1 dependency sort, DO-SCOUT-2 risk priority, DO-SCOUT-3 test priority, DO-SCOUT-4 user value) that propose implementation order; merged via average rank; user drag-reorders in picker; final order lands in `Doc/development-order.md`.
- **Helper ↔ atomic function relationship** — atomic functions are strictly leaf nodes (cannot call other atomics); helper functions may call atomic functions; dependency recorded bidirectionally (`helper → calls atomic: AF-NN` and `atomic → called by helper: HF-NN`).
- **Handoff schema extension** — `/velpari-handoff` includes `Doc/atomic-functions.md` and `Doc/development-order.md` in `.pi/senai/architect-inputs.json` under document types `Atomic Functions` and `Development Order` when those files exist. If they don't exist, the handoff proceeds without them.
- **9-stage pipeline** with 19 stage states (was 15). Pipeline: `discuss → prd → rtm → feasibility → design → pseudocode → testplan → (atomic-function → development-order | skip) → handoff-ready`. Both new stages are optional and can be run in either order.
- **Scout pattern** — 12 scout agents total (4 in discuss + 4 in atomic-function + 4 in development-order) share the same orchestration pattern: 4 parallel agents + JSON parsing + dedup/merge + user-reviewed picker UI. Mirrors Senai's plan-stage scouts.
- **NFR-11** documents the scout-pattern exception: subagents are permitted in 3 stages only; stages 2–7 and handoff MUST NOT spawn subagents.

**v1.2 changes (discussion 4-agent pattern):**

- **`/velpari-discuss`** spawns 4 parallel subagents: NEW EXTRACTOR (captures user input), PRD CHECKER (reads existing PRD), RTM CHECKER (reads existing RTM), DECISION AGENT (merges and classifies).
- **Auto-update PRD on `/velpari-approve`** — the DECISION AGENT's verdict is auto-applied to `Doc/PRD_Pi-Velpari.md` (new FR-Ns added; existing FR-Ns updated; new helpers appended to `## Helper Functions`).
- **Helper functions live in PRD** — `## Helper Functions` section with `HF-NN` ids, name, file path, signature, purpose, and FR-N dependencies.
- **`/velpari-prd`** retained only for the full-rewrite use case (after a major pivot).
- **NFR-02** scoped — subagents forbidden in stages 2–7 only (was "never").

**v1.1 changes (docs-first scope — already documented):**

- **`Doc/PRD.md`** expanded from 32-line stub to full PRD with FR-N identifiers (FR-01..FR-36 in v1.3, NFR-01..NFR-11).
- **`Doc/RTM_Pi-Velpari.md`** — traceability matrix covering 47 requirements and 163 test cases.
- **`Doc/feasibility-study.md`** — 5-dimension feasibility (Technical, Economic, Legal, Operational, Schedule) with Go verdict.
- **`Doc/design.md`** — high-level design (19 source modules with `atomic-function.ts` and `development-order.ts`).
- **`Doc/pseudocode.md`** — algorithm pseudocode for every exported function including 8 scout agents.
- **`Doc/test-plan.md`** and **`Doc/test-cases.md`** — test strategy and 163 specific test cases across 19 test files.
- **`Doc/velpari-sequence.md`** — 9-stage sequence flow with scout pattern.
- **`Doc/step-by-step-guide.md`** — walkthrough with examples for the 4-agent discussion and the post-pipeline stages.
- **`AGENTS.md`**, **`README.md`** — contributor rules and user-facing entry updated for v1.3.

### Added (command surface — 22 commands)

- **22 `/velpari-*` commands** documented across all docs:
  - 9 stage commands: `/velpari-discuss`, `/velpari-prd`, `/velpari-rtm`, `/velpari-feasibility`, `/velpari-design`, `/velpari-pseudocode`, `/velpari-testplan`, `/velpari-atomic-function`, `/velpari-development-order`.
  - 6 discipline commands: `/velpari-approve`, `/velpari-status`, `/velpari-reset`, `/velpari-configure-inputs`, `/velpari-doctor`, `/velpari-handoff`.
  - 7 view commands: `/velpari-show-discussion`, `/velpari-show-prd`, `/velpari-show-rtm`, `/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`, `/velpari-show-testplan`.

### Planned for next releases

- **Phase A — Foundation**: `package.json`, `tsconfig.json`, `.gitignore`, `pi-extension/src/{index,constants,state,prompt,commands,compaction,config,doctor,handoff,show}.ts`, plus 10 corresponding test files.
- **Phase B — First 3 content stages** (with 4-agent discussion): `pi-extension/src/{discuss,prd,rtm}.ts`, plus `skills/velpari-{discuss,prd,rtm}.md` and `skills/discuss-subagents/{extractor,prd-checker,rtm-checker,decision-agent}.md`, plus 3 test files.
- **Phase C — Remaining 4 content stages**: `pi-extension/src/{feasibility,design,pseudocode,testplan}.ts`, plus 4 skills, plus 5 Doc templates, plus 4 test files.
- **Phase D — Handoff bridge**: full implementation of `handoff.ts` with optional artifact handling, `skills/velpari-handoff.md`, schema round-trip test.
- **Phase E — Show commands**: full implementation of `show.ts`, plus test file.
- **Phase F — Atomic-function stage** (new in v1.3): `pi-extension/src/atomic-function.ts`, 4 AF scout functions, `skills/velpari-atomic-function.md`, plus test file.
- **Phase G — Development-order stage** (new in v1.3): `pi-extension/src/development-order.ts`, 4 DO scout functions, `skills/velpari-development-order.md`, plus test file.

### Notes

- v1.3 is the current docs-first scope. No code has been written yet.
- All docs use Velpari's own future template structure (dogfood), so the docs themselves prove the templates work.
- Cross-extension compatibility with Senai is preserved by reading `Pi-Orchestra_v4/pi-extension/src/architect-inputs-config.ts` at handoff-test time. Optional artifacts (`atomic-functions.md`, `development-order.md`) extend the handoff schema with new document types; the handoff test verifies Senai's acceptance.
- The post-pipeline stages can be deferred to a v1.x release if schedule pressure arises. The core 9-stage surface (7 required + 2 optional stubs) ships in v1.0.

## [1.0.0] — 2026-08-23

### Added

- Initial 32-line PRD at `Doc/PRD.md` describing `/velpari-prd` and `/velpari-rtm` with the zero-hallucination rule and the developer confirmation gate.
- One planning note at `.IDE_Plans/git_init_plan_20260823_1755_v1.0.md` (git init history).

### Notes

- This is the pre-v1.1 baseline. The 32-line PRD is fully superseded by the v1.1 PRD expansion.
