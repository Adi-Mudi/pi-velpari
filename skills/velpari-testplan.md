---
name: velpari-testplan
description: Pi-Velpari Test Plan stage — orchestrate 4 visible subagents (testplan-strategy-designer, testplan-unit-test-generator, testplan-integration-test-generator, testplan-coverage-tracer) to produce test plan + test cases, write TWO working copies, show preview gate.
---

# Test Plan Stage

Produce the test plan and test cases from the pseudocode + design. The
handler has already validated the gate (pseudocode must exist) and embedded
its path in the prompt. **This stage produces TWO working copies**: the
test plan (`test-plan_<projectName>.md`) and the test cases
(`test-cases_<projectName>.md`). Your job is to spawn 4 subagents in
parallel, read their reports, and write both working copies.

## Goal

By the end of this stage:
- `<primaryWorkingCopy>` = `test-plan_<projectName>.md` (strategy + summary)
- `<additionalWorkingCopy>` = `test-cases_<projectName>.md` (specific test cases)

Both exist, the user has approved the preview, and `/velpari-approve` can
publish both to `Doc/test-plan_<projectName>.md` and
`Doc/test-cases_<projectName>.md` without surprises.

## Sequence

```
pseudocode (already in prompt as inputArtifact)
        │
        ▼
spawn 4 subagents in parallel via subagent() tool:
  ├─ testplan-strategy-designer        → <scoutReportDir>/testplan-strategy-designer-report.json
  ├─ testplan-unit-test-generator      → <scoutReportDir>/testplan-unit-test-generator-report.json
  ├─ testplan-integration-test-generator → <scoutReportDir>/testplan-integration-test-generator-report.json
  └─ testplan-coverage-tracer          → <scoutReportDir>/testplan-coverage-tracer-report.json
        │
        ▼ (wait for all 4 — see Synchronization rules below)
read 4 reports
        │
        ▼
build test plan markdown (strategy + summary) → write <primaryWorkingCopy>
        │
        ▼
build test cases markdown (specific TCs)     → write <additionalWorkingCopy>
        │
        ▼
AskUserQuestion "Publish preview?"
        │
        ▼ (yes)
tell user to run /velpari-approve
```

## Subagent conventions

The 4 scouts live in `.pi/agents/{testplan-strategy-designer,testplan-unit-test-generator,testplan-integration-test-generator,testplan-coverage-tracer}.md`.
They are real subagents — they run in **visible multiplexer panes** you can
monitor. Use the `subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:` with one
  of: `testplan-strategy-designer`, `testplan-unit-test-generator`,
  `testplan-integration-test-generator`, `testplan-coverage-tracer`.
- **Session mode** — All 4 declare `session-mode: standalone`; do NOT pass
  `fork: true`.
- **Auto-exit** — All 4 declare `auto-exit: true`; the pane closes
  automatically after the agent finishes its turn.
- **Working directory** — Pass `cwd: <runDir>` so scouts can use relative paths.
- **Explicit output path** — Each scout's `task:` MUST include the exact
  artifact path it must write.
- **Task content** — Pass the pseudocode path (`<inputArtifact>`) and the
  scout's own report path. Unit and integration test generators also need
  the strategy report.
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

1. **Use unique names** for every parallel subagent (e.g. `tp-strategy`,
   `tp-unit`, `tp-integration`, `tp-coverage`).
2. **Wait for all completion notifications before proceeding.**
3. **If an expected file is missing, check the live widget first.**
   - Agent still `starting`/`active`/`waiting` → wait.
   - Agent `stalled` or failure received → interrupt and wait.
4. **Verify every artifact** with `test -s <artifactPath>` (bash).
5. **Never write a scout's artifact yourself.**
6. **Strict checkpoints:**
   - `unit-test-generator` and `integration-test-generator` need
     `strategy-designer`'s report (to know the tools + coverage targets).
   - `coverage-tracer` needs both test generator reports.
   - All 4 must exist before writing either working copy.

**Live widget status reference:**

| State | Meaning |
|---|---|
| `starting` | Launched but no valid child snapshot yet |
| `active` | Doing observed runtime work |
| `waiting` | Finished a turn, open for more input |
| `stalled` | Parent lost trust in the run's health |
| `running` | Fallback for backends without child snapshots |

## Merge into the 2 final outputs

After all 4 scouts complete:

1. Read the 4 reports.
2. Build the test plan markdown (strategy + summary table). Write to
   `<primaryWorkingCopy>`.
3. Build the test cases markdown (specific TC table). Write to
   `<additionalWorkingCopy>`.
4. Cross-reference between the two: test plan cites "see test-cases.md §X
   for details" and vice versa.

## Output Format (BOTH files)

### File 1: `<primaryWorkingCopy>` = `test-plan_<projectName>.md`

```markdown
# Test Plan — <projectName>

## 1. Test Strategy
<from strategy-designer report>

## 2. Test Types
| Type | Scope | Target Coverage | Tools | Owner | Frequency |
|---|---|---|---|---|---|
| unit | ... | ... | ... | ... | ... |
| ... | | | | | |

## 3. Coverage Summary
<from coverage-tracer report>
- Total FRs: <N>
- Covered: <N> | Uncovered: <N>
- Uncovered FRs: <list>

## 4. Test Counts
- Unit tests: <N>
- Integration tests: <N>
- Total TCs: <N>

For specific test cases, see test-cases_<projectName>.md.
```

### File 2: `<additionalWorkingCopy>` = `test-cases_<projectName>.md`

```markdown
# Test Cases — <projectName>

## Unit Tests

| TC ID | Name | Target | Steps | Expected | Edge Cases |
|---|---|---|---|---|---|
| TC-1 | createUser with valid input returns userId | M-1.createUser | 1. ... 2. ... | userId (UUID) | valid input |
| TC-2 | createUser with duplicate email raises | M-1.createUser | ... | EmailAlreadyTaken | duplicate |
| ... | | | | | |

## Integration Tests

| TC ID | Name | Target | Modules | Steps | Expected |
|---|---|---|---|---|---|
| IT-1 | signup flow: auth → email | signup | M-1, M-2 | ... | email sent within 5s |
| ... | | | | | |

For test strategy, see test-plan_<projectName>.md.
```

## Zero-Hallucination Rule (FR-22)

Every TC must trace back to either:
- A function in the pseudocode, OR
- A cross-module data flow in the design.

If neither mentions it, do not invent the TC.

## Project-Name Substitution (FR-67, NFR-15)

Use `projectName` from the pseudocode in all output paths. Never
hardcode "Pi-Velpari" in any file path.

## Preview Gate

After writing BOTH working copies, ask the user:

> Publish preview?
> - yes — both working copies are ready, run /velpari-approve
> - no — I'll add changes first
> - edit — let me specify which sections to revise

If yes → tell the user: "Run /velpari-approve to publish both files."

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **Do NOT mutate `state.json.stage`.** The handler already advanced to
  `planning-tests` via `createRun()`. The next state transition
  (`planned-tests`) happens in `/velpari-approve`. You only write the
  working copy artifacts.
- **Write BOTH files.** `<primaryWorkingCopy>` (test-plan) AND
  `<additionalWorkingCopy>` (test-cases). Both must exist before the
  preview gate.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome and the artifact paths. Never paste the test plan content.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the test
plan stage. cmux, tmux, and wezterm backends target panes explicitly and
are not affected.