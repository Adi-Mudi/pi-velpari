---
name: velpari-discuss
description: Pi-Velpari Discussion stage — orchestrate 4 visible subagents (extractor, prd-checker, rtm-checker, optional web-search-agent), iterate up to 3 rounds, write the working-copy discussion notes, show preview gate.
---

# Discussion Stage

A discussion is a quick refinement pass with the user to nail down the
mission before the PRD stage. The handler has already asked the user 6
fixed interview questions and captured a `webSearchAllowed` flag. Your job
is to spawn the 4 scout subagents (visible in multiplexer panes), read
their reports, iterate if gaps remain, and write the working copy.

## Goal

By the end of this stage, `<discussionNotes>` (resolves to
`discussion-notes.md` on disk) has every required section
filled, the user has approved the preview, and `/velpari-approve-discuss`
can publish the artifact to `Doc/discussion-<topic-slug>.md` without
surprises.

## Sequence

```
interview answers (already in the prompt)
        │
        ▼
spawn 4 subagents in parallel via subagent() tool:
  ├─ extractor       → <extractorReport>
  ├─ prd-checker     → <prdCheckerReport>
  ├─ rtm-checker     → <rtmCheckerReport>
  └─ web-search-agent → <webSearchReport>  (only if webSearchAllowed)
        │
        ▼ (wait for all — see Synchronization rules below)
read 4 reports
        │
        ▼ (decide: gaps remain?)
AskUserQuestion follow-up rounds (1-3 questions each, up to 3 iterations)
        │
        ▼
merge into 4 buckets: new-fr, update-fr, helper-update, new-helper
        │
        ▼
write working copy <discussionNotes>
        │
        ▼
AskUserQuestion "Publish preview?" (header ≤12 chars, ends with ?)
        │
        ▼ (yes)
tell user → /velpari-approve-discuss
```

## Subagent conventions

The 4 scouts live in `.pi/agents/{extractor,prd-checker,rtm-checker,web-search-agent}.md`.
They are real subagents — they run in **visible multiplexer panes** you can
monitor. Use the `subagent` tool (provided by `pi-interactive-subagents`):

- **Agent parameter** — Every `subagent()` call MUST include `agent:` with
  one of: `extractor`, `prd-checker`, `rtm-checker`, `web-search-agent`.
- **Session mode** — All 4 agent definitions declare `session-mode: standalone`;
  do NOT pass `fork: true` (it copies the parent's full conversation).
- **Auto-exit** — All 4 agent definitions declare `auto-exit: true`; the pane
  closes automatically after the agent finishes its turn. You do not need
  to tell the agent to exit.
- **Working directory (`cwd`)** — Pass `cwd: <runDir>` so the scout can use
  relative paths to its assigned JSON report. The parent computes this from
  the run id.
- **Explicit output path** — Each scout's `task:` MUST include the exact
  artifact path it must write (`<extractorReport>`, `<prdCheckerReport>`,
  etc.). Scouts do not infer it.
- **Task content** — Pass the user's mission, interview answers, framework
  (if any), and any existing PRD/RTM contents the agent should consider.
- **No turn cap** — The `subagent` tool has NO turn-cap parameter. The
  agent finishes when it writes its report and exits (auto-exit) or when
  it calls `subagent_done`. If a scout loops without progress, interrupt it.
- **No isolation parameter** — The `subagent` tool has no pane-isolation
  or worktree parameter; never pass one. Each scout writes to its own file,
  so parallel writes never collide.
- **Available tools** — Scouts declare `tools: read, write, bash`. They use
  `read` to inspect existing PRD/RTM, `write` to emit the JSON report, and
  `bash` for verification (`test -s <path>`).

**What the `subagent` tool does NOT accept:** any turn-cap parameter,
pane-isolation, worktree, alternate-prompt fields, or `systemPrompt`-style
overrides. Use `task` for the prompt, `cwd` for working directory, and
`agent` for the agent definition. If a scout hangs, use `subagent_interrupt`
(see below).

**caller_ping (child-to-parent help request):** A scout that gets stuck
mid-task can call `caller_ping({ message: "..." })` from inside its pane.
The child exits and the parent receives a steer notification with the
message. You can then either answer it yourself or call `subagent_resume`
to continue the scout with guidance. Use this for genuine clarification
needs, not as a normal flow.

## Synchronization and checkpoint rules

`pi-interactive-subagents` runs each subagent asynchronously in its own
multiplexer pane. The `subagent()` call returns immediately and the agent
works in the background; a completion notification is steered back to you
when the agent finishes.

1. **Use unique names** for every parallel subagent so you can identify
   each one in the live subagent widget. Suggested names:
   `extractor-NN`, `prd-checker-NN`, `rtm-checker-NN`, `web-search-NN`
   (where `NN` matches the current round number).
2. **Wait for all completion notifications before proceeding.** After
   launching parallel agents, do not continue until each one has reported
   back. Do not assume an agent failed just because its output file is not
   yet present. Do not create polling tasks or repeated status checks while
   waiting — notifications wake you automatically.
3. **If an expected file is missing, check the live widget first.**
   - If the agent is still `starting`/`active`/`waiting`, wait.
   - If the agent is `stalled` or you received a failure, interrupt it
     with `subagent_interrupt({ name: "<name>" })` and wait once.
   - **Note:** `subagent_interrupt` only works for **Pi-backed** subagents.
     It returns an error for Claude-backed runs.
   - Cold-respawn only if interrupt + resume fails. Use a unique `-retry`
     name. Never leave two agents of the same role running at once.
4. **Verify every artifact — a "completed" notice is NOT proof.** On
   EVERY completion notification, immediately run `test -s <artifactPath>`
   (bash) for the artifact that subagent was assigned:
   - File exists and is non-empty → proceed.
   - File missing or empty → do NOT respawn cold. Call `subagent_resume`
     with the session path and instruct the agent to write the file.
   - Never wait after a completed notification — act on it in the same turn.
   - Never ask the user to confirm a subagent finished; you own this check.
5. **Never write a subagent's artifact yourself.** If it cannot finish,
   fix the spawn (agent, tools, task) and relaunch.
6. **Strict checkpoints:**
   - Do not start follow-up rounds until **all 4** scout reports exist
     and are non-empty.
   - Do not write the working copy until you have read **all** scout
     reports.
   - Do not present the preview gate until the working copy file exists.

**Live widget status reference** (from `pi-interactive-subagents`):

| State | Meaning |
|---|---|
| `starting` | Launched but no valid child snapshot yet |
| `active` | Doing observed runtime work (turn, provider request, streaming, tool exec) |
| `waiting` | Finished a turn, open for more input or another stage |
| `stalled` | Parent lost trust in the run's health (no recent snapshots). The parent LLM is steered a notification |
| `running` | Fallback for backends without child snapshots (e.g. Claude) |

Our 4 scouts declare `auto-exit: true`, so they will not stay in `waiting`.
Expect either `active` → auto-close, or `stalled` → steer → interrupt/resume.

## 429 playbook

If a scout result says `Sub-agent "X" failed ... 429` (rate limit):

1. Wait about 60 seconds (`sleep 60` via bash) before retry.
2. Resume with `subagent_resume` using the session path from the result —
   do NOT cold-respawn; a fresh spawn restarts the whole agent.
3. Only cold-respawn with a unique `-retry` name if resume also fails.

## Follow-up rounds (iterative discussion)

After reading the 4 scout reports, decide whether gaps remain:

- **Decision inputs:** missing FR coverage, unresolved conflicts between
  scout outputs, ambiguous classifications, missing test-case coverage.
- **If gaps:** use `AskUserQuestion` for 1-3 follow-up questions. Header
  ≤ 12 chars, ends with `?`, 2-4 options per question.
- **If significant gaps:** spawn another scout batch (round 2) with the
  updated answers. You may spawn a subset of the 4 scouts if only some
  need re-running.
- **Cap iterations at 3 rounds.** If still unresolved after 3 rounds,
  surface the gap to the user via AskUserQuestion and ask whether to
  proceed with partial coverage.

## Merge into 4 buckets

After all scout rounds complete (or you cap at 3), merge the proposals
into 4 deterministic buckets:

- `new-fr` — append to `Doc/PRD_<projectName>.md` as `FR-NN`
- `update-fr` — modify existing `FR-NN` with delta from prd-checker
- `helper-update` — modify existing `HF-NN` in `## Helper Functions`
- `new-helper` — append new `HF-NN` to `## Helper Functions`

The merge is a deterministic JS operation in your context — no LLM
judgment needed. Each proposal from the extractor carries a
`classification` field; map it to the right bucket.

## Working copy structure

Write to `<discussionNotes>`:

```markdown
# Discussion Notes — <mission>

## Mission
<mission>

## Interview Answers
1. Q: ... A: ...
...

## Scout Proposals

### NEW EXTRACTOR
- (classification) <rawText>

### PRD CHECKER
- (frId) <delta>

### RTM CHECKER
- (frId) <testCase>

### WEB SEARCH AGENT (only if webSearchAllowed)
- community: <urls>
- official: <urls>
- similar: <repos>

## Decision Summary
- new-fr: [...]
- update-fr: [...]
- helper-update: [...]
- new-helper: [...]
```

Use `path.join` for paths. Write the file via the `write` tool.

## Preview gate

After writing the working copy, ask the user:

> Publish preview?
> - yes — the working copy is ready, run /velpari-approve-discuss
> - no — I'll add changes first
> - edit — let me specify which sections to revise

(Use AskUserQuestion with 2-4 options, header "Publish", question ending
with `?`.)

If yes → tell the user: "Run /velpari-approve-discuss to publish."
If no → ask which sections to revise, iterate, repeat the preview.
If edit → spawn a follow-up scout batch or answer targeted follow-ups.

## Hard rules

- **No in-process scouts.** Use the `subagent()` tool only.
- **Verify every artifact.** `test -s <path>` after each completion.
- **Never write a scout's artifact yourself.** Fix the spawn and relaunch.
- **Do NOT mutate `state.json.stage`.** The handler already advanced to
  `discussing` via `createRun()`. The next state transition (`discussed`)
  happens in `/velpari-approve-discuss`. You only write the working copy
  artifact.
- **Cap iterations at 3 rounds.** Surface gaps to the user, do not loop
  forever.
- **Final message ≤ 10 lines.** When done, your reply must include only
  the outcome (working copy written, preview approved) and the artifact
  path. Never paste the discussion-notes content into the message.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19)
in `pi-interactive-subagents` (open as of 2026-09-03): the zellij backend
calls `zellij action close-pane` after a subagent finishes, but the env-var
approach is ignored — zellij closes the **currently focused** pane, which
is the parent Pi session. After enough subagent cycles the parent can be
killed and the session becomes unresumable via `--resume` / `--continue`.
**Workaround:** during the discussion stage, do NOT manually focus a
subagent pane. Let zellij's auto-layout keep the parent focused. cmux,
tmux, and wezterm backends target panes explicitly and are not affected.