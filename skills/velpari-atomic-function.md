---
name: velpari-atomic-function
description: Pi-Velpari Atomic Function stage (optional post-pipeline, FR-35) — orchestrate 4 visible subagents (af-source-rtm, af-source-pseudocode, af-source-prd, af-source-testcases) to propose atomic function splits across the published artifacts, write the working copy, show preview gate.
---

# Atomic Function Stage

(Optional post-pipeline stage.) Read the published artifacts and propose
atomic function splits — small, leaf-node functions that can be unit-tested
in isolation. The handler has already concatenated the PRD, RTM,
pseudocode, and test cases into the prompt. Your job is to spawn 4
subagents in parallel, read their reports, and write the working-copy
atomic-functions doc.

## Goal

By the end of this stage, `<workingCopy>` (`atomic-functions_<projectName>.md`)
has the consolidated atomic function list, the user has approved the
preview, and `/velpari-approve` can publish the artifact to
`Doc/atomic-functions_<projectName>.md` without surprises.

## Sequence

```
published artifacts (concatenated into prompt by handler):
  - Doc/discussion-<slug>.md
  - Doc/PRD_<projectName>.md
  - Doc/RTM_<projectName>.md
  - Doc/feasibility-study_<projectName>.md
  - Doc/design_<projectName>.md
  - Doc/pseudocode_<projectName>.md
  - Doc/test-plan_<projectName>.md + Doc/test-cases_<projectName>.md
        │
        ▼
spawn 4 subagents in parallel via subagent() tool:
  ├─ af-source-rtm        → <scoutReportDir>/af-source-rtm-report.json
  ├─ af-source-pseudocode → <scoutReportDir>/af-source-pseudocode-report.json
  ├─ af-source-prd        → <scoutReportDir>/af-source-prd-report.json
  └─ af-source-testcases  → <scoutReportDir>/af-source-testcases-report.json
        │
        ▼ (wait for all 4 — see Synchronization rules below)
read 4 reports
        │
        ▼
merge into atomic-functions doc
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

The 4 scouts live in `.pi/agents/{af-source-rtm,af-source-pseudocode,af-source-prd,af-source-testcases}.md`.
They are real subagents — they run in **visible multiplexer panes** you can
monitor. Use the `subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:` with one
  of: `af-source-rtm`, `af-source-pseudocode`, `af-source-prd`,
  `af-source-testcases`.
- **Session mode** — All 4 declare `session-mode: standalone`; do NOT pass
  `fork: true`.
- **Auto-exit** — All 4 declare `auto-exit: true`; the pane closes
  automatically after the agent finishes its turn.
- **Working directory** — Pass `cwd: <runDir>` so scouts can use relative paths.
- **Explicit output path** — Each scout's `task:` MUST include the exact
  artifact path it must write.
- **Task content** — Pass the concatenated published-artifacts content (in
  the prompt) and the scout's own report path. Each scout's skill markdown
  describes what to extract from which artifact.
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

1. **Use unique names** for every parallel subagent (e.g. `af-rtm`,
   `af-pseudocode`, `af-prd`, `af-testcases`).
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

## Merge into final atomic-functions doc

After all 4 scouts complete:

1. Read the 4 reports. Each proposes AFs from a different source.
2. Deduplicate by `name + filePath` (lowercase, forward-slash).
3. Sort by `afId` (AF-1, AF-2, ...).
4. Build the atomic-functions markdown (see "Output Format" below).
5. Write to `<workingCopy>`.

## Output Format

Write the working copy as `atomic-functions_<projectName>.md` at `<workingCopy>`:

```markdown
# Atomic Functions — <projectName>

## Summary
- Total atomic functions: <N>
- Sources: RTM=<N>, Pseudocode=<N>, PRD=<N>, TestCases=<N>

## Atomic Functions

| AF ID | Name | File Path | Signature | Purpose | Source | Testable |
|---|---|---|---|---|---|---|
| AF-1 | validateEmail | src/utils/validate-email.ts | function validateEmail(email: string): boolean | Validates email against RFC 5322 | RTM (called by FR-1, FR-2, FR-5) | yes |
| AF-2 | parseIsoDate | src/utils/parse-iso-date.ts | function parseIsoDate(s: string): Date \| null | Parses ISO 8601 | Pseudocode (M-1, M-3) | yes |
| AF-3 | hashPassword | src/auth/hash-password.ts | function hashPassword(plain: string, cost: number): Promise<string> | Hashes with bcrypt | PRD (FR-1) | yes |
| ... | | | | | | |

## Cross-references

| AF | Used by |
|---|---|
| AF-1 | FR-1, FR-2, FR-5 |
| AF-2 | M-1, M-3 |
| ... | |
```

## Zero-Hallucination Rule (FR-22)

Every atomic function must trace back to a real call site in the PRD, RTM,
pseudocode, or test cases. If none of them mention the pattern, do not
invent an atomic function.

## Project-Name Substitution (FR-67, NFR-15)

Use `projectName` from the prompt. Never hardcode "Pi-Velpari" in any
file path.

## Preview Gate

After writing the working copy, ask the user:

> Publish preview?
> - yes — the working copy is ready, run /velpari-approve
> - no — I'll add changes first
> - edit — let me specify which atomic functions to revise

If yes → tell the user: "Run /velpari-approve to publish."

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **Do NOT mutate `state.json.stage`.** Atomic function is an optional
  post-pipeline stage; it does NOT appear in `STAGE_TRANSITIONS`. State
  is unchanged. The user simply gets the published doc.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome and the artifact path. Never paste the atomic functions content.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the
atomic function stage. cmux, tmux, and wezterm backends target panes
explicitly and are not affected.