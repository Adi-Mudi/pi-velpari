# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed (research-based profile workflow — 2026-09-05)

Implements the approved `profile_workflow_plan_20260904_2349_v1.0.md`. PSRS structure, RTM structure, grouped `Doc/` paths, stage transitions, and command names are unchanged.

- **Common PSRS core profile.** `core-psrs-v1` is now a first-class, versioned, deterministic profile in the built-in library. Its applicationType is `other`, domain `general`, developmentMethod `agile`, regulated `false`, securityLevel `medium`, outputVariant `standard`. A common-core selection is a real, valid choice — never a fallback for missing matches.
- **`ProfileRecommendation` type + scoring.** `recommendProfiles(answers)` returns up to three deterministic recommendations: the common PSRS core plus up to two closest built-in profiles. Each carries a 0–100 score, reasons, and trade-offs. Sort order: `score DESC, profileId ASC`.
- **`compactProfileMetadata` gains `profileKind`.** The compact projection now includes `"common-core" | "built-in"`.
- **Persisted profile shape (v1.1.0).** `version = "1.1.0"`. New `profileKind` field. v1.0.0 profiles still load only if the user manually migrates them; the validator enforces the v1.1.0 shape. `REQUIREMENTS_PROFILE_VERSION` bumped.
- **Native Pi selectors.** `/velpari-configure-requirements` uses `ctx.ui.select(title, options)` for novelty, application type, domain, development method, security level, regulated (via confirm), profile recommendation, and fallback actions. Free text stays on `ctx.ui.input(title, placeholder)`; yes/no stays on `ctx.ui.confirm(title, message)`. Tests mock `select`.
- **Research BEFORE final profile selection.** Web-research consent (`ctx.ui.confirm`) is now collected immediately after the answers, before any recommendation list or saving. The research prompt explicitly states `Profile selection: PENDING`, says `MUST NOT save or write a profile`, and never includes a final selected profile id. Findings remain suggestions only. If consent is granted but `pi` is absent, the handler skips the handoff with a warning and still saves the profile with `researchConsent: true` and empty `researchSources`.
- **`closestBuiltInProfile(answers)` helper.** Deterministic lookup used by the fallback action `Use closest built-in profile`.
- **`runFallbackActions(ctx, cwd)` helper.** Surfaces the four documented fallback actions via native `ctx.ui.select`. No fake custom-profile action. Returns `"core" | "closest" | "stop" | undefined`.
- **Doctor is report-only.** `doctor.ts` adds profile mode, id, version-with-expected-comparison, research consent + source count, and the explicit "Doctor is report-only" note. It also reports when a common-core profile is in use. Doctor never selects, fixes, or mutates a profile.
- **`suggestProfiles` excludes common core.** The deterministic match list keeps the original behaviour (built-ins only). Use `recommendProfiles` for the user-facing list that always includes the common core.

### Added (Phase 7 — Velpari Requirements Factory, 2026-09-04)

Implements the design documented in `Doc/velpari-requirements-orchestration-design.md`.

**New commands (2):**

- **`/velpari-configure-requirements`** — captures the project's requirements profile (application type, domain, development method, regulated flag, security level, required sections, conditional questions) via dynamic core + conditional questions; suggests matching built-in profiles with reasons (deterministic, sorted by profileId); explicitly requires the user's confirmation before saving; asks for web-research consent and, on consent, hands a compact research prompt to the parent LLM via `pi.sendUserMessage` (the extension never fetches the web itself, never adds dependencies, never spawns subagents from this handler). If no profile matches, the handler reports the gap and the documented options — it never invents a profile. Profile persisted at `.pi/velpari/requirements-profile.json`.
- **`/velpari-prd-rtm`** — wrapper that calls `handlePrd` then `handleRtm` in sequence. The wrapper does not duplicate stage logic, does not auto-approve, and can be skipped in favor of the independent `/velpari-prd` + `/velpari-rtm` calls.

**New modules (4):**

- `pi-extension/src/requirements-profile.ts` — versioned profile schema, deterministic profile library, suggest/match logic, save/load, compact-metadata projection, `validateRequirementsProfile` strict guard, `buildConditionalQuestions` for banking/healthcare/AI/regulated extensions.
- `pi-extension/src/psrs.ts` — pure PSRS structural validator (frontmatter, 16 required sections, FR/NFR/HF dedup + duplicates, open-questions + IDs, helper traceability, placeholder detection, MVP/Phases presence + thin-section warning, acceptance/verification aggregation, renderPsrsSummary).
- `pi-extension/src/configure-requirements.ts` — handler for `/velpari-configure-requirements`; calls existing helpers + builds the compact research handoff prompt.
- `pi-extension/src/prd-rtm.ts` — wrapper for `/velpari-prd-rtm`; calls `handlePrd` then `handleRtm`.

**Grouped category layout (new writes):**

`Doc/` documents are now organized into category subfolders for new writes:

```
Doc/
├── discussion/discussion-<topic>.md
├── requirements/PRD_<project>.md        (combined PSRS)
├── requirements/RTM_<project>.md
├── feasibility/feasibility-study_<project>.md
├── design/design_<project>.md
├── pseudocode/pseudocode_<project>.md
├── tests/test-plan_<project>.md
├── tests/test-cases_<project>.md
├── atomic-functions/atomic-functions_<project>.md
└── development-order/development-order_<project>.md
```

Legacy flat paths (`Doc/PRD_<project>.md`, `Doc/discussion-<slug>.md`, etc.) remain readable everywhere as fallback. Nothing is moved, deleted, or overwritten. Working copies under `.IDE_Plans/velpari/runs/<run-id>/` use the matching category folder name (`prd/`, `rtm/`, `tests/`, etc.).

**PSRS shape (preserves the `PRD_<project>.md` file name):**

`/velpari-prd` produces a document with mandatory sections: Objective, Problem, System Actors, Scope, MVP, Phases, Functional Requirements, Non-Functional Requirements, Data and Interfaces, Errors and Edge Cases, Constraints, Dependencies and Risks, Out of Scope, Open Questions, Acceptance Criteria, Helper Function Candidates, plus YAML frontmatter (`documentType: product-software-requirements`, `version`, `status`, `profile`, `profileVersion`, `mission`, `projectName`). RTM remains a separate document and reads the PSRS.

**Stage runner + prompt:**

- `StageRunConfig.profileMetadata` — compact profile projection injected into the stage prompt as a `## Profile (compact)` block. Only the compact projection is carried, never the full profile.
- `BuildStagePromptInput.profileMetadata` — same projection rendered into the prompt.
- Profile absence → block omitted, prompt unchanged.

**Updated handlers + doctor + status + show + handoff:**

- `prd.ts`, `rtm.ts`, `feasibility.ts`, `design.ts`, `pseudocode.ts`, `testplan.ts`, `atomic-function.ts`, `development-order.ts` — read input artifacts from grouped layout first, fall back to legacy flat path; write working copies to grouped working-copy layout; pass `profileMetadata` to the stage runner.
- `approve.ts` — publishes to grouped Doc/<category>/ (testplan keeps the two-file approval); reads working copies from grouped working-copy dir first, falls back to legacy flat.
- `discuss-approve.ts` — publishes discussion to `Doc/discussion/discussion-<topic-slug>.md` with timestamp-suffix fallback for re-runs.
- `show.ts`, `status.ts`, `handoff.ts` — resolveDocArtifact + resolveDiscussionArtifact (grouped first, legacy fallback).
- `doctor.ts` — adds profile presence/version/mismatch, grouped/legacy paths, PSRS structural validation, RTM-to-PSRS traceability, working/published separation, MVP/phases coverage checks. Doctor remains a reporter; it never auto-selects, fixes, or generates a profile.

**Paths module (`pi-extension/src/paths.ts`):**

- `buildGroupedPath(artifact, projectName)` → `Doc/<category>/<artifact>_<project>.md`
- `buildGroupedDiscussionPath(topicSlug)` → `Doc/discussion/discussion-<slug>.md`
- `buildWorkingGroupedPath(cwd, runId, artifact, projectName)` → grouped working-copy path
- `resolveDocArtifact` / `resolveDiscussionArtifact` — `{ path, layout: "grouped" | "legacy" }` resolution with grouped-first, legacy fallback.
- `GROUPED_CATEGORIES` / `WORKING_GROUPED_CATEGORIES` — single source of truth for the category map.
- `buildOutputPath` / `buildDiscussionPath` — preserved for back-compat.

**New skill markdown:**

- `skills/velpari-configure-requirements.md` — describes the deterministic profile selection flow + web-research consent rules + output contract + hard rules.
- `skills/velpari-prd.md`, `skills/velpari-rtm.md` — updated to describe PSRS structure, grouped working/published paths, and the compact profile metadata block.

**Test count: 424 passing** (was 347; +77 net). New test files:

- `pi-extension/test/requirements-profile.test.ts` (32 tests) — schema validation, save/load round-trip, deterministic suggestion, library sanity, conditional questions, compact projection.
- `pi-extension/test/psrs.test.ts` (28 tests) — frontmatter, headings, FR/NFR/HF dedup, open-questions, placeholders, MVP/phases thin-section, acceptance/verification aggregation.
- `pi-extension/test/configure-requirements.test.ts` (12 tests) — happy path, gap reporting, cancel, override, research consent (with and without `ExtensionAPI`), re-run existing profile.
- `pi-extension/test/paths.test.ts` (existing) — extended with grouped-path builders, category map, resolveDocArtifact/resolveDiscussionArtifact.
- `pi-extension/test/prompt.test.ts` (existing) — extended with `## Profile (compact)` rendering + absence behavior.

**Pre-existing unrelated changes preserved (per task instructions):**

- `.IDE_Plans/git_init_plan_20260823_1755_v1.0.md` — marked deleted in `git status`; left untouched.
- `pi-extension/test/e2e/README.md`, `pi-extension/test/e2e/_setup.ts`, `pi-extension/test/e2e/doctor.e2e.test.ts` — pre-existing modifications; left untouched.
- `Doc/velpari-requirements-orchestration-design.md` — untracked file referenced as the design source; left untouched.

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

## [v0.4.0] — 2026-09-05 — Architecture upgrade (7 phases, A through F + G doc sync)

Phase A through Phase F commit-by-commit. Each is a single, recoverable
step; rollback is `git revert <sha>` on the individual commit.

### Phase A — Folder layout (refactor only)

- `9d1b83b` — Move 30 src modules into 6 subfolders (`core/`, `stages/`,
  `discipline/`, `view/`, `prompts/`, `ui/`) by concern. Net 0 LOC change.
- `c6fbcb6` (followup) — Pin the new 4-level `__dirname` probe chain
  for `bundledAgentPath` and `resolveSkillPath`. Adds 2 regression tests.

### Phase B — STAGE_REGISTRY + DRY stage handlers (refactor only)

- `6fe3ea2` — Introduce `stages/registry.ts` with `STAGE_REGISTRY`,
  `runStage()`, and `resolveStageInputs()`. The 8 single-input + multi-
  input stage handlers shrink from ~100 lines each to ~10. Per-stage
  error wording byte-for-byte preserved.
- `e76f5f7` (followup) — 4 edge tests: multi-input concatenation,
  optional-discussion skip, doc legacy fallback, `stageEnum` drift
  detection.

### Phase C — Profile split (refactor only)

- `eca15b4` — Split `requirements-profile.ts` (598 monolith) into
  `core/profile.ts` (types + persistence) + `core/profiles-library.ts`
  (built-in library + scoring). Split `configure-requirements.ts`
  (511 monolith) into `discipline/configure-requirements/{index,
  interview,research,recommend}.ts`. Per-document and per-test imports
  rewired.
- `2a92834` (followup) — Direct `migrateLegacyProfile` contract test
  (writes v1.0.0 JSON, asserts migration shape).

### Phase D — Doctor split (refactor only)

- `03af76d` — Split `doctor.ts` (560 monolith) into
  `discipline/doctor/{index,report}.ts` + 7 checks under
  `discipline/doctor/checks/`. Discovered + recorded a JSDoc parser
  bug caused by literal `**/` inside backticked comment text.
- `70a5d62` (followup) — `handleDoctor` + truncation contract test.
  Locks in the entry wrapper that previously had zero direct coverage.

### Phase E — Pi-native features (the only feature commit)

- `61b1198` — Drop unverified `PI_SUBAGENT_NAME` guard. Add
  `pi-package` keyword to `package.json`. New `appendStageEntry(pi,
  state)` in `core/state.ts`. Called after every `advanceStage` to
  persist state as a `velpari-state` entry — survives session fork /
  resume. `pi.events.emit` on `velpari:start / :before-compact /
  :shutdown`. `pi.registerShortcut` for `ctrl+shift+v` (status) and
  `ctrl+shift+r` (reset). `pi.registerFlag` for `velpari-skip-doctor`
  (boolean) and `velpari-stage` (string). `discipline/status.ts`
  switched from `ctx.ui.notify` (truncated at ~8000 chars) to
  `pi.appendEntry("velpari-status", ...)` with full body + profile
  metadata. Custom entry renderer (`ui/entry-renderer.ts`) deferred
  until `@earendil-works/pi-tui` peer dep is approved.
- `619da1a` (followup) — 5 direct tests for the new contracts:
  `appendStageEntry` shape, 3 event emissions, status entry shape.

### Phase F — resources_discover migration (refactor only)

- `dc61099` — Honest reading: Pi's `pi.on("resources_discover", ...)` is
  for paths Pi should auto-discover, NOT for resolving bundled
  extension assets. So Phase F pragmatically collapsed 4 dead
  `__dirname` probe candidates in `bundledAgentPath` and
  `resolveSkillPath` (only the 4-level-up probe is live since Phase A),
  and added an explicit `pi.on("resources_discover")` registration
  contributing `<cwd>/skills` as a Pi resource path. Net −20 LOC, no
  behavior change.
- `82e4a4a` (followup) — Pin the `resources_discover` registration
  contract (1 test in `index.test.ts`).

### Documentation sync (Phase G)

- `AGENTS.md` "Project structure" block rewritten to reflect the new
  6-subfolder layout and the per-subfolder module summary.
- `Doc/pseudocode.md` §8 doctor.ts reference updated to the new
  `discipline/doctor/index.ts`.
- This CHANGELOG entry.

### Tests

- 463 unit tests + 5 E2E tests across 38 test files (Phase F followup).
- All phase commits maintain the test gate.
- Symlink contract unchanged: `~/.pi/agent/extensions/pi-velpari →
  dist/pi-extension/src`.
