---
name: velpari-feasibility
description: Pi-Velpari Feasibility stage — orchestrate 4 visible subagents (feasibility-tech, feasibility-schedule, feasibility-cost, feasibility-risk) to analyze feasibility across 4 dimensions (tech/schedule/cost/risk), write the working copy, show preview gate.
---

# Feasibility Stage

Analyze feasibility across 4 dimensions (Technical, Schedule, Cost, Risk —
combining the original 5 into 4 by folding Operational + Legal into Risk)
and produce a Go / Conditional Go / No-Go verdict. The handler has already
validated the gate (RTM must exist) and embedded the RTM path in the prompt.
Your job is to spawn 4 subagents in parallel, read their reports, and
write the working-copy feasibility study.

## Goal

By the end of this stage, `<workingCopy>`
(`feasibility-study_<projectName>.md`) has all 4 feasibility sections +
overall verdict filled, the user has approved the preview, and
`/velpari-approve` can publish the artifact to
`Doc/feasibility-study_<projectName>.md` without surprises.

## Sequence

```
RTM (already in prompt as inputArtifact)
        │
        ▼
spawn 4 subagents in parallel via subagent() tool:
  ├─ feasibility-tech      → <scoutReportDir>/feasibility-tech-report.json
  ├─ feasibility-schedule  → <scoutReportDir>/feasibility-schedule-report.json
  ├─ feasibility-cost      → <scoutReportDir>/feasibility-cost-report.json
  └─ feasibility-risk      → <scoutReportDir>/feasibility-risk-report.json
        │
        ▼ (wait for all 4 — see Synchronization rules below)
read 4 reports
        │
        ▼
build feasibility study markdown from 4 reports
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

The 4 scouts live in `.pi/agents/{feasibility-tech,feasibility-schedule,feasibility-cost,feasibility-risk}.md`.
They are real subagents — they run in **visible multiplexer panes** you can
monitor. Use the `subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:` with one
  of: `feasibility-tech`, `feasibility-schedule`, `feasibility-cost`,
  `feasibility-risk`.
- **Session mode** — All 4 declare `session-mode: standalone`; do NOT pass
  `fork: true`.
- **Auto-exit** — All 4 declare `auto-exit: true`; the pane closes
  automatically after the agent finishes its turn.
- **Working directory** — Pass `cwd: <runDir>` so scouts can use relative paths.
- **Explicit output path** — Each scout's `task:` MUST include the exact
  artifact path it must write.
- **Task content** — Pass the RTM path (`<inputArtifact>`) and the scout's
  own report path. Each scout's skill markdown describes what to extract.
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

1. **Use unique names** for every parallel subagent (e.g. `feas-tech`,
   `feas-schedule`, `feas-cost`, `feas-risk`).
2. **Wait for all completion notifications before proceeding.**
3. **If an expected file is missing, check the live widget first.**
   - Agent still `starting`/`active`/`waiting` → wait.
   - Agent `stalled` or failure received → interrupt and wait.
4. **Verify every artifact** with `test -s <artifactPath>` (bash).
5. **Never write a scout's artifact yourself.**
6. **Strict checkpoints:**
   - All 4 reports must exist and be non-empty before writing the working copy.
   - Working copy must exist before presenting the preview gate.

**Live widget status reference:**

| State | Meaning |
|---|---|
| `starting` | Launched but no valid child snapshot yet |
| `active` | Doing observed runtime work |
| `waiting` | Finished a turn, open for more input |
| `stalled` | Parent lost trust in the run's health |
| `running` | Fallback for backends without child snapshots |

## Merge into final feasibility study

After all 4 scouts complete:

1. Read the 4 reports. Each has its own verdict + proposals.
2. (Optional, if gaps remain) Use `AskUserQuestion` to ask 1-3 follow-up
   questions. Cap iterations at 3 rounds.
3. Build the feasibility study markdown (see "Output Format" below).
4. Compute the **Overall Verdict** as the worst of the 4 sub-verdicts.
5. Write to `<workingCopy>`.

## Output Format

Write the working copy as `feasibility-study_<projectName>.md` at `<workingCopy>`:

```markdown
# Feasibility Study — <projectName>

## 1. Technical Feasibility
<summary from feasibility-tech report>
- Rating: Go / Conditional Go / No-Go

## 2. Schedule Feasibility
<summary from feasibility-schedule report>
- Rating: Go / Conditional Go / No-Go

## 3. Cost Feasibility
<summary from feasibility-cost report>
- Rating: Go / Conditional Go / No-Go

## 4. Risk Feasibility (Operational + Legal)
<summary from feasibility-risk report>
- Rating: Go / Conditional Go / No-Go

## 5. Overall Verdict
<one paragraph summary + final Go / Conditional Go / No-Go>

## 6. Conditions (if Conditional Go)
<numbered list of must-meet conditions for the verdict to flip to Go>

## 7. Top 5 Risks
<numbered list with mitigation>

## 8. Open Questions
<numbered list, to be resolved before implementation begins>
```

## Zero-Hallucination Rule (FR-22)

Every rating must trace back to a statement in the source RTM. If the RTM
is silent on a dimension, mark it "Insufficient data — collect more
before rating."

## Project-Name Substitution (FR-67, NFR-15)

Use `projectName` from the RTM (or `.pi/velpari/files.json`) in all
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
  `analyzing-feasibility` via `createRun()`. The next state transition
  (`analyzed-feasibility`) happens in `/velpari-approve`. You only write
  the working copy artifact.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome and the artifact path. Never paste the feasibility content.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the
feasibility stage. cmux, tmux, and wezterm backends target panes
explicitly and are not affected.