---
name: velpari-rtm
description: Pi-Velpari RTM stage — orchestrate 4 visible subagents (rtm-requirement-tracer, rtm-test-case-linker, rtm-coverage-analyzer, rtm-consolidator) to derive the Requirements Traceability Matrix from the PRD, write the working copy, show preview gate.
---

# RTM Stage

Derive the Requirements Traceability Matrix (RTM) from the PSRS. RTM
remains a separate document from PSRS (see `Doc/velpari-requirements-
orchestration-design.md` §6 — RTM maps requirements to design,
implementation, helper functions, and test cases, while PSRS defines
what the system must do). The handler has already validated the gate
(PSRS must exist) and embedded its path in the prompt. Your job is to
spawn 4 subagents in parallel, read their reports, and write the
working-copy RTM.

## Goal

By the end of this stage, `<workingCopy>` (`RTM_<projectName>.md`) has the
full traceability table, the user has approved the preview, and the
`velpari_stage_publish` tool can publish the artifact to
`Doc/requirements/RTM_<projectName>.md` (grouped layout) without
surprises. `/velpari-rtm-approve` remains as the manual fallback.

## Sequence

```
PSRS (already in prompt as inputArtifact)
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
build RTM rows from consolidator's report
        │
        ▼
write working copy <workingCopy> — YAML sidecar FIRST (source of truth),
then the markdown preview generated from it
        │
        ▼
AskUserQuestion "Publish preview?"
        │
        ▼ (yes)
call velpari_stage_publish tool (no parameters)
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
- **Task content** — Pass the PSRS path (`<inputArtifact>`), the cross-
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
3. Build the RTM **YAML sidecar** from the rows (schema in "Output Format"
   below) and write it to `<workingCopy>` with a `.yaml` extension
   (`RTM_<projectName>.yaml`). The YAML is the source of truth. (A legacy
   `.json` sidecar is still accepted on read — writes are always `.yaml`.)
4. Render the markdown table FROM the YAML and write it to `<workingCopy>`
   (`RTM_<projectName>.md`) the publish gate
   re-generates the published markdown from the YAML — the published table
   is always derived from the data, never from hand-written markdown.

## Output Format

Write TWO working-copy files at `<workingCopy>`:

### File 1: `RTM_<projectName>.yaml` — source of truth

```yaml
project: <projectName>
version: 1.0.0
rows:
  - id: FR-1
    title: <requirement title>
    phase: 1
    design: "<module.fn or empty string>"
    implementation: "<HF-NN or empty string>"
    tests: [TC-1, TC-2]
    status: proposed
    coverage: covered
changeLog: []
```

Rules: `phase` is a positive integer copied from the PSRS Phase column for
the same id (1 = MVP — the publish gate blocks a mismatched phase);
`status` ∈ `proposed | approved | implemented | verified | deferred |
deprecated` (deprecated rows MUST carry a `reason` field); `coverage` ∈
`covered | partial | missing`; ids match `FR-<n>` / `NFR-<n>`, no duplicates.
Do NOT write a `fingerprint` field — the publish gate stamps it from the
published PSRS at publish time (a changed requirement then flags the row as
suspect in doctor). the publish gate validates this schema and BLOCKS the
publish on errors.

### File 2: `RTM_<projectName>.md` — rendered preview

Render the markdown FROM the YAML (approve re-renders it at publish time):

```markdown
---
artifact: RTM
project: <projectName>
version: 1.0.0
status: draft
stage: building-rtm
run: <runId>
created: <ISO timestamp>
updated: <ISO timestamp>
---

# Requirements Traceability Matrix — <projectName>

## Summary
- Total FR-Ns: <N>
- Covered: <N> | Partial: <N> | Missing: <N>

## Coverage Gaps
<list of FR-Ns with status "missing" or "partial">

## Traceability

| Req ID | Requirement | Phase | Design Element | Implementation / Helper Function | Test Case(s) | Status |
|---|---|---|---|---|---|---|
| FR-1 | <title> | 1 | <module.fn> | HF-NN | TC-1, TC-2 | covered |
| FR-2 | <title> | 1 | <module.fn> | (none) | TC-3 | covered |
| NFR-1 | <title> | 2 | <module.fn> | (none) | TC-4 | partial |
| ... | | | | | | |
```

## Helper Function Dedup (FR-27, FR-30)

Each row that references a helper function uses the `HF-NN` id from the
PSRS's `## Helper Function Candidates` section. Dedup key is `name + file path`.

If the PSRS introduces a new helper function, it must also be referenced
from at least one FR-N row. Helper functions not referenced from any FR-N
are flagged in the doctor report.

## Coverage Check (NFR-04)

Every FR-N and NFR-N in the PSRS must appear in the RTM. Every test case
listed must trace to at least one FR-N or NFR-N. Drift is a defect that
Doctor reports as part of the PSRS-to-RTM traceability section.

## Project-Name Substitution (FR-67, NFR-15)

Use `projectName` from the PSRS (or `.pi/velpari/files.json`) in all
output paths. Never hardcode "Pi-Velpari" in any file path.

## Path layout (Phase 7)

- Working copy: `<runDir>/rtm/RTM_<projectName>.md` (grouped working-copy layout)
- Published copy after approval: `Doc/requirements/RTM_<projectName>.md`

Legacy flat path `Doc/RTM_<projectName>.md` is still readable as fallback
but new writes go to the grouped layout.

## Update Mode

When the prompt carries an `## Update Mode` block, this run REVISES the
published RTM against the revised PRD — never regenerate it from scratch.
The block names the baseline path and embeds the full published RTM as a
read-only reference.

Revision rules:

1. **Append-only IDs.** New FR-NN / NFR-NN IDs from the revised PRD get
   new rows appended. Never renumber or reuse an existing Req ID.
2. **Deprecate, don't delete.** A requirement deprecated in the PRD keeps
   its RTM row with status `deprecated` and the reason recorded. Never
   delete the row.
3. **Version bump.** Minor (x.Y.0) for additions only. Major (X.0.0)
   when any row is deprecated.
4. **Change Log entry required.** Add a `## Change Log` section if the
   baseline has none, then add a new entry describing the revision. The
   `velpari_stage_publish` tool (which same gate chain as `/velpari-rtm-approve`) blocks publishing without it.
5. **New rows start `proposed`.** Full lifecycle: `proposed | approved |
   implemented | verified | deferred | deprecated`. Existing coverage
   values (`covered` / `partial` / `missing`) stay valid — update them
   only where the revision changes coverage.

The 4 scouts still run fresh — never reuse old scout reports. Instruct
each scout to diff the baseline RTM against the revised PRD and report
add / modify / deprecate proposals.

When a published `RTM_<projectName>.yaml` sidecar exists (legacy `.json`
also resolves), it is the baseline of record: apply the revision to the
sidecar rows (append-only IDs, deprecate-don't-delete with a `reason`,
version bump, new rows start `proposed`) and add a `changeLog` entry. The
publish gate verifies all four rules against the published sidecar and
blocks on violations.

## Publish (auto on working-copy ready)

When the working copy is at `<workingCopy>` (verify with `test -s <workingCopy>`), call the `velpari_stage_publish` tool (no parameters). It runs the publish gate (revision + artifact + post-publish doctor audit), writes the published copy to `Doc/`, and advances the stage. If the tool reports gate/doctor errors, fix the working copy and call it again.

Manual fallback (when the LLM-driven publish is unavailable): `/velpari-rtm-approve` runs the same gate chain from the terminal.

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **Do NOT mutate `state.json.stage`.** The handler already advanced to
  `building-rtm` via `createRun()`. The next state transition (`built-rtm`)
  happens in the `velpari_stage_publish` tool (which same gate chain as `/velpari-rtm-approve`). You only write the working copy
  artifact.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome and the artifact path. Never paste the RTM content.

## Stage payload (DB rows) — MANDATORY before the preview gate

Phase 4 (DB-primary storage): after the working copy exists and BEFORE you
present the preview gate or call `velpari_stage_publish`, write the stage
payload at `<workingCopyDir>/payload/rtm-payload.json` (the directory that
holds the working copy, plus `payload/`). The publish gate validates it and
writes the DB rows; a missing or invalid payload BLOCKS the publish (the
gate error names the exact path + problem).

Shape (unknown fields are rejected; enums must match exactly):

```json
{
  "envelope": {
    "version": 1,
    "stage": "building-rtm",
    "generatedAt": "2026-09-22T00:00:00Z",
    "inputs": { "PRD": "<sha256 hex>" },
    "reviewerVerdict": null,
    "changeLog": []
  },
  "rows": {
    "rtmRow": [{ "id": "RTM-1", "frRef": "FR-1", "afRef": null, "tcRef": null, "phase": 1, "targetSha256": "<sha256>" }]
  }
}
```

The YAML sidecar stays the RTM source of truth (B3) — the payload rows must
mirror the sidecar exactly. Every row must trace to the sidecar (zero
hallucination).

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the RTM
stage. cmux, tmux, and wezterm backends target panes explicitly and are
not affected.