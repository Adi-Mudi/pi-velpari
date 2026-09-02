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

Velpari splits pre-production work into seven explicit stages. Each stage produces an artifact in `.IDE_Plans/velpari/runs/<run-id>/` (working copy) and requires user approval before the artifact is published to `Doc/` and the next stage starts.

- **Discuss** — interactive multi-turn interview that captures raw user input.
- **PRD** — convert discussion notes into a formal PRD with stable FR-N identifiers.
- **RTM** — derive the Requirements Traceability Matrix from the PRD.
- **Feasibility** — analyze feasibility across five dimensions with a Go / Conditional Go / No-Go verdict.
- **Design** — high-level design (modules, data model, interface contracts, data flow).
- **Pseudocode** — algorithmic pseudocode per design module.
- **Test Plan** — test plan and test cases, every case traced back to an RTM row.

## Install

The extension is loaded automatically by Pi. Two install modes are supported:

- **Project-local (development):** copy or symlink the extension into `.pi/extensions/pi-velpari/`. Pi auto-discovers from this directory.
- **npm-distributed (release):** users run `pi install npm:pi-velpari`. The package's `package.json` declares its entry point under the `pi.extensions` field (Pi reads this when installing).

```bash
npm install
npm test
```

## Quickstart

1. **Configure inputs** (one-time per project):

   ```
   /velpari-configure-inputs
   ```

   This captures: **your project name** (e.g., "TodoApp"), framework/tech stack, input documents, and output paths. The project name is used in all output file names (`Doc/PRD_TodoApp.md` etc.). Framework is injected into every stage prompt.

2. **Start the discussion**:

   ```
   /velpari-discuss Build a CLI that lists TODOs from a markdown file
   ```

   After the multi-turn interview, you'll be asked: "Do you want me to search the web for community resources, official docs, and similar projects?" (yes/no). The 4 scouts (NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, optional WEB SEARCH AGENT) run in parallel; the main handler merges their output and renders a verdict.

3. **Approve each stage**:

   For discussion (uses dedicated command):
   ```
   /velpari-approve-discuss
   ```

   For stages 2–7:
   ```
   /velpari-approve
   ```

   Run `/velpari-approve-discuss` once after discussion. It publishes the working copy to `Doc/` and **auto-invokes `/velpari-prd`** to chain into the PRD stage. Then run `/velpari-approve` after every subsequent stage command to advance the state.

4. **Run the stages**:

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

5. **Hand off to Senai**:

   ```
   /velpari-handoff
   ```

6. **Switch to Senai**:

   ```
   /senai-configure-architect-inputs
   /senai-generate-architect
   ```

## Command surface (22 commands)

### Stage commands (9)

**Core 7 (required):**

- `/velpari-discuss <mission>` — interactive interview with 4-agent pattern (auto-updates PRD on approve).
- `/velpari-prd` — full rewrite of PRD from scratch (usually not needed since discussion auto-updates).
- `/velpari-rtm` — produce RTM from approved PRD.
- `/velpari-feasibility` — produce feasibility study.
- `/velpari-design` — produce design document.
- `/velpari-pseudocode` — produce pseudocode.
- `/velpari-testplan` — produce test plan and test cases.

**Post-pipeline 2 (optional):**

- `/velpari-atomic-function` — 4 scout agents propose atomic functions; user reviews in picker.
- `/velpari-development-order` — 4 scout agents propose implementation order; user reorders in picker.

### Discipline commands (6)

- `/velpari-approve` — publish working copy to `Doc/`, advance state.
- `/velpari-status` — show current run state.
- `/velpari-reset` — discard current run.
- `/velpari-configure-inputs` — categorize input docs and output paths.
- `/velpari-doctor` — audit setup, save report.
- `/velpari-handoff` — package artifacts for Senai.

### View commands (7)

- `/velpari-show-discussion`, `/velpari-show-prd`, `/velpari-show-rtm`, `/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`, `/velpari-show-testplan` — print the published artifact.

## Design principles

1. **Zero hallucination.** Every claim in every artifact traces back to a user-provided statement in a discussion note or to an earlier approved artifact. The LLM never invents requirements, design decisions, or test cases.
2. **Confirm-then-write.** No file under `Doc/` is written without a user-facing preview and explicit `/velpari-approve`.
3. **Stage gates are enforced.** A stage cannot start until its prerequisites are approved. Transitions are defined in `constants.ts:STAGE_TRANSITIONS`.
4. **Scout pattern in three stages.** Subagents are used in discussion (4 agents), atomic-function (4 AF scouts), and development-order (4 DO scouts) — 12 scout agents total. Stages 2–7 and the handoff stage do NOT spawn subagents. Mirrors Senai's plan-stage scout pattern.
5. **Helper ↔ atomic relationship.** Helper functions are tracked in the PRD's `## Helper Functions` section. Atomic functions are tracked in `Doc/atomic-functions.md`. Atomic functions are strictly leaf nodes; helper functions may call atomic functions. The dependency is bidirectional.
6. **Optional stages stay optional.** `/velpari-atomic-function` and `/velpari-development-order` can be invoked in any order or skipped entirely. `/velpari-handoff` works with or without their output.
7. **Mirrors Senai's discipline.** Same state-gated runs, same working/published copy separation, same doctor audit, same single-source-of-truth state file, same scout-pattern UI.
8. **No architecture command in Velpari.** Velpari produces inputs only; Senai's `/senai-generate-architect` consumes them. Documented explicitly; rationale in `Doc/design.md` §7.7.
9. **Per-command doc scope and gate.** Every stage command declares which `Doc/` artifacts it reads (the doc scope) and a gate check runs before any LLM call to verify those artifacts exist and are non-empty. See `Doc/velpari-sequence.md` §11.
10. **Framework as one-time setup.** Framework/tech-stack is captured in `/velpari-configure-inputs` and persisted in `.pi/velpari/files.json`. Injected into every stage prompt. Not a pipeline stage.
11. **WEB SEARCH AGENT** (discussion stage only, user-prompted). Collects community resources, official documentation, and similar OSS projects. User chooses per-discussion whether to invoke.
12. **Uniform subagent pattern.** All 12 scout agents follow the `ScoutContract` (same spawn helper, same JSON envelope, same 30-second timeout, same picker UI).
13. **Discussion-approve chain (v1.6).** Discussion has its own dedicated approve command, `/velpari-approve-discuss`, which publishes `Doc/discussion-notes.md` and **auto-invokes `/velpari-prd`** to materialize the PRD. The normal `/velpari-approve` works for stages 2–7 (prd, rtm, feasibility, design, pseudocode, testplan) and errors when used on the discussion stage.
14. **Project-name output documents (v1.7).** Output document names use your `projectName` (captured in `/velpari-configure-inputs`), not the extension name. Example: a "TodoApp" project produces `Doc/PRD_TodoApp.md`, `Doc/RTM_TodoApp.md`, etc. Discussion is per-topic: `Doc/discussion-{topic-slug}.md`. Subsequent runs of the same topic get timestamp suffixes.

## Project layout

```
.IDE_Plans/velpari/
├── state.json                              # single source of truth for current run
├── doctor-report.md                        # latest /velpari-doctor output
└── runs/<run-id>/{discuss,prd,rtm,...}/    # working copies

Doc/                                       # published copies (the artifact of record)
├── discussion-notes.md
├── PRD_Pi-Velpari.md
├── RTM_Pi-Velpari.md
├── feasibility-study.md
├── design.md
├── pseudocode.md
├── test-plan.md
├── test-cases.md
├── atomic-functions.md                      # only if /velpari-atomic-function was run
└── development-order.md                     # only if /velpari-development-order was run

.pi/velpari/files.json                     # /velpari-configure-inputs output
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
- [`AGENTS.md`](AGENTS.md) — contributor / agent notes.

## See also

- [`Pi-Orchestra_v4`](https://github.com/HazAT/pi-interactive-subagents) — the downstream production-phase extension.

## License

MIT
