---
name: velpari-pseudocode
description: Pi-Velpari Pseudocode stage — orchestrate 4 visible subagents (pseudo-algorithm-extractor, pseudo-edge-case-handler, pseudo-complexity-analyzer, pseudo-consolidator) to produce algorithmic pseudocode for each module, write the working copy, show preview gate.
---

# Pseudocode Stage

Produce algorithmic pseudocode for each module in the design. The handler
has already validated the gate (design must exist) and embedded its path
in the prompt. Your job is to spawn 4 subagents in parallel, read their
reports, and write the working-copy pseudocode.

## Goal

By the end of this stage, `<workingCopy>` (`pseudocode_<projectName>.md`)
has every module's functions documented, the user has approved the
preview, and the `velpari_stage_publish` tool can publish the artifact
to `Doc/pseudocode_<projectName>.md` without surprises. `/velpari-pseudocode-approve` remains as the manual fallback.

## Sequence

```
design + atomic functions (concatenated into prompt by handler):
  - Doc/design_<projectName>.md
  - Doc/atomic-functions_<projectName>.md
        │
        ▼
spawn 4 source subagents + 1 reviewer (gated) in parallel via subagent() tool:
  ├─ pseudo-algorithm-extractor     → <scoutReportDir>/pseudo-algorithm-extractor-report.json
  ├─ pseudo-edge-case-handler       → <scoutReportDir>/pseudo-edge-case-handler-report.json
  ├─ pseudo-complexity-analyzer     → <scoutReportDir>/pseudo-complexity-analyzer-report.json
  ├─ pseudo-consolidator            → <scoutReportDir>/pseudo-consolidator-report.json
  └─ pseudo-reviewer (gated)        → <scoutReportDir>/pseudo-reviewer-report.json
        │
        ▼ (wait for all 5 — see Synchronization rules below)
read 4 source reports + 1 reviewer verdict
        │
        ▼
build pseudocode markdown from the 4 reports
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

## Subagent conventions

The 4 scouts live in `.pi/agents/{pseudo-algorithm-extractor,pseudo-edge-case-handler,pseudo-complexity-analyzer,pseudo-consolidator}.md`.
They are real subagents — they run in **visible multiplexer panes** you can
monitor. Use the `subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:` with one
  of: `pseudo-algorithm-extractor`, `pseudo-edge-case-handler`,
  `pseudo-complexity-analyzer`, `pseudo-consolidator`.
- **Session mode** — All 4 declare `session-mode: standalone`; do NOT pass
  `fork: true`.
- **Auto-exit** — All 4 declare `auto-exit: true`; the pane closes
  automatically after the agent finishes its turn.
- **Working directory** — Pass `cwd: <runDir>` so scouts can use relative paths.
- **Explicit output path** — Each scout's `task:` MUST include the exact
  artifact path it must write.
- **Task content** — Pass the design path (`<inputArtifact>`) and the scout's
  own report path. The edge-case, complexity, and consolidator scouts also
  need cross-references.
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

1. **Use unique names** for every parallel subagent (e.g. `pseudo-alg`,
   `pseudo-edge`, `pseudo-complexity`, `pseudo-consolidator`).
2. **Wait for all completion notifications before proceeding.**
3. **If an expected file is missing, check the live widget first.**
   - Agent still `starting`/`active`/`waiting` → wait.
   - Agent `stalled` or failure received → interrupt and wait.
4. **Verify every artifact** with `test -s <artifactPath>` (bash).
5. **Never write a scout's artifact yourself.**
6. **Strict checkpoints:**
   - `edge-case-handler`, `complexity-analyzer`, `consolidator` need
     `algorithm-extractor`'s report. Start them in parallel — they all
     read the input artifact and the algorithm report.

**Live widget status reference:**

| State | Meaning |
|---|---|
| `starting` | Launched but no valid child snapshot yet |
| `active` | Doing observed runtime work |
| `waiting` | Finished a turn, open for more input |
| `stalled` | Parent lost trust in the run's health |
| `running` | Fallback for backends without child snapshots |

## Merge into final pseudocode

After all 4 scouts complete:

1. Read the 4 reports. The consolidator has the merged structure.
2. Build the pseudocode markdown (see "Output Format" below).
3. Write to `<workingCopy>`.

## Output Format

Write the working copy as `pseudocode_<projectName>.md` at `<workingCopy>`:

```markdown
---
artifact: pseudocode
project: <projectName>
version: 1.0.0
status: draft
stage: writing-pseudocode
run: <runId>
created: <ISO timestamp>
updated: <ISO timestamp>
---

# Pseudocode — <projectName>

## Module: M-1 (auth-service)

### Function: createUser(email, password)

AF: AF-1

#### Pseudocode
```
FUNCTION createUser(email, password):
  PRECONDITIONS:
    email MATCHES RFC_5322
    password.length >= 8
  STEPS:
    1. parsed = validateInput(email, password)
    2. IF parsed.email already exists THEN RAISE EmailAlreadyTaken
    3. hashedPassword = bcrypt(password, cost=12)
    4. user = users.insert({email, hashedPassword, createdAt: now()})
    5. RETURN user.id
  POSTCONDITIONS:
    user with given email exists in users table
  RETURNS: userId (UUID)
```

#### Edge Cases
| Case | Handling | Testable |
|---|---|---|
| empty email | validateInput raises InvalidEmail | yes |
| concurrent signup with same email | unique constraint raises EmailAlreadyTaken | yes |
| bcrypt throws (very long password) | wraps in InternalError | yes |

#### Complexity
- **Time:** O(1) amortized (bcrypt ~250ms dominates)
- **Space:** O(1) per call
- **Bottleneck:** bcrypt is CPU-bound; consider worker pool

### Function: <next function>
...

## Module: M-2 (...)
...
```

## Zero-Hallucination Rule (FR-22)

Every function in the pseudocode must trace back to a public function
declared in the design's interface contracts. If the design doesn't
declare a function, do not pseudocode it.

Every function also names the atomic function it implements via a
mandatory `AF: AF-N` reference line directly under its `### Function:`
heading (Layer-2 ID coverage). Every `AF-N` from the published
atomic-functions doc must appear at least once in the pseudocode.

## Project-Name Substitution (FR-67, NFR-15)

Use `projectName` from the design in all output paths. Never hardcode
"Pi-Velpari" in any file path.

## Update Mode

When the prompt carries an `## Update Mode` block, this run REVISES the
published pseudocode in place — never rewrite it from scratch.
Explicitly name the upstream changes (from the revised design) that
triggered this revision.

Revision rules:

1. **Keep module and algorithm IDs.** Existing `M-N` modules and their
   functions keep their identifiers. New modules / functions are
   appended with the next free ID — never renumber or reuse.
2. **Deprecate, don't delete.** A function that is removed stays marked
   `deprecated` with a reason. Never delete it.
3. **Version bump.** Minor (x.Y.0) for additions only. Major (X.0.0)
   when anything is deprecated.
4. **Change Log entry required.** The `velpari_stage_publish` tool
   (same gate chain as `/velpari-pseudocode-approve`) blocks publishing
   without a new Change Log entry.

The 4 scouts still run fresh — never reuse old scout reports.

## Publish (auto on working-copy ready)

When the working copy is at `<workingCopy>` (verify with `test -s <workingCopy>`), call the `velpari_stage_publish` tool (no parameters). It runs the publish gate (revision + pseudocode-reviewer verdict + post-publish doctor audit), writes the published copy to `Doc/`, and advances the stage. If the tool reports gate/doctor errors, fix the working copy and call it again.

Manual fallback (when the LLM-driven publish is unavailable): `/velpari-pseudocode-approve` runs the same gate chain from the terminal.

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **Do NOT mutate `state.json.stage`.** The handler already advanced to
  `writing-pseudocode` via `createRun()`. The next state transition
  (`wrote-pseudocode`) happens in the `velpari_stage_publish` tool (which
  same gate chain as `/velpari-pseudocode-approve`). You only write the working copy
  artifact.
- **Final message ≤ 10 lines.** When done, your reply must include only the
  outcome and the artifact path. Never paste the pseudocode content.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19) in
`pi-interactive-subagents` (open as of 2026-09-04): the zellij backend's
`close-pane` step can close the parent session instead of the subagent
pane. Workaround: do NOT manually focus a subagent pane during the
pseudocode stage. cmux, tmux, and wezterm backends target panes
explicitly and are not affected.