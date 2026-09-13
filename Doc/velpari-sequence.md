# Velpari Sequence

The single source of truth for how a mission moves through Velpari's
9-stage pre-production pipeline. Use this as the reference when you
are not sure what command to run next, what a stage's pre-requisites
are, or what every stage handler does inside.

---

## 1. Simple Overview

The pipeline is a linear sequence of 9 stages plus an optional handoff.
Every `→` is a gate: nothing moves forward until you run the matching
`/velpari-approve` (or `/velpari-approve-brainstorm` after the first stage).

```
/velpari-brainstorm
        │  brainstorm notes (working copy)
        ▼
/velpari-approve-brainstorm ── publishes brainstorm + auto-runs /velpari-prd
        │
        ▼
/velpari-prd
        │  PRD draft (working copy)
        ▼
/velpari-approve ── publishes PRD
        │
        ▼
/velpari-rtm
        │  RTM draft (working copy)
        ▼
/velpari-approve ── publishes RTM
        │
        ▼
/velpari-feasibility
        │  feasibility study (working copy)
        ▼
/velpari-approve ── publishes feasibility study
        │
        ▼
/velpari-architecture-generator
        │  design (working copy)
        ▼
/velpari-approve ── publishes design
        │
        ▼
/velpari-pseudocode
        │  pseudocode (working copy)
        ▼
/velpari-approve ── publishes pseudocode
        │
        ▼
/velpari-testplan
        │  test plan + test cases (working copy)
        ▼
/velpari-approve ── publishes test plan + test cases
        │
        ▼
/velpari-handoff ── exports architect-inputs.json to .pi/senai/
        │
        ▼
   Senai takes over (plan → implement → document → deliver)
```

Optional, after any approved stage from design onward:

```
/velpari-atomic-function   ──  atomic function list (after design)
/velpari-development-order ──  execution order     (after atomic-function)
```

Change flow (living documents) — any change to an approved artifact
starts at brainstorm and flows forward through the sequence. The
sequence is the update mechanism; there is no separate edit path:

```
/velpari-brainstorm "<the change>"   (change mode: the prompt carries
        │                             the published docs, config, and
        │                             run history — paths, read on demand)
        ▼
/velpari-approve-brainstorm
        ▼
/velpari-prd → … → /velpari-testplan (each stage runs in UPDATE MODE when
        │                             its published artifact exists:
        │                             revise the baseline, never regenerate)
        ▼
/velpari-approve                     (revision gate: no dropped IDs,
                                      version bumped, new Change Log entry)
```

---

## 2. Detailed Step-by-Step

Each stage has the same shape: pre-requisite, inputs, behaviour,
working + published outputs, and the exact command that advances.

### Stage 1 — Brainstorm (lifecycle v2)

| | |
|---|---|
| **Command** | `/velpari-brainstorm <mission>` |
| **Pre-req** | None. Start of a new run. Refuses an empty seed. |
| **Inputs** | Mission text from user. Scan selection from the scan-plan gate (community scan = web-search consent). |
| **Behaviour** | Understand-first lifecycle (details in §3): [0] UNDERSTAND (conversational, inline reads, no subagents) → [1] CONFIRM loop with hard lock → [2] SCAN-PLAN GATE (code+doc default; community = web-search consent, run/adjust/skip) → [3] SCANS (visible read-only scout subagents per selected scan) → [4] INFORM (facts + questions with suggested answers) → [5] DISCUSS loop (decision ledger written immediately) → [6] BATCH CONFIRM → [7] COVERAGE CHECK → [8] APPROVE (Go / Clarify / Kill). While a brainstorm is open, the project is read-only: edit/write outside the run's `brainstorm/` folder is hard-blocked. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/brainstorm/brainstorm-notes.md` (+ `brainstorm-dispatch.md` audit log written at approve) |
| **Published copy** | `Doc/brainstorm/brainstorm-<topic-slug>.md` |
| **Advance** | `/velpari-approve-brainstorm` — hard-blocks on unconfirmed understanding, open questions, or missing/empty/`_TBD_` notes sections; on success publishes, writes the audit log, clears the brainstorm session fields, and auto-runs `/velpari-prd` |

### Stage 2 — PRD

| | |
|---|---|
| **Command** | `/velpari-prd` |
| **Pre-req** | Brainstorm approved (`brainstormed`). |
| **Inputs** | Approved brainstorm notes. `.pi/velpari/files.json` (framework, inputs). `.pi/velpari/requirements-profile.json` (compact profile). |
| **Behaviour** | Spawns 4 parallel scout subagents via `pi-interactive-subagents` (visible multiplexer panes). Synthesises into a PRD with all 20 required PSRS sections (strict — any missing section is an error): Objective, Problem, System Actors, User Stories, Scope, MVP, Success Metrics, Phases, Functional Requirements, Non-Functional Requirements, Data and Interfaces, Errors and Edge Cases, Constraints, Dependencies and Risks, Out of Scope, Open Questions, Acceptance Criteria, Helper Function Candidates, Glossary, Change Log. The User Stories, Success Metrics, FR, and NFR tables carry a mandatory `Status` column (`proposed | approved | implemented | verified | deferred | deprecated`). When a published PRD already exists, the stage runs in update mode: revise the baseline (append-only IDs, deprecate-don't-delete, version bump, new Change Log entry). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/prd/PRD_<projectName>.md` |
| **Published copy** | `Doc/requirements/PRD_<projectName>.md` |
| **Advance** | `/velpari-approve` |

### Stage 3 — RTM

| | |
|---|---|
| **Command** | `/velpari-rtm` |
| **Pre-req** | PRD approved (`drafted-prd`). |
| **Inputs** | Approved PRD. |
| **Behaviour** | Builds the Requirements Traceability Matrix: every FR-N and NFR-N from the PRD maps to one or more test cases. 4 scouts. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/rtm/RTM_<projectName>.md` |
| **Published copy** | `Doc/requirements/RTM_<projectName>.md` |
| **Advance** | `/velpari-approve` |

### Stage 4 — Feasibility

| | |
|---|---|
| **Command** | `/velpari-feasibility` |
| **Pre-req** | RTM approved (`built-rtm`). |
| **Inputs** | Approved PRD + RTM. |
| **Behaviour** | Feasibility v2 decision stage: (1) read-first — inputs are read before any user question; (2) consent-gated reuse scan (`feasibility-reuse-scout`) scores community implementations with a deterministic core-function checklist (≥70% healthy = reuse, 30–69% = partial → suggest brainstorm + resume, <30% = build); (3) language selection on the build path — configured framework wins, otherwise mandatory spikes (one `feasibility-spike` agent per candidate language, workspace `<run-id>/feasibility/spikes/`, gitignored), ties decided by the developer; (4) the 4 dimension scouts (tech / schedule / cost / risk — the last three lightweight). Mid-stage state persisted via the `velpari_feasibility_session` tool. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/feasibility/feasibility-study_<projectName>.md` |
| **Published copy** | `Doc/feasibility/feasibility-study_<projectName>.md` |
| **Advance** | `/velpari-approve` — hard-blocks until `feasibilitySession` carries the reuse decision AND the selected language; publish gate validates the 13-section v2 template |

### Stage 5 — Design

| | |
|---|---|
| **Command** | `/velpari-architecture-generator` (renamed from `/velpari-design`; stage states `designing`/`designed`, artifact names, and `/velpari-show-design` unchanged) |
| **Pre-req** | Feasibility approved (`analyzed-feasibility`). Update-cycle skip: from `built-rtm`, `/velpari-architecture-generator` is also allowed when a published feasibility study already exists (`hasPublishedFeasibility`) — it advances straight to `designing`. The skip is a choice, never forced: `/velpari-feasibility` stays available to revise the study. |
| **Inputs** | Approved PRD + RTM + feasibility study. |
| **Behaviour** | High-level design with module decomposition, contracts, data flow, error handling. 4 scouts. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/design/design_<projectName>.md` |
| **Published copy** | `Doc/design/design_<projectName>.md` |
| **Advance** | `/velpari-approve` |

### Stage 6 — Pseudocode

| | |
|---|---|
| **Command** | `/velpari-pseudocode` |
| **Pre-req** | Design approved (`designed`). |
| **Inputs** | Approved design. |
| **Behaviour** | Algorithm pseudocode per module, complexity analysis, edge-case handling. 4 scouts. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/pseudocode/pseudocode_<projectName>.md` |
| **Published copy** | `Doc/pseudocode/pseudocode_<projectName>.md` |
| **Advance** | `/velpari-approve` |

### Stage 7 — Test Plan

| | |
|---|---|
| **Command** | `/velpari-testplan` |
| **Pre-req** | Pseudocode approved (`wrote-pseudocode`). |
| **Inputs** | Approved PRD + RTM + design + pseudocode. |
| **Behaviour** | Test plan + per-requirement test cases. 4 scouts (strategy, coverage, integration, unit). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/testplan/test-plan_<projectName>.md` and `test-cases_<projectName>.md` |
| **Published copy** | `Doc/tests/test-plan_<projectName>.md` and `test-cases_<projectName>.md` |
| **Advance** | `/velpari-approve` |

### Stage 8 (optional) — Atomic Function

| | |
|---|---|
| **Command** | `/velpari-atomic-function` |
| **Pre-req** | Design approved. Can run any time after Stage 5. |
| **Inputs** | Approved design + pseudocode. |
| **Behaviour** | Decomposes the system into leaf-level atomic functions. Helper ↔ atomic relationship tracked (helpers may call atomics; atomics are leaves). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/atomic-function/atomic-functions_<projectName>.md` |
| **Published copy** | `Doc/atomic-functions/atomic-functions_<projectName>.md` |
| **Advance** | None — terminal artifact. |

### Stage 9 (optional) — Development Order

| | |
|---|---|
| **Command** | `/velpari-development-order` |
| **Pre-req** | Atomic functions exist. Can run any time after Stage 8. |
| **Inputs** | Approved design + atomic functions. |
| **Behaviour** | Produces an execution order that respects dependencies and minimises risk. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/development-order/development-order_<projectName>.md` |
| **Published copy** | `Doc/development-order/development-order_<projectName>.md` |
| **Advance** | None — terminal artifact. |

### Stage 10 (optional) — Final Design Consolidation

| | |
|---|---|
| **Command** | `/velpari-design` |
| **Pre-req** | Test plan approved (`planned-tests`). Skippable like Stages 8–9. |
| **Inputs** | Approved architecture doc + pseudocode + test plan + test cases. |
| **Behaviour** | 4 parallel scouts (consistency, coverage, contract, finalizer) cross-check the 4 inputs for ID/naming/contract mismatches and consolidate them into one final design document. Reports every `error` as a blocker (developer must rerun the offending stage) or a resolution inside the consolidated doc. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/final-design/final-design_<projectName>.md` |
| **Published copy** | `Doc/design/final-design_<projectName>.md` |
| **Advance** | `/velpari-approve` (publishes + advances to `finalized-design`). |

### Final — Handoff

| | |
|---|---|
| **Command** | `/velpari-handoff` |
| **Pre-req** | Test plan approved (`planned-tests`). Optional: atomic-function + development-order + final-design outputs. |
| **Inputs** | All approved artifacts. |
| **Behaviour** | Validates Senai schema compatibility. Writes `.pi/senai/architect-inputs.json` so Senai can take over. |
| **Output** | `.pi/senai/architect-inputs.json` |
| **Next** | Senai: `/senai:plan` → `/senai:approve` → `/senai:implement` → `/senai:document` → `/senai:deliver` |

---

## 3. Sub-Sequence Cycle (per-stage loop)

Every stage handler from PRD onwards (Stages 2–7, plus the optional
Stages 8–9) follows the same internal pattern. Brainstorm (Stage 1)
runs its own understand-first lifecycle (below).

```
┌─────────────────────────────────────────────────────────────┐
│  Stage handler receives the command                         │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Validate pre-req: previous stage is approved               │
│  Validate scope: required inputs exist and are non-empty    │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Load inputs: approved artifact + framework + profile       │
│  Load stage skill from skills/<stage>.md                    │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Spawn 4 parallel scout subagents                           │
│  (pi-interactive-subagents, visible multiplexer panes):     │
│    • <stage>-checker      validates against upstream       │
│    • <stage>-extractor    pulls structured information      │
│    • <stage>-consolidator merges findings                   │
│    • <stage>-specialist   stage-specific (e.g. web search)  │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Parent LLM waits for all 4 scouts, reads reports,           │
│  may run a follow-up iteration if coverage is thin          │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Write working copy to:                                     │
│    .IDE_Plans/velpari/runs/<run-id>/<stage>/<artifact>      │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Preview to user (md preview + path + next-command hint)    │
│  Wait for /velpari-approve                                  │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  /velpari-approve:                                          │
│    1. Validate working copy exists                          │
│    2. Atomic copy to Doc/<category>/<artifact>              │
│    3. advanceStage() updates state.json                     │
│    4. setStatus() pushes footer status                      │
│    5. Print next-command hint                               │
└─────────────────────────────────────────────────────────────┘
```

The **cycle** within a single stage is:

1. **Configure** (run once per project: `/velpari-configure-inputs`, `/velpari-configure-requirements`)
2. **Scout** (4 parallel agents)
3. **Synthesise** (parent LLM reads scout reports)
4. **Iterate** (optional second round if coverage is thin)
5. **Write** (working copy to `.IDE_Plans/velpari/runs/<run-id>/<stage>/`)
6. **Preview** (notify user, await approval)
7. **Approve** (atomic copy to `Doc/`, advance state)
8. **Gate** (next stage becomes available)

For the brainstorm stage (Stage 1), the cycle is replaced by the
lifecycle v2 flow (the full program lives in `skills/velpari-brainstorm.md`):

```
[0] UNDERSTAND        chat only, inline reads (1-2 files), NO subagents
       ▼
[1] CONFIRM loop      short paragraph → user agrees or corrects → repeat
                      HARD LOCK: nothing below runs until confirmed
                      (persisted via velpari_brainstorm_session
                       confirm-understanding)
       ▼
[2] SCAN-PLAN GATE    one question: run code+doc (default) /
                      adjust (community = web-search consent) / skip
       ▼
[3] SCANS             visible panes, read-only scouts per scan type
                      (code → extractor + prd-checker,
                       doc → prd-checker + rtm-checker,
                       community → web-search-agent)
       ▼
[4] INFORM            facts + 2-4 questions, each WITH a suggested answer
       ▼
[5] DISCUSS loop      question states via upsert-question; decisions
                      written to the notes ledger (## Agreed /
                      ## Not wanted / ## Open) IMMEDIATELY
       ▼
[6] BATCH CONFIRM     one structured AskUserQuestion per open question
       ▼
[7] COVERAGE CHECK    ✓/✗ table (Scope, Out-of-scope, Data model,
                      Edge cases, Non-functional needs, Success criteria,
                      FR coverage, RTM test-case coverage) — show-only
       ▼
[8] APPROVE           preview → Go / Clarify / Kill
                      Go → /velpari-approve-brainstorm → publish → PRD
```

The brainstorm cycle in short:

1. **Understand** (conversational, hard lock until the user confirms)
2. **Scan gate** (user picks scans; community scan is the web-search consent)
3. **Scan** (visible read-only scouts — only the selected scans)
4. **Discuss** (suggested answers, decision ledger in the notes)
5. **Approve-brainstorm** (hard-blocked gates, publishes, writes the
   audit log, clears the session fields, auto-runs `/velpari-prd`)

---

## 4. Stage Transition Table

The transition rules are the single source of truth — Velpari cannot
skip stages or jump ahead. `STAGE_TRANSITIONS` in
`pi-extension/src/core/constants.ts` enforces this at runtime.

| From | To | Trigger command |
|---|---|---|
| `none` | `brainstorming` | `/velpari-brainstorm <mission>` |
| `brainstorming` | `brainstormed` → `drafting-prd` | `/velpari-approve-brainstorm` (chains into `/velpari-prd`) |
| `brainstormed` | `drafting-prd` | `/velpari-prd` |
| `drafting-prd` | `drafted-prd` → `building-rtm` | `/velpari-approve` |
| `drafted-prd` | `building-rtm` | `/velpari-rtm` |
| `building-rtm` | `built-rtm` → `analyzing-feasibility` | `/velpari-approve` |
| `built-rtm` | `analyzing-feasibility` | `/velpari-feasibility` |
| `built-rtm` | `designing` (feasibility skip — gated: allowed only when a published feasibility study already exists, i.e. an update cycle) | `/velpari-architecture-generator` |
| `analyzing-feasibility` | `analyzed-feasibility` → `designing` | `/velpari-approve` |
| `analyzed-feasibility` | `designing` | `/velpari-architecture-generator` |
| `designing` | `designed` → `writing-pseudocode` | `/velpari-approve` |
| `designed` | `writing-pseudocode` | `/velpari-pseudocode` |
| `writing-pseudocode` | `wrote-pseudocode` → `planning-tests` | `/velpari-approve` |
| `wrote-pseudocode` | `planning-tests` | `/velpari-testplan` |
| `planning-tests` | `planned-tests` → `handoff-ready` | `/velpari-approve` |
| `planned-tests` | `finalizing-design` → `finalized-design` | `/velpari-design` (post-pipeline optional; plan 3) |
| `planned-tests` | `handoff-ready` | `/velpari-handoff` |

---

## 5. Command Surface (27 commands)

### Stage commands (9)
- **Core 7 (required):** `/velpari-brainstorm`, `/velpari-prd`, `/velpari-rtm`, `/velpari-feasibility`, `/velpari-architecture-generator`, `/velpari-pseudocode`, `/velpari-testplan`
- **Post-pipeline 3 (optional):** `/velpari-atomic-function`, `/velpari-development-order`, `/velpari-design` (final design consolidation — plan 3)

### Discipline commands (10)
`/velpari-approve`, `/velpari-approve-brainstorm`, `/velpari-status`, `/velpari-reset`, `/velpari-configure-inputs`, `/velpari-configure-requirements`, `/velpari-configure-agents`, `/velpari-agents`, `/velpari-doctor`, `/velpari-handoff`

### View commands (7)
`/velpari-show-brainstorm`, `/velpari-show-prd`, `/velpari-show-rtm`, `/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`, `/velpari-show-testplan`

### Wrapper command (1)
`/velpari-prd-rtm` — chains `/velpari-prd` then `/velpari-rtm`. Does not auto-approve.

---

## 6. Discipline Layer (cross-cutting)

These run at any stage, regardless of position in the pipeline:

| Command | Purpose |
|---|---|
| `/velpari-status` | Show current stage, mission, run id, next command |
| `/velpari-doctor` | Audit the project for setup, secret, path, profile, agent integrity issues |
| `/velpari-reset` | Clear state.json and run dirs (destructive — requires confirmation) |
| `/velpari-configure-inputs` | One-time: capture framework, project name, code/test/document/excluded paths (discovery-backed) |
| `/velpari-configure-requirements` | One-time: select requirements profile, optional web research |
| `/velpari-configure-agents` | Optional: map the 36 fixed scout roles to custom agent names (agents.json) |
| `/velpari-agents` | View the role → agent mapping and validate mapped agents exist |
| `/velpari-show-*` | View a working or published artifact |

### Traceability discipline (automatic, no user action)

Five mechanisms keep the requirements chain machine-checkable. They run on
their own — the user never has to trigger them:

1. **YAML frontmatter** — every published artifact is stamped with
   `artifact`, `runId`, `stage`, `version`, `generatedAt` at approve time
   (`core/frontmatter.ts`).
2. **RTM JSON sidecar** — the RTM's source of truth is
   `<runDir>/rtm/RTM_<projectName>.json`; `/velpari-approve` regenerates the
   published markdown from it, so the markdown can never drift from the data
   (`core/rtm-data.ts`).
3. **SHA-256 fingerprints** — each RTM row carries the hash of the published
   PSRS requirement it traces to; when the source changes, the link turns
   `suspect` instead of silently breaking (`core/fingerprints.ts`).
4. **Publish gate** — `/velpari-approve` runs `doctor/gate.ts:runPublishGate`
   before publishing: PSRS validation + fingerprint check. Errors block the
   publish; warnings are shown but do not block. This is the automatic subset
   of doctor — `/velpari-doctor` remains the manual full audit.
5. **Session-start notice** — if a run is open and links are stale, the
   status bar shows `trace: N suspect/orphan link(s)` at session start.
6. **Phase + MVP coverage** — every requirement carries a `Phase`
   (1 = MVP) in both the PRD tables and the RTM JSON; the publish gate
   blocks phase mismatches, doctor reports `MVP coverage: X/Y`, and
   `/velpari-handoff` blocks while a Phase-1 requirement is uncovered
   (`core/mvp-coverage.ts`).

Requirement wording follows RFC 2119 (`shall` / `should` / `may`) + EARS
patterns, enforced as doctor warnings via `core/psrs.ts:findFrRowsMissingKeywords`.

---

## 7. State and Artifacts

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

### Working copies (mutable, regenerable)

```
.IDE_Plans/velpari/runs/<run-id>/
├── brainstorm/brainstorm-notes.md
├── prd/PRD_<projectName>.md
├── rtm/
│   ├── RTM_<projectName>.json     (source of truth)
│   └── RTM_<projectName>.md       (rendered from the JSON at approve)
├── feasibility/feasibility-study_<projectName>.md
├── design/design_<projectName>.md
├── pseudocode/pseudocode_<projectName>.md
└── testplan/
    ├── test-plan_<projectName>.md
    └── test-cases_<projectName>.md
```

### Published copies (artifacts of record)

`/velpari-approve` writes these. The parent folder (`Doc/`) contains
only this sequence file as the static reference; per-stage artifacts
land in subfolders created on first approval.

```
Doc/
└── velpari-sequence.md     (this file)
Doc/brainstorm/             (created on first /velpari-approve-brainstorm)
Doc/requirements/           (created on first PRD/RTM approval)
Doc/feasibility/            (created on first feasibility approval)
Doc/design/                 (created on first design approval)
Doc/pseudocode/             (created on first pseudocode approval)
Doc/tests/                  (created on first test plan approval)
Doc/atomic-functions/       (created on first atomic-function approval)
Doc/development-order/      (created on first development-order approval)
```

### Handoff target

```
.pi/senai/architect-inputs.json    (written by /velpari-handoff)
```

---

## 8. Scout Pattern Detail

The scout pattern is the single biggest architectural decision in
Velpari. It applies to all 9 stage handlers: stages 2–7 (PRD through
testplan) and the optional stages 8–9 run 4 write-capable scouts that
produce report files; brainstorm (Stage 1) runs read-only scouts at its
SCANS step ([3]) — only the scan types the user picked at the scan gate.

**Per stage, 4 scouts run in parallel:**
- 1 checker (validates against upstream artifact)
- 1 extractor (pulls structured info from inputs)
- 1 consolidator (merges findings into a draft)
- 1 specialist (stage-specific, e.g. web-search-agent, prd-checker)

**Note:** For the brainstorm stage the role mix is slightly different
(extractor, prd-checker, rtm-checker, optional web-search-agent) and the
scouts are read-only — they report findings back to the parent LLM, which
records them in the brainstorm notes. The shape (visible panes, parallel
dispatch, parent synthesises) is the same.

**Visible to the user:** Scouts run in real multiplexer panes via
`pi-interactive-subagents`. The user sees them running, not a hidden
fan-out. This is intentional — it makes the LLM's work observable.

**Failure handling:** If any scout fails, the stage handler reports
the failure and asks whether to continue with the partial results or
abort. There is no silent fall-on. Partial results are surfaced.

**Iteration:** The parent LLM may spawn a second round of scouts if
the first round's coverage is thin (e.g. specific section of the PRD
has too little detail). Each round reads the previous round's reports.

**Agent definitions:** Live in `.pi/agents/*.md`, auto-bootstrapped
from bundled `skills/agents/*.md` on first use by
`agents-install.ts:ensureStageAgents`.

---

## 9. Cross-cutting Constraints

These constraints apply to every stage and are enforced by code, not
prompt:

1. **No skip.** Stages cannot be skipped. `STAGE_TRANSITIONS` is the
   single source of truth.
2. **No publish without approve.** Nothing under `Doc/` is written
   without `/velpari-approve` (or `/velpari-approve-brainstorm`).
3. **Working copies are free.** Anything under
   `.IDE_Plans/velpari/runs/` can be regenerated by re-running the
   stage command.
4. **Atomic writes.** State file and published artifacts use atomic
   writes (write to `.tmp`, rename).
5. **No hallucination.** Every claim in every artifact traces to a
   user-provided statement or to an earlier approved artifact.
6. **Subagents are visible.** All scout fan-out happens through
   `pi-interactive-subagents`, never silently in-process.
7. **Framework is one-time setup.** Framework + project name captured
   once via `/velpari-configure-inputs` and injected into every
   stage prompt.
8. **Web search is consented at the scan gate.** Never auto-invoke; the
   community scan (web-search-agent) runs only when the user picks it at
   the brainstorm scan-plan gate.
9. **Brainstorm is read-only until approved.** While a brainstorm is
   open, edit/write tool calls outside the run's `brainstorm/` folder
   are hard-blocked by the tool_call hook. Approve is gated:
   unconfirmed understanding, open questions, or incomplete notes all
   block `/velpari-approve-brainstorm`.
10. **Hard stage gates.** A stage command runs only from its exact
    source stage (`STAGE_GATE` in `stages/registry.ts`); the error names
    the correct command to run first. The sequence cannot be broken or
    skipped — re-running a stage already in progress (redraft) stays
    allowed.
11. **Run lock.** Every `state.json` mutation is serialized through
    `.IDE_Plans/velpari/.lock/` (atomic mkdir + heartbeat + stale-steal),
    so two sessions can never corrupt the run state.
12. **Stage-scoped writes.** While any stage draft is open, edit/write
    outside that stage's run folder is hard-blocked by the tool_call
    hook — `Doc/` included, publishing is `/velpari-approve` only — and
    every scout `subagent` spawn must declare its `-report.json` path.
    The `before_agent_start` hook re-injects the current stage, the next
    command, and the hard rule into the system prompt every turn.
13. **Living documents.** Requirement IDs are append-only; removals are
    marked `deprecated` + reason, never deleted; every revision bumps
    the version and adds a Change Log entry. `/velpari-approve` blocks
    revisions that break these rules. Brainstorm is the only entry
    point for changes.

---

## 10. Key Files

| Concern | File |
|---|---|
| Stage transition rules | `pi-extension/src/core/constants.ts` |
| State load/save/advance | `pi-extension/src/core/state.ts` |
| Path resolution (v1.0.1 fix) | `pi-extension/src/core/paths.ts` |
| Stage runner (scout spawn + write + preview) | `pi-extension/src/stages/registry.ts` |
| Brainstorm lifecycle (guards, dispatcher, notes, audit) | `pi-extension/src/stages/brainstorm/` |
| Brainstorm session tool | `pi-extension/src/stages/brainstorm-state-tool.ts` |
| Stage skills (parent LLM programs) | `skills/velpari-*.md` |
| Bundled scout agent definitions | `skills/agents/*.md` |
| Doctor audit | `pi-extension/src/doctor/` |
| Publish gate (approve-time doctor subset) | `pi-extension/src/doctor/gate.ts` |
| Artifact frontmatter | `pi-extension/src/core/frontmatter.ts` |
| RTM JSON sidecar (validate/diff/render) | `pi-extension/src/core/rtm-data.ts` |
| Trace-link fingerprints (SHA-256) | `pi-extension/src/core/fingerprints.ts` |
| Phase consistency check | `pi-extension/src/doctor/checks/phase-consistency.ts` |
| MVP coverage (doctor + handoff) | `pi-extension/src/core/mvp-coverage.ts` + `pi-extension/src/doctor/checks/mvp-coverage.ts` |
| Handoff schema | `pi-extension/src/ops/handoff.ts` |
| Sequence doc (this file) | `Doc/velpari-sequence.md` |