# Pi-Velpari — Development Order

The order in which Pi-Velpari's source code is built. Mirrors the Phase A→G roadmap in `CHANGELOG.md` but adds files-per-phase, dependency edges, and validation criteria for each step.

## Why a separate doc?

`CHANGELOG.md` lists what changed per release. This doc lists what to build next and in what order. Both are needed: CHANGELOG is history; this is the live plan.

## Guiding principles

1. **Build the harness first.** Phase A only delivers a green `npm run build` + `npm test` loop. No user-visible behavior. Cheap to fix foundation mistakes; expensive later.
2. **One phase = one shippable increment.** Each phase ends with a test pass.
3. **Optional stages ship last.** Atomic-function (F) and Development-order (G) are post-pipeline; they are not on the critical path for v1.0.

## Phase summary

| Phase | Scope | New files | Test files | Blocks |
|---|---|---|---|---|
| A | Foundation | 12 | 10 | B, C, D, E, F, G |
| B | Discuss + PRD + RTM | 11 | 3 | C |
| C | Feasibility + Design + Pseudocode + Testplan | 10 | 4 | D |
| D | Handoff bridge | 1 | 0 (extend) | E, F, G |
| E | Show commands | 0 (extend) | 0 (extend) | F, G |
| F | Atomic-function (optional) | 7 | 1 | — |
| G | Development-order (optional) | 7 | 1 | — |

## Phase A — Foundation

**Goal:** Make `npm run build` + `npm test` exit 0 on an empty pipeline.

**Files to create:**

| File | Purpose |
|---|---|
| `package.json` | npm metadata, scripts, `pi.extensions` field, peer dep on `@mariozechner/pi-coding-agent` |
| `tsconfig.json` | TS strict mode, ESM target, `dist/pi-extension/` output |
| `pi-extension/src/index.ts` | Entry point — extension guard + `registerCommands` call |
| `pi-extension/src/constants.ts` | `Stage` enum, `STAGE_TRANSITIONS` table, path helpers |
| `pi-extension/src/state.ts` | `loadState`, `saveState`, `createRun`, `advanceStage`, `clearRun`, `publishToDoc` |
| `pi-extension/src/prompt.ts` | `loadStageSkill`, `buildStagePrompt` |
| `pi-extension/src/compaction.ts` | `buildCompactionSummary` (zero-LLM) |
| `pi-extension/src/config.ts` | `configure-inputs`: load/save/validate `files.json` |
| `pi-extension/src/doctor.ts` | `runDoctor`, `writeDoctorReport`, `scanForSecrets` |
| `pi-extension/src/handoff.ts` | `runHandoff`, `validateSenaiSchema`, `readApprovedArtifacts` (stub) |
| `pi-extension/src/show.ts` | `showStage` (parameterized, stub) |
| `pi-extension/src/commands.ts` | `registerCommands` + 23 handlers (mostly stubs in Phase A) |

**Tests:** one `.test.ts` per source module — 10 test files.

**Validates:**
- `npm install` exits 0
- `npm run build` exits 0 under TS strict mode, no warnings
- `npm test` exits 0; covers every source module
- `Stage` enum + `STAGE_TRANSITIONS` is the source of truth (verified by tests)
- The extension loads inside Pi without spawning subagents (guard works)

**Depends on:** nothing.

**Blocks:** every later phase.

---

## Phase B — Discuss + PRD + RTM (first 3 content stages)

**Goal:** A user can run `/velpari-discuss`, answer the interview, and see a discussion note drafted.

**Files to create:**

| File | Purpose |
|---|---|
| `pi-extension/src/discuss.ts` | 4-scout coordinator + main handler |
| `pi-extension/src/prd.ts` | PRD generator (post-discussion auto-invoke path) |
| `pi-extension/src/rtm.ts` | RTM generator |
| `skills/velpari-discuss.md` | Discuss stage prompt template |
| `skills/velpari-prd.md` | PRD stage prompt template |
| `skills/velpari-rtm.md` | RTM stage prompt template |
| `skills/discuss-subagents/extractor.md` | NEW EXTRACTOR scout |
| `skills/discuss-subagents/prd-checker.md` | PRD CHECKER scout |
| `skills/discuss-subagents/rtm-checker.md` | RTM CHECKER scout |
| `skills/discuss-subagents/decision-agent.md` | DECISION AGENT (deterministic merge) |
| `pi-extension/test/discuss.test.ts` | Discuss stage test |
| `pi-extension/test/prd.test.ts` | PRD stage test |
| `pi-extension/test/rtm.test.ts` | RTM stage test |

**Validates:**
- Clean discuss → approve-discuss → prd → approve → rtm → approve chain runs end-to-end
- Helper-function dedup works (by `name + file path`)
- Stage transitions match `STAGE_TRANSITIONS`
- `/velpari-approve-discuss` auto-invokes `/velpari-prd` after publishing

**Depends on:** Phase A.

**Blocks:** Phase C.

---

## Phase C — Remaining 4 content stages

**Goal:** Full core 7-stage pipeline runs from discuss to `planned-tests`.

**Files to create:**

| File | Purpose |
|---|---|
| `pi-extension/src/feasibility.ts` | 5-dimension feasibility analyzer |
| `pi-extension/src/design.ts` | High-level design generator |
| `pi-extension/src/pseudocode.ts` | Algorithm pseudocode writer |
| `pi-extension/src/testplan.ts` | Test plan + test cases writer |
| `skills/velpari-feasibility.md` | Stage prompt |
| `skills/velpari-design.md` | Stage prompt |
| `skills/velpari-pseudocode.md` | Stage prompt |
| `skills/velpari-testplan.md` | Stage prompt |
| `pi-extension/test/feasibility.test.ts` | Stage test |
| `pi-extension/test/design.test.ts` | Stage test |
| `pi-extension/test/pseudocode.test.ts` | Stage test |
| `pi-extension/test/testplan.test.ts` | Stage test |

**Validates:**
- Discuss → PRD → RTM → Feasibility → Design → Pseudocode → Testplan reaches `planned-tests`
- Every artifact traces back to discussion (zero-hallucination check)
- `/velpari-doctor` passes on a clean run

**Depends on:** Phase B.

**Blocks:** Phase D.

---

## Phase D — Handoff bridge

**Goal:** `/velpari-handoff` produces a Senai-accepted input file.

**Files modified:**
- `pi-extension/src/handoff.ts` — full implementation (was a stub in Phase A). Reads every published `Doc/`, builds `.pi/senai/architect-inputs.json`, validates against Senai's schema by reading `Pi-Orchestra_v4/pi-extension/src/architect-inputs-config.ts` at test time.

**Files created:**
- `skills/velpari-handoff.md` — handoff stage prompt

**Tests:** extend `handoff.test.ts` — schema round-trip test.

**Validates:**
- After `/velpari-testplan` + `/velpari-approve`, `/velpari-handoff` produces a JSON file that `/senai-configure-architect-inputs` accepts without manual editing
- Optional artifacts (`atomic-functions.md`, `development-order.md`) are included when present

**Depends on:** Phase C.

**Blocks:** Phase E.

---

## Phase E — Show commands

**Goal:** All 7 `/velpari-show-*` commands print the published artifact.

**Files modified:**
- `pi-extension/src/show.ts` — full implementation (was a stub from Phase A). 7 read paths.
- `pi-extension/test/show.test.ts` — extend.

**Validates:**
- Each `/velpari-show-*` prints the matching `Doc/` artifact exactly
- Read-only — never mutates state

**Depends on:** Phase D (so all artifacts exist for testing).

**Blocks:** Phase F, Phase G.

---

## Phase F — Atomic-function stage (optional, post-pipeline)

**Goal:** 4 AF scouts propose atomic functions; user reviews in picker; accepted entries land in `Doc/atomic-functions_<projectName>.md`.

**Files to create:**

| File | Purpose |
|---|---|
| `pi-extension/src/atomic-function.ts` | 4-scout coordinator + picker UI |
| `skills/velpari-atomic-function.md` | Stage prompt |
| `skills/discuss-subagents/af-scout-1.md` | Helper splitter scout |
| `skills/discuss-subagents/af-scout-2.md` | Duplicate-pattern finder scout |
| `skills/discuss-subagents/af-scout-3.md` | Requirement-helper scout |
| `skills/discuss-subagents/af-scout-4.md` | Test-helper scout |
| `pi-extension/test/atomic-function.test.ts` | Stage test |

**Validates:**
- 4 proposals are produced; user accepts N; only accepted entries land in published doc
- Bidirectional helper ↔ atomic references in PRD are correct
- Atomic functions are strictly leaf nodes

**Depends on:** Phase E.

**Blocks:** nothing.

---

## Phase G — Development-order stage (optional, post-pipeline)

**Goal:** 4 DO scouts propose implementation order; user drag-reorders; final order lands in `Doc/development-order_<projectName>.md`.

**Files to create:**

| File | Purpose |
|---|---|
| `pi-extension/src/development-order.ts` | 4-scout coordinator + ranking merge + reorder UI |
| `skills/velpari-development-order.md` | Stage prompt |
| `skills/discuss-subagents/do-scout-1.md` | Dependency-sort scout |
| `skills/discuss-subagents/do-scout-2.md` | Risk-priority scout |
| `skills/discuss-subagents/do-scout-3.md` | Test-priority scout |
| `skills/discuss-subagents/do-scout-4.md` | User-value scout |
| `pi-extension/test/development-order.test.ts` | Stage test |

**Validates:**
- Weighted merge of 4 scout proposals is consistent
- User can override; final order is preserved on `/velpari-approve`
- Atomic leaves precede helpers that call them

**Depends on:** Phase E.

**Blocks:** nothing.

---

## Validation per phase

Every phase ends with these gates (run in this order):

1. `npm run build` — TS strict mode, exit 0, no warnings
2. `npm test` — `node --test`, exit 0, all new tests pass
3. `npx tsc --noEmit` — verify no type drift from prior phases
4. Manual smoke — load the extension in Pi, run the relevant `/velpari-*` command, confirm behavior matches `Doc/design.md`

A phase is not DONE until all four gates pass.

## How phases relate to releases

- **v1.0** ships Phases A → B → C → D → E (core 7-stage pipeline + handoff + show).
- **v1.1** adds Phases F + G (optional post-pipeline stages).
- A future **v1.2+** may add web-search-agent toggles, multi-project runs, or schema migration tooling — see `Doc/architecture-discussion.md` for the pending-decisions list.

## Where this doc lives

`DevPlan/development-order.md` is the canonical source. `CHANGELOG.md` records history. If they ever disagree, this doc wins for "what to build next."
