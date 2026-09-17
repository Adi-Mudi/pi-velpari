---
name: velpari-final-design
description: Pi-Velpari Final Design stage (required Stage 10, plan 3) — orchestrate 4 visible subagents (design-consistency-checker, design-coverage-checker, design-contract-checker, design-finalizer) to consolidate the approved design + atomic functions + pseudocode + test plan + test cases + development order into one final-design document. Writes the working copy and shows a preview gate.
---

# Final Design Stage

(Required Stage 10 — runs after `velpari_stage_publish` (or `/velpari-development-order-approve` fallback) on Stage 9 Development Order.) Read the approved artifacts and
produce one consolidated final-design document that the Senai handoff can
trust. The 3 cross-check scouts surface mismatches; the finalizer writes
the consolidated doc. The handler has concatenated the input artifacts
into the prompt. Your job is to spawn 4 subagents in parallel, read their
reports, write the working-copy `final-design_<projectName>.md`, and
show a preview gate.

> **Rename history:**
> - 2026-09-13: `velpari-design` → `velpari-html-design` per plan §Phase 1 (the name was reserved for a future HTML/CSS/JS front-end mockup generator that has not shipped).
> - 2026-09-14: `velpari-html-design` → `velpari-final-design` so the user-facing command name reflects what the command actually does today — a final-design consolidation doc, not actual HTML.
>
> The skill still produces `final-design_<projectName>.md`. Real HTML mockup generation will be addressed in a future revision under whatever name fits best at that time.

## Goal

By the end of this stage, `<workingCopy>` (`final-design_<projectName>.md`)
has every section filled (Overview, Module Inventory, Contract Map,
Consistency Notes, Mismatches Found + Resolution, Final Contracts, Change
Log), the user has approved the preview, and the `velpari_stage_publish`
tool can publish the artifact to `Doc/design/final-design_<project>.md`
without surprises. `/velpari-final-design-approve` remains as the manual fallback.

## Sequence

```
published artifacts (concatenated into prompt by handler):
  - Doc/design_<projectName>.md
  - Doc/atomic-functions_<projectName>.md
  - Doc/pseudocode_<projectName>.md
  - Doc/tests/test-plan_<projectName>.md
  - Doc/tests/test-cases_<projectName>.md
  - Doc/development-order_<projectName>.md
        │
        ▼
spawn 4 subagents in parallel via subagent() tool:
  ├─ design-consistency-checker → <scoutReportDir>/design-consistency-checker-report.json
  ├─ design-coverage-checker    → <scoutReportDir>/design-coverage-checker-report.json
  ├─ design-contract-checker    → <scoutReportDir>/design-contract-checker-report.json
  └─ design-finalizer           (writes the working copy directly at <workingCopy>)
        │
        ▼ (wait for all 4 — see Synchronization rules below)
read 3 reports (consistency, coverage, contract)
        │
        ▼
verify the working copy exists; show preview
        │
        ▼
AskUserQuestion "Publish preview?"
        │
        ▼ (yes)
call velpari_stage_publish tool (no parameters)
```

## Subagent conventions

The 4 scouts live in `.pi/agents/{design-consistency-checker,design-coverage-checker,design-contract-checker,design-finalizer}.md`.
They are real subagents — they run in **visible multiplexer panes** you can
monitor. Use the `subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:` with
  one of the four role ids above.
- **Session mode** — All 4 declare `session-mode: standalone`; do NOT pass
  `fork: true`.
- **Auto-exit** — All 4 declare `auto-exit: true`; the pane closes
  automatically after the agent finishes its turn.
- **Working directory** — Pass `cwd: <runDir>` so scouts can use relative paths.
- **Explicit output path** — Each scout's `task:` MUST include the exact
  artifact path it must write. The 3 cross-checkers write JSON reports
  into `<scoutReportDir>`; the finalizer writes the working copy at
  `<workingCopy>`.
- **Task content** — Pass the concatenated published-artifacts content
  (in the prompt), the report path (or working-copy path for the
  finalizer), and the cross-references to the other scouts' inputs.
- **No turn cap** — The `subagent` tool has NO turn-cap parameter. Use
  `subagent_interrupt` (Pi-backed only) if a scout hangs.
- **No isolation parameter** — The `subagent` tool has no pane-isolation
  or worktree parameter; never pass one.

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

1. **Use unique names** for every parallel subagent.
2. **Wait for all 4 completion notifications before proceeding.**
3. **If an expected file is missing, check the live widget first.**
   - Agent still `starting`/`active`/`waiting` → wait.
   - Agent `stalled` or failure received → interrupt and wait.
4. **Verify every artifact** with `test -s <artifactPath>` (bash).
5. **Never write a scout's artifact yourself.**
6. **Strict checkpoints:**
   - All 3 JSON reports must exist and be non-empty before verifying the
     finalizer's working copy.
   - The finalizer writes the working copy. You verify it; you do not
     re-author it.

**Live widget status reference:**

| State | Meaning |
|---|---|
| `starting` | Launched but no valid child snapshot yet |
| `active` | Doing observed runtime work |
| `waiting` | Finished a turn, open for more input |
| `stalled` | Parent lost trust in the run's health |
| `running` | Fallback for backends without child snapshots |

## Mismatch handling

After all 4 scouts complete:

1. Read the 3 cross-check reports.
2. For every `error` item in any report, decide:
   - **Resolved** — the final-design doc fixes it (e.g. dropped an
     orphan id). Note this in the Mismatches section.
   - **Deferred** — keep the item but flag it with a reason. Use only
     when the user explicitly asks to defer.
   - **Blocker** — the issue cannot be resolved by the consolidated doc
     itself (e.g. a module with no pseudocode). The user must run
     `/velpari-pseudocode` again. List the run command in the Mismatches
     section.
3. Never invent resolutions. If a report says error, the Mismatches
   section must address it.

## Output Format

Write the working copy as `final-design_<projectName>.md` at `<workingCopy>`
(the finalizer writes it directly). The required sections:

1. Overview — one-paragraph summary referencing the approved design.
2. Module Inventory — table reproduced from the coverage report.
3. Contract Map — table reproduced from the contract report.
4. Consistency Notes — id mismatches, name drift, orphan ids (from the
   consistency report).
5. Mismatches Found + Resolution — table with `Source`, `Item`,
   `Resolution` columns; one row per `error` item.
6. Final Contracts — authoritative list of public contracts copied from
   the design's interface section.
7. Change Log — at least one line for this version.

## Zero-Hallucination Rule (FR-22)

Every module, ID, and contract in the final-design doc must appear in one
of the 4 input documents. Never invent.

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
   The `velpari_stage_publish` tool (which same gate chain as `/velpari-final-design-approve`) blocks publishing without it.

## Publish (auto on working-copy ready)

When the working copy is at `<workingCopy>` (verify with `test -s <workingCopy>`), call the `velpari_stage_publish` tool (no parameters). It runs the publish gate (revision + artifact + post-publish doctor audit), writes the published copy to `Doc/`, and advances the stage. If the tool reports gate/doctor errors, fix the working copy and call it again.

Manual fallback (when the LLM-driven publish is unavailable): `/velpari-final-design-approve` runs the same gate chain from the terminal.

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **The /velpari-final-design command is required (Stage 10).** It runs
  after `velpari_stage_publish` (or `/velpari-development-order-approve` fallback) on
  Stage 9 (state `ordered-development`) and before `/velpari-handoff`.
  Handoff is blocked until `finalized-design` is approved — skipping is
  not allowed.
- **Do NOT mutate `state.json.stage` manually.** State advances only via
  the `velpari_stage_publish` tool (which same gate chain as `/velpari-final-design-approve`); `runStage` never mutates state.
- **Final message ≤ 10 lines.** When done, your reply must include only
  the outcome and the artifact path. Never paste the final-design
  content.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the final
design stage. cmux, tmux, and wezterm backends target panes explicitly and
are not affected.
