---
name: velpari-prd
description: Pi-Velpari PRD stage — orchestrate 4 visible subagents (fr-extractor, nfr-checker, helper-detector, consolidator) to convert brainstorm notes into a PSRS (Product and Software Requirements Specification), write the working copy at the grouped path, show preview gate.
---

# PRD Stage

Convert the brainstorm notes into a formal PSRS (Product and Software
Requirements Specification). The document keeps the file name
`PRD_<projectName>.md` for compatibility — only its internal structure is
the PSRS shape. The handler has already validated the gate (brainstorm
must exist) and embedded the brainstorm-notes path in the prompt. Your
job is to spawn 4 subagents in parallel, read their reports, and write
the working-copy PSRS at the grouped working-copy path.

## Goal

By the end of this stage:
- `<workingCopy>` (`PRD_<projectName>.md`) has every required PSRS
  section filled (20 sections, including User Stories, Success Metrics,
  and Glossary).
- The user has approved the preview.
- the `velpari_stage_publish` tool can publish the artifact to
  `Doc/requirements/PRD_<projectName>.md` (grouped layout) without
  surprises. `/velpari-prd-approve` remains as the manual fallback.

## Compact profile metadata (when present)

When the user has run `/velpari-configure-requirements`, the prompt
includes a `## Profile (compact)` block with the selected profile id,
version, application type, domain, development method, regulated flag,
and output variant. Use it to:
- Add required sections mandated by the profile (e.g. "security",
  "audit", "compliance") as explicit subsections inside the PSRS.
- Tag FRs / NFRs that belong to a profile-required section.
- Do NOT invent requirements just because the profile lists a section.
  The trace back to the brainstorm is still mandatory (zero-hallucination).

If no profile is present, follow the common PSRS structure only.

## Sequence

```
brainstorm notes (already in prompt as inputArtifact)
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
call velpari_stage_publish tool (no parameters)
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
- **Task content** — Pass the brainstorm-notes path (`<inputArtifact>`),
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

## 4. User Stories

| ID | Actor | Story | Source | Status |
|---|---|---|---|---|
| US-01 | <actor> | As a <actor>, I want <goal> so that <benefit>. | FR-01 | proposed |

## 5. Scope
<in-scope / out-of-scope summary>

## 6. MVP
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

## 7. Success Metrics

| ID | Metric | Target | Measurement | Status |
|---|---|---|---|---|
| SM-01 | <metric name> | <measurable target> | <how it is measured> | proposed |

## 8. Phases
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

## 9. Functional Requirements

| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |
|---|---|---|---|---|---|---|
| FR-01 | When a user submits a valid expense, the system SHALL save it | must | 1 | expense persisted and listed | Integration test | proposed |
| FR-02 | ... | ... | ... | ... | ... | ... |

## 10. Non-Functional Requirements

| ID | Category | Requirement | Phase | Verification | Status |
|---|---|---|---|---|---|
| NFR-01 | performance | <metric> | 1 | Performance test | proposed |

## 11. Data and Interfaces

| ID | Type | Name | Requirement | Source |
|---|---|---|---|---|
| DATA-01 | Entity | Expense | amount + category + owner + ts | FR-01 |

## 12. Errors and Edge Cases

| ID | Condition | Expected Behavior |
|---|---|---|
| ERR-01 | amount <= 0 | reject with validation error |

## 13. Constraints
<numbered list>

## 14. Dependencies and Risks
<numbered list>

## 15. Out of Scope
<numbered list>

## 16. Open Questions

| ID | Question | Impact | Owner | Status |
|---|---|---|---|---|
| Q-01 | <question> | <impact> | <owner> | Open |

## 17. Acceptance Criteria
<numbered list, each verifiable>

## 18. Helper Function Candidates

| ID | Name | Purpose | Source Requirements | Inputs | Outputs | Errors | Testable |
|---|---|---|---|---|---|---|---|
| HF-01 | validateExpense | Validate expense data. | FR-01 | amount | validated | invalid amount | yes |

## 19. Glossary

| Term | Definition |
|---|---|
| <term> | <meaning> |

## 20. Change Log
- <date> <author> <change>
```

New rows in the User Stories, Success Metrics, Functional Requirements,
and Non-Functional Requirements tables always default to status
`proposed`. Valid status values: `proposed | approved | implemented |
verified | deferred | deprecated`.

The Functional Requirements and Non-Functional Requirements tables MUST
carry a `Phase` column (positive integer). Phase 1 = MVP. Every FR id
listed in §6 "MVP Requirements" must have Phase 1; later phases
(2, 3, ...) match §8 Phases. Doctor errors on a missing Phase column,
a non-integer value, or an MVP-listed FR whose phase is not 1.

## Requirement Wording (RFC 2119 + EARS)

Every FR and NFR row must use RFC 2119 keywords and the EARS sentence
shape:

- Keywords: **MUST / SHALL** (required), **SHOULD** (recommended),
  **MAY** (optional). Doctor warns on FR rows whose requirement text
  carries no keyword.
- EARS shape: `When <trigger>, the system SHALL <response>` for
  event-driven rules; `The system SHALL <response>` for unconditional
  ones; `While <state>, the system SHOULD <response>` for state-driven
  ones.
- One requirement per row. Never join two rules with "and".

## Zero-Hallucination Rule (FR-22)

Every FR-N, NFR-N, HF-NN, US-NN, and SM-NN entry must trace back to a
statement in the brainstorm notes (`<inputArtifact>`). User stories trace
to actors and goals in the brainstorm; success metrics trace to MVP exit
criteria or brainstorm statements. If the brainstorm does not mention
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

## Update Mode

When the prompt carries an `## Update Mode` block, this run REVISES the
published baseline — never regenerate the PSRS from scratch. The block
names the baseline path and embeds the full published document as a
read-only reference.

Revision rules:

1. **Append-only IDs.** Keep every existing US-NN / SM-NN / FR-NN /
   NFR-NN / HF-NN ID. Never renumber or reuse an ID. Append new rows at
   the next free number per prefix.
2. **Deprecate, don't delete.** A removed requirement stays in its table
   with status `deprecated` and the reason recorded. Never delete the
   row.
3. **Version bump.** Minor (x.Y.0) when the revision only adds rows.
   Major (X.0.0) when anything is deprecated or an acceptance criterion
   changes.
4. **Change Log entry required.** Add a new entry under `## 20. Change
   Log` describing the revision. The `velpari_stage_publish` tool (which
   same gate chain as `/velpari-prd-approve`) blocks publishing a revision
   with no new Change Log entry, dropped IDs, or a missing version bump.
5. **New rows start `proposed`.** New rows in the User Stories, Success
   Metrics, Functional Requirements, and Non-Functional Requirements
   tables default to status `proposed`. Full lifecycle: `proposed |
   approved | implemented | verified | deferred | deprecated`.

The 4 scouts still run fresh — never reuse old scout reports. Instruct
each scout to compare the published baseline against the new brainstorm
notes and report add / modify / deprecate proposals, which you merge
into the revised working copy.

## Publish (auto on working-copy ready)

When the working copy is at `<workingCopy>` (verify with `test -s <workingCopy>`), call the `velpari_stage_publish` tool (no parameters). It runs the publish gate (revision + artifact + post-publish doctor audit), writes the published copy to `Doc/`, and advances the stage. If the tool reports gate/doctor errors, fix the working copy and call it again.

Manual fallback (when the LLM-driven publish is unavailable): `/velpari-prd-approve` runs the same gate chain from the terminal.

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **Do NOT mutate `state.json.stage`.** The handler already advanced to
  `drafting-prd` via `createRun()`. The next state transition
  (`drafted-prd`) happens in the `velpari_stage_publish` tool (which
  same gate chain as `/velpari-prd-approve`). You only write the working
  copy artifact.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome (working copy written, preview approved) and the artifact path.
  Never paste the PRD content into the message.

## Stage payload (DB rows) — MANDATORY before the preview gate

Phase 4 (DB-primary storage): after the working copy exists and BEFORE you
present the preview gate or call `velpari_stage_publish`, write the stage
payload at `<workingCopyDir>/payload/prd-payload.json` (the directory that
holds the working copy, plus `payload/`). The publish gate validates it and
writes the DB rows; a missing or invalid payload BLOCKS the publish (the
gate error names the exact path + problem).

Shape (unknown fields are rejected; enums must match exactly):

```json
{
  "envelope": {
    "version": 1,
    "stage": "drafting-prd",
    "generatedAt": "2026-09-22T00:00:00Z",
    "inputs": { "brainstorm": "<sha256 hex>" },
    "reviewerVerdict": null,
    "changeLog": []
  },
  "rows": {
    "fr":         [{ "id": "FR-1", "phase": 1, "textHash": "<sha256 of the FR text>" }],
    "nfr":        [{ "id": "NFR-1", "phase": 1, "textHash": "<sha256 of the NFR text>" }],
    "prdSection": [{ "no": 1, "title": "Purpose", "bodyRef": null }]
  }
}
```

PRD ONLY (G8 mirror check): when a PRD markdown is ALREADY published
(`Doc/requirements/PRD_<project>.md` — a revision; write-alongside mode or a
legacy project), `inputs` MUST include
`"prd-file": "<sha256 hex of that already-published PRD markdown>"` — the
gate recomputes that hash BEFORE the publish rewrites the file and aborts on
mismatch. On a first publish (no such file yet) the key is optional and the
mirror check is skipped.

Every row must trace to the working copy content (zero hallucination).

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the PRD
stage. cmux, tmux, and wezterm backends target panes explicitly and are
not affected.