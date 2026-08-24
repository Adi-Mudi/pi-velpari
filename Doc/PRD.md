# Pi-Velpari Product Requirements Document (PRD)

- **Project Name:** Pi-Velpari
- **Location:** `/mnt/Just_Do_It/02_Devp_Soft/pi-senai/Pi-Velpari`
- **Commands:** `/velpari-prd`, `/velpari-rtm`, `/velpari-discuss`, `/velpari-feasibility`, `/velpari-design`, `/velpari-pseudocode`, `/velpari-testplan`, `/velpari-approve`, `/velpari-status`, `/velpari-reset`, `/velpari-configure-inputs`, `/velpari-doctor`, `/velpari-handoff`, `/velpari-show-*`
- **Status:** v1.1 — docs-first scope, awaiting implementation (Phase A–E pending)
- **Predecessor doc:** the 32-line v1.0 PRD at this same path is fully superseded by this document
- **Companion docs:** `Doc/RTM_Pi-Velpari.md`, `Doc/feasibility-study.md`, `Doc/design.md`, `Doc/pseudocode.md`, `Doc/test-plan.md`, `Doc/test-cases.md`

---

## 1. Objective

Pi-Velpari is a Pi CLI extension that implements the **pre-production phase** of the software lifecycle as a stage-gated, config-driven pipeline. It mirrors Pi-Senai's discipline model (Plan → Implement → Document → Deliver) for the upstream half of the lifecycle: **Discussion → PRD → RTM → Feasibility → Design → Pseudocode → Test Plan**. Its output is a complete, traceable requirements package that Pi-Senai's `/senai-generate-architect` consumes directly.

Velpari exists so a developer can sit down at Pi, talk through what they want to build, and walk away with a PRD, RTM, feasibility study, design document, pseudocode, and test plan — every one of which traces back to the original discussion notes with no hallucinated content.

---

## 2. Background & Context

### 2.1 Why this exists

The `pi-senai` repository hosts two extensions:

- **`Pi-Orchestra_v4` (pi-senai)** — production-phase orchestration: stage-gated runs that implement, document, and deliver a feature against an approved plan. Reads PRD, RTM, NFRs as architectural drivers.
- **`Pi-Velpari` (velpari)** — pre-production-phase orchestration: interactive interviews and structured documents that produce the inputs the architecture factory consumes.

Together they form a continuous pipeline:

```
/velpari-discuss → /velpari-prd → /velpari-rtm → /velpari-feasibility
                 → /velpari-design → /velpari-pseudocode → /velpari-testplan
                 → /velpari-handoff → /senai-configure-architect-inputs
                 → /senai-generate-architect → /senai-plan → ...
```

### 2.2 Design principles

These are not negotiable. They shape every requirement below.

1. **Zero hallucination.** Every claim in every artifact traces to a user-provided statement in a discussion note or to an earlier approved artifact. The extension never invents requirements, design decisions, or test cases that the user did not provide.
2. **Confirm-then-write.** No file under `Doc/` is written without a user-facing preview and explicit approval. Working copies in `.IDE_Plans/velpari/runs/` are written freely; published copies in `Doc/` are only produced on `/velpari-approve`.
3. **Stage gates are enforced.** A stage cannot start until its dependencies are approved. The state machine in `constants.ts` is the single source of truth.
4. **No subagent spawning.** Velpari is a single-developer tool. It does not spawn subagents; the LLM handles each stage in-line. Subagent orchestration is Senai's job, downstream.
5. **Deterministic, not creative.** File paths, file formats, state JSON shape, stage transitions, and the handoff schema are all fixed by code. Only the artifact contents vary per run.
6. **Mirrors Senai's discipline.** The control surface (approve/status/reset/configure/doctor), state file layout, and run directory pattern are deliberately identical so users learn one mental model and apply it across both extensions.

### 2.3 Upstream dependencies

- **Pi runtime** (`@mariozechner/pi-coding-agent` — peer dependency). Velpari registers commands and the `session_before_compact` hook through Pi's extension API.
- **`pi-interactive-subagents`** is NOT a dependency. Velpari never spawns subagents.
- **`Pi-Orchestra_v4`** is the downstream consumer. `/velpari-handoff` writes `.pi/senai/architect-inputs.json` whose schema must remain compatible with `/senai-configure-architect-inputs` and `/senai-generate-architect`.

---

## 3. User Personas

### 3.1 Solo developer (primary)

A single developer working in Pi who is about to start a non-trivial feature. They want a structured way to capture "what am I actually building?" before any code is written. They value:

- Speed of capture (no over-elaborate process for a small change).
- Traceability (every claim is auditable back to their own words).
- A clean handoff to their production-phase tooling.

### 3.2 Tech lead reviewing a junior's requirements (secondary)

A tech lead who wants to verify that a proposed feature has been thought through — feasibility checked, test cases enumerated, design sketched. They read the `Doc/` artifacts directly, not the run history.

### 3.3 Architect / senior developer (tertiary)

Uses the handoff to Senai to bootstrap the architecture factory. They care that `architect-inputs.json` produced by `/velpari-handoff` is valid and complete enough for `/senai-generate-architect` to consume without manual editing.

---

## 4. Key Features & Requirements

### 4.1 Stage commands (9)

These commands produce or advance the artifacts in the run pipeline. The first 7 form the **core pipeline** (required). The last 2 are **post-pipeline stages** that run after `planned-tests` and before `handoff-ready`; both are optional and can be skipped without breaking handoff.

| ID | Command | Description |
|---|---|---|
| **FR-01** | `/velpari-discuss <topic>` | Interactive multi-turn interview that captures raw user input. Spawns 4 parallel subagents (NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, DECISION AGENT) that read existing PRD/RTM and classify each piece of input as new FR-N, update, helper function update, or new helper. Writes `discussion-notes.md` to the run dir. Preview + confirm gate before publishing to `Doc/discussion-notes.md`. |
| **FR-02** | `/velpari-prd` | Full rewrite of PRD from scratch. **Optional** since v1.2 — the discussion stage's DECISION AGENT auto-updates the PRD on `/velpari-approve`. Use only when the user wants a complete rewrite (e.g., after a major pivot). |
| **FR-03** | `/velpari-rtm` | Derives the Requirements Traceability Matrix from the approved PRD. Asks the user to map each requirement to a design element, helper function (HF-NN), and test case. Writes to run dir, then publishes to `Doc/RTM_Pi-Velpari.md`. |
| **FR-04** | `/velpari-feasibility` | Analyzes feasibility across five dimensions (Technical, Economic, Legal, Operational, Schedule). Produces per-dimension ratings and an overall Go / Conditional Go / No-Go verdict. Publishes to `Doc/feasibility-study.md`. |
| **FR-05** | `/velpari-design` | Produces the high-level design: module breakdown, data model, interface contracts, data flow, non-functional considerations. Every design element must trace back to a PRD FR-N. Publishes to `Doc/design.md`. |
| **FR-06** | `/velpari-pseudocode` | Translates the design into algorithmic pseudocode per module. Each block lists function name, inputs, outputs, preconditions, postconditions, and step-by-step logic. Publishes to `Doc/pseudocode.md`. |
| **FR-07** | `/velpari-testplan` | Produces the test plan and the test cases table. Every test case must trace back to an RTM requirement. Publishes to `Doc/test-plan.md` and `Doc/test-cases.md`. |
| **FR-31** | `/velpari-atomic-function` | **Optional post-pipeline stage.** Spawns 4 parallel scout agents (AF-SCOUT-1 through AF-SCOUT-4) that read all completed `Doc/` artifacts and propose atomic functions (smallest single-purpose units). User reviews suggestions in a picker UI, accepts/modifies/rejects each. Publishes `Doc/atomic-functions.md` only with accepted entries. |
| **FR-32** | `/velpari-development-order` | **Optional post-pipeline stage.** Spawns 4 parallel scout agents (DO-SCOUT-1 through DO-SCOUT-4) that read completed docs and propose implementation order (dependency sort, risk priority, test priority, user value). User reviews and reorders. Publishes `Doc/development-order.md`. |

### 4.2 Discipline commands (6)

These commands manage the run lifecycle. They do not produce artifact content.

| ID | Command | Description |
|---|---|---|
| **FR-08** | `/velpari-approve` | Marks the current stage's working copy as approved, publishes it to `Doc/`, advances the state to the next stage, and (optionally) auto-launches the next stage's prompt. The single approval gate of the system. |
| **FR-09** | `/velpari-status` | Displays the current run state: run id, mission, current stage, list of completed stages with timestamps, paths to working and published artifacts. |
| **FR-10** | `/velpari-reset` | Discards the current run (state.json and the run directory) and prepares the extension for a new run. Asks for confirmation before deletion. |
| **FR-11** | `/velpari-configure-inputs` | Categorizes input documents (existing PRDs, NFRs, stakeholder notes) and output paths for each artifact. Writes `.pi/velpari/files.json`. Deep-scans the project to suggest items. |
| **FR-12** | `/velpari-doctor` | Audits the setup: `.pi/velpari/files.json` validity, output path parents exist, current run state is consistent, every completed stage has a non-empty artifact in both run dir and `Doc/`, handoff target valid when state is `handoff-ready`, secret scan over all artifacts. Saves report to `.IDE_Plans/velpari/doctor-report.md`. |
| **FR-13** | `/velpari-handoff` | Packages all approved `Doc/` artifacts into `.pi/senai/architect-inputs.json` matching Senai's expected schema. Validates the target schema before writing. Updates state to `handoff-ready`. |

### 4.3 View commands (7)

Read-only commands that print the published artifact for each stage. They never modify state or files.

| ID | Command | Description |
|---|---|---|
| **FR-14** | `/velpari-show-discussion` | Prints `Doc/discussion-notes.md`. |
| **FR-15** | `/velpari-show-prd` | Prints `Doc/PRD_Pi-Velpari.md`. |
| **FR-16** | `/velpari-show-rtm` | Prints `Doc/RTM_Pi-Velpari.md`. |
| **FR-17** | `/velpari-show-feasibility` | Prints `Doc/feasibility-study.md`. |
| **FR-18** | `/velpari-show-design` | Prints `Doc/design.md`. |
| **FR-19** | `/velpari-show-pseudocode` | Prints `Doc/pseudocode.md`. |
| **FR-20** | `/velpari-show-testplan` | Prints `Doc/test-plan.md` and `Doc/test-cases.md`. |

### 4.4 Cross-cutting functional requirements

These apply across multiple commands and are the architectural backbone.

| ID | Requirement |
|---|---|
| **FR-21** | **Working-copy + published-copy separation.** Every stage writes its artifact to `.IDE_Plans/velpari/runs/<run-id>/<stage>/` first (working copy). Only `/velpari-approve` copies the working copy to `Doc/` (published copy). Stage commands always read and write the working copy; view commands always read the published copy. The atomic-function and development-order stages follow the same pattern with their own working-copy directories. |
| **FR-22** | **Zero-hallucination rule.** No artifact contains a requirement, design decision, or test case that does not trace back to a user-provided statement in a discussion note or to an earlier approved artifact. Stage prompts enforce this; doctor validates it via cross-reference checks. |
| **FR-23** | **Preview-then-save confirmation gate.** Every stage command renders the proposed artifact text in the UI and asks the user to confirm before any write to `Doc/`. Working-copy writes do not require confirmation (they are intermediate). |
| **FR-24** | **Stage transition enforcement.** Each stage command checks that its prerequisites are in the approved state. The transition table in `constants.ts` is the only allowed source of state changes. Manual override is not supported. |
| **FR-25** | **Run state persistence.** State is persisted to `.IDE_Plans/velpari/state.json` after every operation. The state file is the single source of truth for "where is this run". State shape is versioned. |
| **FR-26** | **Discussion stage uses 4 parallel subagents.** When `/velpari-discuss` runs, it spawns NEW EXTRACTOR (captures user input), PRD CHECKER (reads existing PRD), RTM CHECKER (reads existing RTM), and DECISION AGENT (merges and classifies). The main discussion handler coordinates them. |
| **FR-27** | **DECISION AGENT dedupes helper functions.** Reads existing `Doc/PRD_Pi-Velpari.md` (helper functions section) and `Doc/RTM_Pi-Velpari.md`, dedupes helper functions by `name + file path`, and classifies each user input as new FR-N, update existing FR-N, helper function update, or new helper function. |
| **FR-28** | **Auto-update PRD on discussion approve.** When the user runs `/velpari-approve` after a discussion, the DECISION AGENT's verdict is auto-applied to `Doc/PRD_Pi-Velpari.md` (new FR-Ns added to Functional Requirements; existing FR-Ns updated; new helper functions appended to `## Helper Functions`). No separate `/velpari-prd` invocation is required. |
| **FR-29** | **`/velpari-prd` is the full-rewrite path.** Retained only for the use case where the user wants to regenerate the entire PRD from scratch (e.g., after a major pivot). Not the primary path for materializing a discussion into a PRD — that's automatic via FR-28. |
| **FR-30** | **Helper functions live in the PRD's `## Helper Functions` section.** Each helper function entry has an `HF-NN` id, name, file path (planned), signature, purpose, and list of FR-Ns that depend on it. The RTM's `Implementation / Helper Function` column references `HF-NN` ids. |
| **FR-33** | **Helper ↔ atomic function dependency.** Helper functions may call atomic functions; the dependency is recorded bidirectionally (`helper → calls atomic: AF-NN` and `atomic → called by helper: HF-NN`). Atomic functions are strictly leaf nodes (do not call other atomic functions). |
| **FR-34** | **Handoff includes optional artifacts when present.** `/velpari-handoff` reads `Doc/atomic-functions.md` and `Doc/development-order.md` if they exist and includes them in `.pi/senai/architect-inputs.json` under document types `Atomic Functions` and `Development Order`. If they don't exist (stages skipped), the handoff proceeds without them. |
| **FR-35** | **Atomic-function scouts' responsibilities.** AF-SCOUT-1 reads RTM's helper functions and proposes atomic splits. AF-SCOUT-2 reads pseudocode and proposes atomic functions for repeated logic patterns. AF-SCOUT-3 reads PRD requirements and proposes atomic functions per FR-N. AF-SCOUT-4 reads test cases and proposes atomic test helpers. |
| **FR-36** | **Development-order scouts' responsibilities.** DO-SCOUT-1 reads RTM dependencies and proposes a topologically sorted order. DO-SCOUT-2 reads feasibility study and proposes risk-aware priority. DO-SCOUT-3 reads test plan and proposes test-coverage priority. DO-SCOUT-4 reads PRD and proposes user-value ranking. The final order is a weighted merge with the user resolving conflicts. |

---

## 5. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| **NFR-01** | Determinism | A `session_before_compact` hook supplies a zero-LLM summary of the run state (run id, current stage, all artifact paths). Context compaction never loses run state. |
| **NFR-02** | Architecture | Velpari does not spawn subagents in stages 2–7 (prd, rtm, feasibility, design, pseudocode, testplan) or in the handoff stage. All content generation in those stages happens in the parent session. The discussion stage is the documented exception — see NFR-11. |
| **NFR-03** | Deployment | The extension is project-local (loaded by Pi from `package.json`'s `pi.extensions` field). No global state, no global config, no system-level installation. |
| **NFR-04** | Security | `/velpari-doctor` scans every artifact in `Doc/` and the run dir for accidental secrets (API keys, private keys, tokens) using a deterministic regex set. Findings reported as warnings, not failures. |
| **NFR-05** | Auditability | `/velpari-doctor` writes its full report to `.IDE_Plans/velpari/doctor-report.md` on every run. The report opens with a "Setup progress" section marking each step done or pending and naming the next command to run. |
| **NFR-06** | Code quality | TypeScript strict mode. `path.join` for all file paths. No in-place mutation of loaded state objects. Command handlers are thin; logic lives in module functions. |
| **NFR-07** | Dependency hygiene | Peer dependency on `@mariozechner/pi-coding-agent` only. No runtime dependencies added. |
| **NFR-08** | Cross-extension compatibility | `/velpari-handoff` produces `.pi/senai/architect-inputs.json` whose schema is compatible with `/senai-configure-architect-inputs` and `/senai-generate-architect` in `Pi-Orchestra_v4`. The handoff test reads Senai's `architect-inputs-config.ts` at test time to confirm field names have not drifted. |
| **NFR-09** | Testing | One test file per source module under `pi-extension/test/`. Tests use `node --test` and `fs.mkdtempSync` for temp directories. `npm test` builds then runs all tests. |
| **NFR-10** | Documentation | `AGENTS.md` describes the project layout, command inventory, stage workflow, artifact layout, design principles, coding conventions, and the development symlink. `README.md` is the user-facing entry point. `CHANGELOG.md` follows Keep a Changelog format. |
| **NFR-11** | Subagent exception | Subagents are permitted in the discussion stage (4 agents: NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, DECISION AGENT), the atomic-function stage (4 scout agents), and the development-order stage (4 scout agents) — total 12 scout agents. Stages 2–7 and handoff MUST NOT spawn subagents. The scout pattern mirrors Senai's plan-stage scouts. |

---

## 6. Constraints

1. **License:** MIT (matching `Pi-Orchestra_v4`).
2. **Node:** LTS version (currently Node 20+). `package.json` declares the minimum supported Node version.
3. **No network calls.** Velpari does not call out to the network. All operations are local file reads/writes and Pi interactions.
4. **Single-developer scope.** Maintenance is expected to be done by one person familiar with both Pi extensions. No multi-team coordination features.
5. **Backward compatibility within v1.x.** Once `state.json` and `files.json` schemas are published in v1.0, they are not changed within the v1.x series. New versions are additive (new optional fields).
6. **No live LLM in CI tests.** All tests use deterministic fixtures and mock the LLM. The zero-hallucination rule is verified via cross-reference, not via running the LLM against a fixture.
7. **Helper ↔ atomic function relationship.** Helper functions and atomic functions have a strict directional relationship: atomic functions are leaf nodes (do not call other atomic functions); helper functions may call atomic functions. The dependency is recorded bidirectionally in the PRD's `## Helper Functions` and `Doc/atomic-functions.md`.
8. **Post-pipeline stages are optional.** `/velpari-atomic-function` and `/velpari-development-order` may be invoked in any order or skipped entirely. `/velpari-handoff` works with or without their output artifacts. If a post-pipeline stage is invoked, its scout pattern (4 parallel agents + user-reviewed suggestions) MUST be used; no silent auto-write.
9. **Helper function dedup keys.** Dedup is by `name + file path` (lowercase, normalized to forward slashes). Same name in different paths is considered distinct; same name + same path is considered the same helper function.

---

## 7. Out of Scope

The following are explicitly NOT part of Velpari v1.x:

1. **Subagent spawning.** Subagent orchestration belongs to Senai.
2. **Architecture generation.** Velpari produces inputs; Senai generates the architecture.
3. **Implementation / coding.** Senai's domain.
4. **Deployment / packaging.** Senai's deliver stage.
5. **Multi-user collaboration.** Velpari is single-user, single-developer.
6. **Web UI / dashboard.** All interaction happens through Pi slash commands and the terminal.
7. **Import / export of runs.** Runs are local artifacts only in v1.x.
8. **Schema migration tooling.** v1.0 ships with the initial schema; migration comes in a later version if needed.

---

## 8. Glossary

| Term | Definition |
|---|---|
| **Working copy** | An artifact file written under `.IDE_Plans/velpari/runs/<run-id>/<stage>/`. Editable. Not visible to view commands. |
| **Published copy** | An artifact file written under `Doc/`. Read-only after publication. The artifact of record that downstream tools and view commands read. |
| **Run** | A single end-to-end execution of the Velpari pipeline from `/velpari-discuss` through `/velpari-handoff`. Identified by run id `YYYY-MM-DD-HH-MM-<mission-slug>`. |
| **Stage** | One of seven discrete states in the pipeline (discuss, prd, rtm, feasibility, design, pseudocode, testplan), each with `pending` and `approved` sub-states. |
| **FR-N** | Functional Requirement identifier (`FR-01` through `FR-36`). Stable across all Velpari artifacts and used in the RTM, design, and test docs. |
| **NFR-N** | Non-Functional Requirement identifier (`NFR-01` through `NFR-11`). Stable, referenced from the test plan. |
| **HF-NN** | Helper Function identifier (`HF-01`, `HF-02`, ...). Identifies a helper function in the PRD's `## Helper Functions` section. Referenced by FR-Ns that depend on the helper. |
| **AF-NN** | Atomic Function identifier (`AF-01`, `AF-02`, ...). Identifies an atomic function in `Doc/atomic-functions.md`. Strictly a leaf node — does not call other atomic functions. May be called by helper functions. |
| **Atomic function** | The smallest single-purpose unit of reusable logic. Distinct from a helper function: atomic functions do not call other atomic functions; helper functions may call atomic functions. |
| **Helper function** | A reusable function or method that an FR-N depends on. Coarser than an atomic function. Helper functions may call atomic functions. |
| **Scout agent** | One of the 4 parallel subagents used in the discussion stage, atomic-function stage, and development-order stage. Each scout reads a specific subset of completed docs and proposes content from a specific angle. The user reviews all proposals in a unified picker UI. |
| **Suggestion picker** | The unified UI that displays scout agent proposals and lets the user accept/modify/reject each. Same component used in discussion, atomic-function, and development-order stages. |
| **Atomic-function stage** | The optional post-pipeline stage that produces `Doc/atomic-functions.md`. Identified by 4 AF-SCOUT agents. |
| **Development-order stage** | The optional post-pipeline stage that produces `Doc/development-order.md`. Identified by 4 DO-SCOUT agents. |
| **DECISION AGENT** | The 4th scout in the discussion stage that merges the output of NEW EXTRACTOR, PRD CHECKER, and RTM CHECKER and classifies each user input as new FR-N, update, helper function update, or new helper. |
| **Discussion notes** | The raw user-provided input captured during `/velpari-discuss`. The upstream source of every claim in every later artifact. |
| **Trace-back** | A citation from a claim in a downstream artifact to the specific user statement or earlier artifact that justifies it. Enforced by the zero-hallucination rule. |
| **Handoff** | The act of `/velpari-handoff` writing `.pi/senai/architect-inputs.json` so Senai's architecture factory can consume Velpari's outputs. |
| **Doctor** | The audit command `/velpari-doctor` and its report at `.IDE_Plans/velpari/doctor-report.md`. |
| **Compaction hook** | A `session_before_compact` hook that supplies a zero-LLM summary so context compaction does not lose run state. |
| **Mission** | The user-provided description of what they want to build. Passed to `/velpari-discuss` and recorded in `state.json`. |
| **Run id** | The directory name `YYYY-MM-DD-HH-MM-<mission-slug>` that uniquely identifies a run. |

---

## 9. Acceptance Criteria

Velpari v1.3 is considered complete when ALL of the following are true:

1. **All 22 commands register.** `/velpari-discuss`, `/velpari-prd`, `/velpari-rtm`, `/velpari-feasibility`, `/velpari-design`, `/velpari-pseudocode`, `/velpari-testplan`, `/velpari-atomic-function`, `/velpari-development-order`, `/velpari-approve`, `/velpari-status`, `/velpari-reset`, `/velpari-configure-inputs`, `/velpari-doctor`, `/velpari-handoff`, and all 7 `/velpari-show-*` commands are present and respond to Pi's command system.
2. **A complete core run is possible.** Starting from `/velpari-discuss`, a user can advance through the 7 core stages with `/velpari-approve` and reach the `planned-tests` state.
3. **Optional stages are optional.** `/velpari-atomic-function` and `/velpari-development-order` can each be invoked or skipped independently. `/velpari-handoff` works with or without their output.
4. **Discussion 4-agent pattern works.** The discussion stage spawns the 4 expected agents (NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, DECISION AGENT), classifies user input correctly, and auto-updates the PRD on `/velpari-approve`.
5. **Helper function dedup is correct.** Repeated helper functions are detected by `name + file path`; updates vs new helpers are classified correctly; references in the PRD's `## Helper Functions` and RTM are bidirectional.
6. **Post-pipeline scout pattern works.** Both `/velpari-atomic-function` and `/velpari-development-order` spawn their 4 scout agents, render suggestions in a unified picker UI, and write only accepted entries to the published doc.
7. **Published copies are produced.** Each `/velpari-approve` writes the working copy to `Doc/` and only after explicit confirmation. Optional stage docs are written only on `/velpari-approve` after suggestion review.
8. **`/velpari-doctor` passes on a clean run.** A complete run (with or without optional stages) passes doctor with no errors (warnings allowed).
9. **`/velpari-handoff` produces a valid Senai input file.** The output `.pi/senai/architect-inputs.json` is accepted by `/senai-configure-architect-inputs` and `/senai-generate-architect`. When `atomic-functions.md` and `development-order.md` exist, they are included in the handoff with document types `Atomic Functions` and `Development Order`.
10. **All FR-Ns are traceable.** Every requirement in `Doc/PRD_Pi-Velpari.md` appears in `Doc/RTM_Pi-Velpari.md`. Every design element in `Doc/design.md` appears in the RTM. Every test case in `Doc/test-cases.md` references an RTM row. Every atomic function in `Doc/atomic-functions.md` is referenced by at least one helper function or test case.
11. **Tests pass.** `npm test` exits with code 0 and covers every source module with at least one test.
12. **Build is clean.** `npm run build` exits with code 0 under TypeScript strict mode with no warnings.
13. **No secrets in artifacts.** `/velpari-doctor`'s secret scan finds no matches in a clean run.
14. **Documentation is complete.** `README.md`, `AGENTS.md`, `CHANGELOG.md`, `Doc/velpari-sequence.md`, `Doc/step-by-step-guide.md`, `Doc/atomic-functions.md` (if stage run), `Doc/development-order.md` (if stage run) exist and accurately describe the implemented behavior.

---

## 10. Change Log (this document)

- **v1.0** — initial 32-line PRD with 3 sections (Objective, Key Features & Requirements, File Outputs).
- **v1.1** — full PRD: added Background & Context, User Personas, per-command FR-N IDs, cross-cutting functional requirements, non-functional requirements, constraints, out of scope, glossary, acceptance criteria. Document is now the source of truth for Velpari v1.0 implementation.
- **v1.2** — added FR-26..FR-30 (4-agent discussion stage + auto-update PRD + helper functions in PRD) and NFR-11 (subagent exception for discussion). Extended NFR-02 scope to stages 2–7. Updated Constraints with helper↔atomic rules. Expanded Glossary with HF-NN, AF-NN, DECISION AGENT.
- **v1.3** — added FR-31..FR-36 (post-pipeline atomic-function and development-order stages with 8 additional scout agents, helper↔atomic dependency rule, extended handoff schema). Extended NFR-11 to cover all 12 scout agents. Updated Constraints with post-pipeline stage rules. Expanded Glossary with scout agent, suggestion picker, atomic-function stage, development-order stage terms. Updated Acceptance Criteria to v1.3 (22 commands, optional stages, scout pattern, helper↔atomic traceability).

---

*This PRD is consumed by `Doc/RTM_Pi-Velpari.md` (every FR-N becomes an RTM row), `Doc/design.md` (FR-Ns are referenced as design drivers), and `Doc/test-cases.md` (every FR-N becomes at least one test case). It is the root of the traceability chain.*
