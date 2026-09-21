# 01 — First-Run Sequence (Strict)

This document defines the **first-time execution** of the pi_velpari pipeline:
a brand-new run on a project that has no published Velpari artifacts yet.
For updates and upgrades after a first pass, see `02-revision-workflows.md`.

## The first-run contract

1. **Phases run in strict order:** Phase 1 → Phase 2 → Phase 3 → Phase 4.
   No phase may be skipped or started before the previous phase completes.
2. **Stages run in strict order inside each phase.** Every stage ends with
   its approve gate; the next stage command is rejected until the gate passes.
3. **No skips on a first run.** The only skippable stage anywhere in the
   system is Feasibility *on revision runs* — on a first run it is mandatory
   because no published feasibility study can exist yet.
4. **Cross-session resume is allowed.** A developer may stop after any
   approved stage, close the session, and later continue from the next valid
   stage. State persists in `.pi/velpari/state.json`. Resuming never skips
   a gate — the next command is exactly the one the transition table names.
5. **Invalid commands are blocked, always with the correct command named.**
   Example: PRD approved, developer types `/velpari-architecture-generator`
   → blocked: "Run `/velpari-rtm` next." See `04-brainstorm-and-locking.md`.

## Step 0 — One-time setup (before Phase 1)

Not a phase. Required once per project; safe on a completely empty project.

| Command | What it captures | Empty-project behavior |
|---|---|---|
| `/velpari-configure-inputs` | Framework (free text — what you *intend* to use), `projectName`, code/test/document/excluded paths via a discovery-backed list editor | Discovery finds nothing → skip paths or enter conventional ones (`src/`, `tests/`). Empty path lists are valid. |
| `/velpari-configure-requirements` | Requirements profile (optional) | Skippable — the common PSRS core (`core-psrs-v1`) applies by default. |
| `/velpari-configure-standards` | Standards overlay (optional) | Skippable — no overlay = common core. |
| `/velpari-configure-agents` | Role → custom agent name mapping (optional) | Skippable — defaults apply. |

Config is **revisable, not one-shot**: the framework guessed on day 1 is
confirmed or corrected at the Feasibility stage, and configure commands may
be re-run anytime. The config grows with the project.

## Step 1 — Generate Phase 1 agents → doctor validate

`/velpari-generate-sub-agents` (Phase 1 scope) emits the 4 brainstorm roles
(extractor, prd-checker, rtm-checker, web-search-agent) from mission +
`files.json` + technology resources. No artifacts exist yet — this is the
only phase whose agents are generated without published-document input.
Doctor then validates: agents exist, mapped in `agents.json`, manifest fresh.
Fallback: bundled scouts in `skills/agents/` work without generation.
Details: `05-sub-agent-generation.md`.

## Phase 1 — Discovery

| | |
|---|---|
| **Command** | `/velpari-brainstorm <mission>` |
| **Pre-req** | None (start of a run). A terminal multiplexer must be active (visible scout panes); override via `PI_SUBAGENT_MUX`. |
| **Behavior** | UNDERSTAND loop (conversational) → understanding paragraph → developer confirms (hard lock) → SCAN gate (developer picks: all / code+doc / community / adjust / skip; community = web-search consent) → clarify loop (decision ledger: every question → agreed / not-wanted+reason / replaced) → notes draft. Read-only scouts only. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/brainstorm/brainstorm-notes.md` |
| **Approve gate** | `/velpari-approve-brainstorm` — hard-blocks on unconfirmed understanding, open questions, missing/empty/`_TBD_` sections. |
| **Published copy** | `Doc/brainstorm/brainstorm-<topic-slug>.md` |

## Step 3 — Generate Phase 2 agents → doctor validate

Input: the **published** brainstorm notes (`Doc/` only) + `files.json`.
Generates: PRD scouts, RTM scouts, feasibility scouts (+ reuse-scout, spike).
Doctor validates freshness against the published notes and role mapping.

## Phase 2 — Requirements

### Stage 2 — PRD

| | |
|---|---|
| **Command** | `/velpari-prd` |
| **Pre-req** | Brainstorm approved. |
| **Inputs** | Published brainstorm notes + `files.json` + requirements profile (compact) + standards overlay + agent mapping. |
| **Behavior** | 4 parallel visible scouts synthesise a PRD with all 20 required PSRS sections; FR/NFR wording follows RFC 2119 (`shall`/`should`/`may`) + EARS; User Stories / Success Metrics / FR / NFR tables carry a `Status` column; every FR/NFR row carries a `Phase` (1 = MVP). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/prd/PRD_<projectName>.md` |
| **Approve gate** | publish via `velpari_stage_publish` (fallback `/velpari-prd-approve`) — PSRS validation + doctor audit. |
| **Published copy** | `Doc/requirements/PRD_<projectName>.md` |

### Stage 3 — RTM

| | |
|---|---|
| **Command** | `/velpari-rtm` |
| **Pre-req** | PRD approved. |
| **Inputs** | All prior published artifacts + config. |
| **Behavior** | 4 scouts build the Requirements Traceability Matrix: every FR-N / NFR-N maps to test cases. Source of truth is the structured sidecar; SHA-256 fingerprints link each row to its published PRD source. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/rtm/RTM_<projectName>.yaml` (+ rendered `.md`) |
| **Approve gate** | publish (fallback `/velpari-rtm-approve`) — sidecar validation + fingerprints stamped. |
| **Published copy** | `Doc/requirements/RTM_<projectName>.md` (rendered from the sidecar) |

### Stage 4 — Feasibility (mandatory on first runs)

| | |
|---|---|
| **Command** | `/velpari-feasibility` |
| **Pre-req** | RTM approved. |
| **Inputs** | All prior published artifacts + `files.json` (configured framework decides language selection). |
| **Behavior** | Decision stage with evidence: (1) read-first; (2) consent-gated reuse scan (deterministic core-function checklist; ≥70% = reuse, 30–69% = partial, <30% = build; license + repo-freshness health gate); (3) language selection on the build path — configured framework wins, otherwise mandatory spikes (one spike agent per candidate language builds+runs the core function); ties decided by the developer. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/feasibility/feasibility-study_<projectName>.md` (+ `reuse/`, `spikes/` evidence) |
| **Approve gate** | publish (fallback `/velpari-feasibility-approve`) — hard-blocks until decision + selected language are recorded; template validation. |
| **Published copy** | `Doc/feasibility/feasibility-study_<projectName>.md` |

## Step 5 — Generate Phase 3 agents → doctor validate

Input: published PRD + RTM + feasibility (language/framework now known) +
requirements profile + standards overlay. Generates: design scouts +
design-reviewer, atomic-function scouts + reviewer, pseudocode scouts +
reviewer. Doctor validates freshness + reviewer presence per tier.

## Phase 3 — Design

### Stage 5 — Architecture

| | |
|---|---|
| **Command** | `/velpari-architecture-generator` |
| **Pre-req** | Feasibility approved. |
| **Inputs** | All prior published artifacts + config + standards overlay. |
| **Behavior** | Style-selector scout runs first → ADR-001 (mandatory, accepted, ≥2 options). 4 base scouts + adversarial design-reviewer. Standards-aligned template (arc42 / Rozanski & Woods / SEI / C4 / Nygard ADR): quality scenarios in SEI 6-part form, every Approach names a catalogued tactic, 3 C4 Mermaid diagrams (Context/Container/Component) mandatory. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/design/design_<projectName>.md` |
| **Approve gate** | publish (fallback `/velpari-architecture-generator-approve`) — section gate + reviewer verdict + doctor audit. |
| **Published copy** | `Doc/design/design_<projectName>.md` |

Optional cross-cut after this stage: `/velpari-design-logging` (logging
architecture plan; not a stage, no gate change).

### Stage 6 — Atomic Functions

| | |
|---|---|
| **Command** | `/velpari-atomic-function` |
| **Pre-req** | Design approved. |
| **Inputs** | All prior published artifacts + config + atomic profile (tier + criticality from `files.json:atomic`). |
| **Behavior** | 4 source scouts (RTM / design / PRD / feasibility) + adversarial reviewer. Decomposes the system into leaf atomic functions per the tier-driven schema (ISO/IEC 29110 tiers + IEC 62304 criticality + IEC 61508 SIL). 8 base-core fields at every tier; higher tiers add fields. Helpers may call atomics; atomics are strictly leaves. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/atomic-function/atomic-functions_<projectName>.md` |
| **Approve gate** | publish (fallback `/velpari-atomic-function-approve`) — tier-aware doctor gate + reviewer verdict. |
| **Published copy** | `Doc/atomic-functions/atomic-functions_<projectName>.md` |

### Stage 7 — Pseudocode

| | |
|---|---|
| **Command** | `/velpari-pseudocode` |
| **Pre-req** | Atomic functions approved. |
| **Inputs** | All prior published artifacts + config. |
| **Behavior** | 4 scouts + adversarial reviewer. Algorithm pseudocode per module, complexity analysis, edge-case handling; references atomic functions by id (V-Model Module Design / SA-SD). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/pseudocode/pseudocode_<projectName>.md` |
| **Approve gate** | publish (fallback `/velpari-pseudocode-approve`) — reviewer verdict + doctor audit. |
| **Published copy** | `Doc/pseudocode/pseudocode_<projectName>.md` |

## Step 6 — Generate Phase 4 agents → doctor validate

Input: published design + atomic functions + pseudocode (+ all earlier).
Generates: testplan scouts + reviewer, development-order scouts,
final-design scouts. Doctor validates freshness + role mapping.

## Phase 4 — Validation & Handoff

### Stage 8 — Test Plan

| | |
|---|---|
| **Command** | `/velpari-testplan` |
| **Pre-req** | Pseudocode approved. |
| **Inputs** | All prior published artifacts + config. |
| **Behavior** | 4 scouts (strategy, coverage, integration, unit) + adversarial reviewer. Test plan + per-requirement test cases; test cases reference atomic-function ids and FR/NFR ids (V-Model). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/testplan/test-plan_<projectName>.md` + `test-cases_<projectName>.md` |
| **Approve gate** | publish (fallback `/velpari-testplan-approve`) — reviewer verdict + doctor audit. |
| **Published copy** | `Doc/tests/test-plan_<projectName>.md` + `test-cases_<projectName>.md` |

### Stage 9 — Development Order

| | |
|---|---|
| **Command** | `/velpari-development-order` |
| **Pre-req** | Test plan approved. |
| **Inputs** | All prior published artifacts + config. |
| **Behavior** | 4 scouts produce a dependency-respecting execution order (PMBOK WBS). The order is a machine-checkable dependency DAG (sidecar format — see `06-artifact-formats.md`). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/development-order/development-order_<projectName>.md` |
| **Approve gate** | publish (fallback `/velpari-development-order-approve`) — DAG validity + doctor audit. |
| **Published copy** | `Doc/development-order/development-order_<projectName>.md` |

### Stage 10 — Final Design Consolidation

| | |
|---|---|
| **Command** | `/velpari-final-design` |
| **Pre-req** | Development order approved. |
| **Inputs** | All 9 prior published artifacts + config. |
| **Behavior** | 4 scouts (consistency, coverage, contract, finalizer) cross-check all inputs for ID/naming/contract mismatches and consolidate one final reference document. Errors = blockers naming the offending stage (V-Model Design Verification). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/final-design/final-design_<projectName>.md` |
| **Approve gate** | publish (fallback `/velpari-final-design-approve`) — full doctor audit. |
| **Published copy** | `Doc/design/final-design_<projectName>.md` |

### Final — Handoff

| | |
|---|---|
| **Command** | `/velpari-handoff` (no approve step) |
| **Pre-req** | Final design approved AND nothing stale anywhere in the chain (see `03-staleness-and-validation.md`) AND MVP coverage clean. |
| **Behavior** | Final doctor audit → validates the handoff package is self-contained (all referenced published artifacts exist) → writes `.pi/senai/architect-inputs.json` (requirements, ADRs, active overlay, logging plan, freshness manifest). |
| **Output** | `.pi/senai/architect-inputs.json` → Senai takes over (production). |

## Stage transition table (first run)

Source of truth at runtime: `STAGE_TRANSITIONS` in
`pi-extension/src/core/constants.ts`. This table is the human-readable mirror.

| From | To | Trigger command |
|---|---|---|
| `none` | `brainstorming` | `/velpari-brainstorm <mission>` |
| `brainstorming` | `brainstormed` | `/velpari-approve-brainstorm` |
| `brainstormed` | `drafting-prd` | `/velpari-prd` |
| `drafting-prd` | `drafted-prd` | `/velpari-prd-approve` (or publish tool) |
| `drafted-prd` | `building-rtm` | `/velpari-rtm` |
| `building-rtm` | `built-rtm` | `/velpari-rtm-approve` (or publish tool) |
| `built-rtm` | `analyzing-feasibility` | `/velpari-feasibility` |
| `analyzing-feasibility` | `analyzed-feasibility` | `/velpari-feasibility-approve` (or publish tool) |
| `analyzed-feasibility` | `designing` | `/velpari-architecture-generator` |
| `designing` | `designed` | `/velpari-architecture-generator-approve` (or publish tool) |
| `designed` | `analyzing-atomic-functions` | `/velpari-atomic-function` |
| `analyzing-atomic-functions` | `analyzed-atomic-functions` | `/velpari-atomic-function-approve` (or publish tool) |
| `analyzed-atomic-functions` | `writing-pseudocode` | `/velpari-pseudocode` |
| `writing-pseudocode` | `wrote-pseudocode` | `/velpari-pseudocode-approve` (or publish tool) |
| `wrote-pseudocode` | `planning-tests` | `/velpari-testplan` |
| `planning-tests` | `planned-tests` | `/velpari-testplan-approve` (or publish tool) |
| `planned-tests` | `ordering-development` | `/velpari-development-order` |
| `ordering-development` | `ordered-development` | `/velpari-development-order-approve` (or publish tool) |
| `ordered-development` | `finalizing-design` | `/velpari-final-design` |
| `finalizing-design` | `finalized-design` | `/velpari-final-design-approve` (or publish tool) |
| `finalized-design` | `handoff-ready` | `/velpari-handoff` |

Note: the `built-rtm → designing` feasibility-skip transition exists in the
table but is **unreachable on a first run** (no published feasibility study
can exist). It belongs to revision runs — see `02-revision-workflows.md`.
