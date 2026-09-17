---
name: velpari-reviewer
description: Pi-Velpari Reviewer Orchestration — parent-LLM program: spawn the reviewer sub-agent after the N source scouts finish, consume the verdict JSON, surface to the preview gate. (Used by Stage 6 atomic-function today; future stages pseudocode/testplan/design.)
---

# Reviewer Orchestration

The reviewer sub-agent is the **only adversarial critic** in Velpari. All
other scouts propose; the reviewer critiques. The parent LLM invokes
the reviewer after the source scouts finish and after the draft is
merged, but before the preview gate.

The reviewer verdict is the **single source of truth** for tier checks.
The doctor gate consumes the verdict but does not re-derive any rule.

## Goal

After this orchestration, `<reviewerReport>` exists at the assigned path,
contains a valid `verdict` JSON, and the parent LLM has applied the
verdict's `needs-fix` items to the working copy (or surfaced
`block` items to the user).

## Sequence

```
N source scouts finish (e.g. af-source-rtm, -design, -prd, -feas)
  │
  ▼
parent LLM merges the N reports into a working-copy draft
  │
  ▼
parent LLM spawns `reviewer` via subagent() tool:
  - agent: reviewer
  - cwd: <runDir>
  - task: full task description (see "Inputs to pass to the reviewer")
  - auto-exit: true
  - the reviewer writes its JSON verdict to <reviewerReport>
  │
  ▼
parent LLM reads <reviewerReport>
  │
  ├── verdict === "approve"     → proceed to preview gate
  ├── verdict === "needs-fix"   → apply fixes to working copy,
  │                                re-spawn reviewer, re-check
  └── verdict === "block"       → notify user, stop the stage,
                                   write a diagnostic report
  │
  ▼
preview gate (existing — unchanged)
```

## Inputs to pass to the reviewer

In the `task:` argument of the `subagent()` call, pass:

```yaml
stageArtifact: "<artifact key, e.g. atomic-functions>"
tier: "<entry | basic | intermediate | advanced>"
safetyClass: "<A | B | C>"
sil: "<none | 1 | 2 | 3 | 4>"
baseCoreFields:
  - afId
  - name
  - purpose
  - signature
  - source
  - cohesion
  - verification
  - testable
tierFields:
  # populated from profile.tier (see core/atomic-tier.ts:TIER_FIELDS)
  - <list of required tier-specific fields>
overlayId: "<id or null>"
scoutReports:
  - "<abs path>/af-source-rtm-report.json"
  - "<abs path>/af-source-design-report.json"
  - "<abs path>/af-source-prd-report.json"
  - "<abs path>/af-source-feas-report.json"
  # extend as N grows (other stages)
workingCopy: "<abs path of the draft the parent LLM wrote>"
reviewerReportPath: "<abs path>/reviewer-report.json"
```

The reviewer reads every input above and writes one verdict JSON to
`reviewerReportPath`.

## Verdict handling

The reviewer verdict JSON shape:

```json
{
  "verdict": "approve" | "needs-fix" | "block",
  "issues": [
    {
      "severity": "error" | "warning" | "info",
      "rule": "<rule-id>",
      "location": "<AF-N | working-copy>",
      "message": "...",
      "suggestion": "..."
    }
  ],
  "summary": "Reviewed N scout reports + working copy; ...",
  "timestamp": "ISO-8601"
}
```

### approve
- No errors. Warnings and infos are advisory.
- Parent LLM proceeds to the existing preview gate.
- The verdict JSON is preserved in `<runDir>/<stage>/scouts/reviewer-report.json` for the publish gate.

### needs-fix
- One or more errors that the parent LLM can fix in the working copy.
- Loop: apply fixes to working copy → re-spawn reviewer → re-check.
- Maximum 2 iterations. After 2 needs-fix iterations, escalate to `block`.

### block
- One or more errors that require human intervention (e.g.
  contradictory source artifacts the parent LLM cannot reconcile).
- Parent LLM stops the stage.
- Writes a diagnostic report at `<runDir>/<stage>/reviewer-block.md`
  summarizing the verdict + suggested user actions.
- Notifies the user via `ctx.ui.notify("Reviewer blocked: <summary>",
  "error")`.

## Tier gate (when to spawn the reviewer)

The reviewer is **not** spawned at every tier. The registry filters the
scout slot via `filterReviewerSlot` based on:

| # | Tier | Reviewer spawns? |
|---|---|---|
| 1 | Entry | **No** (overhead > value) |
| 2 | Basic | **No** (doctor covers) |
| 3 | Intermediate | **Opt-in** via `--velpari-run-reviewer` flag |
| 4 | Advanced | **Yes** (required) |

Additionally, the reviewer always spawns when the active standards
overlay declares `requiresReviewer: true` (medical / industrial /
financial / cloud).

The orchestration prompt's `## Atomic Profile` block already declares
the tier. The parent LLM does NOT need to re-check the gate — the
registry has already filtered the slot. If the reviewer slot is missing,
the registry skipped it.

## Output

After the verdict lands:

1. `<runDir>/<stage>/scouts/reviewer-report.json` exists with the verdict.
2. If `verdict === "needs-fix"` and the parent LLM applied fixes, the
   working copy at `<workingCopy>` reflects the fixes.
3. If `verdict === "block"`, `<runDir>/<stage>/reviewer-block.md`
   exists with the user-facing diagnostic.

The verdict JSON travels with the run dir; the publish gate (doctor)
consumes it via `loadReviewerVerdict(<reviewerReportPath>)` and folds
issues into errors/warnings. See `doctor/gate.ts:runPublishGate`.

## Hard rules

- **Spawn the reviewer exactly once per stage iteration.** Do not
  re-spawn unless `verdict === "needs-fix"` and you have applied fixes.
- **Maximum 2 `needs-fix` iterations.** After 2, escalate to `block`.
- **Never let the reviewer override doctor errors.** The reviewer
  verdict is additive to the doctor gate, never subtractive.
- **Never spawn the reviewer recursively.** The reviewer is a leaf
  specialist; it does not spawn subagents.
- **Preserve verdict JSON in `<runDir>/<stage>/scouts/`** — the publish
  gate reads from there. Don't move it to `Doc/` directly.
- **Final reply ≤ 10 lines.** Just outcome + verdict + path.

## Known issues

- **zellij `close-pane` bug** (issue #19 in `pi-interactive-subagents`):
  the zellij backend's `close-pane` step can close the parent session
  instead of the reviewer pane. Workaround: do NOT manually focus the
  reviewer pane during the stage. cmux / tmux / wezterm are not
  affected.
- **Reviewer verdict stale across iterations:** when re-spawning after
  `needs-fix`, overwrite the previous verdict JSON — never append. The
  publish gate reads only the latest verdict.
