---
name: velpari-prd
description: Pi-Velpari PRD stage — orchestrate 4 visible subagents (fr-extractor, nfr-checker, helper-detector, consolidator) to convert discussion notes into a PSRS (Product and Software Requirements Specification), write the working copy at the grouped path, show preview gate.
---

# PRD Stage

Convert the discussion notes into a formal PSRS (Product and Software
Requirements Specification). The document keeps the file name
`PRD_<projectName>.md` for compatibility — only its internal structure is
the PSRS shape. The handler has already validated the gate (discussion
must exist) and embedded the discussion-notes path in the prompt. Your
job is to spawn 4 subagents in parallel, read their reports, and write
the working-copy PSRS at the grouped working-copy path.

## Goal

By the end of this stage:
- `<workingCopy>` (`PRD_<projectName>.md`) has every required PSRS
  section filled.
- The user has approved the preview.
- `/velpari-approve` can publish the artifact to
  `Doc/requirements/PRD_<projectName>.md` (grouped layout) without
  surprises.

## Compact profile metadata (when present)

When the user has run `/velpari-configure-requirements`, the prompt
includes a `## Profile (compact)` block with the selected profile id,
version, application type, domain, development method, regulated flag,
and output variant. Use it to:
- Add required sections mandated by the profile (e.g. "security",
  "audit", "compliance") as explicit subsections inside the PSRS.
- Tag FRs / NFRs that belong to a profile-required section.
- Do NOT invent requirements just because the profile lists a section.
  The trace back to the discussion is still mandatory (zero-hallucination).

If no profile is present, follow the common PSRS structure only.

## Sequence

```
discussion notes (already in prompt as inputArtifact)
        │
        ▼
spawn 4 subagents in parallel via subagent() tool:
  ├─ fr-extractor     → <scoutReportDir>/fr-extractor-report.json
  ├─ nfr-checker      → <scoutReportDir>/nfr-checker-report.json
  ├─ helper-detector  → <scoutReportDir>/helper-detector-report.json
  └─ consolidator     → <scoutReportDir>/consolidator-report.json
        │
        ▼ (wait for all 4 — see Synchronization rules below)
read 4 reports
        │
        ▼
merge reports into final PSRS structure (FRs, NFRs, Helpers)
        │
        ▼
write working copy <workingCopy>
        │
        ▼
AskUserQuestion "Publish preview?" (header "Publish", question ends with ?)
        │
        ▼ (yes)
tell user to run /velpari-approve
```

## Subagent conventions

The 4 scouts live in `.pi/agents/{fr-extractor,nfr-checker,helper-detector,consolidator}.md`.
They are real subagents — they run in **visible multiplexer panes** you can
monitor. Use the `subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:` with one
  of: `fr-extractor`, `nfr-checker`, `helper-detector`, `consolidator`.
- **Session mode** — All 4 declare `session-mode: standalone`; do NOT pass
  `fork: true`.
- **Auto-exit** — All 4 declare `auto-exit: true`; the pane closes
  automatically after the agent finishes its turn.
- **Working directory** — Pass `cwd: <runDir>` so scouts can use relative paths.
- **Explicit output path** — Each scout's `task:` MUST include the exact
  artifact path it must write.
- **Task content** — Pass the discussion-notes path (`<inputArtifact>`),
  the relevant cross-references (e.g. fr-extractor report path for
  nfr-checker / helper-detector / consolidator), and the scout's own
  report path.
- **No turn cap** — The `subagent` tool has NO turn-cap parameter. Use
  `subagent_interrupt` (Pi-backed only) if a scout hangs.
- **No isolation parameter** — The `subagent` tool has no pane-isolation or
  worktree parameter; never pass one. Each scout writes to its own file.

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
multiplexer pane. The `subagent()` call returns immediately and the agent
works in the background.

1. **Use unique names** for every parallel subagent (e.g. `prd-fr-extractor`,
   `prd-nfr-checker`, `prd-helper-detector`, `prd-consolidator`).
2. **Wait for all completion notifications before proceeding.** After
   launching parallel agents, do not continue until each one has reported
   back. Do not create polling tasks while waiting.
3. **If an expected file is missing, check the live widget first.**
   - Agent still `starting`/`active`/`waiting` → wait.
   - Agent `stalled` or failure received → interrupt with
     `subagent_interrupt({ name: "<name>" })` and wait once.
   - Cold-respawn only with a unique `-retry` name.
4. **Verify every artifact — a "completed" notice is NOT proof.** On EVERY
   completion notification, run `test -s <artifactPath>` (bash):
   - File exists and is non-empty → proceed.
   - File missing or empty → do NOT respawn cold. `subagent_resume` with
     the session path and instruct the agent to write the file.
5. **Never write a scout's artifact yourself.** If it cannot finish, fix
   the spawn and relaunch.
6. **Strict checkpoints:**
   - Do not start the consolidator until **all 3** specialist reports
     (`fr-extractor`, `nfr-checker`, `helper-detector`) exist and are
     non-empty.
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

## Merge into final PSRS

After all 4 scouts complete:

1. Read the consolidator's report — it has FRs, NFRs, Helpers, conflicts.
2. (Optional, if gaps remain) Use `AskUserQuestion` to ask 1-3 follow-up
   questions. Cap iterations at 3 rounds.
3. Build the PSRS markdown structure (see "Output Format" below).
4. Write to `<workingCopy>` (grouped working-copy path).

## Output Format (PSRS)

Write the working copy as `PRD_<projectName>.md` at `<workingCopy>`.
The document header MUST include the PSRS YAML frontmatter and the
mandatory sections in this order. Doctor validates the structure.

```markdown
---
documentType: product-software-requirements
version: 1.0.0
status: draft
profile: <profileId>
profileVersion: 1.0.0
mission: <mission>
projectName: <projectName>
---

# Product and Software Requirements Specification — <projectName>

## 1. Objective
<one paragraph summary>

## 2. Problem
<what problem this solves>

## 3. System Actors
<primary, secondary, tertiary users>

## 4. Scope
<in-scope / out-of-scope summary>

## 5. MVP
### MVP Goal
<one paragraph>

### MVP Users
<primary users for the first release>

### MVP Requirements
- FR-01
- FR-02

### Explicitly Not in MVP
- <item>

### MVP Exit Criteria
- <measurable criterion>

## 6. Phases
### Phase 0 — Foundation
#### Goal
#### Requirements
#### Acceptance Criteria
#### Dependencies
#### Risks
#### Out of Scope

### Phase 1 — MVP
<same shape as Phase 0>

### Phase 2 — Essential improvements
<same shape>

### Phase 3 — Advanced features
<same shape>

### Phase 4 — Scale and optimization
<same shape>

## 7. Functional Requirements

| ID | Requirement | Priority | Acceptance | Verification |
|---|---|---|---|---|
| FR-01 | <title> | must | <acceptance> | Integration test |
| FR-02 | ... | ... | ... | ... |

## 8. Non-Functional Requirements

| ID | Category | Requirement | Verification |
|---|---|---|---|
| NFR-01 | performance | <metric> | Performance test |

## 9. Data and Interfaces

| ID | Type | Name | Requirement | Source |
|---|---|---|---|---|
| DATA-01 | Entity | Expense | amount + category + owner + ts | FR-01 |

## 10. Errors and Edge Cases

| ID | Condition | Expected Behavior |
|---|---|---|
| ERR-01 | amount <= 0 | reject with validation error |

## 11. Constraints
<numbered list>

## 12. Dependencies and Risks
<numbered list>

## 13. Out of Scope
<numbered list>

## 14. Open Questions

| ID | Question | Impact | Owner | Status |
|---|---|---|---|---|
| Q-01 | <question> | <impact> | <owner> | Open |

## 15. Acceptance Criteria
<numbered list, each verifiable>

## 16. Helper Function Candidates

| ID | Name | Purpose | Source Requirements | Inputs | Outputs | Errors | Testable |
|---|---|---|---|---|---|---|---|
| HF-01 | validateExpense | Validate expense data. | FR-01 | amount | validated | invalid amount | yes |

## 17. Change Log
- <date> <author> <change>
```

## Zero-Hallucination Rule (FR-22)

Every FR-N, NFR-N, and HF-NN entry must trace back to a statement in the
discussion notes (`<inputArtifact>`). If the discussion does not mention
something, do not invent it. Profile-required sections must be present
but may be empty or reference open questions.

## Project-Name Substitution (FR-67, NFR-15)

Read `projectName` from `.pi/velpari/files.json` (also available in the
stage prompt's framework context if captured there). Use it in all output
paths. Never hardcode "Pi-Velpari" in any file path.

## Path layout (Phase 7)

- Working copy: `<runDir>/prd/PRD_<projectName>.md` (grouped working-copy layout)
- Published copy after approval: `Doc/requirements/PRD_<projectName>.md`

Legacy flat path `Doc/PRD_<projectName>.md` is still readable as fallback
but new writes go to the grouped layout.

## Preview Gate

After writing the working copy, ask the user:

> Publish preview?
> - yes — the working copy is ready, run /velpari-approve
> - no — I'll add changes first
> - edit — let me specify which sections to revise

(Use AskUserQuestion with 3 options, header `Publish`, question ending with `?`.)

If yes → tell the user: "Run /velpari-approve to publish."
If no → ask which sections to revise, iterate, repeat the preview.

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **Do NOT mutate `state.json.stage`.** The handler already advanced to
  `drafting-prd` via `createRun()`. The next state transition
  (`drafted-prd`) happens in `/velpari-approve`. You only write the
  working copy artifact.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome (working copy written, preview approved) and the artifact path.
  Never paste the PRD content into the message.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the PRD
stage. cmux, tmux, and wezterm backends target panes explicitly and are
not affected.