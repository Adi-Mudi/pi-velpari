---
name: velpari-development-order
description: Pi-Velpari Development Order stage (required Stage 9, FR-36, FR-32) — orchestrate 4 visible subagents (do-topology, do-risk, do-test, do-value) to rank modules into an implementation order, write the working copy, show preview gate.
---

# Development Order Stage

(Required Stage 9 — runs after `velpari_stage_publish` (or `/velpari-testplan-approve` fallback) on Stage 8 Test Plan.) Read the published artifacts and rank
modules into an implementation order. The 4 scouts produce 4 different
rankings (topological, risk, test-coverage, value). You (the parent LLM)
merge them into a single final order. The handler has concatenated the
relevant artifacts into the prompt. Your job is to spawn 4 subagents in
parallel, read their reports, and write the working-copy
development-order doc.

## Goal

By the end of this stage, `<workingCopy>` (`development-order_<projectName>.md`)
has the consolidated implementation order, the user has approved the
preview, and the `velpari_stage_publish` tool can publish the artifact
to `Doc/development-order_<projectName>.md` without surprises.
`/velpari-development-order-approve` remains as the manual fallback.

## Sequence

```
published artifacts (concatenated into prompt by handler):
  - Doc/design_<projectName>.md
  - Doc/PRD_<projectName>.md
  - Doc/RTM_<projectName>.md
  - Doc/feasibility-study_<projectName>.md
  - Doc/atomic-functions_<projectName>.md
  - Doc/pseudocode_<projectName>.md
  - Doc/test-plan_<projectName>.md + Doc/test-cases_<projectName>.md
        │
        ▼
spawn 4 subagents in parallel via subagent() tool:
  ├─ do-topology → <scoutReportDir>/do-topology-report.json
  ├─ do-risk     → <scoutReportDir>/do-risk-report.json
  ├─ do-test     → <scoutReportDir>/do-test-report.json
  └─ do-value    → <scoutReportDir>/do-value-report.json
        │
        ▼ (wait for all 4 — see Synchronization rules below)
read 4 reports
        │
        ▼
merge rankings into final order (weighted average of rank positions)
        │
        ▼
write working copy <workingCopy>
        │
        ▼
AskUserQuestion "Publish preview?"
        │
        ▼ (yes)
call velpari_stage_publish tool (no parameters)
```

## Subagent conventions

The 4 scouts live in `.pi/agents/{do-topology,do-risk,do-test,do-value}.md`.
They are real subagents — they run in **visible multiplexer panes** you can
monitor. Use the `subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:` with one
  of: `do-topology`, `do-risk`, `do-test`, `do-value`.
- **Session mode** — All 4 declare `session-mode: standalone`; do NOT pass
  `fork: true`.
- **Auto-exit** — All 4 declare `auto-exit: true`; the pane closes
  automatically after the agent finishes its turn.
- **Working directory** — Pass `cwd: <runDir>` so scouts can use relative paths.
- **Explicit output path** — Each scout's `task:` MUST include the exact
  artifact path it must write.
- **Task content** — Pass the concatenated published-artifacts content (in
  the prompt) and the scout's own report path. Each scout's skill markdown
  describes what to extract.
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

1. **Use unique names** for every parallel subagent (e.g. `do-topo`,
   `do-risk`, `do-test`, `do-value`).
2. **Wait for all completion notifications before proceeding.**
3. **If an expected file is missing, check the live widget first.**
   - Agent still `starting`/`active`/`waiting` → wait.
   - Agent `stalled` or failure received → interrupt and wait.
4. **Verify every artifact** with `test -s <artifactPath>` (bash).
5. **Never write a scout's artifact yourself.**
6. **Strict checkpoints:**
   - All 4 reports must exist and be non-empty before writing the working copy.

**Live widget status reference:**

| State | Meaning |
|---|---|
| `starting` | Launched but no valid child snapshot yet |
| `active` | Doing observed runtime work |
| `waiting` | Finished a turn, open for more input |
| `stalled` | Parent lost trust in the run's health |
| `running` | Fallback for backends without child snapshots |

## Merge into final order

After all 4 scouts complete:

1. Read the 4 reports. Each ranks modules 1..N.
2. Compute a **weighted average rank** for each module:
 - topology rank: weight 2 (dependencies are non-negotiable)
 - risk rank: weight 1.5 (fail-fast on unknowns)
 - test rank: weight 1 (close coverage gaps)
 - value rank: weight 1.5 (deliver user value early)
3. Sort modules by ascending weighted average rank.
4. Tie-breaker: lower topology rank wins.
5. Build the development-order YAML sidecar (schema in "Output Format"
   below) and write it to `<workingCopy>`
   (`development-order_<projectName>.yaml`). The YAML is the source of
   truth.
6. Render the markdown FROM the YAML and write it to `<workingCopy>`
   (`development-order_<projectName>.md`). The publish gate re-generates
   the published markdown from the YAML — the published doc is always
   derived from the data, never from hand-written markdown.

## Output Format

Write TWO working-copy files at `<workingCopy>`:

### File 1: `development-order_<projectName>.yaml` — source of truth

The YAML sidecar is the source of truth (D8 schema). The publish gate
validates it (hard-block on schema errors, unknown `dependsOn`
references, dependency CYCLES, and dependency-first ordering) and
RE-RENDERS the published markdown from it — a markdown-only working
copy is blocked.

```yaml
project: <projectName>
version: 1.0.0
steps:
  - id: DO-1
    module: M-3 (database-schema)
    afs: [AF-3, AF-7]
    dependsOn: []
    rationale: "No deps; foundation"
  - id: DO-2
    module: M-1 (auth-service)
    afs: [AF-1, AF-2]
    dependsOn: [DO-1]
    rationale: "Depends on schema; high-value signup path"
changeLog: []
```

Rules: step ids match `DO-<n>`, no duplicates; `module` is a required
string; `afs` lists the `AF-N` ids the step delivers (every AF from the
published atomic-functions doc must appear in exactly one step);
`dependsOn` lists step ids from THIS file — every reference must
resolve, the graph must be ACYCLIC, and a step must be listed after
every step it depends on. Update mode: never delete a step — mark it
superseded in its `rationale`, bump the version, add a `changeLog`
entry.

### File 2: `development-order_<projectName>.md` — rendered preview

Render the markdown FROM the YAML (approve re-renders it at publish
time):

```markdown
---
artifact: development-order
project: <projectName>
version: 1.0.0
status: draft
stage: ordering-development
run: <runId>
created: <ISO timestamp>
updated: <ISO timestamp>
---

# Development Order — <projectName>

## Final Order

| Rank | Module | Source | Weighted Score | Rationale |
|---|---|---|---|---|
| 1 | M-3 (database-schema) | topology 1, risk 5, test 3, value 4 | 2.95 | No deps; foundation; risk-spike de-prioritized |
| 2 | M-1 (auth-service) | topology 2, risk 4, test 1, value 1 | 1.85 | Depends on schema; high-value signup path |
| ... | | | | |

## Per-Lens Rankings

### Topology (do-topology)
1. M-3 (database-schema) — no deps
2. M-1 (auth-service) — depends on M-3
...

### Risk (do-risk)
1. M-5 (external-integration) — high novelty, spike first
2. M-1 (auth-service) — bcrypt tuning
...

### Test Coverage (do-test)
1. M-1 (auth-service) — 2 uncovered critical FRs
...

### User Value (do-value)
1. M-1 (auth-service) — must-have, blocks all flows
...

## Recommended Execution Plan

1. **Week 1-2:** M-3 (database schema) + spike on M-5 (external integration)
   AFs: AF-3, AF-7
2. **Week 3-4:** M-1 (auth-service) with full test coverage
   AFs: AF-1, AF-2
3. ...

Each step carries a mandatory `AFs: AF-N, …` list (Layer-2 ID coverage)
naming the atomic functions that step delivers. Every `AF-N` from the
published atomic-functions doc must appear in exactly one step.
```

## Zero-Hallucination Rule (FR-22)

Every module in the final order must appear in the design's module
decomposition. If a module is not in the design, do not invent an
implementation step for it.

## Project-Name Substitution (FR-67, NFR-15)

Use `projectName` from the prompt. Never hardcode "Pi-Velpari" in any
file path.

## Update Mode

When the prompt carries an `## Update Mode` block (a published baseline
exists), revise the baseline instead of regenerating:

1. Append new entries with new IDs — never renumber or delete existing
   entries.
2. Mark superseded entries `deprecated` with a reason.
3. Bump the version and add a new Change Log entry.
   The `velpari_stage_publish` tool (which same gate chain as `/velpari-development-order-approve`) blocks publishing without it.

## Publish (auto on working-copy ready)

When the working copy is at `<workingCopy>` (verify with `test -s <workingCopy>`), call the `velpari_stage_publish` tool (no parameters). It runs the publish gate (revision + artifact + post-publish doctor audit), writes the published copy to `Doc/`, and advances the stage. If the tool reports gate/doctor errors, fix the working copy and call it again.

Manual fallback (when the LLM-driven publish is unavailable): `/velpari-development-order-approve` runs the same gate chain from the terminal.

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **Do NOT mutate `state.json.stage` directly.** Development order is
  Stage 9 (required) and appears in `STAGE_TRANSITIONS` as
  `planned-tests → ordering-development`. The stage command only writes
  the working copy; `state.json.stage` is advanced by the
  `velpari_stage_publish` tool (which same gate chain as `/velpari-development-order-approve`), not by this skill.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome and the artifact path. Never paste the development order content.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the
development order stage. cmux, tmux, and wezterm backends target panes
explicitly and are not affected.