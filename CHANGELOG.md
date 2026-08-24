# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (docs-first scope — v1.3 plan)

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
