---
name: velpari-design
description: Pi-Velpari Design stage — orchestrate 4 visible subagents (design-module-decomposer, design-contract-definer, design-data-flow-mapper, design-error-definer) to produce the high-level design, write the working copy, show preview gate.
---

# Design Stage

Produce the high-level design: module breakdown, data model, interface
contracts, data flow, error handling, and non-functional considerations.
The handler has already validated the gate (feasibility study must exist)
and embedded its path in the prompt. Your job is to spawn 4 subagents in
parallel, read their reports, and write the working-copy design.

## Goal

By the end of this stage, `<workingCopy>` (`design_<projectName>.md`)
has every section filled, the user has approved the preview, and
`/velpari-approve` can publish the artifact to
`Doc/design_<projectName>.md` without surprises.

## Sequence

```
feasibility study (already in prompt as inputArtifact)
        │
        ▼
spawn 4 subagents in parallel via subagent() tool:
  ├─ design-module-decomposer  → <scoutReportDir>/design-module-decomposer-report.json
  ├─ design-contract-definer   → <scoutReportDir>/design-contract-definer-report.json
  ├─ design-data-flow-mapper    → <scoutReportDir>/design-data-flow-mapper-report.json
  └─ design-error-definer       → <scoutReportDir>/design-error-definer-report.json
        │
        ▼ (wait for all 4 — see Synchronization rules below)
read 4 reports
        │
        ▼
build design markdown from the 4 reports
        │
        ▼
write working copy <workingCopy>
        │
        ▼
AskUserQuestion "Publish preview?"
        │
        ▼ (yes)
tell user to run /velpari-approve
```

## Subagent conventions

The 4 scouts live in `.pi/agents/{design-module-decomposer,design-contract-definer,design-data-flow-mapper,design-error-definer}.md`.
They are real subagents — they run in **visible multiplexer panes** you can
monitor. Use the `subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:` with one
  of: `design-module-decomposer`, `design-contract-definer`,
  `design-data-flow-mapper`, `design-error-definer`.
- **Session mode** — All 4 declare `session-mode: standalone`; do NOT pass
  `fork: true`.
- **Auto-exit** — All 4 declare `auto-exit: true`; the pane closes
  automatically after the agent finishes its turn.
- **Working directory** — Pass `cwd: <runDir>` so scouts can use relative paths.
- **Explicit output path** — Each scout's `task:` MUST include the exact
  artifact path it must write.
- **Task content** — Pass the feasibility-study path (`<inputArtifact>`) and
  the scout's own report path. The contract, data-flow, and error scouts
  also need the cross-references to the other scouts' reports.
- **No turn cap** — The `subagent` tool has NO turn-cap parameter. Use
  `subagent_interrupt` (Pi-backed only) if a scout hangs.
- **No isolation parameter** — The `subagent` tool has no pane-isolation or
  worktree parameter; never pass one.

**What the `subagent` tool does NOT accept:** any turn-cap parameter,
pane-isolation, worktree, alternate-prompt fields, or `systemPrompt`-style
overrides. Use `task` for the prompt, `cwd` for working directory, and
`agent` for the agent definition. If a scout hangs, use `subagent_interrupt`.

**caller_ping (child-to-parent help request):** A scout that gets stuck
mid-task can call `caller_ping({ message: "..." })`. The child exits and
the parent receives a steer notification. Use this for genuine
clarification needs, not as a normal flow.

## Synchronization and checkpoint rules

`pi-interactive-subagents` runs each subagent asynchronously in its own
multiplexer pane.

1. **Use unique names** for every parallel subagent (e.g. `design-decomposer`,
   `design-contracts`, `design-dataflow`, `design-errors`).
2. **Wait for all completion notifications before proceeding.**
3. **If an expected file is missing, check the live widget first.**
   - Agent still `starting`/`active`/`waiting` → wait.
   - Agent `stalled` or failure received → interrupt and wait.
4. **Verify every artifact** with `test -s <artifactPath>` (bash).
5. **Never write a scout's artifact yourself.**
6. **Strict checkpoints:**
   - `contract-definer`, `data-flow-mapper`, `error-definer` need
     `module-decomposer`'s report. Start them in parallel — they all read
     the input artifact. The data-flow and error scouts also benefit from
     the contract scout's report (in the second batch if needed).
   - Write the working copy only after all 4 reports exist.

**Live widget status reference:**

| State | Meaning |
|---|---|
| `starting` | Launched but no valid child snapshot yet |
| `active` | Doing observed runtime work |
| `waiting` | Finished a turn, open for more input |
| `stalled` | Parent lost trust in the run's health |
| `running` | Fallback for backends without child snapshots |

## Merge into final design

After all 4 scouts complete:

1. Read the 4 reports.
2. Build the design markdown (see "Output Format" below).
3. Write to `<workingCopy>`.

## Output Format

Write the working copy as `design_<projectName>.md` at `<workingCopy>`:

```markdown
# High-Level Design — <projectName>

## 1. Module Breakdown

| Module | Purpose | Source FRs |
|---|---|---|
| <name> | <purpose> | FR-NN, FR-MM |
| ... | | |

## 2. Data Model

| Entity | Fields | Constraints | Notes |
|---|---|---|---|
| <name> | <field list> | <constraints> | <notes> |
| ... | | | |

## 3. Interface Contracts

For each module, list public functions/classes with:
- Function name + signature
- Inputs + outputs + types
- Preconditions + postconditions
- Error cases

## 4. Data Flow

ASCII or Mermaid diagrams showing:
- User inputs → module boundaries
- Storage writes/reads
- External API calls
- Error propagation paths

## 5. Non-Functional Considerations

| Concern | Approach |
|---|---|
| Performance | <approach> |
| Security | <approach> |
| Observability | <approach> |
| Scalability | <approach> |

## 6. Error Handling

<summary from design-error-definer report>

## 7. Traceability

Every module in §1 traces back to at least one FR-N from the source PRD.
```

## Zero-Hallucination Rule (FR-22)

Every module, data entity, and interface must trace back to a statement in
the source feasibility study AND the PRD. If neither mentions it, do not
invent it.

## Project-Name Substitution (FR-67, NFR-15)

Use `projectName` from the input artifact in all output paths. Never
hardcode "Pi-Velpari" in any file path.

## Preview Gate

After writing the working copy, ask the user:

> Publish preview?
> - yes — the working copy is ready, run /velpari-approve
> - no — I'll add changes first
> - edit — let me specify which sections to revise

If yes → tell the user: "Run /velpari-approve to publish."

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **Do NOT mutate `state.json.stage`.** The handler already advanced to
  `designing` via `createRun()`. The next state transition (`designed`)
  happens in `/velpari-approve`. You only write the working copy artifact.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome and the artifact path. Never paste the design content.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the design
stage. cmux, tmux, and wezterm backends target panes explicitly and are
not affected.