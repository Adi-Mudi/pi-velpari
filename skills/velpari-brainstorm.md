---
name: velpari-brainstorm
description: Pi-Velpari Brainstorm stage (lifecycle v2.1) — understand the user's request first (conversational UNDERSTAND loop with hard lock), then a mandatory SCAN-gate picker (no default, developer always chooses), then visible read-only scout scans, then an informed DISCUSS loop with a decision ledger, batch confirm, coverage check, and a 3-outcome approve. Writes brainstorm-notes.md + brainstorm-dispatch.md under the run's brainstorm folder.
---

# Brainstorm Stage (Lifecycle v2.1)

A brainstorm is a conversational pass with the user that turns a vague
request into finalized brainstorm notes BEFORE the PRD stage runs. Velpari
has ONE mission type: requirements. There are no mission-type branches —
the lifecycle below is the same for every brainstorm.

The handler has already created the run and handed you the run id and the
artifact paths. Your job is to run the lifecycle: understand first, scan
second, ask smart questions third.

## The golden rule

**Understand first. Scan second. Ask smart questions third.**

No subagent, no scan, and no approve may run before the user has confirmed
your understanding. Parallel agents on a raw seed produce confident
garbage — the lock exists to prevent exactly that.

**v2.1 addition:** the handler now hard-gates on multiplexer presence
(zellij/tmux/wezterm/cmux). If you started brainstorm without one, the
command notifies the developer and exits before any state work. There is
also **no default scan selection** — the SCAN-gate picker ALWAYS asks the
developer (see [2]).

## Lifecycle overview

```
/velpari-brainstorm "<seed>"
       │  (handler: hard-gate on multiplexer present — zellij/tmux/wezterm/cmux)
       ▼
[0] UNDERSTAND        chat only, inline reads (1-2 files), NO subagents
       ▼
[1] CONFIRM loop      short paragraph → user agrees or corrects → repeat
                      HARD LOCK: nothing below runs until confirmed
       ▼
[2] SCAN-PLAN GATE    v2.1: ALWAYS asks via runScanGatePicker
                      5 branches: Run all / Run code+doc / Community only / Adjust / Skip
                      Config-aware (code-only / doc-only / mixed projects hide unavailable scans)
       ▼
[3] SCANS             visible panes, read-only scouts, per scan type
       ▼
[4] INFORM            facts + 2-4 questions, each WITH a suggested answer
       ▼
[5] DISCUSS loop ◄────┐ states: draft → discussing → agreed /
       ▼              │              not-wanted(+reason) / replaced
[6] BATCH CONFIRM ────┘ one structured call, "Discuss more" loops back
       ▼
[7] COVERAGE CHECK    automatic ✓/✗ table (show-only)
       ▼
[8] APPROVE           preview → Go / Clarify / Kill
                      Go → user runs /velpari-approve-brainstorm → publish → user then runs /velpari-prd (v1.6.2+; no auto-chain)
```

## [0] UNDERSTAND

Read the seed and do a QUICK INLINE look if it helps (1-2 files, your own
Read/Grep — NEVER a subagent at this stage).

Then ask 1-3 DYNAMIC follow-up questions, chosen for this exact seed (no
fixed script — every project and problem is different):

- Who will use it? What should it do? What should it NOT do?
- What problem does it solve today? What does success look like?
- Any constraints (tech stack, deadlines, dependencies)?
- Does it connect to existing parts of the project?

Rules:

- 1-3 questions per round, max 5 total per brainstorm.
- Every question must change a real decision. If answering it changes
  nothing, do NOT ask it.
- If the seed is already clear: ask ZERO follow-ups and go straight to [1].

### Change mode (when `## Existing Project Context` is present)

If the prompt carries an `## Existing Project Context` block, this is a
CHANGE brainstorm — an existing system is being modified, not created:

- BEFORE asking any question, read the listed published artifacts
  (start with the PRD). The block carries paths only — read the content
  on demand with your own Read tool.
- Frame every UNDERSTAND question as a change to the existing system
  ("what should change / be added / be removed"), never as a green-field
  build.
- In the notes, record each change as **add** / **modify** / **deprecate**
  and name the existing IDs it touches (FR-xx, NFR-xx, US-xx, ...).
- Existing IDs are append-only: never propose renumbering or reusing
  them. Removals are recorded as deprecate + reason — the downstream PRD
  keeps them with status `deprecated`.
- Check the config and requirements profile lines in the block before
  proposing anything that contradicts them; surface the conflict as a
  question instead of silently overriding.

## [1] CONFIRM UNDERSTANDING (loop + hard lock)

Write ONE short paragraph — plain language, no jargon:

> "Here is what I understood: <paragraph>. Correct?"

- User agrees → record it via the session tool:
  `velpari_brainstorm_session({ action: "confirm-understanding" })`
  (persists `understandingConfirmed: true` in state.json).
- User corrects → rewrite the paragraph and show it again.
- This repeats until the user confirms.

**HARD LOCK:** while `understandingConfirmed` is not true in state.json:
- no scan gate, no subagent dispatch, no notes writing, no approve.
`/velpari-approve-brainstorm` hard-blocks until the lock is released.

## [2] SCAN-PLAN GATE (v2.1: ALWAYS asks, no default)

After confirmation, **always** invoke the SCAN-gate picker. There is NO
default scan selection in v2.1 — the developer chooses every time. Do NOT
propose a plan conversationally first; the picker handles the ask.

Call:

```
velpari_brainstorm_session({ action: "request-scan-gate" })
```

The picker reads files.json v4 (`codePaths`, `inputDocuments`) to know
which scans are available and hides the ones that aren't. Branches:

1. **Run all available** (e.g. `code + doc + community`) — community
   still needs explicit `ctx.ui.confirm` consent (FR-52).
2. **Run code + doc only** — community excluded even when available.
3. **Run community only** — requires FR-52 consent; falls through to
   Adjust if denied.
4. **Adjust (pick per-scan)** — one `ctx.ui.confirm` per available scan.
5. **Skip scans** — picker returns `[]`; you fall back to inline research
   only.

The action persists `state.json:scansSelected` and returns the snapshot.

| Scan | Looks at | Scouts | Timeout |
| --- | --- | --- | --- |
| code | your source code | extractor, prd-checker | 30s |
| doc | your PRDs, docs, notes | prd-checker, rtm-checker | 30s |
| community | internet, official docs, similar projects | web-search-agent | 90s |

## [3] SCANS (visible panes, read-only scouts)

- Only the selected scans run, in parallel, max 2 dispatches per scan type,
  max 3 dispatches total per brainstorm (caps are enforced by the guards).
- Scouts run in **visible multiplexer panes** — velpari's standard UX.
  The pane is display + monitoring; the scout's returned findings are the
  truth.
- Scouts are READ-ONLY. The dispatcher strips write/edit/bash (community
  scans keep websearch + fetchurl). A scout CANNOT write a report file —
  it reports findings back in its completion result. You record the
  findings yourself (see [4]).
- web-search-agent runs ONLY for the community scan. Never dispatch it for
  code/doc scans — the dispatcher hard-rejects that (FR-52).
- Timeout or failure → mark the topic "needs research" in the notes and
  move on; never silently downgrade the questions.
- You may save raw findings under `<brainstormDir>/scout-notes/<scan>/<agent>.md`
  (inside the brainstorm folder, so the mutation lock allows it).

## [4] INFORM

Merge the scan findings into a 1-page context brief for the user:

- key facts (max 5 bullets)
- risks / unknowns
- 2-4 draft questions — EACH WITH A SUGGESTED DEFAULT ANSWER, so the user
  can accept with one word

Record each question via
`velpari_brainstorm_session({ action: "upsert-question", question: { id, text, suggestedAnswer, state: "draft" } })`.

## [5] DISCUSS loop

Normal chat. Per user reply, update question states via `upsert-question`:

- answer given → `discussing` (then `agreed` when the user confirms it)
- user rejects → `not-wanted` WITH a reason (required)
- answer replaced later → `replaced` (strikethrough, old text kept, reason required)
- new topic raised → new question, state `draft`

Hard rules:

- **Decisions are written to the notes IMMEDIATELY** — the session tool
  regenerates the `## Agreed` / `## Not wanted` / `## Open` ledger block in
  brainstorm-notes.md on every upsert. Keep the rest of the notes current
  as decisions land.
- **Rejected decisions are kept with their reason.** "Deferred, not
  forgotten": the PRD stage must know what the user refused, or it will
  suggest it again.
- Mid-loop research: resume the earlier subagent session (never cold-spawn
  the same scout twice). Counts against the dispatch caps.
- Extra questions are allowed ONLY when a scan or the discussion found
  something real (a conflict, a risk, a new option). No filler questions.

Exit ONLY when: the user says "done" / "ready to confirm", OR every
question is in a terminal state (agreed / not-wanted / replaced).
"Has content" is NOT an exit condition — your own suggestion in a draft
was never discussed.

## [6] BATCH CONFIRM (structured, no parsing)

ONE AskUserQuestion call with one entry per open question:

> Q<n>: <question text>?
> - Confirm: <suggested answer>
> - Discuss more
> - Cancel (with reason)

- Confirm → state `agreed`.
- Discuss more → back to [5].
- Cancel → state `not-wanted`, reason recorded.

Never parse free-text confirmation strings — structured entries only.

## [7] COVERAGE CHECK (automatic, show-only)

Before approve, show a coverage table:

| Area | Covered? |
| --- | --- |
| Scope | ✓/✗ |
| Out-of-scope | ✓/✗ |
| Data model | ✓/✗ |
| Edge cases / failure modes | ✓/✗ |
| Non-functional needs | ✓/✗ |
| Success criteria + verification step | ✓/✗ |
| FR coverage | ✓/✗ |
| RTM test-case coverage | ✓/✗ |

(The last two rows are velpari-specific — the PRD/RTM stages downstream
depend on them.) This is informational. It does NOT block by itself — the
user decides at approve. (The hard blocks in [8] are separate.)

## [7.5] PRE-APPROVE HARD GATE (run BEFORE the preview gate)

Re-run the same checks that `/velpari-approve-brainstorm` runs in code.
If ANY check fails, do NOT show the APPROVE preview gate — go back to
the right earlier step and fix it first.

1. **Understanding confirmed?** If `state.understandingConfirmed !== true`,
   you skipped the [1] CONFIRM loop. Go back to [1] and finish it.
2. **Every question terminal?** Any question in state `draft` or
   `discussing` blocks approve. Go back to [5] and resolve them.
3. **Every notes section filled?** Run this exact check against
   `<brainstormNotes>`:

   ```
   for section in Mission, Interview Answers, Scout Proposals,
                 Decision Summary, Agreed, Not wanted, Open:
       body = section body (text between this heading and the next ##)
       if body is missing OR empty OR contains "_TBD_":
           list the failing sections, go back to [4] INFORM and [5] DISCUSS
           to fill them, then return here.
   ```

   All 7 sections are required: Mission, Interview Answers, Scout Proposals,
   Decision Summary, Agreed, Not wanted, Open. Do not show the APPROVE
   preview until ALL three checks pass.

## [8] APPROVE (preview → Go / Clarify / Kill)

(Run [7.5] PRE-APPROVE HARD GATE first. This section assumes it passed.)

First show the preview gate: a short summary of the finished notes (never
paste the whole file into chat), then ONE AskUserQuestion:

> "Brainstorm ready. Publish?"
> - Go — publish and chain into PRD
> - Clarify — back to discussion
> - Kill — drop this brainstorm (reason logged)

- **Go** → tell the user: "Run /velpari-approve-brainstorm to publish."
  The command hard-blocks if understanding is unconfirmed, any question is
  still draft/discussing, or any notes section is missing/empty/`_TBD_`.
  On success it publishes `Doc/brainstorm/brainstorm-<topic-slug>.md`,
  writes the dispatch audit log, clears the session fields, advances the
  stage, and surfaces a `Next: /velpari-prd` hint. The user runs the next
  command by hand (v1.6.2+ — no auto-chain).
- **Clarify** → back to [5] with new draft questions.
- **Kill** → record the reason in the notes (`## Not wanted`), then tell
  the user the run can be discarded with `/velpari-reset`. A rejected
  mission is a valid brainstorm result.

## Merge into 4 buckets

When the scout findings and decisions are settled, merge the proposals
into 4 deterministic buckets (the `## Decision Summary` section of the
notes):

- `new-fr` — will append to `Doc/PRD_<projectName>.md` as `FR-NN`
- `update-fr` — modify existing `FR-NN` with delta from prd-checker
- `helper-update` — modify existing `HF-NN` in `## Helper Functions`
- `new-helper` — append new `HF-NN` to `## Helper Functions`

The merge is a deterministic operation in your context — no judgment
needed. Each proposal from the extractor carries a `classification`
field; map it to the right bucket.

## Working copy structure

Write to `<brainstormNotes>` (the run's `brainstorm/brainstorm-notes.md`).
ALL 7 sections are required — approve hard-rejects missing, empty, or
`_TBD_` sections:

```markdown
# Brainstorm Notes — <mission>

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

### WEB SEARCH AGENT (only if the community scan ran)
- community: <urls>
- official: <urls>
- similar: <repos>

## Decision Summary
- new-fr: [...]
- update-fr: [...]
- helper-update: [...]
- new-helper: [...]

## Agreed
- Q1: <question> — <answer>

## Not wanted
- Q2: <question> — <reason>

## Open
- (none)
```

The `## Agreed` / `## Not wanted` / `## Open` sections form the decision
ledger. The session tool rewrites them inside the
`<!-- pi-velpari decisions:start -->` / `<!-- pi-velpari decisions:end -->`
markers on every `upsert-question` — never hand-edit inside the markers;
edit the rest of the file normally.

Use `path.join` for paths. Write the file via the `write` tool.

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
  relative paths while reading the project context.
- **Expected output in the task** — Scouts are read-only and CANNOT write
  report files (the dispatcher strips write/edit/bash). Each scout's
  `task:` MUST state exactly what findings to report back in its final
  message (facts, proposals, classifications). You record the returned
  findings into the notes yourself.
- **Task content** — Pass the user's mission, the confirmed understanding,
  framework (if any), and any existing PRD/RTM contents the agent should
  consider.
- **No turn cap** — The `subagent` tool has NO turn-cap parameter. The
  agent finishes when it reports its findings and exits (auto-exit) or when
  it calls `subagent_done`. If a scout loops without progress, interrupt it.
- **No isolation parameter** — The `subagent` tool has no pane-isolation
  or worktree parameter; never pass one.
- **Read-only tools** — Dispatches carry only read/grep/glob (plus
  websearch/fetchurl for the community scan). If you call `subagent()`
  with a tools list, keep it inside that allowlist.

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
   back. Do not assume an agent failed just because it has not reported
   yet. Do not create polling tasks or repeated status checks while
   waiting — notifications wake you automatically.
3. **If a scout goes quiet, check the live widget first.**
   - If the agent is still `starting`/`active`/`waiting`, wait.
   - If the agent is `stalled` or you received a failure, interrupt it
     with `subagent_interrupt({ name: "<name>" })` and wait once.
   - **Note:** `subagent_interrupt` only works for **Pi-backed** subagents.
     It returns an error for Claude-backed runs.
   - Cold-respawn only if interrupt + resume fails. Use a unique `-retry`
     name. Never leave two agents of the same role running at once.
4. **Verify every result — a "completed" notice is NOT proof.** On EVERY
   completion notification, check that the scout's result contains real
   findings:
   - Findings present → record them into the notes.
   - Result empty or useless → do NOT respawn cold. Call `subagent_resume`
     with the session path and instruct the agent to report its findings.
   - Never wait after a completed notification — act on it in the same turn.
   - Never ask the user to confirm a subagent finished; you own this check.
5. **Never fake a scout's findings.** If it cannot finish, fix the spawn
   (agent, tools, task) and relaunch, or mark the topic "needs research".
6. **Strict checkpoints:**
   - Do not start [4] INFORM until **all** dispatched scouts have reported.
   - Do not present the preview gate until the working copy file exists
     with all 7 sections filled.

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

## AskUserQuestion rules (the tool rejects violations)

- Every question MUST end with `?`.
- `header` field MUST be ≤ 12 chars — one short word or acronym.
- 2-4 options per question; never open-ended free text.

## Audit log

Approve writes `.IDE_Plans/velpari/runs/<run-id>/brainstorm/brainstorm-dispatch.md`
with a summary of the run (dispatches, notes coverage). Write noteworthy
dispatch decisions down as you go (a line per dispatch in the notes or
scout-notes is enough) so the log can be reconstructed.

## Hard rules

- **Understand before scan.** No subagent before `understandingConfirmed`.
- **Multiplexer is required (v2.1).** Velpari spawns visible scouts in
  multiplexer panes. If the developer started brainstorm without one,
  the handler hard-fails at entry — tell them to run inside zellij/tmux
  (or set `PI_SUBAGENT_MUX` for wrappers/tests).
- **SCAN gate always asks (v2.1).** Call
  `velpari_brainstorm_session({ action: "request-scan-gate" })` —
  never assume a default. The picker persists the result.
- **The project is read-only during brainstorm.** A tool_call hook
  hard-blocks edit/write outside the run's `brainstorm/` folder while the
  brainstorm is open. Write ONLY `<brainstormNotes>` and optional
  `scout-notes/` files inside that folder. The lock lifts at approve.
- **Do NOT mutate `state.json.stage`.** The handler already advanced to
  `brainstorming` via `createRun()`. The next transition (`brainstormed`)
  happens in `/velpari-approve-brainstorm`. You drive session state only
  through `velpari_brainstorm_session`.
- **Parent owns Q&A.** Never delegate AskUserQuestion to a subagent.
- **Parent owns the notes.** Never delegate writing brainstorm-notes.md to
  a subagent.
- **Subagents are read-only.** The dispatcher strips write/edit/bash.
- **Caps:** max 3 dispatches per brainstorm total, max 2 per scan type.
- **web-search-agent only with consent.** It runs only for the community
  scan the user picked at the scan gate (FR-52).
- **Final message ≤ 10 lines.** When done, your reply must include only
  the outcome (working copy written, preview shown) and the artifact
  path. Never paste the brainstorm-notes content into the message.

## Known issue: zellij `close-pane` bug

[Issue #19](https://github.com/HazAT/pi-interactive-subagents/issues/19)
in `pi-interactive-subagents` (open as of 2026-09-03): the zellij backend
calls `zellij action close-pane` after a subagent finishes, but the env-var
approach is ignored — zellij closes the **currently focused** pane, which
is the parent Pi session. After enough subagent cycles the parent can be
killed and the session becomes unresumable via `--resume` / `--continue`.
**Workaround:** during the brainstorm stage, do NOT manually focus a
subagent pane. Let zellij's auto-layout keep the parent focused. cmux,
tmux, and wezterm backends target panes explicitly and are not affected.
