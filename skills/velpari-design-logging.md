---
name: velpari-design-logging
description: Pi-Velpari Logging Design (v1.4.0) — orchestrate 3 visible subagents in parallel: logging-standards-researcher (reads the active standards overlay + PRD + identifies applicable regimes), logging-architecture-designer (reads PRD §10 NFRs + Design §11 + §10 + picks library, format, transport, storage, retention tiers, alerting), logging-compliance-mapper (walks every regime clause, evidence-points each design decision, surfaces gaps). Produces Doc/observability/logging-plan_<project>.md with the 16-section markdown body + YAML frontmatter (YAML frontmatter + Objectives + Compliance regime + Event catalog + Log shape + Log levels + Transport + Storage + Protection + Clock sync + Monitoring + Review cadence + Correlation + Privacy + Design crosscuts + Test plan + Change log). Self-publishes when the doctor passes; otherwise the working copy stays in <runDir>/observability/ for revision.
---

# Logging Design Stage

Produce the logging architecture plan: what gets logged, at what level,
how it is shipped, where it is stored, for how long, how it is
protected, how it is monitored and reviewed. The handler has already
validated the gate (PRD + Design must exist) and embedded their
paths in the prompt. Your job is to spawn 3 subagents in parallel,
read their reports, and write the working-copy logging plan.

> **v1.4.0 self-publish discipline.** Unlike Stages 2–10, this command
> does NOT have a separate `the publish tool` step. The command
> publishes directly to `Doc/observability/logging-plan_<project>.md`
> when `core/logging-plan.ts:validateLoggingPlan(plan)` AND the
> doctor's `checkLoggingPlanSection` both pass. When either fails,
> the working copy stays in `<runDir>/observability/` and the user
> can revise and re-run.

## Goal

By the end of this stage, `Doc/observability/logging-plan_<projectName>.md`
exists with all 17 required sections filled, the doctor audit passes,
and the next stage (Senai handoff) can pick it up.

## Pre-conditions

The handler has already verified:

1. `.pi/velpari/files.json:projectName` is set.
2. State is at or past `drafted-prd` (PRD published).
3. State is at or past `designed` (Design published) — logging is a
   cross-cutting concern that needs the architecture it must log.
4. The active standards overlay (if any) loads cleanly.
5. A terminal multiplexer is active (for visible scout panes).

If any of these fail, the handler has already notified the user and
exited — you will not see this prompt.

## Sequence

```
preconditions (already verified by handler)
        │
        ▼
spawn 3 subagents in parallel via subagent() tool:
  ├─ logging-standards-researcher      → <scoutReportDir>/logging-standards-researcher-report.json
  ├─ logging-architecture-designer     → <scoutReportDir>/logging-architecture-designer-report.json
  └─ logging-compliance-mapper        → <scoutReportDir>/logging-compliance-mapper-report.json
        │
        ▼ (wait for all 3 — see Synchronization rules below)
if compliance-mapper.score.gap > 0:
  AskUserQuestion("Compliance gaps found: <gaps[0..2]>. Proceed with current design or spawn architecture-designer for round 2?")
        │
        ▼
build the LoggingPlan object (TypeScript shape from core/logging-plan.ts):
  - frontmatter: artifact=logging-plan, project=<projectName>, version=1.0.0,
                 status=approved, stage=<runStage>, run=<runId>,
                 created=<ISO>, updated=<ISO>, overlay=<id|null>
  - objectives: from PRD §1
  - complianceRegimes: from standards-researcher.regimes[]
  - eventCatalog: from architecture-designer.eventCatalog + standards-researcher.overlayLoggingRequirements.extraEventCategories
  - logShape: from architecture-designer.logShape (always include RFC 5424 mandatory fields)
  - logLevels: from architecture-designer.logLevels (always include all 8 RFC 5424 severities)
  - transport: from architecture-designer.transport
  - storage: from architecture-designer.storage
  - clockSync: from architecture-designer.clockSync
  - alerting: from architecture-designer.alerting
  - reviewCadence: from architecture-designer.reviewCadence
  - correlation: from architecture-designer.correlation
  - mapping: designCrosscutsSection="Doc/design/design_<project>.md §11", testCases=[]
  - changeLog: [{ date: <today>, author: <user>, note: "Initial publish via /velpari-design-logging" }]
        │
        ▼
call core/logging-plan.ts:renderLoggingPlanMarkdown(plan) → markdown string
        │
        ▼
call core/logging-plan.ts:validateLoggingPlan(plan)
        │
        ├─ errors → notify user with errors[], working copy stays in <runDir>/observability/
        │
        └─ no errors → atomicWriteJsonWithFrontmatter(<workingCopy>, frontmatter, body)
                │
                ▼
                re-run validateLoggingPlan on the file's parsed content
                        │
                        ├─ errors → notify user, leave working copy for revision
                        │
                        └─ no errors → atomic publish to Doc/observability/logging-plan_<project>.md
                                update state.json:loggingPlanPublishedPath
                                notify: "logging plan published; run /velpari-doctor to verify"
```

## Output format (16 required markdown sections + YAML frontmatter)

The 16 markdown sections are defined as a frozen constant in
`pi-extension/src/core/logging-plan.ts:LOGGING_PLAN_REQUIRED_SECTIONS`.
Both this skill and `doctor/checks/logging-plan.ts` import from there,
so the headings cannot drift. The YAML frontmatter is emitted by
`io/atomic-write.ts:atomicWriteJsonWithFrontmatter` and verified
separately by the doctor's frontmatter check. The order of the body
sections is:

```
## 1. Logging Objectives & Scope
## 2. Compliance Regime Map
## 3. Event Catalog
## 4. Log Shape
## 5. Log Levels
## 6. Transport
## 7. Storage & Retention
## 8. Protection
## 9. Clock Synchronization
## 10. Monitoring & Alerting
## 11. Log Review Cadence
## 12. Correlation IDs & Trace Context
## 13. Privacy Considerations
## 14. Mapping to Design Crosscuts
## 15. Mapping to Test Plan
## 16. Change Log
```

(The YAML frontmatter block is emitted by `io/atomic-write.ts:atomicWriteJsonWithFrontmatter`; the 16 headings above are the markdown body sections.)

## Subagent conventions

The 3 scouts live in `skills/agents/{logging-standards-researcher,logging-architecture-designer,logging-compliance-mapper}.md`
and are auto-bootstrapped to `.pi/agents/` on first use by
`io/agents-install.ts:ensureStageAgents`. They are real subagents —
they run in **visible multiplexer panes** you can monitor. Use the
`subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:`
  with one of: `logging-standards-researcher`, `logging-architecture-designer`,
  `logging-compliance-mapper`.
- **Session mode** — All 3 declare `session-mode: standalone`; do NOT
  pass `fork: true`.
- **Auto-exit** — All 3 declare `auto-exit: true`; the pane closes
  automatically after the agent finishes its turn.
- **Working directory** — Pass `cwd: <runDir>` so scouts can use
  relative paths.
- **Explicit output path** — Each scout's `task:` MUST include the
  exact artifact path it must write.
- **Task content** — Pass the input artifact paths
  (`<prdPath>`, `<designPath>`, `<standardsProfilePath>`) and the
  scout's own report path. The compliance-mapper needs the other
  two scouts' report paths.
- **No turn cap** — The `subagent` tool has NO turn-cap parameter. Use
  `subagent_interrupt` (Pi-backed only) if a scout hangs.
- **No isolation parameter** — The `subagent` tool has no
  pane-isolation or worktree parameter; never pass one.

**What the `subagent` tool does NOT accept:** any turn-cap parameter,
pane-isolation, worktree, alternate-prompt fields, or
`systemPrompt`-style overrides. Use `task` for the prompt, `cwd` for
working directory, and `agent` for the agent definition. If a scout
hangs, use `subagent_interrupt`.

**caller_ping (child-to-parent help request):** A scout that gets
stuck mid-task can call `caller_ping({ message: "..." })`. The child
exits and the parent receives a steer notification. Use this for
genuine clarification needs, not as a normal flow.

## Synchronization and checkpoint rules

`pi-interactive-subagents` runs each subagent asynchronously in its
own multiplexer pane.

1. **Use unique names** for every parallel subagent
   (e.g. `logging-standards`, `logging-architecture`, `logging-compliance`).
2. **Wait for all completion notifications before proceeding.**
3. **If an expected file is missing, check the live widget first.**
   - Agent still `starting`/`active`/`waiting` → wait.
   - Agent `stalled` or failure received → interrupt and wait.
4. **Verify every artifact** with `test -s <artifactPath>` (bash).
5. **Never write a scout's artifact yourself.**
6. **Strict checkpoints:**
   - The architecture-designer and compliance-mapper need the
     standards-researcher's report. Start all 3 in parallel — they
     each declare what they read in their `Inputs` section. The
     compliance-mapper is the last to finish because it joins both
     upstream reports.
   - Do NOT spawn the compliance-mapper in a second round; instead,
     if gaps > 0, ask the architecture-designer to revise in a
     second round (this is the pattern used by the design stage's
     `design-conflict-detector`).
7. **Second-round loop (only when gaps > 0):**
   - AskUserQuestion("Compliance gaps found. Spawn architecture-designer
     for round 2 with feedback, or proceed with gaps documented?")
   - If "spawn round 2": re-invoke `logging-architecture-designer`
     with the gaps as input; wait; re-invoke
     `logging-compliance-mapper`; merge.
   - Cap at 2 rounds (matches the design stage pattern).

**Live widget status reference:**

| State | Meaning |
|---|---|
| `starting` | Launched but no valid child snapshot yet |
| `active` | Doing observed runtime work |
| `waiting` | Finished a turn, open for more input |
| `stalled` | Parent lost trust in the run's health |
| `running` | Fallback for backends without child snapshots |

## Merge into final logging plan

After all 3 scouts complete (and any second-round revisions):

1. Read the 3 reports (or more, if a second round was needed).
2. Build the LoggingPlan object per the schema in
   `core/logging-plan.ts:LoggingPlan`.
3. Call `core/logging-plan.ts:renderLoggingPlanMarkdown(plan)` to get
   the markdown body.
4. Call `core/logging-plan.ts:validateLoggingPlan(plan)`.
5. If validation returns 0 errors, write to `<workingCopy>` via
   `io/atomic-write.ts:atomicWriteJsonWithFrontmatter`.
6. If validation returns ≥ 1 error, notify the user with the errors
   and leave the working copy for revision.

## Update Mode

When the published artifact `Doc/observability/logging-plan_<project>.md`
already exists, this run REVISES it in place — never rewrite it from
scratch. The handler has already read the baseline and embedded it in
the prompt as a Read-only reference.

Revision rules:

1. **Keep section ids.** Existing sections keep their headings; new
   sections are appended in the canonical order (the frozen
   `LOGGING_PLAN_REQUIRED_SECTIONS` array).
2. **Deprecate, don't delete.** A regime or event category that is
   removed stays in the document marked with a `[DEPRECATED <date>]`
   prefix. Never delete it.
3. **Version bump.** Minor (x.Y.0) for additions only. Major (X.0.0)
   when anything is deprecated or the schema changes.
4. **Change Log entry required.** Every revision adds a new entry to
   §16 with the date, author, and a one-line summary of the change.

The 3 scouts still run fresh — never reuse old scout reports.

## Overlay awareness

When the active standards overlay is one of the 4 bundled overlays
(`financial-payments`, `medical-device-b`, `industrial-ot`,
`cloud-saas`), the standards-researcher emits an
`overlayLoggingRequirements` block with:

- `retentionMonths` — minimum retention the plan must satisfy.
- `dailyReview` — whether §11 must declare daily review.
- `tamperEvident` — whether §8 must declare tamper-evident storage.
- `piiRedaction` — whether §13 must declare PII redaction at source.
- `extraEventCategories` — additional event categories the plan
  must include in §3 (e.g. `cardholder-data-access`,
  `safety-function-trigger`, `tenant-isolation-event`).

The architecture-designer reads this block and bakes the requirements
into the eventCatalog, storage tiers, and alerting rules.

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and
  relaunch.
- **Do NOT mutate `state.json.currentStage`.** The logging design is
  cross-cutting; no stage transition occurs. The handler updates
  `state.json:loggingPlanPublishedPath` only.
- **Call `renderLoggingPlanMarkdown`, not your own markdown
  formatter.** The renderer is the single source of truth for
  section order + frontmatter shape. Drift causes doctor false-
  negatives.
- **Call `validateLoggingPlan`, not your own checker.** Same reason.
- **Final message ≤ 10 lines.** When done, your reply must include
  only the outcome and the artifact path. Never paste the logging
  plan content.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij
backend's `close-pane` step can close the parent session instead of
the subagent pane. Workaround: do NOT manually focus a subagent
pane during the logging design stage. cmux, tmux, and wezterm
backends target panes explicitly and are not affected.
