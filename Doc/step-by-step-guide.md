# Pi-Velpari Step-by-Step Guide

A hands-on walkthrough for running a full Velpari cycle, from `/velpari-discuss` through `/velpari-handoff`. The example uses a fictional mission *"Build a CLI that lists TODOs from a markdown file."* Substitute your own mission.

---

## 0. Prerequisites

- Pi is installed and running.
- The `pi-velpari` extension is installed in the project. Confirm with:
  ```
  /help
  ```
  You should see `/velpari-*` commands in the list.
- You have a clear idea of what you want to build. The clearer the mission, the cleaner the discussion.

---

## 1. Configure inputs (one-time per project)

```
/velpari-configure-inputs
```

This command:

1. Deep-scans your project for existing markdown files (potential input documents — existing PRDs, NFRs, etc.).
2. Suggests default output paths under `Doc/`.
3. Lets you accept or adjust each suggestion.
4. Writes `.pi/velpari/files.json`.

For a brand-new project with no existing PRDs, the defaults are fine. For a project with an existing PRD or NFR document, you can mark it as an `inputDocument` — Velpari will keep it in scope across all stages.

**After this step**, `/velpari-doctor` should report "Setup progress: 1 of 7 steps done."

---

## 2. Start the discussion

```
/velpari-discuss Build a CLI that lists TODOs from a markdown file
```

What happens:

1. Velpari asks the LLM for the **first question** based on the mission. The question is shown to you.
2. You answer in plain English.
3. Velpari asks: "Add another point?" If you say yes, it asks the **next question**.
4. Continue until you say no.

Each Q&A pair is recorded in the working copy. Velpari generates a question based on what you've already said — so the interview adapts. You don't have to think of every angle upfront; the LLM helps you surface things you hadn't considered.

When you say "no more points", Velpari **spawns 4 parallel subagents** to process your input:

- **NEW EXTRACTOR** — extracts raw statements from your Q&A.
- **PRD CHECKER** — reads existing `Doc/PRD_Pi-Velpari.md` (if any) to find related requirements.
- **RTM CHECKER** — reads existing `Doc/RTM_Pi-Velpari.md` (if any) to find related helper functions and TCs.
- **DECISION AGENT** — merges the three outputs and classifies each statement as **new FR-N**, **update existing FR-N**, **helper function update**, or **new helper function**.

The DECISION AGENT's verdict is rendered as a **preview** showing what will be added or updated in the PRD. Read it. If it captured what you said, **confirm**. The working copy is saved to `.IDE_Plans/velpari/runs/<run-id>/discuss/discussion-notes.md`.

If the preview missed something or the verdict is wrong, **cancel** and rerun `/velpari-discuss`. The new run overwrites the working copy.

**Tip:** answer concretely. *"It should be fast for big files"* is better than *"It should be performant"*. The clearer your answers, the less the LLM has to fill in (and the zero-hallucination rule means it won't fill in anyway).

**Example Q&A:**

```
Q1: What does "list TODOs" mean exactly — show all of them, or filter by status?
A1: Show all by default. Optional filter by status (todo / doing / done).

Q2: What's the output format? Plain text, JSON, table?
A2: Plain text, one TODO per line, with the line number prefix.

Q3: Any other command-line options?
A3: --help and --version. That's it.

Q4: Where does the input file come from?
A4: First positional argument, or stdin if no argument.
```

When you say "no more points", Velpari renders the **preview** of the working copy. Read it. If it captured what you said, **confirm**. The working copy is saved to `.IDE_Plans/velpari/runs/<run-id>/discuss/discussion-notes.md`.

If the preview missed something, **cancel** and rerun `/velpari-discuss`. The new run overwrites the working copy.

---

## 3. Approve the discussion

```
/velpari-approve
```

What happens:

1. The working copy (`discussion-notes.md`) is copied to `Doc/discussion-notes.md`. This is the published copy.
2. **Auto-update applied:** the DECISION AGENT's verdict from the discussion is applied to `Doc/PRD_Pi-Velpari.md`. New FR-Ns are added to the Functional Requirements table; updated FR-Ns replace existing entries; new helper functions are appended to `## Helper Functions`.
3. State advances from `discussed` to `drafting-prd` (or `building-rtm` if the PRD already had content).
4. The next stage's prompt is auto-launched (you'll see a `/velpari-rtm` or `/velpari-prd` prompt ready to go).

**If parent context usage is ≥ 50%**, `/velpari-approve` first compacts the session. A deterministic zero-LLM summary of the run state is injected so nothing is lost.

**Note:** you can skip `/velpari-prd` in this flow — the auto-update already wrote your discussion into the PRD. `/velpari-prd` is only needed if you want to fully regenerate the PRD from scratch.

---

## 4. Produce the PRD

```
/velpari-prd
```

What happens:

1. Velpari reads the published `Doc/discussion-notes.md`.
2. The LLM produces a PRD draft with sections: **Objective**, **Background**, **Key Features & Requirements** (with stable `FR-N` IDs), **Constraints**, **Out of Scope**, **Glossary**, **Acceptance Criteria**.
3. **Zero-hallucination enforced.** Every requirement traces back to a discussion note. No new info.
4. The draft is rendered as a preview.
5. On confirm, the working copy is saved to `.IDE_Plans/velpari/runs/<run-id>/prd/PRD_Pi-Velpari.md`.

If the LLM produces something you didn't say (e.g., it adds a feature you never mentioned), **cancel** and re-run. The skill markdown is built to refuse additions, but verify.

---

## 5. Approve the PRD

```
/velpari-approve
```

`Doc/PRD_Pi-Velpari.md` is published. State advances to `building-rtm`.

---

## 6. Produce the RTM

```
/velpari-rtm
```

Velpari asks you to map each requirement (FR-N) from the PRD to:

- **Design element** — which module/component will satisfy this requirement
- **Implementation / Helper Function** — which function (and where) implements it
- **Test case** — how you'll verify it

The RTM table is industry-standard format with columns: `Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status`.

For the TODO CLI example:

| Req ID | Description | Source | Design Element | Implementation | Test Case | Status |
|---|---|---|---|---|---|---|
| FR-01 | Show all TODOs by default | PRD §3.1 | CLI main | `src/cli.ts:listAll()` | TC-001 | Planned |
| FR-02 | Filter by status | PRD §3.1 | CLI main | `src/cli.ts:listByStatus()` | TC-002 | Planned |
| FR-03 | Plain text output with line numbers | PRD §3.2 | Formatter | `src/formatter.ts:formatLine()` | TC-003 | Planned |
| FR-04 | Read from file or stdin | PRD §3.4 | Parser | `src/parser.ts:readInput()` | TC-004 | Planned |

Confirm the preview. The working copy is saved.

---

## 7. Approve the RTM

```
/velpari-approve
```

`Doc/RTM_Pi-Velpari.md` is published. State advances to `analyzing-feasibility`.

---

## 8. Produce the feasibility study

```
/velpari-feasibility
```

The LLM analyzes the approved PRD + RTM across 5 dimensions:

- **Technical** — can we build this with reasonable tech?
- **Economic** — is it worth building?
- **Legal** — any licensing issues?
- **Operational** — can we maintain it?
- **Schedule** — how long will it take?

Each dimension gets a rating (High / Medium / Low). An overall verdict is given: **Go** / **Conditional Go** / **No-Go**.

For the TODO CLI: probably Go across the board — small CLI, no unknowns.

Confirm the preview. Working copy saved.

---

## 9. Approve the feasibility

```
/velpari-approve
```

`Doc/feasibility-study.md` is published. State advances to `designing`.

---

## 10. Produce the design document

```
/velpari-design
```

The LLM produces a high-level design with sections:

- **Module Breakdown** — what modules exist
- **Data Model** — data shapes (e.g., the TODO struct)
- **Interface Contracts** — function signatures
- **Data Flow** — how data moves through the system
- **Non-Functional Considerations** — performance, error handling

Every design element traces back to a PRD FR-N. No new requirements are introduced.

Confirm the preview. Working copy saved.

---

## 11. Approve the design

```
/velpari-approve
```

`Doc/design.md` is published. State advances to `writing-pseudocode`.

---

## 12. Produce the pseudocode

```
/velpari-pseudocode
```

The LLM produces algorithmic pseudocode for every module listed in the design. Each block has:

- **Function name** (matches design.md's interface contracts)
- **Inputs** with types
- **Outputs** with types
- **Preconditions**
- **Postconditions**
- **Step-by-step logic**

Pseudocode traces to a design module. No new logic.

Confirm. Working copy saved.

---

## 13. Approve the pseudocode

```
/velpari-approve
```

`Doc/pseudocode.md` is published. State advances to `planning-tests`.

---

## 14. Produce the test plan and test cases

```
/velpari-testplan
```

Two artifacts are produced:

- **`Doc/test-plan.md`** — scope, approach, environment, entry/exit criteria.
- **`Doc/test-cases.md`** — tabular list of test cases with columns: `TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority`.

Every test case traces back to an RTM row. No test cases for requirements not in RTM.

Confirm. Both working copies saved.

---

## 15. Approve the test plan

```
/velpari-approve
```

Both files published. State advances to `planned-tests`.

**At this point you have two optional post-pipeline stages available.** Both are recommended for non-trivial projects and can be run in either order.

---

## 15a. Produce atomic functions (optional)

```
/velpari-atomic-function
```

What happens:

1. Velpari spawns **4 parallel scout agents** that read all completed `Doc/` artifacts:
   - **AF-SCOUT-1 (Helper splitter)** reads `Doc/RTM_Pi-Velpari.md`, looks at helper functions, and proposes atomic splits.
   - **AF-SCOUT-2 (Duplicate pattern finder)** reads `Doc/pseudocode.md`, finds repeated logic patterns, and proposes atomic functions for them.
   - **AF-SCOUT-3 (Requirement helper)** reads `Doc/PRD_Pi-Velpari.md`, walks each FR-N, and proposes atomic functions per requirement.
   - **AF-SCOUT-4 (Test helper)** reads `Doc/test-cases.md`, looks for test setup/teardown patterns, and proposes atomic test helpers.
2. Suggestions are deduplicated by `name + filePath` (case-insensitive, normalized to forward slashes). If two scouts propose the same atomic, the suggestions merge.
3. A **unified picker UI** shows every proposal with its name, file path, signature, purpose, and source scout. For each, you choose: **Accept**, **Reject**, or **Edit**.
4. Only accepted entries are written to the working copy at `.IDE_Plans/velpari/runs/<run-id>/atomic-function/atomic-functions.md`.

**Example proposals:**

```
AF-SCOUT-1: HF-02 "validateTodoLine" should be split into:
  - AF-01: parseStatusTag(line: string): StatusTag | null
  - AF-02: parsePriorityTag(line: string): Priority | null

AF-SCOUT-2: The pattern "if (!line.startsWith('- [')) return null" appears in 3 modules.
Propose: AF-03 isTodoLine(line: string): boolean

AF-SCOUT-3: FR-04 "include date in output" needs:
  - AF-04 formatDate(iso: string): string

AF-SCOUT-4: TC-001..TC-005 all use a 3-line setup:
  - AF-05 makeFakeTodoLine(content: string): string
```

For each, choose Accept / Reject / Edit. When done, the working copy is saved.

---

## 15b. Approve the atomic functions

```
/velpari-approve
```

`Doc/atomic-functions.md` is published with only the accepted entries. State advances to `atomic-functions-proposed` (or you can skip and go straight to handoff).

If you ran `/velpari-atomic-function` after the PRD was updated with helper functions, Velpari also writes the bidirectional references: each helper function entry in the PRD's `## Helper Functions` section gets a `calls atomic: AF-NN` line, and each atomic function entry in `Doc/atomic-functions.md` gets a `called by helper: HF-NN` line.

---

## 15c. Produce development order (optional)

```
/velpari-development-order
```

What happens:

1. Velpari spawns **4 parallel scout agents** that read all completed `Doc/` artifacts:
   - **DO-SCOUT-1 (Dependency sort)** reads `Doc/RTM_Pi-Velpari.md` and `Doc/design.md`, builds a dependency graph, and produces a topologically sorted order.
   - **DO-SCOUT-2 (Risk priority)** reads `Doc/feasibility-study.md` and `Doc/design.md`, identifies high-risk items, and proposes tackling them first.
   - **DO-SCOUT-3 (Test priority)** reads `Doc/test-plan.md`, finds test dependencies, and proposes an order that lets test coverage grow incrementally.
   - **DO-SCOUT-4 (User value)** reads `Doc/PRD_Pi-Velpari.md`, ranks requirements by user-visible value, and proposes delivering the most valuable first.
2. The 4 rankings are merged by **average rank per FR-N** (lower = earlier).
3. A **draggable list UI** shows the merged ranking. You can **accept as-is**, **drag items to reorder**, or **drop items** to exclude.
4. The final order is written to the working copy at `.IDE_Plans/velpari/runs/<run-id>/development-order/development-order.md`.

**Example merged ranking:**

```
DO-SCOUT-1: FR-01 → FR-02 → FR-04 → FR-03 (topological)
DO-SCOUT-2: FR-03 → FR-01 → FR-04 → FR-02 (risk)
DO-SCOUT-3: FR-01 → FR-02 → FR-04 → FR-03 (test coverage)
DO-SCOUT-4: FR-03 → FR-01 → FR-02 → FR-04 (user value)

Merged (average rank):
  1. FR-01 (avg 2.0)
  2. FR-03 (avg 2.5)
  3. FR-02 (avg 2.75)
  4. FR-04 (avg 3.25)

You can drag-reorder if needed.
```

---

## 15d. Approve the development order

```
/velpari-approve
```

`Doc/development-order.md` is published with the final accepted order. State advances to `development-order-proposed`.

**At this point, all 9 stages are complete (7 required + 2 optional).** You can now run `/velpari-handoff`.

---

## 16. Hand off to Senai

```
/velpari-handoff
```

What happens:

1. Velpari reads all published artifacts from `Doc/`.
2. If `Doc/atomic-functions.md` exists, it's included as document type `Atomic Functions`. If `Doc/development-order.md` exists, it's included as `Development Order`. If they don't exist (you skipped the optional stages), they're omitted.
3. Velpari packages the artifacts into `.pi/senai/architect-inputs.json` matching Senai's expected schema.
4. Validates the schema by reading Senai's `architect-inputs-config.ts` at test time (and at runtime via the schema check).
5. If Senai does not yet recognize a new document type (`Atomic Functions` or `Development Order`), Velpari logs a warning but still includes the file.
6. Writes the file.
5. State advances to `handoff-ready`.

---

## 17. Switch to Senai

Now hand off to Senai. The user runs:

```
/senai-configure-architect-inputs
```

Senai detects the handoff file and uses it as-is. Then:

```
/senai-generate-architect
```

Senai's architecture factory consumes the PRD, RTM, feasibility, design, pseudocode, and test plan to produce the project-specific architecture, agents, and skills. From there, Senai's normal flow takes over:

```
/senai-plan <mission>
```

The mission can be the same one you used for Velpari.

---

## 18. Reset / start over

If you want to discard the current run and start fresh:

```
/velpari-reset
```

You'll be asked to confirm. The `state.json` and the run directory under `.IDE_Plans/velpari/runs/<id>/` are deleted. Published `Doc/` files are preserved (delete them manually if you want a clean slate).

After reset:

```
/velpari-discuss <new-mission>
```

A new run begins with a fresh state and run id.

---

## 19. Check status at any time

```
/velpari-status
```

Renders:

- Run id
- Mission
- Current stage
- Updated timestamp
- History of completed stages with timestamps and artifact paths

Use this to remember where you are after a context compaction or a break.

---

## 20. Audit setup

```
/velpari-doctor
```

Runs all checks:

- Files config exists and is valid
- Output path parent dirs exist
- Current state is consistent
- Every approved stage has a non-empty artifact in both working and published locations
- If `handoff-ready`, the handoff file is valid
- Secret scan over all artifacts

Report is saved to `.IDE_Plans/velpari/doctor-report.md` and printed to the user.

The report opens with a **"Setup progress"** section listing each setup step as done or pending, and naming the next command to run.

---

## 21. Common pitfalls

### 21.1 "I ran a stage and the LLM added info I didn't say"

**Cause:** the skill markdown is permissive for that stage, or the LLM is being creative.
**Fix:** cancel the preview, re-run the stage, and verify the next attempt stays closer to your inputs. If the LLM keeps adding info, the skill markdown needs tightening (this is a Phase B/C iteration concern).

### 21.2 "I approved but forgot to advance"

**Cause:** you ran `/velpari-approve` but the previous stage's working copy wasn't actually written.
**Fix:** check `/velpari-status`. If the working copy is missing, re-run the stage.

### 21.3 "The handoff file isn't being picked up by Senai"

**Cause:** the schema drifted, or Senai's `/senai-configure-architect-inputs` expects a different path.
**Fix:** run `/velpari-doctor` — it reports handoff schema validity. If it fails, read Senai's `architect-inputs-config.ts` and update `handoff.ts:validateSenaiSchema` accordingly.

### 21.4 "I want to redo a stage without losing the run"

**Cause:** you want to regenerate the PRD, but keep the discussion notes.
**Fix:** that's what the working-copy model is for. Re-run the stage. The new working copy overwrites the old one. If you change your mind, you can `/velpari-reset` and start over.

### 21.5 "I want to delete a published artifact"

**Cause:** you published a bad PRD and want to redo it.
**Fix:** delete the file from `Doc/` manually, then `/velpari-reset`. Re-run the entire pipeline.

---

## 22. End-to-end checklist

A complete run produces 9–11 published artifacts:

**Core (9 — always produced):**

- [ ] `Doc/discussion-notes.md` (after `/velpari-discuss` + `/velpari-approve`)
- [ ] `Doc/PRD_Pi-Velpari.md` (auto-updated by discussion's DECISION AGENT; or `/velpari-prd` + `/velpari-approve` for full rewrite)
- [ ] `Doc/RTM_Pi-Velpari.md` (after `/velpari-rtm` + `/velpari-approve`)
- [ ] `Doc/feasibility-study.md` (after `/velpari-feasibility` + `/velpari-approve`)
- [ ] `Doc/design.md` (after `/velpari-design` + `/velpari-approve`)
- [ ] `Doc/pseudocode.md` (after `/velpari-pseudocode` + `/velpari-approve`)
- [ ] `Doc/test-plan.md` (after `/velpari-testplan` + `/velpari-approve`)
- [ ] `Doc/test-cases.md` (same step)
- [ ] `.pi/senai/architect-inputs.json` (after `/velpari-handoff`)

**Optional (2 — produced only if post-pipeline stages are run):**

- [ ] `Doc/atomic-functions.md` (after `/velpari-atomic-function` + `/velpari-approve`)
- [ ] `Doc/development-order.md` (after `/velpari-development-order` + `/velpari-approve`)

After `/velpari-handoff`, switch to Senai and run `/senai-configure-architect-inputs` followed by `/senai-generate-architect`. If you ran the optional stages, Senai will see the additional atomic functions and development order documents and use them in its architecture generation.

---

*This guide is consumed by `README.md` (linked from the user-facing entry) and `AGENTS.md` (development workflow reference).*
