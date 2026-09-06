# Pi-Velpari

Stage-gated agent orchestration extension for Pi — pre-production phase:

```
Discussion → PRD → RTM → Feasibility → Design → Pseudocode → Test Plan
                                                       │
                                                       ▼
                              ┌──────────────────────────────────────┐
                              │  Atomic Function (optional)          │
                              │  4 scouts + suggestion picker        │
                              └──────────────────────────────────────┘
                                                       │
                                                       ▼
                              ┌──────────────────────────────────────┐
                              │  Development Order (optional)        │
                              │  4 scouts + ranking merge + picker    │
                              └──────────────────────────────────────┘
                                                       │
                                                       ▼
                                                 Senai handoff
```

> **Note:** This extension and all its slash commands are branded as **Velpari** (`/velpari-*`). Pi loads it automatically from `package.json`.
>
> **Why "Velpari"?** Velpari (வேல்பாரி) is a Tamil word meaning "one who seeks work / employment." It describes someone gathering requirements before the work begins. That matches how Velpari works: the user is asked questions, requirements are captured, and only after each stage is approved does the next begin.

## Relationship to Pi-Senai

`Pi-Orchestra_v4` (pi-senai) handles the **production phase** — Plan → Implement → Document → Deliver. Velpari handles the **pre-production phase** — Discussion → PRD → RTM → Feasibility → Design → Pseudocode → Test Plan.

The two extensions form a continuous pipeline:

```
Velpari (this repo, Pi-Velpari/)            Senai (Pi-Orchestra_v4/)
       │                                            │
  /velpari-discuss                                  │
       ▼                                            │
  /velpari-prd                                      │
       ▼                                            │
  /velpari-rtm                                      │
       ▼                                            │
  /velpari-feasibility                              │
       ▼                                            │
  /velpari-design                                   │
       ▼                                            │
  /velpari-pseudocode                               │
       ▼                                            │
  /velpari-testplan                                 │
       ▼                                            │
  /velpari-handoff  ──── writes ────▶  /senai-configure-architect-inputs
                                                ▼
                                          /senai-generate-architect
                                                ▼
                                          /senai-plan
                                                ▼
                                          /senai-implement
                                                ▼
                                          /senai-document
                                                ▼
                                          /senai-deliver
```

After Velpari's `/velpari-handoff`, the user switches to Senai and the production phase begins.

## What it does

Velpari splits pre-production work into seven explicit stages. Each stage produces an artifact in `.IDE_Plans/velpari/runs/<run-id>/` (working copy) and requires user approval before the artifact is published to `Doc/` (grouped category layout) and the next stage starts.

- **Configure Requirements** (optional one-time) — pick a built-in requirements profile (web/banking/healthcare/…) so the PSRS knows which sections to demand.
- **Discuss** — interactive multi-turn interview that captures raw user input.
- **PRD** — convert discussion notes into a formal **PSRS** (Product and Software Requirements Specification, kept under the file name `PRD_<projectName>.md`) with stable FR/NFR/HF identifiers, MVP, phases, acceptance criteria, helper candidates, and open questions.
- **RTM** — derive the Requirements Traceability Matrix from the PSRS. RTM remains a separate document.
- **Feasibility** — analyze feasibility across five dimensions with a Go / Conditional Go / No-Go verdict.
- **Design** — high-level design (modules, data model, interface contracts, data flow).
- **Pseudocode** — algorithmic pseudocode per design module.
- **Test Plan** — test plan and test cases, every case traced back to an RTM row.

## Install

Install via pi's package manager:

```bash
pi install npm:@Adi-Mudi/pi-velpari
```

Pi downloads the package, runs `npm install`, and loads the extension automatically. The 4 scout agent definitions are auto-bootstrapped from bundled files on first `/velpari-discuss`.

### Required peer dependency

Velpari requires [`pi-interactive-subagents`](https://github.com/HazAT/pi-interactive-subagents) (≥3.7.2) to be installed alongside Velpari. It provides the `subagent` tool the parent LLM uses to spawn the 4 discussion scouts (`NEW EXTRACTOR`, `PRD CHECKER`, `RTM CHECKER`, optional `WEB SEARCH AGENT`) in **visible multiplexer panes**. Without it installed, `/velpari-discuss` will fail to spawn scouts and the working copy will not be written.

```bash
pi install git:github.com/HazAT/pi-interactive-subagents
```

### Local development (optional)

For active development with hot-reload:

```bash
git clone https://github.com/Adi-Mudi/pi-velpari
cd pi-velpari
npm install
npm run build
ln -sf "$(pwd)/dist/pi-extension/src" ~/.pi/agent/extensions/pi-velpari
```

## Quickstart

1. **Configure inputs** (one-time per project):

   ```
   /velpari-configure-inputs
   ```

   This captures: **your project name** (e.g., "TodoApp"), framework/tech stack, input documents, and output paths. The project name is used in all output file names (`Doc/requirements/PRD_TodoApp.md` etc.). Framework is injected into every stage prompt.

2. **Configure requirements profile** (one-time per project, optional but recommended):

   ```
   /velpari-configure-requirements
   ```

   This captures the project type / domain / development method / regulated flag. Fixed choices go through native Pi selectors (`ctx.ui.select(title, options)`); free-text answers use `ctx.ui.input(title, placeholder)`; yes/no decisions use `ctx.ui.confirm(title, message)`. Web-research consent is asked **before** recommendations, and the research prompt explicitly says profile selection is pending and never selects a profile for you.

   The handler shows up to three deterministic recommendations: the **common PSRS core** (baseline PSRS structure, always present, a real choice) plus up to two closest built-in profiles, each with a score (0–100), reasons, and trade-offs. Pick via the selector, confirm via confirm, save. If no built-in matches, fallback actions (`Use common PSRS core` / `Use closest built-in profile` / `Update Velpari` / `Stop`) are shown — no silent profile creation.

3. **Start the discussion**:

   ```
   /velpari-discuss Build a CLI that lists TODOs from a markdown file
   ```

   After the multi-turn interview, you'll be asked: "Do you want me to search the web for community resources, official docs, and similar projects?" (yes/no). The 4 scouts (NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, optional WEB SEARCH AGENT) run in parallel; the main handler merges their output and renders a verdict.

4. **Approve each stage**:

   For discussion (uses dedicated command):
   ```
   /velpari-approve-discuss
   ```

   For stages 2–7:
   ```
   /velpari-approve
   ```

   Run `/velpari-approve-discuss` once after discussion. It publishes the working copy to `Doc/discussion/discussion-<topic-slug>.md` and **auto-invokes `/velpari-prd`** to chain into the PRD stage. Then run `/velpari-approve` after every subsequent stage command to advance the state.

5. **Run the stages**:

   ```
   /velpari-prd
   /velpari-approve
   /velpari-rtm
   /velpari-approve
   /velpari-feasibility
   /velpari-approve
   /velpari-design
   /velpari-approve
   /velpari-pseudocode
   /velpari-approve
   /velpari-testplan
   /velpari-approve
   ```

   To produce the PSRS and RTM in a single combined invocation, run `/velpari-prd-rtm` (a thin wrapper that calls `/velpari-prd` and then `/velpari-rtm` in order; no auto-approve).

6. **Hand off to Senai**:

   ```
   /velpari-handoff
   ```

7. **Switch to Senai**:

   ```
   /senai-configure-architect-inputs
   /senai-generate-architect
   ```

## Command surface (25 commands)

### Stage commands (9)

**Core 7 (required):**

- `/velpari-discuss <mission>` — interactive interview with 4-agent pattern.
- `/velpari-prd` — produce the PSRS (`PRD_<projectName>.md`) from discussion notes.
- `/velpari-rtm` — produce the RTM (`RTM_<projectName>.md`) from the PSRS.
- `/velpari-feasibility` — produce feasibility study.
- `/velpari-design` — produce design document.
- `/velpari-pseudocode` — produce pseudocode.
- `/velpari-testplan` — produce test plan and test cases.

**Post-pipeline 2 (optional):**

- `/velpari-atomic-function` — 4 scout agents propose atomic functions; user reviews in picker.
- `/velpari-development-order` — 4 scout agents propose implementation order; user reorders in picker.

### Discipline commands (8)

- `/velpari-approve` — publish working copy to `Doc/<category>/`, advance state.
- `/velpari-approve-discuss` — discussion-specific approve, chains into PRD.
- `/velpari-status` — show current run state.
- `/velpari-reset` — discard current run.
- `/velpari-configure-inputs` — capture `projectName` + framework, persisted in `.pi/velpari/files.json`.
- `/velpari-configure-requirements` — capture the requirements profile, persisted in `.pi/velpari/requirements-profile.json`.
- `/velpari-doctor` — audit setup, save report. The doctor checks 17 sections:
  1. **Action items** (top-of-report callout) — every error/warning with its fix
  2. **Setup progress** — first-time-user guide naming the next command
  3. **Run state** — current run id, mission, stage, history length
  4. **Config** — `.pi/velpari/files.json` validity + projectName
  5. **Requirements profile** — mode, id, version, research consent
  6. **Doc/ artifacts** — markdown inventory under Doc/
  7. **Grouped / legacy paths** — per-artifact presence across layouts
  8. **Working / published separation** — working-copy vs Doc/ counts
  9. **PSRS validation** — structural shape against the schema
  10. **RTM traceability** — every RTM id resolves in the PSRS
  11. **Multiplexer** — tmux / zellij / wezterm / cmux detection + Issue #19 warning
  12. **Sub-agent extension** — pi-interactive-subagents presence + version
  13. **Stray files** — `tmp_*.sh` / `tmp_*.ts` debris in project + runs/
  14. **Web-tool lock** — only `web-search-agent` may carry `websearch`/`fetchurl`
  15. **Agent file integrity** — filename ↔ `name:`, tools, thinking, session-mode, body
  16. **Scout agents** — every stage's 4 scouts present + frontmatter OK
  17. **Stage skills** — every skill markdown references its scouts + v2.0 machinery
  Plus **Secret scan** across `Doc/`, `.pi/agents/`, `.pi/skills/`, `.pi/velpari/` with 7 patterns. Every actionable item carries a `→ Fix: <suggestion>` hint. Report is written via `atomic-write.ts`; verdict banner flips to ❌ on any error.
- `/velpari-handoff` — package artifacts for Senai.

### Wrapper command (1)

- `/velpari-prd-rtm` — call `/velpari-prd` and `/velpari-rtm` in sequence; no auto-approve.

### View commands (7)

- `/velpari-show-discussion`, `/velpari-show-prd`, `/velpari-show-rtm`, `/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`, `/velpari-show-testplan` — print the published artifact (grouped layout first, legacy flat path as fallback).

## Design principles

1. **Zero hallucination.** Every claim in every artifact traces back to a user-provided statement in a discussion note or to an earlier approved artifact. The LLM never invents requirements, design decisions, or test cases.
2. **Confirm-then-write.** No file under `Doc/` is written without a user-facing preview and explicit `/velpari-approve`.
3. **Stage gates are enforced.** A stage cannot start until its prerequisites are approved. Transitions are defined in `constants.ts:STAGE_TRANSITIONS`.
4. **Scout pattern in all 9 stage commands.** All 9 stage commands spawn 4 visible subagents in parallel via the `subagent` tool from `pi-interactive-subagents` — 36 scout agents total. Mirrors Senai's plan-stage scout pattern.
5. **Helper ↔ atomic relationship.** Helper candidates are tracked in the PSRS's `## Helper Function Candidates` section. Atomic functions are tracked in `Doc/atomic-functions/atomic-functions_<projectName>.md`. Atomic functions are strictly leaf nodes; helper functions may call atomic functions. The dependency is bidirectional.
6. **Optional stages stay optional.** `/velpari-atomic-function` and `/velpari-development-order` can be invoked in any order or skipped entirely. `/velpari-handoff` works with or without their output.
7. **Mirrors Senai's discipline.** Same state-gated runs, same working/published copy separation, same doctor audit, same single-source-of-truth state file, same scout-pattern UI.
8. **No architecture command in Velpari.** Velpari produces inputs only; Senai's `/senai-generate-architect` consumes them. Documented explicitly; rationale in `Doc/design.md` §7.7.
9. **Per-command doc scope and gate.** Every stage command declares which `Doc/` artifacts it reads (the doc scope) and a gate check runs before any LLM call to verify those artifacts exist and are non-empty. See `Doc/velpari-sequence.md` §11.
10. **Framework as one-time setup.** Framework/tech-stack is captured in `/velpari-configure-inputs` and persisted in `.pi/velpari/files.json`. Injected into every stage prompt. Not a pipeline stage.
11. **WEB SEARCH AGENT** (discussion stage only, user-prompted). Collects community resources, official documentation, and similar OSS projects. User chooses per-discussion whether to invoke.
12. **Uniform subagent pattern.** All 36 scout agents follow the same `subagent` invocation (visible panes, `agent:` parameter, `auto-exit: true`, `session-mode: standalone`). No in-process scouts.
13. **Discussion-approve chain (v1.6).** Discussion has its own dedicated approve command, `/velpari-approve-discuss`, which publishes `Doc/discussion/discussion-<topic-slug>.md` and **auto-invokes `/velpari-prd`** to materialize the PSRS. The normal `/velpari-approve` works for stages 2–7 (prd, rtm, feasibility, design, pseudocode, testplan) and errors when used on the discussion stage.
14. **Project-name output documents (v1.7).** Output document names use your `projectName` (captured in `/velpari-configure-inputs`), not the extension name. Example: a "TodoApp" project produces `Doc/requirements/PRD_TodoApp.md`, `Doc/requirements/RTM_TodoApp.md`, etc. Discussion is per-topic: `Doc/discussion/discussion-<topic-slug>.md`. Subsequent runs of the same topic get timestamp suffixes.
15. **Grouped Doc/ layout (Phase 7 / Requirements Factory).** New writes go to category subfolders under `Doc/` (`Doc/discussion/`, `Doc/requirements/`, `Doc/feasibility/`, `Doc/design/`, `Doc/pseudocode/`, `Doc/tests/`, `Doc/atomic-functions/`, `Doc/development-order/`). Legacy flat paths (`Doc/PRD_<project>.md`, `Doc/discussion-<slug>.md`, etc.) remain readable as fallback for back-compat. New docs never overwrite or move legacy docs.
16. **PSRS shape (Phase 7 / Requirements Factory).** The PRD document is a combined **Product and Software Requirements Specification** with required sections: Objective, Problem, System Actors, Scope, MVP, Phases, Functional Requirements, Non-Functional Requirements, Data and Interfaces, Errors and Edge Cases, Constraints, Dependencies and Risks, Out of Scope, Open Questions, Acceptance Criteria, Helper Function Candidates. The file keeps the legacy name `PRD_<projectName>.md` for compatibility.
17. **Requirements profile (Phase 7 / Requirements Factory, v1.1).** `/velpari-configure-requirements` uses native Pi selectors (`ctx.ui.select`) for fixed choices and free-text input for open answers. Profile selection is **optional** and surfaces up to three deterministic recommendations (common PSRS core + up to two closest built-ins) with scores, reasons, and trade-offs. Web research consent is asked **before** recommendations; the research prompt explicitly says profile selection is pending and never selects a profile. A common PSRS core selection is a real choice. When no built-in matches, fallback actions (common core / closest built-in / update / stop) are offered via selector — the handler never invents a profile. Doctor reports profile mode (`common-core` or `built-in`), id, version, research consent + source count, and the report-only stance; it never mutates the profile.

## Project layout

```
.IDE_Plans/velpari/
├── state.json                              # single source of truth for current run
├── doctor-report.md                        # latest /velpari-doctor output
└── runs/<run-id>/{discuss,prd,rtm,...}/    # working copies (grouped layout)

Doc/                                       # published copies (the artifact of record)
├── discussion/
│   └── discussion-<topic>.md
├── requirements/
│   ├── PRD_<project>.md                    # combined PSRS
│   └── RTM_<project>.md
├── feasibility/
│   └── feasibility-study_<project>.md
├── design/
│   └── design_<project>.md
├── pseudocode/
│   └── pseudocode_<project>.md
├── tests/
│   ├── test-plan_<project>.md
│   └── test-cases_<project>.md
├── atomic-functions/                        # only if /velpari-atomic-function was run
│   └── atomic-functions_<project>.md
└── development-order/                       # only if /velpari-development-order was run
    └── development-order_<project>.md

.pi/velpari/files.json                     # /velpari-configure-inputs output
.pi/velpari/requirements-profile.json      # /velpari-configure-requirements output
.pi/senai/architect-inputs.json             # /velpari-handoff output (consumed by Senai)
```

## Development

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Tests are in `pi-extension/test/` and use Node's built-in test runner.

## Documentation

- [`Doc/PRD.md`](Doc/PRD.md) — source PRD with FR-N identifiers (FR-01..FR-48, NFR-01..NFR-12).
- [`Doc/RTM_Pi-Velpari.md`](Doc/RTM_Pi-Velpari.md) — requirements traceability matrix.
- [`Doc/feasibility-study.md`](Doc/feasibility-study.md) — 5-dimension feasibility analysis.
- [`Doc/design.md`](Doc/design.md) — high-level design.
- [`Doc/pseudocode.md`](Doc/pseudocode.md) — algorithm pseudocode.
- [`Doc/test-plan.md`](Doc/test-plan.md) — test strategy.
- [`Doc/test-cases.md`](Doc/test-cases.md) — specific test cases.
- [`Doc/velpari-sequence.md`](Doc/velpari-sequence.md) — sequence flow + state machine + per-command sub-sequence (§11).
- [`Doc/step-by-step-guide.md`](Doc/step-by-step-guide.md) — hands-on walkthrough.
- [`Doc/architecture-discussion.md`](Doc/architecture-discussion.md) — architecture patterns study + pending decisions (v1.4).
- [`Doc/velpari-requirements-orchestration-design.md`](Doc/velpari-requirements-orchestration-design.md) — Phase 7 Requirements Factory design (PSRS + profiles + grouped paths + Doctor).
- [`AGENTS.md`](AGENTS.md) — contributor / agent notes.

## See also

- [`pi-senai`](https://github.com/Adi-Mudi/pi-senai) — the downstream production-phase extension.

## License

MIT


