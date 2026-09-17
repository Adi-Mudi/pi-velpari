# Velpari Full Sequence — Option B (Industry-Standard Order)

This is the working draft of the sequence in industry-standard order.
Stages 6–10 (Atomic Functions, Pseudocode, Test Plan, Development Order,
Final Design) are required, and Atomic Functions comes BEFORE Pseudocode
(matching V-Model Module Design / SA/SD Structured Design).

| | |
|---|---|
| **Version** | v2.1 (Option B — industry-standard) |
| **Date** | 2026-09-15 |
| **Source of truth (current)** | `Doc/velpari-sequence.md` |
| **Source of truth (target)** | `Doc/velpari-sequence.md` after approval |
| **Standards aligned with** | V-Model, SA/SD, IEEE 12207 / 29148, PMBOK |

---

## 1. Pipeline Shape

| Phase | Stages | Status | Industry standard |
|---|---|---|---|
| **Phase A — Pre-work** | Stage 0 (one-time setup) | One-time per project | Project initiation |
| **Phase B — Pre-production** | Stages 1–5 | Required | Requirements + Design |
| **Phase C — Build planning** | Stages 6–8 | Required | V-Model Module Design (LLD) |
| **Phase D — Execution planning** | Stage 9 | Required | PMBOK WBS |
| **Phase E — Consolidation** | Stage 10 | Required | Design freeze |
| **Phase F — Handoff** | Stage 11 | Required | Implementation kickoff |

**Total: 11 sequential stages + 1 one-time setup + discipline/view commands**

---

## 2. Stage 0 — One-Time Setup (before any run)

| # | Command | Purpose | Repeatable? |
|---|---|---|---|
| 0.1 | `/velpari-configure-inputs` | Set framework, project name, code/test/doc/excluded paths | Yes |
| 0.2 | `/velpari-configure-requirements` | Pick requirements profile, optional web research | Yes |
| 0.3 | `/velpari-configure-agents` | Map scout roles to custom agent names (optional) | Yes |
| 0.4 | `/velpari-configure-standards` | Pick standards overlay (optional) | Yes |
| 0.5 | `/velpari-generate-sub-agents` | Re-emit 4 brainstorm scouts as project-specific copies (optional) | Yes |

---

### Cross-cutting discipline (v1.4.0)

| # | Command | When | Purpose |
|---|---|---|---|
| X1 | `/velpari-design-logging` | After Stage 5 (Design) is approved, before Stages 6–10 | Produces `Doc/observability/logging-plan_<project>.md` (16-section markdown body + YAML frontmatter). Self-publishing — no separate `/velpari-approve` step. Doctor's `checkLoggingPlanSection` audits it; overlay-driven error when an active overlay requires logging. |
| X2 | `/velpari-show-logging` | Any time | Print the published logging plan to the TUI. |

---

## 3. Phase B — Pre-Production Stages (1 to 5, required)

| # | Command | Stage transition | Output |
|---|---|---|---|
| 1 | `/velpari-brainstorm <mission>` | `none` → `brainstorming` | brainstorm notes (working) |
| 1a | `/velpari-approve-brainstorm` | `brainstorming` → `brainstormed` → `drafting-prd` (auto) | publishes + chains into PRD |
| 2 | `/velpari-prd` | `brainstormed` → `drafting-prd` | PRD draft (working) |
| 2a | `/velpari-approve` | `drafting-prd` → `drafted-prd` → `building-rtm` | publishes PRD |
| 3 | `/velpari-rtm` | `drafted-prd` → `building-rtm` | RTM draft (working) |
| 3a | `/velpari-approve` | `building-rtm` → `built-rtm` → `analyzing-feasibility` | publishes RTM |
| 4 | `/velpari-feasibility` | `built-rtm` → `analyzing-feasibility` | feasibility study (working) |
| 4a | `/velpari-approve` | `analyzing-feasibility` → `analyzed-feasibility` → `designing` | publishes feasibility |
| 5 | `/velpari-architecture-generator` | `analyzed-feasibility` → `designing` | design (working) |
| 5a | `/velpari-approve` | `designing` → `designed` → `analyzing-atomic-functions` | publishes design |

**Note: After Stage 5a, the next stage is forced to Stage 6. No handoff, no skipping.**

---

## 4. Phase C — Build Planning Stages (6 to 8, required)

| # | Command | Stage transition | Output |
|---|---|---|---|
| 6 | `/velpari-atomic-function` | `designed` → `analyzing-atomic-functions` | atomic-functions (working) |
| 6a | `/velpari-approve` | `analyzing-atomic-functions` → `analyzed-atomic-functions` → `writing-pseudocode` | publishes atomic-functions |
| 7 | `/velpari-pseudocode` | `analyzed-atomic-functions` → `writing-pseudocode` | pseudocode (working) |
| 7a | `/velpari-approve` | `writing-pseudocode` → `wrote-pseudocode` → `planning-tests` | publishes pseudocode |
| 8 | `/velpari-testplan` | `wrote-pseudocode` → `planning-tests` | test plan + test cases (working) |
| 8a | `/velpari-approve` | `planning-tests` → `planned-tests` → `ordering-development` | publishes tests |

**Note: After Stage 8a, the next stage is forced to Stage 9.**

---

## 5. Phase D — Execution Planning Stage (9, required)

| # | Command | Stage transition | Output |
|---|---|---|---|
| 9 | `/velpari-development-order` | `planned-tests` → `ordering-development` | development-order (working) |
| 9a | `/velpari-approve` | `ordering-development` → `ordered-development` → `finalizing-design` | publishes development-order |

**Note: After Stage 9a, the next stage is forced to Stage 10.**

---

## 6. Phase E — Consolidation Stage (10, required)

| # | Command | Stage transition | Output |
|---|---|---|---|
| 10 | `/velpari-final-design` | `ordered-development` → `finalizing-design` | final-design consolidation (working) |
| 10a | `/velpari-approve` | `finalizing-design` → `finalized-design` → `handoff-ready` | publishes final-design |

**Note: After Stage 10a, the next stage is forced to Stage 11 (handoff).**

---

## 7. Phase F — Handoff (Stage 11, required)

| # | Command | Stage transition | Output |
|---|---|---|---|
| 11 | `/velpari-handoff` | `finalized-design` → `handoff-ready` | `.pi/senai/architect-inputs.json` (Senai takes over) |

---

## 8. Stage Transition Table (full chain)

| From | To | Trigger |
|---|---|---|
| `none` | `brainstorming` | `/velpari-brainstorm <mission>` |
| `brainstorming` | `brainstormed` → `drafting-prd` | `/velpari-approve-brainstorm` |
| `brainstormed` | `drafting-prd` | `/velpari-prd` |
| `drafting-prd` | `drafted-prd` → `building-rtm` | `/velpari-approve` |
| `drafted-prd` | `building-rtm` | `/velpari-rtm` |
| `building-rtm` | `built-rtm` → `analyzing-feasibility` | `/velpari-approve` |
| `built-rtm` | `analyzing-feasibility` | `/velpari-feasibility` |
| `built-rtm` | `designing` (skip — only if published feasibility exists, update-cycle path) | `/velpari-architecture-generator` |
| `analyzing-feasibility` | `analyzed-feasibility` → `designing` | `/velpari-approve` |
| `analyzed-feasibility` | `designing` | `/velpari-architecture-generator` |
| `designing` | `designed` → `analyzing-atomic-functions` | `/velpari-approve` |
| `designed` | `analyzing-atomic-functions` | `/velpari-atomic-function` |
| `analyzing-atomic-functions` | `analyzed-atomic-functions` → `writing-pseudocode` | `/velpari-approve` |
| `analyzed-atomic-functions` | `writing-pseudocode` | `/velpari-pseudocode` |
| `writing-pseudocode` | `wrote-pseudocode` → `planning-tests` | `/velpari-approve` |
| `wrote-pseudocode` | `planning-tests` | `/velpari-testplan` |
| `planning-tests` | `planned-tests` → `ordering-development` | `/velpari-approve` |
| `planned-tests` | `ordering-development` | `/velpari-development-order` |
| `ordering-development` | `ordered-development` → `finalizing-design` | `/velpari-approve` |
| `ordered-development` | `finalizing-design` | `/velpari-final-design` |
| `finalizing-design` | `finalized-design` → `handoff-ready` | `/velpari-approve` |
| `finalized-design` | `handoff-ready` | `/velpari-handoff` |

---

## 9. Industry Standards Mapping

This sequence is aligned with the following industry standards.
Each stage maps to one or more recognized SDLC frameworks.

| # | Velpari stage | V-Model | SA/SD | IEEE 12207 / 29148 | PMBOK |
|---|---|---|---|---|---|
| 1 | Brainstorm | Planning | — | Agreement processes | Project initiation |
| 2 | PRD (PSRS) | Business Requirement Analysis | — | Requirements Analysis (IEEE 29148) | Requirements gathering |
| 3 | RTM | Traceability | — | Requirements Traceability (IEEE 29148) | Scope baseline |
| 4 | Feasibility | — | — | Feasibility study | Business case |
| 5 | Design (architecture) | System Design + Architectural Design | Structure Chart | Architecture Definition (IEEE 42010) | Design planning |
| 6 | **Atomic Functions** | **Module Design (LLD)** | **Functional Decomposition** | Implementation process prep | WBS creation |
| 7 | **Pseudocode** | **Module Design detail** | **Pseudocode (per SA/SD)** | Detailed design | Activity definition |
| 8 | Test Plan | System + Integration Test Plans | — | Validation process | Quality planning |
| 9 | Development Order | — | — | Implementation planning | **WBS + Schedule** |
| 10 | Final Design | Design Verification | — | Verification process | Design freeze |
| 11 | Handoff | Implementation kickoff | — | Implementation process | Project kickoff |

Citations:
- V-Model: Geeksforgeeks SDLC V-Model, Builtin V-Model, Tutorialspoint SDLC V-Model, Wikipedia V-Model
- SA/SD: Geeksforgeeks Structured Analysis and Structured Design
- IEEE 12207:2026, IEEE 29148:2018 (Requirements engineering)
- PMBOK: Project Management Body of Knowledge (WBS, schedule)
- Functional decomposition position: Tutorialspoint Functional Decomposition, DataCamp Functional Decomposition

---

## 10. Discipline Commands (run at any time)

1. `/velpari-approve` — publish + advance stage
2. `/velpari-approve-brainstorm` — publish brainstorm + chain into PRD
3. `/velpari-status` — show current stage, mission, run id, next command
4. `/velpari-reset` — clear state.json (destructive, asks first)
5. `/velpari-configure-inputs` — one-time setup (framework + paths)
6. `/velpari-configure-requirements` — one-time setup (profile + research)
7. `/velpari-configure-agents` — map scout roles
8. `/velpari-configure-standards` — pick standards overlay
9. `/velpari-agents` — view role → agent mapping
10. `/velpari-doctor` — full audit (ad-hoc)
11. `/velpari-handoff` — export to Senai
12. `/velpari-generate-sub-agents` — re-emit 4 brainstorm scouts

---

## 11. View Commands (read-only)

1. `/velpari-show-brainstorm`
2. `/velpari-show-prd`
3. `/velpari-show-rtm`
4. `/velpari-show-feasibility`
5. `/velpari-show-design`
6. `/velpari-show-pseudocode`
7. `/velpari-show-testplan`

---

## 12. Wrapper Commands

1. `/velpari-prd-rtm` — runs PRD then RTM in sequence (does not auto-approve)

---

## 13. Visual Flow

```
[setup] → Brainstorm → PRD → RTM → Feasibility → Design (architecture-generator) → [/velpari-design-logging — cross-cutting, after Design is approved] → Atomic Functions → Pseudocode → Test Plan (test case and test plan) → Development Order → Final Design → Handoff → Senai
```

11 stages in the pipeline + 1 setup phase + 1 handoff target.

---

## 14. Why This Order (vs. previous code)

| Aspect | Previous code (Option A) | New order (Option B) |
|---|---|---|
| Atomic Functions vs Pseudocode | Pseudocode first, then Atomic | **Atomic first, then Pseudocode** |
| Functional decomposition position | After Test Plan (back-reference) | **After Design (forward chain)** |
| Module Design (LLD) position | Split across 3 stages | **Contiguous: Design → Atomic → Pseudocode** |
| Test Plan inputs | Design + Pseudocode | Design + Atomic Functions + Pseudocode |
| Reading dependency direction | Has back-references | **Pure forward chain** |
| Standards alignment | Partial | **Full V-Model, SA/SD, IEEE, PMBOK alignment** |

---

## 15. What Changes From Current Code

1. **Reorder 3 stages**: Atomic Functions (was after Test Plan) moves between Design and Pseudocode
2. **Force stages 6–10 as required** (was: 8–10 were optional)
3. **Update STAGE_TRANSITIONS** in `pi-extension/src/core/constants.ts` — 8 entries reorder
4. **Update stage gate** in `pi-extension/src/stages/registry.ts` — `/velpari-handoff` blocks until `finalized-design`
5. **Update next-commands list** — after each approve, next is correct stage
6. **Update stage handlers** (`atomic-function.ts`, `pseudocode.ts`, `testplan.ts`) — update `reads` lists
7. **Update skill files** (`skills/velpari-atomic-function.md`, `velpari-pseudocode.md`, `velpari-testplan.md`) — update "Reads" sections
8. **Update tests** in `pi-extension/test/stages/` — update transition assertions
9. **Update AGENTS.md** — change principle #10, update stage workflow
10. **Update Doc/velpari-sequence.md** — replace with this content
11. **Update CHANGELOG** — note version bump + reorder

---

## 16. Risk

1. Existing users who reached `planned-tests` without doing 8, 9, 10 (in old order) will need to redo stages in new order
2. Old runs may need `/velpari-reset` or manual stage replay
3. Stage state file schema may need backward-compat shim for runs that were in mid-stage when reordered
4. Test fixtures may need updates (some test the stage order)

---

## 17. Side Effect On Existing Runs

1. Any run that reached `designed` (Stage 5a done) is at the right state for the new order — proceed with Stage 6 (Atomic Functions)
2. Any run that reached `planning-tests` (was after Test Plan in old order) is now mid-pipeline; new order needs Atomic + Pseudocode before Test Plan — the run needs Atomic Functions and Pseudocode run before continuing
3. Any run past `planned-tests` (in old position) needs `/velpari-reset` or careful stage replay

---

## 18. File Location

- This draft: `velpari-full-sequence.md` (project root)
- Target (after approval): `Doc/velpari-sequence.md`
- AGENTS.md: update principle #10, stage workflow section
- pi-extension/src/core/constants.ts: STAGE_TRANSITIONS
