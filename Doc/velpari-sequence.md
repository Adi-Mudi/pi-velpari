# Velpari Sequence

The single source of truth for how a mission moves through Velpari's
9-stage pre-production pipeline. Use this as the reference when you
are not sure what command to run next, what a stage's pre-requisites
are, or what every stage handler does inside.

---

## 1. Simple Overview

The pipeline is a linear sequence of 11 required stages plus the
handoff step. Every `→` is a gate: nothing moves forward until you run
the matching per-stage `/velpari-<stage>-approve` (or `/velpari-approve-brainstorm` after
the first stage).
Every `→` is a gate: nothing moves forward until you run the matching
the per-stage `/velpari-<stage>-approve` (or `/velpari-approve-brainstorm` after the first stage).

```
/velpari-brainstorm
        │  brainstorm notes (working copy)
        ▼
/velpari-approve-brainstorm ── publishes brainstorm (user then runs /velpari-prd to advance; v1.6.2+ dropped the auto-chain)
        │
        ▼
/velpari-prd
        │  PRD draft (working copy)
        ▼
velpari_stage_publish (auto on preview-yes) ── publishes PRD
        │
        ▼
/velpari-rtm
        │  RTM draft (working copy)
        ▼
velpari_stage_publish (auto on preview-yes) ── publishes RTM
        │
        ▼
/velpari-feasibility
        │  feasibility study (working copy)
        ▼
velpari_stage_publish (auto on preview-yes) ── publishes feasibility study
        │
        ▼
/velpari-architecture-generator
        │  design (working copy)
        ▼
velpari_stage_publish (auto on preview-yes) ── publishes design
        │
        ▼
/velpari-pseudocode
        │  pseudocode (working copy)
        ▼
velpari_stage_publish (auto on preview-yes) ── publishes pseudocode
        │
        ▼
/velpari-testplan
        │  test plan + test cases (working copy)
        ▼
velpari_stage_publish (auto on preview-yes) ── publishes test plan + test cases
        │
        ▼
/velpari-handoff ── exports architect-inputs.json to .pi/senai/
        │
        ▼
   Senai takes over (plan → implement → document → deliver)
```

Required post-pipeline stages, after Stage 5 (Design) — see §2 for the
full per-stage detail:

```
/velpari-atomic-function   ──  functional decomposition into leaf nodes (after design)
/velpari-pseudocode        ──  module-level pseudocode (after atomic-function)
/velpari-development-order ──  execution order (after testplan)
/velpari-final-design      ──  final-design consolidation (after development-order)
```

Change flow (living documents) — any change to an approved artifact

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
velpari_stage_publish (auto)         (revision gate: no dropped IDs,
                                      version bumped, new Change Log entry;
                                      auto doctor audit after publish:
                                      errors + warnings both stop
                                      state advance — see v1.2.1)
```

---

## 1.5 7 Important Nuances (READ FIRST)

These 7 nuances apply to **every** stage. Keep them in mind whenever
you read the per-stage details below or write code that touches the
stage handlers.

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
   full profile), rendered into a `## Profile (compact)` block in the
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

6. **Approve commands (v1.6.0, manual confirm at every stage boundary).**
   - `/velpari-approve-brainstorm` — only for the brainstorm stage.
     Hard-blocks on unconfirmed understanding, open (draft/discussing)
     questions, or missing/empty/`_TBD_` notes sections. On success
     publishes, writes the audit log, clears the brainstorm session
     fields, advances the stage, and surfaces a `Next: /velpari-prd`
     hint (v1.6.2+ — no auto-invocation of the PRD handler).
   - 9 per-stage `/velpari-<stage>-approve` fall-back commands — one
     for each publishable stage (PRD through final-design). Run from
     the terminal when the parent LLM cannot auto-publish (publish tool
     unavailable, recovery after a blocker, etc.). Each runs the same
     `handleApprove` gate chain (revision + artifact + post-publish
     doctor audit) the tool calls. The publish advance uses both the
     legacy `the publish tool` actor name (from `handleApprove`) and
     the per-stage command name in `STAGE_TRANSITIONS`.

7. **The `/velpari-final-design` command name reflects what it does.**
   It was previously called `/velpari-html-design` (the name was
   reserved for a future HTML mockup generator that has not shipped).
   Today it produces `Doc/design/final-design_<project>.md` — a
   final-design consolidation document, not actual HTML. Real HTML
   mockup generation is deferred to a future revision.

8. **Brainstorm lifecycle v2.1 (added 2026-09-14)** — the
   `/velpari-brainstorm` command has two new gates at entry:
   - **Multiplexer hard gate** — the handler refuses to start a run
     unless a multiplexer (zellij/tmux/wezterm/cmux) is detected in
     the environment. Without one, visible scout subagents cannot
     spawn. Override via `PI_SUBAGENT_MUX` for wrappers/tests.
   - **Mandatory SCAN-gate picker** — there is NO default scan
     selection. The developer always chooses via the picker
     (`stages/brainstorm/scan-gate.ts`). The picker is config-aware
     and hides scans that don't apply (e.g., a doc-only project with
     no `codePaths` won't see "Run code scan" as an option).

9. **SCAN-gate picker follows the AskUserQuestion hardening pattern**
   (added 2026-09-14). The picker auto-injects a `Type something...
   (freeform — name the scans)` row at the end of every label list,
   matching Claude Code's AskUserQuestion auto-injected freeform. The
   freeform input is `ctx.ui.input` (lowercased, trimmed,
   comma-split, filtered to the available scan set). The picker
   returns a rich `ScanGateResult { scans, cancelled, freeform }`
   instead of a bare `ScanType[]`, so the state tool can distinguish
   "user skipped scans" (`scans: []`, `cancelled: false`) from
   "user pressed Esc" (`scans: []`, `cancelled: true`) from
   "user typed a custom subset" (`freeform: true`). The pattern is
   documented in the bundled skill
   `skills/velpari-scan-gate/SKILL.md`.

10. **Brainstorm lifecycle v2.2 — single-shot per run (added 2026-09-14)** —
    The `/velpari-brainstorm` command is now single-shot per run. Re-running
    on a run that has advanced past `brainstorming` hard-blocks with the
    next command named via `nextCommandsFor(state.currentStage)`. The
    refusal names `/velpari-reset` as the way to discard the current run.
    In the 2026-09-13 session, 8 brainstorm missions were started on one
    runId; this guard makes that silent reuse impossible.

11. **Pre-APPROVE hard gate in the skill (added 2026-09-14)** — the parent
    LLM now mirrors `guardApproveReadiness` and `guardNotesContent` in the
    skill (new `[7.5] PRE-APPROVE HARD GATE` section) BEFORE showing the
    preview gate at `[8] APPROVE`. The 4 missing-section errors visible in
    the 2026-09-13 session are no longer reachable from a well-behaved
    parent LLM.

---

## 2. Detailed Step-by-Step

Each stage has the same shape: pre-requisite, inputs, behaviour,
working + published outputs, and the exact command that advances.

### Stage 1 — Brainstorm (lifecycle v2.1)

| | |
|---|---|
| **Command** | `/velpari-brainstorm <mission>` |
| **Pre-req** | None. Start of a new run. Refuses an empty seed. |
| **Pre-req (v2.1)** | A terminal multiplexer (zellij/tmux/wezterm/cmux) must be active. The handler hard-gates on this at entry — without one, the command notifies the developer and exits. Override via `PI_SUBAGENT_MUX`. |
| **Inputs** | Mission text from user. Scan selection from the mandatory SCAN-gate picker (no default in v2.1; community scan = web-search consent). |
| **Behaviour** | Understand-first lifecycle (details in §3): [0] UNDERSTAND (conversational, inline reads, no subagents) → [1] CONFIRM loop with hard lock → [2] **SCAN-PLAN GATE — v2.1: ALWAYS asks via `runScanGatePicker`** (5 branches: Run all / Run code+doc / Community only / Adjust / Skip; config-aware — hides unavailable scans) → [3] SCANS (visible read-only scout subagents per selected scan) → [4] INFORM (facts + questions with suggested answers) → [5] DISCUSS loop (decision ledger written immediately) → [6] BATCH CONFIRM → [7] COVERAGE CHECK → [8] APPROVE (Go / Clarify / Kill). While a brainstorm is open, the project is read-only: edit/write outside the run's `brainstorm/` folder is hard-blocked. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/brainstorm/brainstorm-notes.md` (+ `brainstorm-dispatch.md` audit log written at approve) |
| **Published copy** | `Doc/brainstorm/brainstorm-<topic-slug>.md` |
| **Advance** | `/velpari-approve-brainstorm` — hard-blocks on unconfirmed understanding, open questions, or missing/empty/`_TBD_` notes sections; on success publishes, writes the audit log, clears the brainstorm session fields, advances the stage, and surfaces a `Next: /velpari-prd` hint (v1.6.2+ — no auto-run; user runs `/velpari-prd` by hand) |

### Stage 2 — PRD

| | |
|---|---|
| **Command** | `/velpari-prd` |
| **Pre-req** | Brainstorm approved (`brainstormed`). |
| **Inputs** | Approved brainstorm notes (`Doc/brainstorm/brainstorm-<topic-slug>.md`) + `.pi/velpari/files.json` (framework + path patterns) + `.pi/velpari/requirements-profile.json` (compact profile metadata) + `.pi/velpari/standards-profile.json` (active standards overlay, if any) + `.pi/velpari/agents.json` (role → agent name mapping). |
| **Behaviour** | Spawns 4 parallel scout subagents via `pi-interactive-subagents` (visible multiplexer panes). Synthesises into a PRD with all 20 required PSRS sections (strict — any missing section is an error): Objective, Problem, System Actors, User Stories, Scope, MVP, Success Metrics, Phases, Functional Requirements, Non-Functional Requirements, Data and Interfaces, Errors and Edge Cases, Constraints, Dependencies and Risks, Out of Scope, Open Questions, Acceptance Criteria, Helper Function Candidates, Glossary, Change Log. The User Stories, Success Metrics, FR, and NFR tables carry a mandatory `Status` column (`proposed | approved | implemented | verified | deferred | deprecated`). When a published PRD already exists, the stage runs in update mode: revise the baseline (append-only IDs, deprecate-don't-delete, version bump, new Change Log entry). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/prd/PRD_<projectName>.md` |
| **Published copy** | `Doc/requirements/PRD_<projectName>.md` |
| **Advance** | Stage publishes inline once the working copy is ready (no human preview gate; v1.6.0). Manual fall-back: `/velpari-prd-approve`. |

### Stage 3 — RTM

| | |
|---|---|
| **Command** | `/velpari-rtm` |
| **Pre-req** | PRD approved (`drafted-prd`). |
| **Inputs** | Approved brainstorm notes + PRD (`Doc/requirements/PRD_<projectName>.md`) + `.pi/velpari/files.json` + `.pi/velpari/requirements-profile.json` + standards overlay + agent mapping. |
| **Behaviour** | Builds the Requirements Traceability Matrix: every FR-N and NFR-N from the PRD maps to one or more test cases. 4 scouts. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/rtm/RTM_<projectName>.md` |
| **Published copy** | `Doc/requirements/RTM_<projectName>.md` |
| **Advance** | Stage publishes inline once the working copy is ready (no human preview gate; v1.6.0). Manual fall-back: `/velpari-rtm-approve`. |

### Stage 4 — Feasibility

| | |
|---|---|
| **Command** | `/velpari-feasibility` |
| **Pre-req** | RTM approved (`built-rtm`). |
| **Inputs** | Approved brainstorm notes + PRD + RTM (`Doc/requirements/RTM_<projectName>.md`) + `.pi/velpari/files.json` (the configured framework decides language selection) + profile + standards + agent mapping. |
| **Behaviour** | Feasibility v2 decision stage: (1) read-first — inputs are read before any user question; (2) consent-gated reuse scan (`feasibility-reuse-scout`) scores community implementations with a deterministic core-function checklist (≥70% healthy = reuse, 30–69% = partial → suggest brainstorm + resume, <30% = build); (3) language selection on the build path — configured framework wins, otherwise mandatory spikes (one `feasibility-spike` agent per candidate language, workspace `<run-id>/feasibility/spikes/`, gitignored), ties decided by the developer; (4) the 4 dimension scouts (tech / schedule / cost / risk — the last three lightweight). Mid-stage state persisted via the `velpari_feasibility_session` tool. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/feasibility/feasibility-study_<projectName>.md` |
| **Published copy** | `Doc/feasibility/feasibility-study_<projectName>.md` |
| **Advance** | Stage publishes inline once the working copy is ready (no human preview gate; v1.6.0). Hard-blocks until `feasibilitySession` carries the reuse decision AND the selected language; publish gate validates the 13-section v2 template. Manual fall-back: `/velpari-feasibility-approve`. |

### Stage 5 — Design

| | |
|---|---|
| **Command** | `/velpari-architecture-generator` (renamed from `/velpari-design`; stage states `designing`/`designed`, artifact names, and `/velpari-show-design` unchanged) |
| **Pre-req** | Feasibility approved (`analyzed-feasibility`). Update-cycle skip: from `built-rtm`, `/velpari-architecture-generator` is also allowed when a published feasibility study already exists (`hasPublishedFeasibility`) — it advances straight to `designing`. The skip is a choice, never forced: `/velpari-feasibility` stays available to revise the study. |
| **Inputs** | Approved brainstorm notes + PRD + RTM + feasibility study (`Doc/feasibility/feasibility-study_<projectName>.md`) + `.pi/velpari/files.json` + profile + standards overlay (extra sections + scout + doctor checks) + agent mapping. |
| **Behaviour** | High-level design with module decomposition, contracts, data flow, error handling. **v1.1.0: 7 base scouts + 1 conditional** (style-selector + module + contracts + dataflow + errors + context-mapper + deployment-mapper; conflict-detector + crosscutting-extractor on demand). All 14 required design sections per the standards-aligned template (§0, §0.4, §5, §9, §10, §11, §12, §13, §14). Style choice recorded as ADR-001, every §5 row names a SEI tactic, 3 C4 Mermaid diagrams required. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/design/design_<projectName>.md` |
| **Published copy** | `Doc/design/design_<projectName>.md` |
| **Advance** | Stage publishes inline once the working copy is ready (no human preview gate; v1.6.0). Manual fall-back: `/velpari-architecture-generator-approve`. |

#### Required design sections (v1.1.0, arc42 / Rozanski & Woods / SEI / C4)

| § | Section | Standard source | Doctor enforcement |
|---|---|---|---|
| Header | Quick Reference sheet | Community polish | doctor warns when missing |
| Frontmatter | YAML block (`artifact`, `project`, `version`, `status`, `stage`, `run`, `created`, `updated`, `supersedes` on update) | Internal (Phase 7) | required |
| 0 | Introduction & Goals (mission + top 3–5 quality goals + stakeholder summary) | arc42 §1 + ISO/IEC/IEEE 42010 | error when missing |
| 0.4 | Architecture Constraints | arc42 §2 | error when missing |
| 1 | Module Breakdown (with Maturity + Depends on columns) | Internal | error when missing |
| 2 | Data Model | Internal | warn when empty |
| 3 | Interface Contracts | Internal | warn when empty |
| 4 | Data Flow | Internal (Rozanski & Woods runtime view) | error when missing |
| 5 | Quality Attribute Scenarios (SEI 6-part form: Source / Stimulus / Environment / Artifact / Response / Response measure / Approach) | SEI 6-part scenario | error when missing or any row incomplete |
| 8 | Architecture Decisions (mandatory ADR-001 in `accepted` status with ≥2 options at stage `design`) | Nygard ADR | error when missing or rubric violated |
| 9 | Context View (users / external systems / trust boundaries / cross-boundary flows) | Rozanski & Woods; C4 Level 1 | error when missing |
| 10 | Deployment View (container→host / network / scaling boundaries — numeric limits only) | Rozanski & Woods | error when missing |
| 11 | Crosscutting Concepts (persistence, logging, observability, error handling, security, communication, configuration, deployment, testing) | arc42 §8 | error when missing |
| 12 | Risks & Tech Debt (impact + mitigation + owner, no "no risks") | arc42 §11 | error when missing |
| 13 | Glossary (term + definition + source, ubiquitous language) | arc42 §12 | error when missing |
| 14 | Diagrams (C4) — three Mermaid blocks `C4Context`, `C4Container`, `C4Component` | Simon Brown's C4 | error when missing |

The doctor gate (`pi-extension/src/doctor/checks/design-readiness.ts:gateDesignReadiness`) hard-blocks every `design.missing-*` and `design.qa-row-incomplete`. The publish gate (`doctor/gate.ts:runPublishGate`) runs this gate before writing.

### Stage 6 — Atomic Functions

| | |
|---|---|
| **Command** | `/velpari-atomic-function` |
| **Pre-req** | Design approved (`designed`). |
| **Inputs** | Approved brainstorm notes + PRD + RTM + feasibility + design (`Doc/design/design_<projectName>.md`) + `.pi/velpari/files.json` + profile + standards + agent mapping + **atomic profile** (`files.json:atomic` — see §6.5 below). |
| **Behaviour** | Decomposes the system into leaf-level atomic functions (per V-Model Module Design / LLD and SA/SD Functional Decomposition). Helper ↔ atomic relationship is tracked: helpers may call atomics; atomics are strictly leaves. Pseudocode in Stage 7 references these atomic units by id. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/atomic-function/atomic-functions_<projectName>.md` |
| **Published copy** | `Doc/atomic-functions/atomic-functions_<projectName>.md` |
| **Advance** | Stage publishes inline once the working copy is ready (no human preview gate; v1.6.0). Manual fall-back: `/velpari-atomic-function-approve`. |

#### Stage 6 tier-driven schema (ISO/IEC 29110 + IEC 61508/IEC 62304)

The atomic-function stage serves every developer tier via a single
**tier-driven schema** loaded from `.pi/velpari/files.json:atomic`:

| Tier (ISO/IEC 29110) | Audience | Required fields |
|---|---|---|
| **Entry** | 1 dev / prototype | Base-core only (8 fields) |
| **Basic** | small team / single project | Base-core + 5 cross-ref fields |
| **Intermediate** | multi-module / CI / regression | Base-core + 5 + 11 (EARS, V-Model LLD, Clean Code) |
| **Advanced** | regulated industry / full audit | Base-core + 5 + 11 + 11 (INCOSE, PMBOK, maintenance) |

**The 8 base-core fields** (mandatory at every tier):

| Field | Source standard |
|---|---|
| `afId` (AF-N, append-only) | IEEE 29148 traceability |
| `name` (verb-noun) | ISO 25010 analyzability |
| `purpose` (one sentence) | INCOSE C5 singular |
| `signature` (typed) | V-Model LLD module spec |
| `source` (which prior artifact) | IEEE 29148 + Velpari zero-hallucination rule |
| `cohesion` (perfect-atomic or functional) | Yourdon & Constantine 1979 |
| `verification` (Test/Demo/Inspection/Analysis) | IEEE 29148 |
| `testable` (yes) | Clean Code + ISO 25010 testability |

**Tier-specific additions** are documented in
`skills/velpari-atomic-function.md` § Output Format and enforced by the
`checkAtomicTierSection` doctor gate (publish-time, hard-blocks).

**Criticality** is captured separately as `safetyClass` (IEC 62304
Class A/B/C) and `sil` (IEC 61508 SIL 1-4). Both are stored in
`files.json:atomic` alongside the tier.

The selection framework is the same as the industry standard: **3 inputs
→ 1 schema**. Run `/velpari-configure-inputs` to declare the tier +
criticality + standards overlay. The atomic-function stage applies the
matching schema automatically. The doctor gate enforces it.

#### Reviewer sub-agent (Plan A + Plan D)

The reviewer is the **only adversarial critic** in Velpari — all source
scouts are friendly (they propose); the reviewer critiques. Spawned last
by the parent LLM after the source reports are merged into the draft,
before the preview gate. Each reviewer writes a structured verdict JSON to
`<runDir>/<stage>/scouts/<reviewer-role>-report.json`.

**Plan D** generalizes the reviewer to 4 stages (originally only
atomic-function):

| Stage | Reviewer role | Verdict path |
|---|---|---|
| atomic-function (Plan A) | `reviewer` | `<runDir>/atomic-function/scouts/reviewer-report.json` |
| pseudocode (Plan D) | `pseudocode-reviewer` | `<runDir>/pseudocode/scouts/pseudocode-reviewer-report.json` |
| testplan (Plan D) | `testplan-reviewer` | `<runDir>/testplan/scouts/testplan-reviewer-report.json` |
| architecture-generator (Plan D) | `design-reviewer` | `<runDir>/design/scouts/design-reviewer-report.json` |

Each stage's reviewer has 10 deterministic + 4 semantic checks (LLM-only).
Per-stage agents live in `skills/agents/{pseudocode,testplan,design}-reviewer.md`.

**5-scout pattern (atomic-function):**

| # | Scout | Role | Spawned by |
|---|---|---|---|
| 1 | `af-source-rtm` | Proposes AFs from the RTM | parent LLM (parallel) |
| 2 | `af-source-design` | Proposes AFs from the design | parent LLM (parallel) |
| 3 | `af-source-prd` | Proposes AFs from the PRD | parent LLM (parallel) |
| 4 | `af-source-feas` | Proposes AFs from the feasibility study | parent LLM (parallel) |
| 5 | `reviewer` | Adversarial critic (merged draft + 4 reports) | parent LLM (after merge, before preview) |

**Reviewer tier gate** (shared by all 4 reviewer stages):

| # | Tier | Reviewer spawns? |
|---|---|---|
| 1 | Entry | **No** (overhead > value) |
| 2 | Basic | **No** (doctor covers) |
| 3 | Intermediate | **Opt-in** via `--velpari-run-reviewer` flag |
| 4 | Advanced | **Yes** (required) |

Overlay gate: 4 bundled overlays (`medical-device-b`, `industrial-ot`,
`financial-payments`, `cloud-saas`) declare `requiresReviewer: true` —
the reviewer always spawns when the overlay is active, regardless of
tier. Per-project override via `files.json:atomic.reviewerMode`
(`tier-default` / `always` / `never`).

**Reviewer verdict JSON shape:**
```json
{
  "verdict": "approve" | "needs-fix" | "block",
  "issues": [
    {
      "severity": "error" | "warning" | "info",
      "rule": "<rule-id>",
      "location": "<AF-N | working-copy>",
      "message": "...",
      "suggestion": "..."
    }
  ],
  "summary": "...",
  "timestamp": "ISO-8601"
}
```

**Reviewer checks (single source of truth — replaces doctor parser):**

10 deterministic rules (migrated from `doctor/checks/atomic-tier.ts`):
base-core-missing, tier-specific-missing, cohesion-invalid,
verification-invalid, testable-invalid, complexity-exceeded,
ears-pattern-invalid, arg-count-high, coupling-high, risk-empty.

4 semantic rules (NEW — only the LLM can judge):
cross-scout-contradiction, missing-merge, tier-mismatch,
standards-mapping-missing.

**Verdict decision rule** (from `skills/agents/reviewer.md`):
- `errors === 0` → `approve`
- `errors ≤ 3` → `needs-fix` (parent LLM fixes + re-spawns; max 2 iterations)
- `errors > 3` → `block` (human intervention required)

**Migration from doctor:** every deterministic rule that previously
lived in `doctor/checks/atomic-tier.ts` is now owned by the reviewer.
The doctor gate consumes the verdict JSON via
`loadReviewerVerdict(cwd, profile)` — single source of truth = reviewer.

**Standards mapped:** Anthropic Constitutional AI (adversarial
critique), Cursor Composer/Reviewer, SWE-Agent Manager/Editor/Reviewer,
ISO/IEC 14764 (independent review per maintenance type).

#### Stage 6 tier-driven schema (ISO/IEC 29110 + IEC 61508/IEC 62304)

The atomic-function stage serves every developer tier via a single
**tier-driven schema** loaded from `.pi/velpari/files.json:atomic`:

| Tier (ISO/IEC 29110) | Audience | Required fields |
|---|---|---|
| **Entry** | 1 dev / prototype | Base-core only (8 fields) |
| **Basic** | small team / single project | Base-core + 5 cross-ref fields |
| **Intermediate** | multi-module / CI / regression | Base-core + 5 + 11 (EARS, V-Model LLD, Clean Code) |
| **Advanced** | regulated industry / full audit | Base-core + 5 + 11 + 11 (INCOSE, PMBOK, maintenance) |

**The 8 base-core fields** (mandatory at every tier):

| Field | Source standard |
|---|---|
| `afId` (AF-N, append-only) | IEEE 29148 traceability |
| `name` (verb-noun) | ISO 25010 analyzability |
| `purpose` (one sentence) | INCOSE C5 singular |
| `signature` (typed) | V-Model LLD module spec |
| `source` (which prior artifact) | IEEE 29148 + Velpari zero-hallucination rule |
| `cohesion` (perfect-atomic or functional) | Yourdon & Constantine 1979 |
| `verification` (Test/Demo/Inspection/Analysis) | IEEE 29148 |
| `testable` (yes) | Clean Code + ISO 25010 testability |

**Tier-specific additions** are documented in
`skills/velpari-atomic-function.md` § Output Format and enforced by the
`checkAtomicTierSection` doctor gate (publish-time, hard-blocks).

**Criticality** is captured separately as `safetyClass` (IEC 62304
Class A/B/C) and `sil` (IEC 61508 SIL 1-4). Both are stored in
`files.json:atomic` alongside the tier.

The selection framework is the same as the industry standard: **3 inputs
→ 1 schema**. Run `/velpari-configure-inputs` to declare the tier +
criticality + standards overlay. The atomic-function stage applies the
matching schema automatically. The doctor gate enforces it.

### Stage 7 — Pseudocode

| | |
|---|---|
| **Command** | `/velpari-pseudocode` |
| **Pre-req** | Atomic functions approved (`analyzed-atomic-functions`). |
| **Inputs** | Approved brainstorm notes + PRD + RTM + feasibility + design + atomic functions (`Doc/atomic-functions/atomic-functions_<projectName>.md`) + `.pi/velpari/files.json` + profile + standards + agent mapping. |
| **Behaviour** | Algorithm pseudocode per module, complexity analysis, edge-case handling. Pseudocode references atomic functions by id (per SA/SD "Design Phase involves structure chart and pseudocode"). 4 scouts. |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/pseudocode/pseudocode_<projectName>.md` |
| **Published copy** | `Doc/pseudocode/pseudocode_<projectName>.md` |
| **Advance** | Stage publishes inline once the working copy is ready (no human preview gate; v1.6.0). Manual fall-back: `/velpari-pseudocode-approve`. |

### Stage 8 — Test Plan

| | |
|---|---|
| **Command** | `/velpari-testplan` |
| **Pre-req** | Pseudocode approved (`wrote-pseudocode`). |
| **Inputs** | Approved brainstorm notes + PRD + RTM + feasibility + design + atomic functions + pseudocode (`Doc/pseudocode/pseudocode_<projectName>.md`) + `.pi/velpari/files.json` + profile + standards + agent mapping. |
| **Behaviour** | Test plan + per-requirement test cases. Test cases reference atomic function ids (per V-Model: System Test Plans developed during System Design, Unit Test Plans during Module Design). 4 scouts (strategy, coverage, integration, unit). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/testplan/test-plan_<projectName>.md` and `test-cases_<projectName>.md` |
| **Published copy** | `Doc/tests/test-plan_<projectName>.md` and `test-cases_<projectName>.md` |
| **Advance** | Stage publishes inline once the working copy is ready (no human preview gate; v1.6.0). Manual fall-back: `/velpari-testplan-approve`. |

### Stage 9 — Development Order

| | |
|---|---|
| **Command** | `/velpari-development-order` |
| **Pre-req** | Test plan approved (`planned-tests`). |
| **Inputs** | Approved brainstorm notes + PRD + RTM + feasibility + design + atomic functions + pseudocode + test plan (`Doc/tests/test-plan_<projectName>.md`) + test cases (`Doc/tests/test-cases_<projectName>.md`) + `.pi/velpari/files.json` + profile + standards + agent mapping. |
| **Behaviour** | Produces an execution order that respects dependencies and minimises risk (per PMBOK Work Breakdown Structure — created after requirements, design, and planning are complete). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/development-order/development-order_<projectName>.md` |
| **Published copy** | `Doc/development-order/development-order_<projectName>.md` |
| **Advance** | Stage publishes inline once the working copy is ready (no human preview gate; v1.6.0). Manual fall-back: `/velpari-development-order-approve`. |

### Stage 10 — Final Design Consolidation

| | |
|---|---|
| **Command** | `/velpari-final-design` (renamed from `/velpari-html-design` on 2026-09-14; today produces the final-design consolidation doc, not actual HTML) |
| **Pre-req** | Development order approved (`ordered-development`). |
| **Inputs** | Approved brainstorm notes + PRD + RTM + feasibility + design + atomic functions + pseudocode + test plan (`Doc/tests/test-plan_<projectName>.md`) + test cases (`Doc/tests/test-cases_<projectName>.md`) + development order (`Doc/development-order/development-order_<projectName>.md`) + `.pi/velpari/files.json` + profile + standards + agent mapping. |
| **Behaviour** | 4 parallel scouts (consistency, coverage, contract, finalizer) cross-check all 9 prior inputs for ID/naming/contract mismatches and consolidate them into one final design document. Reports every `error` as a blocker (developer must rerun the offending stage) or a resolution inside the consolidated doc (per V-Model Design Verification). |
| **Working copy** | `.IDE_Plans/velpari/runs/<run-id>/final-design/final-design_<projectName>.md` |
| **Published copy** | `Doc/design/final-design_<projectName>.md` |
| **Advance** | Stage publishes inline once the working copy is ready (no human preview gate; v1.6.0; publishes + advances to `finalized-design`). Manual fall-back: `/velpari-final-design-approve`. |

### Final — Handoff

| | |
|---|---|
| **Command** | `/velpari-handoff` |
| **Pre-req** | Final design approved (`finalized-design`). |
| **Inputs** | All 10 approved artifacts: brainstorm + PRD + RTM + feasibility + design + atomic functions + pseudocode + test plan + test cases + development order + final-design consolidation + `.pi/velpari/files.json` + profile + standards + agent mapping + state.json (`history`, `currentStage`). |
| **Behaviour** | Validates Senai schema compatibility. Writes `.pi/senai/architect-inputs.json` so Senai can take over. |
| **Output** | `.pi/senai/architect-inputs.json` |
| **Next** | Senai: `/senai:plan` → `/senai:approve` → `/senai:implement` → `/senai:document` → `/senai:deliver` |

---

## 3. Sub-Sequence Cycle (per-stage loop)

Every stage handler from PRD onwards (Stages 2–10) follows the same
internal pattern. Brainstorm (Stage 1) runs its own understand-first
lifecycle (below).

### 3.1 Auto-audit lifecycle (v1.2.1 + v1.2.2)

After the working copy is written to `Doc/` (atomic publish), every
`/velpari-<stage>-approve` invocation runs the **full** doctor audit before
the state advances. The doctor produces a per-section verdict:

- `ok` / `info` / `warning` / `error` items per section.
- The on-disk report at `.IDE_Plans/velpari/doctor-report.md` is the
  canonical source.
- The notify stream carries a one-line headline + a grouped list
  (one line per section, v1.2.3 UI) + the report path.
- **Errors AND warnings block the state advance** (v1.2.1 policy).
  The developer reads the report, fixes the file, re-runs
  `/velpari-<stage>-approve` (which re-runs both the publish gate and the
  full doctor audit).
- `ShapeCompatibility` (v1.2.2) is one of the 25+ doctor
  sections. It emits `fresh` / `upgrade` / `migration` based on the
  published `version:` frontmatter (SemVer 2.0.0 MAJOR semantics) +
  the section count (arc42 catalogue). The verdict is also visible
  in `/velpari-status` and in the architecture-generator prelude.
- **Escape hatch for tests only**: `VELPARI_SKIP_AUTO_DOCTOR=1` env
  var or `opts.skipAutoDoctor=true` programmatic flag. Production
  never sets either. The standalone `/velpari-doctor` slash
  command is the public ad-hoc audit path.

### 3.2 Per-stage flow

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
│  Parent LLM runs scouts → writes                            │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Auto-publish (parent calls velpari_stage_publish tool):    │
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
lifecycle v2.1 flow (the full program lives in `skills/velpari-brainstorm.md`):

```
[handler]           hard-gate on multiplexer present (zellij/tmux/wezterm/cmux)
       │            (override via PI_SUBAGENT_MUX for wrappers/tests)
       ▼
[0] UNDERSTAND        chat only, inline reads (1-2 files), NO subagents
       ▼
[1] CONFIRM loop      short paragraph → user agrees or corrects → repeat
                      HARD LOCK: nothing below runs until confirmed
                      (persisted via velpari_brainstorm_session
                       confirm-understanding)
       ▼
[2] SCAN-PLAN GATE    v2.1: ALWAYS asks via runScanGatePicker
                      5 branches: Run all / Run code+doc / Community only / Adjust / Skip
                      Config-aware (code-only / doc-only / mixed projects hide unavailable scans)
                      Persists via velpari_brainstorm_session request-scan-gate
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
                      Go → /velpari-approve-brainstorm → publish → user runs /velpari-prd (v1.6.2+; no auto-chain)
```

The brainstorm cycle in short:

1. **Multiplexer gate** (handler entry — fail-fast if no mux)
2. **Understand** (conversational, hard lock until the user confirms)
3. **Scan gate** (v2.1: picker ALWAYS asks — no default; community scan is the web-search consent)
4. **Scan** (visible read-only scouts — only the selected scans)
5. **Discuss** (suggested answers, decision ledger in the notes)
6. **Approve-brainstorm** (hard-blocked gates, publishes, writes the
   audit log, clears the session fields, auto-runs `/velpari-prd`)

---

## 4. Stage Transition Table

The transition rules are the single source of truth — Velpari cannot
skip stages or jump ahead. `STAGE_TRANSITIONS` in
`pi-extension/src/core/constants.ts` enforces this at runtime.

| From | To | Trigger command |
|---|---|---|
| `none` | `brainstorming` | `/velpari-brainstorm <mission>` |
| `brainstorming` | `brainstormed` → `drafting-prd` | `/velpari-approve-brainstorm` (manual; user then runs `/velpari-prd` to advance — v1.6.2+ dropped the auto-chain) |
| `brainstormed` | `drafting-prd` | `/velpari-prd` |
| `drafting-prd` | `drafted-prd` → `building-rtm` | `/velpari-prd-approve` |
| `drafted-prd` | `building-rtm` | `/velpari-rtm` |
| `building-rtm` | `built-rtm` → `analyzing-feasibility` | `/velpari-rtm-approve` |
| `built-rtm` | `analyzing-feasibility` | `/velpari-feasibility` |
| `built-rtm` | `designing` (feasibility skip — gated: allowed only when a published feasibility study already exists, i.e. an update cycle) | `/velpari-architecture-generator` |
| `analyzing-feasibility` | `analyzed-feasibility` → `designing` | `/velpari-feasibility-approve` |
| `analyzed-feasibility` | `designing` | `/velpari-architecture-generator` |
| `designing` | `designed` → `analyzing-atomic-functions` | `/velpari-architecture-generator-approve` |
| `designed` | `analyzing-atomic-functions` | `/velpari-atomic-function` |
| `analyzing-atomic-functions` | `analyzed-atomic-functions` → `writing-pseudocode` | `/velpari-atomic-function-approve` |
| `analyzed-atomic-functions` | `writing-pseudocode` | `/velpari-pseudocode` |
| `writing-pseudocode` | `wrote-pseudocode` → `planning-tests` | `/velpari-pseudocode-approve` |
| `wrote-pseudocode` | `planning-tests` | `/velpari-testplan` |
| `planning-tests` | `planned-tests` → `ordering-development` | `/velpari-testplan-approve` |
| `planned-tests` | `ordering-development` | `/velpari-development-order` |
| `ordering-development` | `ordered-development` → `finalizing-design` | `/velpari-development-order-approve` |
| `ordered-development` | `finalizing-design` | `/velpari-final-design` |
| `finalizing-design` | `finalized-design` → `handoff-ready` | `/velpari-final-design-approve` |
| `finalized-design` | `handoff-ready` | `/velpari-handoff` |

---

## 5. Command Surface (32 commands — v1.4.0: + `/velpari-design-logging`, `/velpari-show-logging`)

### Stage commands (10)
- **Core 5 (required, pre-production):** `/velpari-brainstorm`, `/velpari-prd`, `/velpari-rtm`, `/velpari-feasibility`, `/velpari-architecture-generator`
- **Build-planning 3 (required, post-design):** `/velpari-atomic-function`, `/velpari-pseudocode`, `/velpari-testplan`
- **Execution + Consolidation 2 (required, post-testplan):** `/velpari-development-order`, `/velpari-final-design` (final design consolidation — renamed from `/velpari-html-design` on 2026-09-14, which itself was renamed from `/velpari-design`)

### Discipline commands (13 — v1.4.0 added `/velpari-design-logging`)
`/velpari-approve-brainstorm`, `/velpari-prd-approve`, `/velpari-rtm-approve`, `/velpari-feasibility-approve`, `/velpari-architecture-generator-approve`, `/velpari-atomic-function-approve`, `/velpari-pseudocode-approve`, `/velpari-testplan-approve`, `/velpari-development-order-approve`, `/velpari-final-design-approve` (per-stage fall-back, v1.6.0), `/velpari-status`, `/velpari-reset`, `/velpari-configure-inputs`, `/velpari-configure-requirements`, `/velpari-configure-standards`, `/velpari-configure-agents`, `/velpari-agents`, `/velpari-generate-sub-agents`, `/velpari-doctor`, `/velpari-handoff`, **`/velpari-design-logging`** (cross-cutting; runs after Design is approved)

### View commands (8 — v1.4.0 added `/velpari-show-logging`)
`/velpari-show-brainstorm`, `/velpari-show-prd`, `/velpari-show-rtm`, `/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`, `/velpari-show-testplan`, **`/velpari-show-logging`**

### Wrapper command (1)
`/velpari-prd-rtm` — chains `/velpari-prd` then `/velpari-rtm`. Does not auto-approve.

### Cross-cutting — Logging design (v1.4.0)

`/velpari-design-logging` is **not a stage** — it's a discipline command that produces a logging architecture plan (`Doc/observability/logging-plan_<project>.md`) once the architecture is in place. Place it after Stage 5 (Design) is approved, before `/velpari-handoff`:

```
Stage 5 Design published → /velpari-architecture-generator-approve → /velpari-design-logging →
Stages 6–10 (Atomic, Pseudocode, Test, Dev Order, Final Design) →
/velpari-final-design-approve → /velpari-handoff → Senai
```

The 3-scout pattern (logging-standards-researcher, logging-architecture-designer, logging-compliance-mapper) mirrors Stages 2–10. Self-publishing (no separate `the publish tool` step) — the doctor `checkLoggingPlanSection` is the safety net. The published plan flows into Senai's `architect-inputs.json` under `observability.loggingPlan[*]`.

When the active standards overlay has a `loggingRequirements` block (medical-device-b, industrial-ot, financial-payments, cloud-saas), the doctor's check flips the missing plan from `info` to `error` and verifies retention + tamper-evidence + PII redaction compliance against the overlay.

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
   `<runDir>/rtm/RTM_<projectName>.json`; the publish tool (or `/velpari-rtm-approve` fall-back) regenerates the
   published markdown from it, so the markdown can never drift from the data
   (`core/rtm-data.ts`).
3. **SHA-256 fingerprints** — each RTM row carries the hash of the published
   PSRS requirement it traces to; when the source changes, the link turns
   `suspect` instead of silently breaking (`core/fingerprints.ts`).
4. **Publish gate** — the publish tool (or `/velpari-<stage>-approve` fall-back) runs `doctor/gate.ts:runPublishGate`
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

// Full Stage enum (22 values — source: pi-extension/src/core/constants.ts).
// All states are required; the post-design and post-testplan states are
// reached via /velpari-atomic-function, /velpari-pseudocode, /velpari-testplan,
// /velpari-development-order, and /velpari-final-design in that order.
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

`/velpari-<stage>-approve` writes these. The parent folder (`Doc/`) contains
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
Velpari. It applies to all 10 stage handlers (stages 2–10): PRD, RTM,
Feasibility, Design, Atomic Functions, Pseudocode, Test Plan,
Development Order, Final Design — all run 4 write-capable scouts that
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
   without `the publish tool` (or `/velpari-approve-brainstorm`).
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
    hook — `Doc/` included, publishing goes through the stage-publish
    tool (or the per-stage `/velpari-<stage>-approve` fall-back) — and
    every scout `subagent` spawn must declare its `-report.json` path.
    The `before_agent_start` hook re-injects the current stage, the next
    command, and the hard rule into the system prompt every turn.
13. **Living documents.** Requirement IDs are append-only; removals are
    marked `deprecated` + reason, never deleted; every revision bumps
    the version and adds a Change Log entry. The publish tool (and
    per-stage `/velpari-<stage>-approve` fall-back) blocks revisions
    that break these rules. Brainstorm is the only entry point for
    changes.

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
| Architecture sub-life cycle | `pi-extension/src/core/arch-context.ts` + `arch-confirm.ts` |
| Standards overlay machinery | `pi-extension/src/core/standards-catalogue.ts` + `standards-overlay.ts` |
| ADR module | `pi-extension/src/core/adr.ts` |
| Standards doctor check | `pi-extension/src/doctor/checks/standards-profile.ts` |
| ADR doctor check | `pi-extension/src/doctor/checks/adr.ts` |
| Overlay check registry | `pi-extension/src/doctor/check-registry.ts` |
| Bundled overlays | `skills/standards/overlays/<id>/` |
| `medical-device-b` overlay (IEC 62304 Class B) | `skills/standards/overlays/medical-device-b/` |

---

## 11. Architecture sub-life cycle (Phases 2 + 4)

Before the design stage runs any scout, the handler executes a
**sub-life cycle prelude**:

1. **Load context** (`core/arch-context.ts:loadArchContext`)
   - Reads PRD, RTM, feasibility, requirements-profile, standards-profile, files.json, agents.json
2. **Confirm with developer** (`core/arch-confirm.ts:confirmWithDeveloper`)
   - Shows a one-paragraph summary; asks `Proceed / Adjust scope / Pick a different profile`
   - Persists the outcome in `state.json:archSubCycle.developerConfirmed`
3. **Run standard flow** — spawn 4 base scouts (design stage)
4. **Spawn 5th conditional scout** (`design-conflict-detector`)
   - Reads the 4 base reports, returns JSON list of conflicts
5. **Surface conflicts via AskUserQuestion** — Pick A / Pick B / Composite / Re-spawn
6. **Record decisions as ADRs** (`core/adr.ts`)
   - Each ADR has Context / Options / Decision / Rationale / Consequences / Reconsider Triggers
7. **Write working copy** with the `## Architecture Decisions` section
8. **Auto-publish (v1.6.0)** — parent LLM calls `velpari_stage_publish` tool on working-copy ready; no human preview

The doctor gate refuses to publish when `developerConfirmed` is false or
the ADR section is missing/invalid. See `doctor/checks/arch-sub-cycle.ts`
+ `doctor/checks/adr.ts`.

---

## 12. Standards overlays (Phase 3, 5, 6)

Domain overlays are self-contained bundles under
`skills/standards/overlays/<id>/`:

| File | Purpose |
|---|---|
| `profile.json` | Overlay definition: standards, scopes, required sections, extra scouts, doctor checks |
| `sections/{prd,design,testplan}-extra.md` | Section templates injected by `core/standards-overlay.ts:mergeOverlay` |
| `scouts/<role>.md` | Overlay-specific scout (role MUST start with `overlay-` prefix) |
| `doctor/check-overlay.md` | One bullet per overlay-specific doctor rule |

The catalogue at `skills/standards/catalogue.json` lists every bundled
overlay. `/velpari-configure-standards` lets the developer pick one;
the choice persists to `state.json:standardsProfile` + `.pi/velpari/standards-profile.json`.

When the active overlay declares `extraScouts`, the stage registry
(`stages/registry.ts:runStage`) bootstraps them into `.pi/agents/`
(via `io/agents-install.ts:bootstrapOverlayScouts`) and spawns them
alongside the 4 base scouts.

Bundled overlays (v1.0):
- `none` — common core (RFC 2119 + EARS); zero domain overlay
- `medical-device-b` — IEC 62304 Class B (the first real overlay;
  Phase 6 proves the mechanism)
- `industrial-ot` — IEC 61508 SIL + IEC 62443 (industrial / process control)
- `financial-payments` — PCI-DSS v4.0 + SOX §404 + FFIEC CAT
- `cloud-saas` — SOC 2 Type II + ISO 27001 + NIST 800-53 Rev 5 + ISO 27017 + ISO 27018

The mechanism is general — community overlays can be added by copying
`skills/standards/overlays/_template/`.

---

## 13. ADR mechanism (Phase 4)

Every architecture decision that survives a conflict between scouts is
captured as an **ADR** (Architecture Decision Record) in the design
artifact's `## Architecture Decisions` section. Each ADR carries:

- Context, Options, Decision, Rationale, Consequences, Reconsider Triggers
- Status (`proposed | accepted | rejected | superseded`)
- Optional `supersedes` / `supersededBy` link to a prior decision

Supersession chain: when a future brainstorm update reverses a prior
decision, the old ADR's status flips to `superseded` and the new ADR
declares `supersedes: "ADR-NNN"`. Both ADRs stay in the artifact
(superseded ≠ deleted).

The handoff payload exports every ADR to `.pi/senai/architect-inputs.json`
so Senai honors the decisions during implement instead of re-deciding.

Doctor checks (Phase 4):
- `adr.section-missing` — `## Architecture Decisions` is absent
- `adr.no-records` — section present but no parseable ADRs
- `adr.orphan` — supersedes / supersededBy points to a missing id
- `adr.invalid` — fails validateADR (missing field, bad id pattern, etc.)
- `adr.single-option` — accepted ADR with <2 options (rubber-stamp guard)

---

## 14. Cross-stage continuity

When the architecture design changes mid-run (update mode):

1. The architecture sub-life cycle loads the new context
2. The `design-conflict-detector` may surface new conflicts vs the published design
3. Every captured ADR can be revisited; new ADRs declare `supersedes`
4. Standards overlay can be switched via `/velpari-configure-standards`
5. The handoff payload carries the current ADR set + active overlay,
   so Senai always sees the live decisions, not a snapshot from a
   prior version

---

## 15. Integration verification (Phase 8)

After all 7 phases ship, Phase 8 adds 12 cross-cutting verification
tests that exercise every change end-to-end. See
`.IDE_Plans/architecture-command_plan_20260913_1723_v1.1.md §Phase 8`
for the verification matrix.

| What | How |
|---|---|
| Layer boundaries | `npm run test:layer-align` |
| Command registration | `npm test` + grep |
| Skill discovery | Boot test session |
| State machine | Walk STAGE_TRANSITIONS |
| Publish gate | Per-artifact violation test |
| End-to-end flow | Full 16-step scenario |
| Overlay switching | `none → medical → none` |
| ADR continuity | Supersession chain test |
| Update mode | Re-run with changes |
| Build + install | `npm pack` + clean install |
| Performance | Baseline comparison |
| Doctor | Manual audit |

---

## 16. Sub-agent generator (Phase 8, brainstorom-only v1)

`/velpari-generate-sub-agents` is the optional re-emission step that
produces project-specific sub-agents for the 4 brainstorm roles
(`extractor`, `prd-checker`, `rtm-checker`, `web-search-agent`). It is
deterministic — no LLM content generation. The flow mixes four inputs:

1. **Role template** — `VELPARI_BRAINSTORM_GENERATED_ROLES` in
   `core/agents-config.ts`. Each row carries `role`, `label`, `tools`,
   `mandate`, `invocationHint`, `outOfScope[]`, and (for
   `web-search-agent`) `bodyFile`.
2. **Technology resource(s)** — files under `resources/technologies/`
   in the extension package. Shipped: `_template.md`, `generic.md`,
   `typescript.md`, `node.md`. Project overrides at
   `<cwd>/.pi/velpari/technologies/` win on matching `id`.
3. **Project context block** — v1: scan of the run's `mission` text for
   known tech-stack substrings. v2+ (planned): PRD + RTM JSON sidecars.
4. **Drift manifest** — `.pi/velpari/generated-manifest.json` with
   sha256 of every file the generator wrote. Used to skip
   unknown-origin files, preserve user edits, and merge (never wipe)
   pre-existing entries.

The UX flow: 3-question basic-mode interview (project type, language,
optional framework) → scan-gate consent picker (Fetch official docs /
Use generic / Cancel) when only `generic` matches → `planAgentGeneration`
+ `previewRegeneration` → ONE confirmation gate → `writeGeneratedAgents`
+ `updateAgentsJson` → post-write summary + doctor hint.

Safety contract:

- Files of unknown origin are NEVER overwritten. Generator authority
  comes from the manifest alone.
- Generated files whose sha256 has drifted from the manifest (user
  edited) are kept and reported as `keptDrifted`. The manifest hash
  is not updated for these.
- A missing file with a surviving mapping is recreated.
- Custom mappings in `agents.json` are NEVER overwritten; the
  generator only touches the default column.

Doctor surfaces the result via the new `Sub-agent generator
completeness` section:

- Every row of `VELPARI_BRAINSTORM_GENERATED_ROLES` is classified
  (bundled default / custom mapping / generated mapping) and checked
  (frontmatter present, `name:` matches filename, footer carries
  `_Generated by pi-velpari (generator v<N>)_`).
- A project-wide scan walks `.pi/agents/*.md` for stale footer
  versions (`N < GENERATOR_VERSION`) and recommends `/velpari-generate-
  sub-agents` to refresh.

### v1 scope (brainstorm-only)

The v1 generator emits only the 4 brainstorm sub-agents. The
remaining roles for Stages 2–10 (plus 2 feasibility-conditional:
`feasibility-reuse-scout`, `feasibility-spike`) remain bundled in
`skills/agents/*.md` and bootstrapped by
`io/agents-install.ts:ensureStageAgents`. Future phases will extend
`VELPARI_GENERATED_ROLES` (a future array) to cover the stage scouts;
the architecture-bound roles remain owned by `@adi-mudi/pi-chirpi`
(Senai's architecture factory).

### First-time setup

The generator is **optional**. The default bootstrap path still uses
the bundled scouts. To run the generator:

```
/velpari-brainstorm <mission>   # bootstraps the 4 bundled scouts
/velpari-generate-sub-agents     # re-emits them as project-specific copies
/velpari-doctor                  # verify the generator section is clean
```

