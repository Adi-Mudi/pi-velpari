# Pi-Velpari Sequence

A reference for how Pi-Velpari orchestrates the pre-production phase. Parallels `Pi-Orchestra_v4/Doc/senai-sequence.md` so users learn one mental model and apply it across both extensions.

> **v2.0 Update (2026-09-04):** The "4 scout agents + suggestion picker" pattern described below has been **replaced** by the visible-subagent pattern. All 9 stages (discuss, prd, rtm, feasibility, design, pseudocode, testplan, atomic-function, development-order) now spawn 4 real subagents via the `subagent()` tool from `@earendil-works/pi-interactive-subagents` in visible multiplexer panes. The handler hands off to the parent LLM via `pi.sendUserMessage(prompt)`; the parent LLM does the spawning. The picker UI described in the original spec is replaced by a preview gate via `AskUserQuestion`. The 12-scout count below is now 36 (9 stages × 4). See `AGENTS.md` principle #4 for the current mental model.

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

### 1a. Pre-pipeline setup: `/velpari-configure-requirements` (optional, recommended)

Profile selection is a **separate one-time setup step**, not a pipeline stage. It runs before `/velpari-discuss` and produces `.pi/velpari/requirements-profile.json`:

1. Handler asks core questions via `ctx.ui.input(title, placeholder)` and fixed choices via `ctx.ui.select(title, options)`.
2. Web-research consent is collected via `ctx.ui.confirm` immediately after the answers — **before** any recommendations are produced.
3. Research handoff (when consent=yes) is sent through `pi.sendUserMessage` and explicitly says **profile selection is pending** + **MUST NOT save or write a profile** + never includes a final selected profile id.
4. Handler computes deterministic `ProfileRecommendation[]`: the **common PSRS core** (`core-psrs-v1`, always present, a real choice) plus up to two closest built-in profiles, each with a 0–100 score, reasons, and trade-offs.
5. User picks via `ctx.ui.select`, then confirms save via `ctx.ui.confirm`. The profile JSON is written.
6. If no exact built-in matches, fallback actions (`Use common PSRS core` / `Use closest built-in profile` / `Update Velpari` / `Stop`) are surfaced via `ctx.ui.select`. The common core and closest built-in are real choices; no fake custom-profile action exists.

Doctor (`/velpari-doctor`) reports the active profile mode, id, version (with expected-comparison), research consent + source count, and the report-only stance; it never selects, fixes, or mutates a profile.

---

## 2. Stages and transitions

The full state machine has 19 states (per `constants.ts:STAGE_TRANSITIONS`):

| Current stage | Allowed next | Trigger |
|---|---|---|
| `none` | `discussing` | `/velpari-discuss <mission>` (creates new run) |
| `discussing` | `discussed` | `/velpari-approve-discuss` (publishes discussion, then **auto-invokes `/velpari-prd`**) |
| `discussed` | `drafting-prd` | `/velpari-prd` (auto-invoked by `/velpari-approve-discuss`) |
| `drafting-prd` | `drafted-prd` | `/velpari-prd` (preview/confirm gate; publishes PRD) |
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
        ├── discuss/discussion-{topic-slug}.md      (working copy)
        ├── discuss/discussion-{topic-slug}-{timestamp}.md  (working copy; subsequent runs)
        ├── prd/PRD_{projectName}.md                (working copy)
        ├── rtm/RTM_{projectName}.md                (working copy)
        ├── feasibility/feasibility-study_{projectName}.md (working copy)
        ├── design/design_{projectName}.md          (working copy)
        ├── pseudocode/pseudocode_{projectName}.md  (working copy)
        ├── testplan/
        │   ├── test-plan_{projectName}.md          (working copy)
        │   └── test-cases_{projectName}.md         (working copy)
        ├── atomic-function/atomic-functions_{projectName}.md  (working copy; optional stage)
        └── development-order/development-order_{projectName}.md (working copy; optional stage)

Doc/                                       (published copies, written only by /velpari-approve or /velpari-atomic-function/-development-order)
├── discussion-{topic-slug}.md                              (or with timestamp suffix if multiple)
├── PRD_{projectName}.md
├── RTM_{projectName}.md
├── feasibility-study_{projectName}.md
├── design_{projectName}.md
├── pseudocode_{projectName}.md
├── test-plan_{projectName}.md
├── test-cases_{projectName}.md
├── atomic-functions_{projectName}.md                      (only if /velpari-atomic-function was run)
└── development-order_{projectName}.md                     (only if /velpari-development-order was run)

.pi/velpari/files.json                     (output of /velpari-configure-inputs; includes projectName and framework)

.pi/senai/architect-inputs.json             (output of /velpari-handoff; document paths reference project-suffixed files)
```

**Naming rules (v1.7):** Output files use the `projectName` captured in `/velpari-configure-inputs`. The previous hardcoded "Pi-Velpari" prefix is replaced by the user's project name (e.g., `Doc/PRD_TodoApp.md` instead of `Doc/PRD_Pi-Velpari.md`). Discussion files are per-topic: `Doc/discussion-{topic-slug}.md` for the first discussion of a topic; subsequent runs of the same topic append a timestamp suffix.

---

## 6. Command surface (23 commands)

### Stage commands (9)

1. `/velpari-discuss <mission>` — interactive interview with 4-agent pattern (3 always + 1 user-prompted web search); entry point. Iterative — can run multiple times.
2. `/velpari-prd` — convert approved discussion notes → PRD. Triggered automatically by `/velpari-approve-discuss`. Can also be invoked manually for full rewrite.
3. `/velpari-rtm` — derive RTM from approved PRD.
4. `/velpari-feasibility` — analyze feasibility.
5. `/velpari-design` — produce design doc.
6. `/velpari-pseudocode` — produce pseudocode.
7. `/velpari-testplan` — produce test plan + test cases.
8. `/velpari-atomic-function` — **optional post-pipeline stage**. 4 scout agents propose atomic functions; user reviews suggestions in picker; output `Doc/atomic-functions.md`.
9. `/velpari-development-order` — **optional post-pipeline stage**. 4 scout agents propose implementation order; user reorders in picker; output `Doc/development-order.md`.

### Discipline commands (7, was 6)

10. `/velpari-approve-discuss` (NEW in v1.6) — publishes `Doc/discussion-notes.md`, then **auto-invokes `/velpari-prd`**. Chains through `discussing → drafted-prd`. The dedicated discussion-approve command (separate from `/velpari-approve`).
11. `/velpari-approve` — publish working copy to `Doc/`, advance state. Used for stages 2–7 (after `/velpari-approve-discuss` completes).
12. `/velpari-status` — show current run state.
13. `/velpari-reset` — discard current run.
14. `/velpari-configure-inputs` — set input documents, output paths, **and framework/tech-stack** (v1.5). One-time setup. Writes `.pi/velpari/files.json`.
15. `/velpari-doctor` — audit setup.
16. `/velpari-handoff` — bridge to Senai.

### View commands (7)

17–23. `/velpari-show-{discussion,prd,rtm,feasibility,design,pseudocode,testplan}` — print published artifact.

Total: 23 commands. Each command's **doc scope** (which `Doc/` artifacts it reads) and **gate** (prerequisite check) is documented in §11 below.

### Approval command selection (v1.6)

- **Discussion stage** (`discussing`): use `/velpari-approve-discuss`, NOT `/velpari-approve`. This publishes discussion and auto-triggers PRD.
- **All other core stages** (`drafting-prd`, `building-rtm`, etc.): use `/velpari-approve`. Auto-advances through the chain.
- The UI hint reflects the current stage. If you run `/velpari-approve` while in `discussed` state, it errors with: "Use `/velpari-approve-discuss` for the discussion stage."

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

Shape (Senai-compatible, v1.7):

```json
{
  "version": 1,
  "projectName": "<project-name>",
  "documents": [
    { "path": "Doc/PRD_{projectName}.md",                     "type": "PRD" },
    { "path": "Doc/RTM_{projectName}.md",                     "type": "RTM" },
    { "path": "Doc/feasibility-study_{projectName}.md",       "type": "Feasibility" },
    { "path": "Doc/design_{projectName}.md",                 "type": "Design" },
    { "path": "Doc/pseudocode_{projectName}.md",             "type": "Pseudocode" },
    { "path": "Doc/test-plan_{projectName}.md",              "type": "Test Plan" },
    { "path": "Doc/test-cases_{projectName}.md",             "type": "Test Cases" },
    { "path": "Doc/atomic-functions_{projectName}.md",        "type": "Atomic Functions" },
    { "path": "Doc/development-order_{projectName}.md",       "type": "Development Order" }
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

1. `/velpari-configure-inputs` → set `projectName` ("TodoApp" in this example), framework, language, libraries, runtime, output paths. One-time setup.
2. `/velpari-discuss "Build a CLI that lists TODOs from a markdown file"` → topic-slug is "build-a-cli-that-lists-todos-from-a-markdown-file". Multi-turn interview; then 4-agent discussion: NEW EXTRACTOR captures user input; PRD CHECKER reads existing PRD (empty on first run); RTM CHECKER reads existing RTM (empty on first run); **WEB SEARCH AGENT** (user-prompted, default off) collects community resources, official docs, similar projects. Main handler merges all proposals and classifies each statement as new FR / update / helper function update / new helper. Preview shows proposed additions; user confirms. Working copy at `.IDE_Plans/velpari/runs/.../discuss/discussion-build-a-cli-that-lists-todos-from-a-markdown-file.md`.
3. `/velpari-approve-discuss` → `Doc/discussion-build-a-cli-that-lists-todos-from-a-markdown-file.md` published; **auto-invokes `/velpari-prd`**.
4. `/velpari-prd` (auto-invoked) → produces `Doc/PRD_TodoApp.md` (after preview + confirm).
5. `/velpari-approve` → published.
6. `/velpari-rtm` → produces `Doc/RTM_TodoApp.md` (after preview + confirm).
7. `/velpari-approve` → published.
8. `/velpari-feasibility` → produces `Doc/feasibility-study_TodoApp.md` (Go — small CLI, no unknowns).
9. `/velpari-approve` → published.
10. `/velpari-design` → produces `Doc/design_TodoApp.md` (modules: parser, formatter, CLI entry).
11. `/velpari-approve` → published.
12. `/velpari-pseudocode` → produces `Doc/pseudocode_TodoApp.md`.
13. `/velpari-approve` → published.
14. `/velpari-testplan` → produces `Doc/test-plan_TodoApp.md` and `Doc/test-cases_TodoApp.md`.
15. `/velpari-approve` → published.

**Optional post-pipeline stages (recommended):**

16. `/velpari-atomic-function` → 4 scout agents read all completed docs:
    - AF-SCOUT-1 reads RTM's helper functions, suggests splitting `validateTodoLine` into `parseStatusTag` + `parsePriorityTag`.
    - AF-SCOUT-2 reads pseudocode, finds the repeated `if (!line.startsWith('- [')) return null` pattern across modules, suggests `isTodoLine(line)` as an atomic function.
    - AF-SCOUT-3 reads PRD requirements, suggests `formatDate(iso)` for FR-N "include date in output".
    - AF-SCOUT-4 reads test cases, suggests `makeFakeTodoLine(...)` for test setup.
    - Suggestion picker shows all 4 proposals. User accepts 3, rejects 1.
    - On accept, `Doc/atomic-functions_TodoApp.md` is written with the 3 accepted entries (`AF-01`, `AF-02`, `AF-03`).
    - `/velpari-approve` advances state.

17. `/velpari-development-order` → 4 scout agents read all completed docs:
    - DO-SCOUT-1 (dependency sort): parse → format → CLI entry → filter.
    - DO-SCOUT-2 (risk priority): CLI entry first (most surface area), parse second.
    - DO-SCOUT-3 (test priority): parse → format → filter (testable in order).
    - DO-SCOUT-4 (user value): CLI entry → filter → format → parse (visible value first).
    - Merged proposal shown to user. User reorders slightly: CLI entry → parse → format → filter.
    - `Doc/development-order_TodoApp.md` is written.
    - `/velpari-approve` advances state.

18. `/velpari-handoff` → `.pi/senai/architect-inputs.json` is written with all 9 documents (with project-suffixed paths).

19. Switch to Senai: `/senai-configure-architect-inputs` picks up the handoff, then `/senai-generate-architect` produces the architecture agents and skills. Senai now has a clear implementation order from `development-order_TodoApp.md` and an atomic-function catalog from `atomic-functions_TodoApp.md`.

20. `/senai-plan "Implement TODO CLI"` → Senai runs the production phase.

End-to-end, Velpari produces 11 published artifacts (`Doc/` + `architect-inputs.json`), all suffixed with the project name "TodoApp". Each one traces back through the RTM to a discussion note or earlier approved artifact. The atomic functions are referenced by helper functions; the development order guides Senai's planner.

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

### 10.4 Discussion scouts (v1.5)

The discussion stage (`/velpari-discuss`) uses 4 scout agents:

| Scout | Always runs? | Reads | Proposes |
|---|---|---|---|
| **NEW EXTRACTOR** | Yes | User Q&A | Raw user input normalized into statements |
| **PRD CHECKER** | Yes | Existing `Doc/PRD_Pi-Velpari.md` (if any) | Related FR-Ns already in the PRD |
| **RTM CHECKER** | Yes | Existing `Doc/RTM_Pi-Velpari.md` (if any) | Related helper functions and TCs already in the RTM |
| **WEB SEARCH AGENT** | **No — user-prompted** | User input as search query | Community resources, official documentation, similar OSS projects |

After all scouts complete, the **main discussion handler** performs the DECISION AGENT logic as deterministic post-processing:

1. Merge proposals from all scouts.
2. For each user statement, classify as one of:
   - **new FR-N** — entirely new requirement.
   - **update existing FR-N** — modifies an existing PRD entry.
   - **helper function update** — modifies an existing helper function entry.
   - **new helper function** — adds a new helper function entry.
3. Dedup helper functions by `name + file path` (case-insensitive, forward slashes).
4. Render verdict for user preview.

#### Web search activation

After the user finishes the multi-turn interview and says "no more points", the discussion handler asks:

> "Do you want me to search the web for community resources, official documentation, and similar projects related to your input? This adds ~15 seconds and uses ~1 LLM call. (yes/no)"

If **yes**: WEB SEARCH AGENT runs in parallel with the other 3 scouts. If **no**: skipped. Web search results appear in the preview alongside the verdict.

#### Why DECISION AGENT is no longer a subagent

The DECISION AGENT's logic (merge + classify + dedup) is deterministic post-processing. It does not benefit from a separate LLM call — it can run in the main handler. This frees the 4th agent slot for WEB SEARCH AGENT, which adds genuine value (community context).

#### Why web search is optional

Web search adds latency (~15s) and tokens (~1 LLM call). For small projects, it's not worth it. For projects with non-trivial tech-stack choices or unfamiliar domains, it provides valuable context. The user chooses per-discussion whether to invoke it.

---

## 11. Sub-sequence: per-command doc scope and gate (v1.4)

Each stage command declares what it reads and what it writes. Before the command runs, a **gate** check verifies that every required input artifact exists and is non-empty. Failure → clear error message, no LLM call, state unchanged. This is the per-command sub-sequence — the unit of "what each command needs to do its job."

### 11.1 Stage commands

| Command | Reads (gate check) | Writes (working copy) |
|---|---|---|
| `/velpari-discuss` | (none — entry point) | `Doc/discussion-{topic-slug}.md` (after approve; with timestamp suffix if multi-run) |
| `/velpari-prd` | `Doc/discussion-{topic-slug}.md` | `Doc/PRD_{projectName}.md` (after approve) |
| `/velpari-rtm` | `Doc/PRD_{projectName}.md` | `Doc/RTM_{projectName}.md` (after approve) |
| `/velpari-feasibility` | `Doc/PRD_{projectName}.md`, `Doc/RTM_{projectName}.md` | `Doc/feasibility-study_{projectName}.md` (after approve) |
| `/velpari-design` | `Doc/PRD_{projectName}.md`, `Doc/RTM_{projectName}.md` | `Doc/design_{projectName}.md` (after approve) |
| `/velpari-pseudocode` | `Doc/PRD_{projectName}.md`, `Doc/RTM_{projectName}.md`, `Doc/design_{projectName}.md` | `Doc/pseudocode_{projectName}.md` (after approve) |
| `/velpari-testplan` | `Doc/PRD_{projectName}.md`, `Doc/RTM_{projectName}.md`, `Doc/design_{projectName}.md`, `Doc/pseudocode_{projectName}.md` | `Doc/test-plan_{projectName}.md`, `Doc/test-cases_{projectName}.md` (after approve) |
| `/velpari-atomic-function` *(optional)* | all 6 core artifacts (suffixed) | `Doc/atomic-functions_{projectName}.md` (after approve) |
| `/velpari-development-order` *(optional)* | all 6 core artifacts (suffixed) | `Doc/development-order_{projectName}.md` (after approve) |
| `/velpari-handoff` | all published `Doc/*` artifacts | `.pi/senai/architect-inputs.json` |

**Naming convention (v1.7):** Output files use the `projectName` captured in `/velpari-configure-inputs`. Example for a "TodoApp" project: `Doc/PRD_TodoApp.md`, `Doc/RTM_TodoApp.md`, etc. Discussion is per-topic: `Doc/discussion-{topic-slug}.md`. Subsequent runs of the same topic append a timestamp: `Doc/discussion-{topic-slug}-{YYYYMMDD-HHMMSS}.md`.

### 11.2 Discipline commands (no Doc scope)

| Command | Reads | Notes |
|---|---|---|
| `/velpari-approve` | working copy in run dir | Promotes working copy to `Doc/`. No Doc scope; operates on the run dir. |
| `/velpari-status` | `state.json` | Pure read. |
| `/velpari-reset` | `state.json`, run dir | Destructive. Confirms before deleting. |
| `/velpari-configure-inputs` | project tree | Scans for inputs; writes `.pi/velpari/files.json`. |
| `/velpari-doctor` | `state.json`, run dir, `Doc/` | Reads everything for audit. |

### 11.3 View commands

| Command | Reads (single artifact) |
|---|---|
| `/velpari-show-discussion` | `Doc/discussion-notes.md` |
| `/velpari-show-prd` | `Doc/PRD_Pi-Velpari.md` |
| `/velpari-show-rtm` | `Doc/RTM_Pi-Velpari.md` |
| `/velpari-show-feasibility` | `Doc/feasibility-study.md` |
| `/velpari-show-design` | `Doc/design.md` |
| `/velpari-show-pseudocode` | `Doc/pseudocode.md` |
| `/velpari-show-testplan` | `Doc/test-plan.md`, `Doc/test-cases.md` (concatenated) |

### 11.4 Gate enforcement contract

Every stage command follows this contract:

1. **Gate check (synchronous, no LLM call):** verify every required input artifact exists at the path under `Doc/` and is non-empty. If any is missing, fail with: `"/velpari-<stage> requires Doc/<artifact> to exist and be non-empty. Run <previous stage> first or check /velpari-status."` State unchanged, no working copy written, no LLM call.

2. **Build prompt:** construct the prompt with the verified input artifacts as scope.

3. **Run the command body:** (LLM call, multi-turn interview, scout agents, etc.).

4. **Write working copy:** under `runs/<run-id>/<stage>/<artifact>`.

5. **Preview + confirm:** user reviews the draft.

6. **Mark ready:** state advances to the "ready-to-approve" state. The published copy is written only on `/velpari-approve`.

The gate is enforced at the command-handler level. Each handler in `commands.ts` checks its doc scope before delegating to the stage module. The check is deterministic — no LLM involvement.

### 11.5 Why this matters

Without per-command doc scope and gates:

- A user could run `/velpari-rtm` before `/velpari-prd`, leaving the RTM without a source PRD. The LLM would have nothing to trace. The error would surface mid-generation, wasting tokens and user time.
- A user could run `/velpari-pseudocode` before `/velpari-design`, and the LLM would invent a design on the fly — violating the zero-hallucination rule.
- The "PRD is the source of truth" principle would be advisory, not enforced.

With gates, the contract is enforced by code: a command cannot run without its inputs. The pipeline becomes a true DAG, where each stage's outputs are the next stage's verified inputs.

---

## 12. Why this design

The pre-production phase has different failure modes than the production phase:

- **In production, the cost of a wrong requirement is hours of rework.**
- **In pre-production, the cost of a wrong requirement is the entire feature being built wrong.**

Velpari's discipline model — interactive interviews, trace-back to user statements, explicit approval gates, published vs working copies — exists to surface requirement issues *before* any code is written. The 9-stage structure (7 required + 2 optional post-pipeline) mirrors what experienced engineers do informally: capture intent, formalize it, trace it, evaluate feasibility, design, sketch logic, plan tests, decompose into atomic units, sequence the work. Velpari makes that workflow explicit and reproducible.

The post-pipeline stages (`/velpari-atomic-function` and `/velpari-development-order`) use the scout pattern because the LLM is well-suited to **proposing** candidate decompositions and orderings, but a human is required to **accept** them. The scout + picker pattern lets the user stay in control while still benefiting from LLM-driven proposal generation. The pattern is the same one Senai uses in its plan stage — same mental model, same UI affordance, same trace-back rigor.

The bridge to Senai is a one-file handoff because Senai's architecture factory needs the inputs in a fixed shape. By keeping that shape stable (read from Senai's source at test time), Velpari remains compatible across Senai versions as long as both extensions live in the same monorepo and are updated together. Optional artifacts (`atomic-functions.md`, `development-order.md`) are included in the handoff when they exist, falling back gracefully when they don't.
