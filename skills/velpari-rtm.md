---
name: velpari-rtm
description: Pi-Velpari RTM stage — orchestrate 4 visible subagents (rtm-requirement-tracer, rtm-test-case-linker, rtm-coverage-analyzer, rtm-consolidator) to derive the Requirements Traceability Matrix from the PRD, write the working copy, show preview gate.
---

# RTM Stage

Derive the Requirements Traceability Matrix (RTM) from the PRD. The handler
has already validated the gate (PRD must exist) and embedded the PRD path
in the prompt. Your job is to spawn 4 subagents in parallel, read their
reports, and write the working-copy RTM.

## Goal

By the end of this stage, `<workingCopy>` (`RTM_<projectName>.md`) has the
full traceability table, the user has approved the preview, and
`/velpari-approve` can publish the artifact to `Doc/RTM_<projectName>.md`
without surprises.

## Sequence

```
PRD (already in prompt as inputArtifact)
        │
        ▼
spawn 4 subagents in parallel via subagent() tool:
  ├─ rtm-requirement-tracer  → <scoutReportDir>/rtm-requirement-tracer-report.json
  ├─ rtm-test-case-linker    → <scoutReportDir>/rtm-test-case-linker-report.json
  ├─ rtm-coverage-analyzer   → <scoutReportDir>/rtm-coverage-analyzer-report.json
  └─ rtm-consolidator        → <scoutReportDir>/rtm-consolidator-report.json
        │
        ▼ (wait for all 4 — see Synchronization rules below)
read 4 reports
        │
        ▼
build RTM table from consolidator's rows
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

The 4 scouts live in `.pi/agents/{rtm-requirement-tracer,rtm-test-case-linker,rtm-coverage-analyzer,rtm-consolidator}.md`.
They are real subagents — they run in **visible multiplexer panes** you can
monitor. Use the `subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:` with one
  of: `rtm-requirement-tracer`, `rtm-test-case-linker`, `rtm-coverage-analyzer`,
  `rtm-consolidator`.
- **Session mode** — All 4 declare `session-mode: standalone`; do NOT pass
  `fork: true`.
- **Auto-exit** — All 4 declare `auto-exit: true`; the pane closes
  automatically after the agent finishes its turn.
- **Working directory** — Pass `cwd: <runDir>` so scouts can use relative paths.
- **Explicit output path** — Each scout's `task:` MUST include the exact
  artifact path it must write.
- **Task content** — Pass the PRD path (`<inputArtifact>`), the cross-
  references (tracer/linker/coverage reports for the consolidator), and the
  scout's own report path.
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
multiplexer pane. The `subagent()` call returns immediately.

1. **Use unique names** for every parallel subagent (e.g.
   `rtm-tracer`, `rtm-linker`, `rtm-coverage`, `rtm-consolidator`).
2. **Wait for all completion notifications before proceeding.** Do not
   continue until each one has reported back. Do not create polling tasks.
3. **If an expected file is missing, check the live widget first.**
   - Agent still `starting`/`active`/`waiting` → wait.
   - Agent `stalled` or failure received → interrupt with
     `subagent_interrupt({ name: "<name>" })` and wait once.
   - Cold-respawn only with a unique `-retry` name.
4. **Verify every artifact** with `test -s <artifactPath>` (bash):
   - File exists and is non-empty → proceed.
   - File missing or empty → do NOT respawn cold. `subagent_resume` with
     the session path.
5. **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
6. **Strict checkpoints:**
   - Do not start the consolidator until **all 3** specialist reports
     (tracer, linker, coverage) exist and are non-empty.
   - Do not write the working copy until **all 4** reports exist.
   - Do not present the preview gate until the working copy file exists.

**Live widget status reference:**

| State | Meaning |
|---|---|
| `starting` | Launched but no valid child snapshot yet |
| `active` | Doing observed runtime work |
| `waiting` | Finished a turn, open for more input |
| `stalled` | Parent lost trust in the run's health |
| `running` | Fallback for backends without child snapshots |

## Merge into final RTM

After all 4 scouts complete:

1. Read the consolidator's report — it has the consolidated rows.
2. (Optional, if gaps remain) Use `AskUserQuestion` to ask 1-3 follow-up
   questions. Cap iterations at 3 rounds.
3. Build the RTM markdown table (see "Output Format" below).
4. Write to `<workingCopy>`.

## Output Format

Write the working copy as `RTM_<projectName>.md` at `<workingCopy>`:

```markdown
# Requirements Traceability Matrix — <projectName>

## Summary
- Total FR-Ns: <N>
- Covered: <N> | Partial: <N> | Missing: <N>

## Coverage Gaps
<list of FR-Ns with status "missing" or "partial">

## Traceability

| Req ID | Requirement | Design Element | Implementation / Helper Function | Test Case(s) | Status |
|---|---|---|---|---|---|
| FR-1 | <title> | <module.fn> | HF-NN | TC-1, TC-2 | covered |
| FR-2 | <title> | <module.fn> | (none) | TC-3 | covered |
| NFR-1 | <title> | <module.fn> | (none) | TC-4 | partial |
| ... | | | | | |
```

## Helper Function Dedup (FR-27, FR-30)

Each row that references a helper function uses the `HF-NN` id from the
PRD's `## Helper Functions` section. Dedup key is `name + file path`.

If the PRD introduces a new helper function, it must also be referenced
from at least one FR-N row. Helper functions not referenced from any FR-N
are flagged in the doctor report.

## Coverage Check (NFR-04)

Every FR-N and NFR-N in the PRD must appear in the RTM. Every test case
listed must trace to at least one FR-N or NFR-N. Drift is a defect.

## Project-Name Substitution (FR-67, NFR-15)

Use `projectName` from the PRD (or `.pi/velpari/files.json`) in all
output paths. Never hardcode "Pi-Velpari" in any file path.

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
  `building-rtm` via `createRun()`. The next state transition (`built-rtm`)
  happens in `/velpari-approve`. You only write the working copy artifact.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome and the artifact path. Never paste the RTM content.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the RTM
stage. cmux, tmux, and wezterm backends target panes explicitly and are
not affected.