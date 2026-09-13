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

## Read-First Rule (HARD)

1. **Read every input artifact BEFORE asking the user anything.** The RTM
   path is in the prompt; read it fully. If PRD/brainstorm paths are
   available, read them too.
2. **Never ask a question whose answer exists in an input artifact.**
   An orchestra that asks before reading is broken.
3. **Default to "Insufficient data".** If the inputs are silent on a
   dimension, the scout marks it "Insufficient data — collect more before
   rating" and moves on. Do NOT interrupt the user for it.
4. **User questions are the LAST resort** — only for verdict-blocking gaps
   (a gap that would make the Overall Verdict meaningless), and at most
   ONE AskUserQuestion round per run.

## Sequence

```
RTM (already in prompt as inputArtifact)
        │
        ▼
READ all inputs fully (Read-First Rule)
        │
        ▼
REUSE SCAN (consent-gated — see Reuse Scan section):
  consent? → spawn feasibility-reuse-scout → checklist JSONs
        │
        ▼
score candidates (checklist math) → decision:
  ├─ reuse    → record clone details; skip language selection
  ├─ partial  → chat report + suggest /velpari-brainstorm; STOP here
  └─ build    → LANGUAGE SELECTION (see section below):
                  framework configured? → tech scout validates it (no spikes)
                  not configured?       → spikes MANDATORY, one per language
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
build feasibility study markdown from 4 reports + reuse scan results
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

## Reuse Scan (BEFORE the 4 dimension scouts)

Someone may have already built this. Cloning and upgrading a healthy
existing repo beats starting from scratch. This scan decides
**build vs reuse** with numbers, not vibes.

1. **Consent gate (like FR-52).** Ask the user once:
   > "Search the community (GitHub, package registries) for existing
   > implementations of your core functions?" — yes / no
   If no: skip the scan and record "Reuse scan: not scanned (no consent)"
   in the study. Never search without consent.
   Persist the answer: `velpari_feasibility_session({ action:
   "set-consent", consent: true|false })`.
2. **Build the core-function checklist** from the PRD FR table: each row
   is `{ id, title }`. This list is the scoring ruler.
3. **Spawn the reuse scout** (`feasibility-reuse-scout` — check the
   `## Conditional Agents` block for the resolved spawn name). Task must
   include: `<inputArtifact>` (RTM path), the core-function checklist,
   and `<reuseDir>` = `<workingCopyDir>/reuse/`.
4. **Read every checklist JSON** in `<reuseDir>/`. Validate each one:
   coverage contains exactly the core-function ids, values only
   0 / 0.5 / 1, repoUrl is http(s), license + lastCommit present.
   Invalid checklist → the candidate is dropped (note it in the chat).
5. **Score (deterministic math):**
   match% = round((sum of coverage values / core-function count) * 100).
6. **Health gate per candidate:** license missing/unknown or restrictive
   (GPL/AGPL/LGPL/SSPL/proprietary) → NOT reusable; last commit older
   than 18 months → stale → NOT reusable. High match + bad health =
   "health-blocked", never a reuse candidate.
7. **Decision thresholds:** (persist the verdict with
   `velpari_feasibility_session({ action: "set-decision", decision,
   reuseSummary: [table rows] })` — the approve gate requires it)
   - any candidate ≥ 70% AND healthy → **reuse**: show the summary table
     in chat, recommend clone + upgrade, record repo URL / commit /
     license / match% for the study. Language selection is skipped —
     the clone dictates the stack.
   - best candidate 30–69% (or health-blocked) → **partial**: show the
     summary table, then tell the user: "Partial match found. Run
     /velpari-brainstorm to discuss reuse-vs-build, then re-run
     /velpari-feasibility." STOP the stage here (no working copy yet).
   - everything < 30% (or nothing found) → **build**: record
     "no reusable implementation found" and continue.
8. **Chat summary is short** (the JSON files carry the detail):
   one table — repo | match% | license | status — plus the verdict line.

## Language Selection + Spikes (build path only)

Runs ONLY when the reuse scan verdict is **build**. Skipped entirely on
the reuse path (the clone dictates the stack). Persist every step with
the `velpari_feasibility_session` tool — the approve gate reads it.

1. **Framework already configured?** If the prompt's metadata carries a
   `Framework:` line (set via /velpari-configure-inputs), there is nothing
   to pick: `feasibility-tech` validates that stack against the RTM as
   part of its normal report. Persist
   `velpari_feasibility_session({ action: "select-language",
   selectedLanguage: <framework>, selectedBy: "config" })`. Done — no spikes.
2. **No framework → spikes are MANDATORY.** Not optional. The whole point
   of this stage is choosing the language with evidence.
3. **Pick 2–4 candidate languages WITH the user** (AskUserQuestion — this
   is a genuine decision point, not a verdict-blocking gap). Propose
   candidates that fit the RTM (e.g. a CLI tool → Node/TypeScript,
   Python, Go). Persist
   `velpari_feasibility_session({ action: "set-candidates",
   languageCandidates: [...] })`.
4. **Pick the core function to spike**: the single most representative
   FR from the PRD (hardest or most central). Name it explicitly.
5. **Spawn one `feasibility-spike` agent PER candidate language** in
   parallel (check `## Conditional Agents` for the resolved spawn name).
   Each task includes: `<language>`, `<coreFunction>`, `<inputArtifact>`
   (RTM path), `<spikeDir>` = `<workingCopyDir>/spikes/<language>/`,
   `<spikeReportPath>` = `<workingCopyDir>/spikes/<language>-result.json`.
   Agents may install dependencies ONLY inside their spikeDir.
6. **Read every spike result JSON**, then persist each:
   `velpari_feasibility_session({ action: "add-spike-result", spike: {...} })`.
   A failed spike is valuable data — record it, don't hide it.
7. **Decide:**
   - exactly ONE language passed (buildOk && runOk) → auto-select it:
     `select-language` with `selectedBy: "auto"`. Tell the user.
   - TWO OR MORE passed → the developer chooses. Show the results table
     (language | build | run | notes) and ask via AskUserQuestion. Then
     `select-language` with `selectedBy: "user"`.
   - NONE passed → STOP. Report the failures honestly and suggest
     /velpari-brainstorm to rethink scope or stack. No language selected
     = /velpari-approve will block.
8. On the **reuse** path: `select-language` with the clone's language and
   `selectedBy: "clone"`.

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
2. Ask the user ONLY for verdict-blocking gaps (see Read-First Rule):
   one AskUserQuestion round maximum. Everything else becomes
   "Insufficient data" in the study.
3. Build the feasibility study markdown (see "Output Format" below).
4. Compute the **Overall Verdict** as the worst of the 4 sub-verdicts.
5. Write to `<workingCopy>`.

## Output Format

Sections Schedule / Cost / Risk are **lightweight**: one short
paragraph + a rating each, evidence-linked to the RTM. No long essays.
Technical Feasibility and the v2 decision sections carry the depth.

Write the working copy as `feasibility-study_<projectName>.md` at `<workingCopy>`:

```markdown
---
artifact: feasibility-study
project: <projectName>
version: 1.0.0
status: draft
stage: analyzing-feasibility
run: <runId>
created: <ISO timestamp>
updated: <ISO timestamp>
---

# Feasibility Study — <projectName>

## 1. Executive Summary
<3-5 lines: what was analyzed, the decision (reuse/build), the chosen
stack, and the overall verdict.>

## 2. Options Analysis
<Reuse scan outcome. For each candidate repo: name, URL, match %,
license, last commit, health status. Or "not scanned (no consent)" /
"no candidates found".>

## 3. Build-vs-Reuse Comparison
<Why the decision went reuse or build: match % vs thresholds, license/
health findings, effort estimate of clone+upgrade vs from-scratch.>

## 4. Language Selection
<Chosen language + who picked it (clone/config/auto/user). On the build
path with spikes: results table — language | build | run | notes — and
the evidence paths. On the reuse path: the clone's language and repo.>

## 5. Technical Feasibility
<summary from feasibility-tech report, including the stack validation>
- Rating: Go / Conditional Go / No-Go

## 6. Schedule Feasibility
<summary from feasibility-schedule report — lightweight>
- Rating: Go / Conditional Go / No-Go

## 7. Cost Feasibility
<summary from feasibility-cost report — lightweight>
- Rating: Go / Conditional Go / No-Go

## 8. Risk Feasibility (Operational + Legal)
<summary from feasibility-risk report — lightweight>
- Rating: Go / Conditional Go / No-Go

## 9. Overall Verdict
<one paragraph summary + final Go / Conditional Go / No-Go>

## 10. Conditions (if Conditional Go)
<numbered list of must-meet conditions for the verdict to flip to Go>

## 11. Top 5 Risks
<numbered list with mitigation>

## 12. Open Questions
<numbered list, to be resolved before implementation begins>

## 13. Change Log
- <date> velpari initial draft
```

## Zero-Hallucination Rule (FR-22)

Every rating must trace back to a statement in the source RTM. If the RTM
is silent on a dimension, mark it "Insufficient data — collect more
before rating."

## Project-Name Substitution (FR-67, NFR-15)

Use `projectName` from the RTM (or `.pi/velpari/files.json`) in all
output paths. Never hardcode "Pi-Velpari" in any file path.

## Update Mode

When the prompt carries an `## Update Mode` block, this run REVISES the
published feasibility study in place — never rewrite it from scratch.
Explicitly name the upstream changes (from the revised RTM) that
triggered this revision.

Revision rules:

1. **Keep section structure.** Revise the existing sections and ratings
   only where the upstream changes affect them.
2. **Deprecate, don't delete.** Conditions, risks, or open questions that
   no longer apply stay in the document marked `deprecated` with a
   reason. Never delete them silently.
3. **Version bump.** Minor (x.Y.0) for additions only. Major (X.0.0)
   when anything is deprecated.
4. **Change Log entry required.** `/velpari-approve` blocks publishing
   without a new Change Log entry.
5. **New content is appended** under the existing sections.

The 4 scouts still run fresh — never reuse old scout reports.

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