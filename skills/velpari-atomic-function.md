---
name: velpari-atomic-function
description: Pi-Velpari Atomic Function stage (required Stage 6, FR-35) — orchestrate 4 visible subagents (af-source-rtm, af-source-design, af-source-prd, af-source-feas) to propose atomic function splits across the published artifacts, write the working copy, show preview gate.
---

# Atomic Function Stage

(Required Stage 6 — runs after the design stage is approved.) Read the
DB Input Slices and propose
atomic function splits — small, leaf-node functions that can be unit-tested
in isolation. The handler has already loaded the PRD, RTM, feasibility,
and design rows from the project store into the prompt's `## DB Input
Slices` block. Your job is to spawn 4
subagents in parallel, read their reports, and write the working-copy
atomic-functions doc.

## Goal

By the end of this stage, `<workingCopy>` (`atomic-functions_<projectName>.md`)
has the consolidated atomic function list, the user has approved the
preview, and the `velpari_stage_publish` tool can publish the artifact to
`Doc/atomic-functions_<projectName>.md` without surprises.

## Sequence

```
upstream artifacts (pre-loaded into the prompt's `## DB Input Slices`
block from the project store — NEVER open Doc/ files):
  - prd slice   (FR, NFR rows with prose)
  - rtm slice   (Traceability Rows)
  - feasibility slice (Decision, Spikes, Reuse Scan)
  - design slice (Modules, Module Source FRs, ADRs)
        │
        ▼
spawn 4 subagents in parallel via subagent() tool:
  ├─ af-source-rtm    → <scoutReportDir>/af-source-rtm-report.json
  ├─ af-source-design → <scoutReportDir>/af-source-design-report.json
  ├─ af-source-prd    → <scoutReportDir>/af-source-prd-report.json
  └─ af-source-feas   → <scoutReportDir>/af-source-feas-report.json
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
call the velpari_stage_publish tool (it publishes + advances stage)
```

## Subagent conventions

The 4 scouts live in `.pi/agents/{af-source-rtm,af-source-design,af-source-prd,af-source-feas}.md`.
They are real subagents — they run in **visible multiplexer panes** you can
monitor. Use the `subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:` with one
  of: `af-source-rtm`, `af-source-design`, `af-source-prd`,
  `af-source-feas`.
- **Session mode** — All 4 declare `session-mode: standalone`; do NOT pass
  `fork: true`.
- **Auto-exit** — All 4 declare `auto-exit: true`; the pane closes
  automatically after the agent finishes its turn.
- **Working directory** — Pass `cwd: <runDir>` so scouts can use relative paths.
- **Explicit output path** — Each scout's `task:` MUST include the exact
  artifact path it must write.
- **Task content** — Pass the `## DB Input Slices` block content (in
  the prompt) and the scout's own report path. Each scout's skill markdown
  describes what to extract from which slice row-set. Scouts must NOT open
  Doc/ files. The reviewer agent is the sole exception: it reads the DB
  slice AND the published Doc/ view — a mismatch is a finding.
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
4. Build the atomic-functions YAML sidecar (schema in "Output Format"
   below) and write it to `<workingCopy>`
   (`atomic-functions_<projectName>.yaml`). The YAML is the source of
   truth.
5. Render the markdown table FROM the YAML and write it to `<workingCopy>`
   (`atomic-functions_<projectName>.md`). The publish gate re-generates
   the published markdown from the YAML — the published table is always
   derived from the data, never from hand-written markdown.

## Output Format

Write TWO working-copy files at `<workingCopy>`:

### File 1: `atomic-functions_<projectName>.yaml` — source of truth

The YAML sidecar is the source of truth. The publish gate validates it
(hard-block on schema errors, including the tier-required fields) and
RE-RENDERS the published markdown from it — a markdown-only working copy
is blocked.

```yaml
project: <projectName>
version: 1.0.0
tier: basic
functions:
  - afId: AF-1
    name: validateEmail
    filePath: src/utils/validate-email.ts
    signature: "function validateEmail(email: string): boolean"
    purpose: Validates email against RFC 5322
    source: RTM
    cohesion: perfect-atomic
    verification: Test
    testable: yes
    # tier-added fields per the Atomic Profile block, e.g. basic tier:
    calledByFrIds: [FR-1, FR-2]
    designRef: M-3
    extractedFrom: HF-01
    satisfactionFrId: FR-1
    feasibilityRef: ""
changeLog: []
```

Rules: `afId` matches `AF-<n>`, no duplicates; the 8 base-core fields +
`filePath` are required at every tier; the fields listed in the prompt's
`## Atomic Profile` block are required at the configured tier (the
publish gate blocks on any missing one). Array fields
(`calledByFrIds`, `inputs`, `outputs`, `errors`, `dependencies`) are
string lists; `complexity` / `argCount` / `storyPoints` are numbers.
Update mode: never delete a function — keep it with
`status: deprecated` + a `reason`, bump the version, add a `changeLog`
entry.

### File 2: `atomic-functions_<projectName>.md` — rendered preview

Render the markdown FROM the YAML (approve re-renders it at publish
time). The schema is **tier-driven** (ISO/IEC 29110 + IEC 61508/IEC
62304). The prompt carries a `## Atomic Profile` block declaring which
fields are required at the selected tier. Use the matching schema below.

### Tier 1 — Entry (ISO/IEC 29110 entry profile; safety class A only)

8 base-core fields. Every AF must declare all of them.

```markdown
---
artifact: atomic-functions
project: <projectName>
version: 1.0.0
status: draft
stage: analyzing-atomic-functions
run: <runId>
atomicTier: entry
created: <ISO timestamp>
updated: <ISO timestamp>
---

# Atomic Functions — <projectName>

## Summary
- Tier: Entry (ISO/IEC 29110 entry profile)
- Total atomic functions: <N>

## Atomic Functions

| AF ID | Name | File Path | Signature | Purpose | Source | Cohesion | Verification | Testable |
|---|---|---|---|---|---|---|---|---|
| AF-1 | validateEmail | src/utils/validate-email.ts | function validateEmail(email: string): boolean | Validates email against RFC 5322 | RTM | perfect-atomic | Test | yes |
| ... | | | | | | | | |
```

### Tier 2 — Basic (ISO/IEC 29110 basic profile; safety class A or B)

Base-core + basic-tier cross-references (5 fields).

```markdown
| AF ID | Name | File Path | Signature | Purpose | Source | Cohesion | Verification | Testable | Called by FRs | Design ref | Extracted from HF | Satisfies FR | Feasibility ref |
```

### Tier 3 — Intermediate (ISO/IEC 29110 intermediate; safety class A or B)

Adds EARS pattern + V-Model LLD fields (11 fields). Cohesion MUST remain
`perfect-atomic` or `functional`. Complexity MUST be ≤ 10 (ISO 25010).

```markdown
| AF ID | Name | ... | EARS Pattern | Inputs | Outputs | Errors | Dependencies | DB/IO | Complexity | Coupling | ArgCount | OneLevelAbstr | NameIntent |
```

### Tier 4 — Advanced (ISO/IEC 29110 advanced; safety class B or C)

Adds INCOSE GtWR v4 + maintenance + risk fields (11 more). Full schema.

```markdown
| AF ID | Name | ... | Owner | Priority | SecurityClass | Risk | Reusability | ModifiabilityNote | StoryPoints | AcceptanceRef | TestRef | Rationale | ChangeLog |
```

### Common — Cross-references (all tiers)

```markdown
## Cross-references

| AF | Used by |
|---|---|
| AF-1 | FR-1, FR-2, FR-5 |
| AF-2 | M-1, M-3 |
| ... | |
```

## Tier rules (doctor gate enforcement)

| # | Rule | Tier | Severity |
|---|---|---|---|
| 1 | Base-core fields present | All | error |
| 2 | `cohesion` ∈ {`perfect-atomic`, `functional`} | All | error |
| 3 | `verification` ∈ {`Test`, `Demonstration`, `Inspection`, `Analysis`} | All | error |
| 4 | `testable` = `yes` | All | error |
| 5 | `complexity` ≤ 10 (ISO 25010 modifiability) | intermediate+ | error |
| 6 | `argCount` ≤ 2 preferred; warn at ≥ 3 (Clean Code) | intermediate+ | warn |
| 7 | `coupling` = `high` requires rationale | intermediate+ | warn |
| 8 | `earsPattern` ∈ 5 EARS patterns | intermediate+ | warn |
| 9 | Tier-specific fields present | matches tier | error |
| 10 | `risk` declared | advanced | error |
| 11 | `changeLog` entry present (revised docs) | advanced | error |

## Zero-Hallucination Rule (FR-22)

Every atomic function must trace back to a real call site in the PRD, RTM,
pseudocode, or test cases. If none of them mention the pattern, do not
invent an atomic function.

## Project-Name Substitution (FR-67, NFR-15)

Use `projectName` from the prompt. Never hardcode "Pi-Velpari" in any
file path.

## Update Mode

When the prompt carries an `## Update Mode` block (a published baseline
exists), revise the baseline instead of regenerating:

1. Append new entries with new AF-N IDs — never renumber or delete
   existing entries.
2. Mark superseded entries `deprecated` with a reason.
3. Bump the version and add a new Change Log entry.
   The doctor gate (called via the `velpari_stage_publish` tool) blocks publishing without it.

## Publish (auto on working-copy ready)

When the working copy is at `<workingCopy>` (verify with `test -s <workingCopy>`), call the `velpari_stage_publish` tool (no parameters). It runs the publish gate (revision + atomic-tier reviewer verdict + post-publish doctor audit), writes the published copy to `Doc/`, and advances the stage. If the tool reports gate/doctor errors, fix the working copy and call it again.

Manual fallback (when the LLM-driven publish is unavailable): `/velpari-atomic-function-approve` runs the same gate chain from the terminal.

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **Do NOT mutate `state.json.stage` directly.** Atomic function is Stage 6
  (required) and appears in `STAGE_TRANSITIONS` as
  `designed → analyzing-atomic-functions`. The stage command only writes
  the working copy; `state.json.stage` is advanced by the
  `velpari_stage_publish` tool (which `handleApprove` invokes),
  not by this skill.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome and the artifact path. Never paste the atomic functions content.

## Stage payload (DB rows) — MANDATORY before the preview gate

Phase 4 (DB-primary storage): after the working copy exists and BEFORE you
present the preview gate or call `velpari_stage_publish`, write the stage
payload at `<workingCopyDir>/payload/atomic-functions-payload.json` (the
directory that holds the working copy, plus `payload/`). The publish gate
validates it and writes the DB rows; a missing or invalid payload BLOCKS
the publish (the gate error names the exact path + problem).

Shape (unknown fields are rejected; enums must match exactly):

```json
{
  "envelope": {
    "version": 1,
    "stage": "analyzing-atomic-functions",
    "generatedAt": "2026-09-22T00:00:00Z",
    "inputs": { "design": "<sha256 hex>" },
    "reviewerVerdict": "<reviewer verdict or null>",
    "changeLog": []
  },
  "rows": {
    "atomicFunction": [{ "id": "AF-1", "name": "doThing", "signature": "doThing(): void", "tier": "basic", "criticality": "A", "sil": "none", "isLeaf": 1 }]
  }
}
```

`tier` ∈ entry | basic | intermediate | advanced. `criticality` ∈ A | B | C.
`sil` ∈ none | sil-1 | sil-2 | sil-3 | sil-4. `isLeaf` is 0 or 1. Every row
must trace to the working copy content (zero hallucination).

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the
atomic function stage. cmux, tmux, and wezterm backends target panes
explicitly and are not affected.