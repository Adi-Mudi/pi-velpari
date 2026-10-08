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
upstream artifacts (pre-loaded into the prompt's `## DB Input Slices`
block from the project store — NEVER open Doc/ files):
  - design slice (Modules, Module Source FRs, ADRs)
  - prd slice (FR, NFR rows with prose)
  - rtm slice (Traceability Rows)
  - feasibility slice (Decision, Spikes, Reuse Scan)
  - atomic-functions slice (AF catalog with tier/criticality)
  - pseudocode slice (blocks with content)
  - testplan slice (Test Cases + Traces — covers both test-plan and test-cases)
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
derive the execution-lane map from the dependsOn graph (Merge steps 6–8)
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

**Lane-hint track (Phase 7 / N16):** each scout *additionally* proposes a
**lane hint** in `proposals[].payload.laneHint` (optional, see the scout
templates) — which of its ranked items can run concurrently. The hints may
inform your lane derivation (Merge step 6) but never override the dependency
graph: publish-time code verifies and finalizes the map.

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
- **Task content** — Pass the `## DB Input Slices` block content (in
  the prompt) and the scout's own report path. Each scout's skill markdown
  describes what to extract from which slice row-set. Scouts must NOT open
  Doc/ files.
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
6. Derive the **execution-lane map** from the final order + the `dependsOn`
   edges — deterministic algorithm, 4 rules:
   - **Levels** — `level = 0` for a step with no deps, else
     `1 + max(level(deps))`. Levels ARE the series boundaries; same-level
     steps are the parallel candidates.
   - **Greedy lane assignment (dependency handoff)** — levels in order
     0,1,2,…; within a level, steps sorted by id. Each step joins the first
     lane whose last assigned step is its direct predecessor; else the first
     lane not yet used at this level; else a new lane `lane-<n+1>`.
     (You may use each scout's `laneHint` to pick a lane's `slug` — never to
     change the graph.)
   - **Cap** — `velpari.maxWorktrees` (files.json; legacy fallback `velpari.maxLanes`; default 4). Over the cap, the
     smallest lane merges into its most-connected neighbour; steps inside a
     lane are never reordered.
   - **Name-match** — every lane gets
     `worktree === branch === <projectSlug>/wt-<x>-<slug>`
     (e.g. `myapp/wt-1-auth`), the exact string used by
     `git worktree add ../<string> -b <string>`.
7. Record every **cross-lane** dependency as an integration point: one row
   per edge that spans lanes, `boundaryLevel` = the dependent step's level —
   the published Integration Plan and the doctor's lane-integrity check both
   read it.
8. **Code has the final word.** You may compute the map yourself, but the
   payload's `devLane` rows MUST match the algorithm — publish-time code
   verifies and finalizes; an invalid proposal blocks publish with the exact
   problems, and a cycle is never silently fixed. (Omit `devLane` from the
   payload entirely and the publish step computes it for you.)
9. Render the markdown FROM the YAML and write it to `<workingCopy>`
   (`development-order_<projectName>.md`). The publish gate re-generates
   the published markdown from the YAML — the published doc is always
   derived from the data, never from hand-written markdown. (The DB-only
   publish default writes NOTHING to `Doc/` — the published view comes from
   `/velpari-export`; the working-copy markdown + YAML stay the review
   surface.) The working copy's `## Execution Lanes` section must mirror the
   lane map you put in the payload — at publish the renderer regenerates it
   from the rows.

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
entry, and declare the bump (N27): add `bump: major|minor|patch`
(exact lowercase) to the working copy's frontmatter — `major` = ids
removed/sections reorganized (incl. any deprecation), `minor` =
backward-compatible additions, `patch` = wording only. The publish
gate blocks a missing or under-declared bump; a first publish needs no
bump.

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

## Execution Lanes

| Lane | Status | Steps (in order) | Worktree | Branch |
|---|---|---|---|---|
| lane-1 | active | DO-1, DO-3, DO-5 | <projectSlug>/wt-1-core | <projectSlug>/wt-1-core |
| lane-2 | active | DO-2, DO-4 | <projectSlug>/wt-2-integrations | <projectSlug>/wt-2-integrations |

- `git worktree add ../<projectSlug>/wt-1-core -b <projectSlug>/wt-1-core`
- `git worktree add ../<projectSlug>/wt-2-integrations -b <projectSlug>/wt-2-integrations`

lane-1: DO-1, DO-3, DO-5 … — parallel at levels 0 and 2, series handoff at
level 1. lane-2: DO-2, DO-4 … — picks up DO-4 only after DO-1 (lane-1)
merges at the level-1 boundary. State the project's real parallel groups
here — which steps run together and why — never a generic sentence.

## Integration Plan

| Order | Lane | Merge level | Gates |
|---|---|---|---|
| 1 | lane-2 | 1 | tests green + doctor audit |
| 2 | lane-1 | 2 | tests green + doctor audit |

Lane ready before its series boundary ⇒ `parked` (locked for edit); re-verify
(rebuild + tests + doctor) against the integration branch before merge.
Gate per merge: tests green + doctor audit. Lane locked for edit from merge
start until the merge commit lands.

## Lock Rules

- A lane is locked for edit once its merge starts; it unlocks when the merge
  commit lands on the integration branch.
- A lane whose steps complete before its series boundary enters `parked`
  (locked for edit) and must re-verify — rebuild + tests + doctor audit —
  against the current integration branch before it may merge.
- Every merge is gated by tests green + a doctor audit; a lane never merges
  ahead of its integration order.
- Files outside every lane's declared ownership merge only at an
  integration boundary, never inside a lane.
- A level-(N+1) step cannot start until every level-N lane it depends on
  has merged; a feeding lane with an open dependency stays blocked.

## Lane Shape

Shape: parallel (2 lanes) → series (1 step) → parallel (2 lanes) → series
(1 step) — derived from the step dependency graph, not a template.

Steps at the same level run in parallel across lanes; dependent steps stay
sequential inside one lane.

## Recommended Execution Plan

1. **Week 1-2:** M-3 (database schema) + spike on M-5 (external integration)
   AFs: AF-3, AF-7
2. **Week 3-4:** M-1 (auth-service) with full test coverage
   AFs: AF-1, AF-2
3. ...

Each step carries a mandatory `AFs: AF-N, …` list (Layer-2 ID coverage)
naming the atomic functions that step delivers. Every `AF-N` from the
published atomic-functions doc must appear in exactly one step — for BOTH
shapes (lane-shaped and legacy no-lane docs).
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
   The `velpari_stage_publish` tool (which runs the same gate chain as `/velpari-development-order-approve`) blocks publishing without it.
4. **Lanes follow the graph.** The lane map is derived from the current
   `stepDep` edges on every publish — a re-run never renumbers step ids,
   and lane ids stay stable for unchanged levels (append-only spirit: new
   steps may open `lane-<n+1>`, existing lanes keep their ids and
   name-match strings unless the graph itself changed).

## Publish (auto on working-copy ready)

When the working copy is at `<workingCopy>` (verify with `test -s <workingCopy>`), call the `velpari_stage_publish` tool (no parameters). It runs the publish gate (revision + artifact + post-publish doctor audit), publishes to the project store (DB-only default: store rows + YAML export + git commit — `Doc/` markdown only with the `velpari.markdownWrites` opt-in), and advances the stage. If the tool reports gate/doctor errors, fix the working copy and call it again.

Manual fallback (when the LLM-driven publish is unavailable): `/velpari-development-order-approve` runs the same gate chain from the terminal.

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **Do NOT mutate `state.json.stage` directly.** Development order is
  Stage 9 (required) and appears in `STAGE_TRANSITIONS` as
  `planned-tests → ordering-development`. The stage command writes the
  working copy and runs the stage-entry advance (`runStage` →
  `advanceStage`, N24-01); the next transition (`ordered-development`) is
  advanced by the `velpari_stage_publish` tool (which runs the same gate
  chain as `/velpari-development-order-approve`), not by this skill.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome and the artifact path. Never paste the development order content.

## Stage payload (DB rows) — MANDATORY before the preview gate

Phase 4 (DB-primary storage): after the working copy exists and BEFORE you
present the preview gate or call `velpari_stage_publish`, write the stage
payload at `<workingCopyDir>/payload/development-order-payload.json` (the
directory that holds the working copy, plus `payload/`). The publish gate
validates it and writes the DB rows; a missing or invalid payload BLOCKS
the publish (the gate error names the exact path + problem).

Shape (unknown fields are rejected):

```json
{
  "envelope": {
    "version": 1,
    "stage": "ordering-development",
    "generatedAt": "2026-09-22T00:00:00Z",
    "inputs": { "testplan": "<sha256 hex>" },
    "reviewerVerdict": null,
    "changeLog": []
  },
  "rows": {
    "devStep": [{ "id": "S1", "module": "core" }],
    "stepAf":  [{ "stepId": "S1", "afId": "AF-1" }],
    "stepDep": [{ "stepId": "S2", "dependsOnId": "S1" }],
    "devLane": [
      { "laneId": "lane-1", "stepId": "S1", "position": 0,
        "worktree": "<projectSlug>/wt-1-core", "branch": "<projectSlug>/wt-1-core",
        "status": "active" },
      { "laneId": "lane-1", "stepId": "S2", "position": 1,
        "worktree": "<projectSlug>/wt-1-core", "branch": "<projectSlug>/wt-1-core",
        "status": "active" }
    ],
    "devLaneXdep": [
      { "stepId": "S3", "dependsOnId": "S2", "boundaryLevel": 2 }
    ]
  }
}
```

`stepDep` must stay acyclic (D8) and `stepId <> dependsOnId` (self-edge
rejected). `afId` must reference an atomic function that exists in the
store. Every row must trace to the working copy content (zero
hallucination).

`devLane` and `devLaneXdep` are **optional** row-sets: omit `devLane` and
the publish step computes it; include it only when it matches the algorithm
(the publish-time verifier checks coverage, topology, the lane cap, the
worktree/branch name-match and every recorded `boundaryLevel` — an invalid
proposal blocks the publish with the exact problem codes, e.g.
`step-in-two-lanes`, `lane-cap`, `bad-boundary`). `worktree` and `branch`
must be identical strings (name-match rule); `status` is one of
`active`/`complete`/`parked`/`merged` (publish stamps `active`).

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the
development order stage. cmux, tmux, and wezterm backends target panes
explicitly and are not affected.