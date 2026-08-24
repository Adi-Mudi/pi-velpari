# Pi-Velpari Sequence

A reference for how Pi-Velpari orchestrates the pre-production phase. Parallels `Pi-Orchestra_v4/Doc/senai-sequence.md` so users learn one mental model and apply it across both extensions.

---

## 1. The 9-stage pipeline (with 2 optional post-pipeline stages)

```
┌─────────────┐   /velpari-approve    ┌─────────────┐   /velpari-approve    ┌─────────────┐
│  discuss    │ ──────────────────────▶│    prd      │ ──────────────────────▶│    rtm      │
│ (interview) │                        │  (formalize)│                        │  (trace)    │
└─────────────┘                        └─────────────┘                        └─────────────┘
       │                                     │                                     │
       ▼                                     ▼                                     ▼
 discussion-notes.md                   PRD_Pi-Velpari.md                     RTM_Pi-Velpari.md

       │                                     │                                     │
       │ /velpari-approve                    │ /velpari-approve                    │ /velpari-approve
       ▼                                     ▼                                     ▼

┌─────────────────┐              ┌─────────────┐                          ┌─────────────┐
│  feasibility    │ ─────────────│   design    │ ────────────────────────▶│ pseudocode  │
│  (evaluate)     │              │  (shape)    │                          │  (logic)    │
└─────────────────┘              └─────────────┘                          └─────────────┘
       │                                  │                                      │
       ▼                                  ▼                                      ▼
 feasibility-study.md                design.md                              pseudocode.md

       │                                  │                                      │
       │ /velpari-approve                 │ /velpari-approve                     │ /velpari-approve
       ▼                                  ▼                                      ▼

                                                ┌─────────────┐
                                                │  testplan   │
                                                │  (verify)   │
                                                └─────────────┘
                                                       │
                                                       ▼
                                              test-plan.md
                                              test-cases.md

                                                       │
                                                       │ /velpari-approve
                                                       ▼

                                                ┌─────────────┐
                                                │ planned-tests│
                                                └─────────────┘
                                                       │
                ┌──────────────────────────────────────┼──────────────────────────────────────┐
                │                                      │                                      │
                ▼                                      ▼                                      ▼

   ┌────────────────────────┐            ┌────────────────────────┐         ┌──────────────────┐
   │  atomic-function       │            │  development-order      │         │   handoff-ready  │
   │  (4 scout agents       │            │  (4 scout agents        │         │  (Senai bridge)  │
   │   + suggestion picker) │            │   + suggestion picker)  │         │                  │
   └────────────────────────┘            └────────────────────────┘         └──────────────────┘
                │                                      │                              │
                ▼                                      ▼                              │
       atomic-functions.md                    development-order.md                    │
                                                                                      │
                                                                                      ▼
                                                                        .pi/senai/architect-inputs.json
                                                                                  (atomic-functions and
                                                                                   development-order included
                                                                                   if their docs exist)
```

Each core stage produces one (or two, for testplan) published artifact. `/velpari-approve` is the only transition for the core 7 stages. The two post-pipeline stages (atomic-function, development-order) are **optional** — they can be invoked in either order, or skipped entirely. Both use a **scout-agent + suggestion picker** pattern: 4 parallel agents propose content, the user reviews and accepts/modifies/rejects each suggestion in a unified picker UI, and only accepted entries are written to the published doc.

---

## 2. Stages and transitions

The full state machine has 19 states (per `constants.ts:STAGE_TRANSITIONS`):

| Current stage | Allowed next | Trigger |
|---|---|---|
| `none` | `discussing` | `/velpari-discuss <mission>` (creates new run) |
| `discussing` | `discussed` | `/velpari-approve` (after discussion working copy is confirmed) |
| `discussed` | `drafting-prd` | `/velpari-prd` |
| `drafting-prd` | `drafted-prd` | `/velpari-approve` |
| `drafted-prd` | `building-rtm` | `/velpari-rtm` |
| `building-rtm` | `built-rtm` | `/velpari-approve` |
| `built-rtm` | `analyzing-feasibility` | `/velpari-feasibility` |
| `analyzing-feasibility` | `analyzed-feasibility` | `/velpari-approve` |
| `analyzed-feasibility` | `designing` | `/velpari-design` |
| `designing` | `designed` | `/velpari-approve` |
| `designed` | `writing-pseudocode` | `/velpari-pseudocode` |
| `writing-pseudocode` | `wrote-pseudocode` | `/velpari-approve` |
| `wrote-pseudocode` | `planning-tests` | `/velpari-testplan` |
| `planning-tests` | `planned-tests` | `/velpari-approve` |
| `planned-tests` | `proposing-atomic-functions` | `/velpari-atomic-function` (optional — first post-pipeline stage) |
| `planned-tests` | `proposing-development-order` | `/velpari-development-order` (optional — can skip atomic-functions) |
| `planned-tests` | `handoff-ready` | `/velpari-handoff` (skip both optional stages) |
| `proposing-atomic-functions` | `atomic-functions-proposed` | `/velpari-approve` (after user accepts scout suggestions) |
| `atomic-functions-proposed` | `proposing-development-order` | `/velpari-development-order` (next stage) |
| `atomic-functions-proposed` | `handoff-ready` | `/velpari-handoff` (skip development-order) |
| `proposing-development-order` | `development-order-proposed` | `/velpari-approve` (after user accepts order) |
| `development-order-proposed` | `handoff-ready` | `/velpari-handoff` |
| `handoff-ready` | — (terminal) | — |

The two halves of each core-stage pair are:

- **Starting** (`drafting-prd`, `building-rtm`, …): the user has invoked the next stage command.
- **Approved** (`drafted-prd`, `built-rtm`, …): the working copy is confirmed and ready to publish.

`/velpari-approve` is the only thing that moves from approved to the next starting state.

The two post-pipeline stages are **independent**: each can be skipped or invoked in any order. After both have been run (or both skipped), `/velpari-handoff` is the next step. The handoff reads whatever artifacts exist in `Doc/` and packages them into `.pi/senai/architect-inputs.json`.

---

## 3. Working-copy + published-copy model

Every stage produces two copies of its artifact:

- **Working copy** — `.IDE_Plans/velpari/runs/<run-id>/<stage>/<artifact>`. Editable. Discardable. The stage module writes here freely.
- **Published copy** — `Doc/<artifact>`. Read-only by convention. The artifact of record. Only `/velpari-approve` writes here.

```
┌──────────────────────────┐       /velpari-approve        ┌─────────────┐
│ .IDE_Plans/velpari/runs/ │ ─────────────────────────────▶│    Doc/     │
│   <run-id>/<stage>/      │       copyFileSync             │ <artifact>  │
│   <artifact>             │                                └─────────────┘
└──────────────────────────┘
   (working copy)                                          (published copy)
```

Why two copies?

1. **Iteration is safe.** The user can re-run a stage and overwrite the working copy without touching the published artifact. Each `/velpari-discuss` re-run rewrites only the working copy.
2. **Approval is explicit.** The transition from working to published is the user's explicit action (`/velpari-approve`). There's no implicit "save" anywhere in the pipeline.
3. **Reset is clean.** `/velpari-reset` deletes the entire run directory (working copies + state). The published `Doc/` files are preserved unless the user explicitly deletes them — they're independent.
4. **The handoff reads only `Doc/`.** `/velpari-handoff` packages the published artifacts into `.pi/senai/architect-inputs.json`. Working copies are not exposed to the downstream tool.

---

## 4. Approval-gate discipline

Velpari enforces a single rule at every stage boundary:

> **No artifact reaches `Doc/` without an explicit `/velpari-approve`.**

This is enforced by code, not policy:

- `state.ts:publishToDoc()` is only called from `commands.ts:handleApprove()`.
- Stage modules write to working copies only; they have no path to `Doc/`.
- The UI flow is: stage command produces working copy → user sees preview → user runs `/velpari-approve` → working copy is copied to `Doc/`.

Manual override is not supported. The transition table in `constants.ts` is the only source of allowed transitions.

---

## 5. Artifact layout

```
.IDE_Plans/velpari/
├── state.json                              (single source of truth for current run)
├── doctor-report.md                        (latest /velpari-doctor output)
└── runs/
    └── YYYY-MM-DD-HH-MM-<mission-slug>/
        ├── discuss/discussion-notes.md     (working copy)
        ├── prd/PRD_Pi-Velpari.md           (working copy)
        ├── rtm/RTM_Pi-Velpari.md           (working copy)
        ├── feasibility/feasibility-study.md (working copy)
        ├── design/design.md                (working copy)
        ├── pseudocode/pseudocode.md        (working copy)
        ├── testplan/
        │   ├── test-plan.md                (working copy)
        │   └── test-cases.md               (working copy)
        ├── atomic-function/atomic-functions.md  (working copy; optional stage)
        └── development-order/development-order.md (working copy; optional stage)

Doc/                                       (published copies, written only by /velpari-approve or /velpari-atomic-function/-development-order)
├── discussion-notes.md
├── PRD_Pi-Velpari.md
├── RTM_Pi-Velpari.md
├── feasibility-study.md
├── design.md
├── pseudocode.md
├── test-plan.md
├── test-cases.md
├── atomic-functions.md                     (only if /velpari-atomic-function was run)
└── development-order.md                    (only if /velpari-development-order was run)

.pi/velpari/files.json                     (output of /velpari-configure-inputs)

.pi/senai/architect-inputs.json             (output of /velpari-handoff; includes atomic-functions.md and development-order.md if they exist)
```

---

## 6. Command surface (22 commands)

### Stage commands (9)

1. `/velpari-discuss <mission>` — interactive interview with 4-agent scout pattern; entry point.
2. `/velpari-prd` — convert discussion → PRD (full rewrite; usually not needed since discussion auto-updates the PRD).
3. `/velpari-rtm` — derive RTM from PRD.
4. `/velpari-feasibility` — analyze feasibility.
5. `/velpari-design` — produce design doc.
6. `/velpari-pseudocode` — produce pseudocode.
7. `/velpari-testplan` — produce test plan + test cases.
8. `/velpari-atomic-function` — **optional post-pipeline stage**. 4 scout agents propose atomic functions; user reviews suggestions in a picker; output `Doc/atomic-functions.md`.
9. `/velpari-development-order` — **optional post-pipeline stage**. 4 scout agents propose implementation order; user reviews and reorders; output `Doc/development-order.md`.

### Discipline commands (6)

10. `/velpari-approve` — publish working copy to `Doc/`, advance state.
11. `/velpari-status` — show current run state.
12. `/velpari-reset` — discard current run.
13. `/velpari-configure-inputs` — set input documents and output paths.
14. `/velpari-doctor` — audit setup.
15. `/velpari-handoff` — bridge to Senai.

### View commands (7)

16–22. `/velpari-show-{discussion,prd,rtm,feasibility,design,pseudocode,testplan}` — print published artifact.

---

## 7. Parallels with Senai

Velpari is the upstream half of the same pipeline Senai operates on:

| Concern | Velpari | Senai |
|---|---|---|
| Stage gating | `/velpari-approve` | `/senai-approve` |
| State file | `.IDE_Plans/velpari/state.json` | `.IDE_Plans/senai/state.json` |
| Run id format | `YYYY-MM-DD-HH-MM-<slug>` | `YYYY-MM-DD-HH-MM-<slug>` |
| Run directory | `.IDE_Plans/velpari/runs/<id>/` | `.IDE_Plans/senai/runs/<id>/` |
| Doctor | `/velpari-doctor` | `/senai-doctor` |
| Configure | `/velpari-configure-inputs` | `/senai-configure-files`, `/senai-configure-architect-inputs` |
| Handoff target | `.pi/senai/architect-inputs.json` | reads from `.pi/senai/architect-inputs.json` |
| Architecture factory | (not applicable) | `/senai-generate-architect` |
| Sub-agents | 12 scout agents total (4 in `discuss`, 4 in `atomic-function`, 4 in `development-order`) | generated by `/senai-generate-sub-agents` |
| Scout pattern | 4-agent parallel scout + suggestion picker for atomic-function and development-order | 4-scout pattern in plan stage |
| Atomic functions | `Doc/atomic-functions.md` produced by `/velpari-atomic-function` | (consumed downstream) |
| Development order | `Doc/development-order.md` produced by `/velpari-development-order` | (consumed downstream) |

The discipline model is identical: state-gated runs, working/published copy separation, doctor audit, single-source-of-truth state file. The scout pattern (4 parallel agents + user-driven suggestion review) is shared between Velpari's post-pipeline stages and Senai's plan stage — same mental model, same UI affordance, same trace-back rigor.

The only difference is scope: Velpari produces requirements, design, and implementation planning; Senai executes against them.

---

## 8. The handoff bridge

`/velpari-handoff` is the moment Velpari's job ends and Senai's begins. The bridge is one file:

```
.pi/senai/architect-inputs.json
```

Shape (Senai-compatible, v1.3):

```json
{
  "version": 1,
  "projectName": "<mission-slug>",
  "documents": [
    { "path": "Doc/PRD_Pi-Velpari.md",     "type": "PRD" },
    { "path": "Doc/RTM_Pi-Velpari.md",     "type": "RTM" },
    { "path": "Doc/feasibility-study.md",  "type": "Feasibility" },
    { "path": "Doc/design.md",             "type": "Design" },
    { "path": "Doc/pseudocode.md",         "type": "Pseudocode" },
    { "path": "Doc/test-plan.md",          "type": "Test Plan" },
    { "path": "Doc/test-cases.md",         "type": "Test Cases" },
    { "path": "Doc/atomic-functions.md",   "type": "Atomic Functions" },
    { "path": "Doc/development-order.md",  "type": "Development Order" }
  ],
  "constraints": []
}
```

`atomic-functions.md` and `development-order.md` are included in the handoff **only if the files exist** in `Doc/`. If the user skipped `/velpari-atomic-function` or `/velpari-development-order`, those entries are omitted and the handoff still works — those stages are optional. The handoff test reads Senai's `architect-inputs-config.ts` at test time to confirm both the field shape and the document-type strings are accepted; if Senai does not yet recognize a new document type, the handoff logs a warning but still includes the file.

Senai's `/senai-configure-architect-inputs` and `/senai-generate-architect` consume the handoff file as-is.

---

## 9. End-to-end example

Mission: *"Build a CLI that lists TODOs from a markdown file."*

**Core pipeline (required):**

1. `/velpari-configure-inputs` → set `Doc/` as output dir; nothing to read.
2. `/velpari-discuss "Build a CLI that lists TODOs from a markdown file"` → 4-agent discussion: NEW EXTRACTOR captures user input; PRD CHECKER reads existing PRD (empty on first run); RTM CHECKER reads existing RTM (empty on first run); DECISION AGENT merges and decides — for the first run, all input is "new FR-N". Preview shows proposed additions; user confirms. Working copy at `.IDE_Plans/velpari/runs/.../discuss/discussion-notes.md`.
3. `/velpari-approve` → `Doc/discussion-notes.md` published; **DECISION AGENT verdict auto-applied** to `Doc/PRD_Pi-Velpari.md` (new FR-Ns added).
4. `/velpari-rtm` → produces `Doc/RTM_Pi-Velpari.md` (after preview + confirm).
5. `/velpari-approve` → published.
6. `/velpari-feasibility` → produces `Doc/feasibility-study.md` (Go — small CLI, no unknowns).
7. `/velpari-approve` → published.
8. `/velpari-design` → produces `Doc/design.md` (modules: parser, formatter, CLI entry).
9. `/velpari-approve` → published.
10. `/velpari-pseudocode` → produces `Doc/pseudocode.md`.
11. `/velpari-approve` → published.
12. `/velpari-testplan` → produces `Doc/test-plan.md` and `Doc/test-cases.md`.
13. `/velpari-approve` → published.

**Optional post-pipeline stages (recommended):**

14. `/velpari-atomic-function` → 4 scout agents read all completed docs:
    - AF-SCOUT-1 reads RTM's helper functions, suggests splitting `validateTodoLine` into `parseStatusTag` + `parsePriorityTag`.
    - AF-SCOUT-2 reads pseudocode, finds the repeated `if (!line.startsWith('- [')) return null` pattern across modules, suggests `isTodoLine(line)` as an atomic function.
    - AF-SCOUT-3 reads PRD requirements, suggests `formatDate(iso)` for FR-N "include date in output".
    - AF-SCOUT-4 reads test cases, suggests `makeFakeTodoLine(...)` for test setup.
    - Suggestion picker shows all 4 proposals. User accepts 3, rejects 1.
    - On accept, `Doc/atomic-functions.md` is written with the 3 accepted entries (`AF-01`, `AF-02`, `AF-03`).
    - `/velpari-approve` advances state.

15. `/velpari-development-order` → 4 scout agents read all completed docs:
    - DO-SCOUT-1 (dependency sort): parse → format → CLI entry → filter.
    - DO-SCOUT-2 (risk priority): CLI entry first (most surface area), parse second.
    - DO-SCOUT-3 (test priority): parse → format → filter (testable in order).
    - DO-SCOUT-4 (user value): CLI entry → filter → format → parse (visible value first).
    - Merged proposal shown to user. User reorders slightly: CLI entry → parse → format → filter.
    - `Doc/development-order.md` is written.
    - `/velpari-approve` advances state.

16. `/velpari-handoff` → `.pi/senai/architect-inputs.json` is written with all 9 documents (including atomic-functions.md and development-order.md).

17. Switch to Senai: `/senai-configure-architect-inputs` picks up the handoff, then `/senai-generate-architect` produces the architecture agents and skills. Senai now has a clear implementation order from `development-order.md` and an atomic-function catalog from `atomic-functions.md`.

18. `/senai-plan "Implement TODO CLI"` → Senai runs the production phase.

End-to-end, Velpari produces 11 published artifacts (`Doc/` + `architect-inputs.json`). Each one traces back through the RTM to a discussion note or earlier approved artifact. The atomic functions are referenced by helper functions; the development order guides Senai's planner.

---

## 10. The scout pattern (post-pipeline stages)

The two post-pipeline stages (`/velpari-atomic-function` and `/velpari-development-order`) use a **scout pattern** that mirrors Senai's plan stage. The pattern has four moving parts:

```
   ┌──────────────────────────────────────────────────────────────┐
   │ 4 scout agents (run in parallel)                             │
   │                                                              │
   │  Scout 1  ──┐                                                │
   │  Scout 2  ──┼──►  suggestion list  ──►  picker UI  ──►  user │
   │  Scout 3  ──┤                              │                 │
   │  Scout 4  ──┘                              │                 │
   │                                             ▼                 │
   │                                    accepted suggestions       │
   │                                             │                 │
   │                                             ▼                 │
   │                                    published artifact        │
   └──────────────────────────────────────────────────────────────┘
```

Each scout is a focused LLM call that reads a specific subset of the completed docs and proposes content from a specific angle. The proposals are deduplicated (same idea from multiple scouts is merged). The user reviews every proposal in a unified picker UI (`simple-picker` reuse from Senai), accepts/modifies/rejects each, and only accepted entries land in the published doc.

### 10.1 Atomic-function scouts

| Scout | Reads | Proposes |
|---|---|---|
| **AF-SCOUT-1 (Helper splitter)** | RTM's `## Helper Functions` section | Atomic functions extracted by splitting larger helpers into smaller ones |
| **AF-SCOUT-2 (Duplicate pattern finder)** | `Doc/pseudocode.md` | Atomic functions for repeated logic patterns across modules |
| **AF-SCOUT-3 (Requirement helper)** | `Doc/PRD_Pi-Velpari.md` Functional Requirements | Atomic functions called by specific FR-Ns |
| **AF-SCOUT-4 (Test helper)** | `Doc/test-cases.md` | Atomic functions used as test setup/teardown helpers |

### 10.2 Development-order scouts

| Scout | Reads | Proposes |
|---|---|---|
| **DO-SCOUT-1 (Dependency sort)** | RTM dependencies + design module graph | Topologically sorted implementation order |
| **DO-SCOUT-2 (Risk priority)** | `Doc/feasibility-study.md` + design | Order that tackles high-risk items first |
| **DO-SCOUT-3 (Test priority)** | `Doc/test-plan.md` | Order that enables test coverage to grow incrementally |
| **DO-SCOUT-4 (User value)** | PRD Functional Requirements + NFRs | Order that delivers user-visible value first |

The final order is a weighted merge of the 4 scout rankings, with the user resolving any conflicts.

### 10.3 Helper ↔ atomic function relationship

Atomic functions are smaller than helper functions and do not call other atomic functions (strictly leaf nodes). Helper functions may call atomic functions; the dependency is recorded bidirectionally:

```
   HF-NN (helper) ──── calls atomic ────► AF-NN (atomic)
        ▲                                      │
        └────────── called by helper ──────────┘
```

Both lists are kept in `Doc/`: helper functions live in `Doc/PRD_Pi-Velpari.md` (under `## Helper Functions`), atomic functions live in `Doc/atomic-functions.md`. The dependency `helper → atomic` is recorded in both places.

---

## 11. Why this design

The pre-production phase has different failure modes than the production phase:

- **In production, the cost of a wrong requirement is hours of rework.**
- **In pre-production, the cost of a wrong requirement is the entire feature being built wrong.**

Velpari's discipline model — interactive interviews, trace-back to user statements, explicit approval gates, published vs working copies — exists to surface requirement issues *before* any code is written. The 9-stage structure (7 required + 2 optional post-pipeline) mirrors what experienced engineers do informally: capture intent, formalize it, trace it, evaluate feasibility, design, sketch logic, plan tests, decompose into atomic units, sequence the work. Velpari makes that workflow explicit and reproducible.

The post-pipeline stages (`/velpari-atomic-function` and `/velpari-development-order`) use the scout pattern because the LLM is well-suited to **proposing** candidate decompositions and orderings, but a human is required to **accept** them. The scout + picker pattern lets the user stay in control while still benefiting from LLM-driven proposal generation. The pattern is the same one Senai uses in its plan stage — same mental model, same UI affordance, same trace-back rigor.

The bridge to Senai is a one-file handoff because Senai's architecture factory needs the inputs in a fixed shape. By keeping that shape stable (read from Senai's source at test time), Velpari remains compatible across Senai versions as long as both extensions live in the same monorepo and are updated together. Optional artifacts (`atomic-functions.md`, `development-order.md`) are included in the handoff when they exist, falling back gracefully when they don't.
