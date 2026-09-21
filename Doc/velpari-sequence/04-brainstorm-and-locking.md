# 04 — Brainstorm Anytime & the Dynamic Transition Lock

How the orchestrator keeps the sequence enforced while allowing free
discussion — the self-healing locking mechanism.

## Brainstorm is invocable at any time

`/velpari-brainstorm` is not only Stage 1. It is the standing **discussion
mode** of the whole pipeline: whenever a developer has a question, doubts a
decision, or wants to change something — at any stage — they open a brainstorm.

This replaces the old single-shot-per-run guard. The finalized rules:

1. Brainstorm may be opened from **any stage**, first run or revision run.
2. Brainstorm remains the **only entry point for changes** (zero-hallucination
   rule: every claim traces to a user statement in a brainstorm note or an
   earlier approved artifact).
3. The brainstorm lifecycle itself is unchanged (v2.1 base): UNDERSTAND loop →
   confirm (hard lock) → scan gate (consent) → clarify loop (decision ledger) →
   notes → `/velpari-approve-brainstorm`. On revision runs it operates in
   **change mode**: the prompt carries the published docs, config, and run
   context.

## The chain-impact rule

Opening a brainstorm never breaks the chain by itself. **Only republishing an
artifact breaks the chain.**

| Situation | Consequence |
|---|---|
| Brainstorm → developer continues the **same stage** | No impact. The stage's working copy absorbs the discussion outcome. Nothing goes stale. |
| Brainstorm → notes approved but **no artifact republishes** | No impact. Pure discussion. |
| Brainstorm → an artifact **republishes** (any stage) | Downstream artifacts go stale (`03-staleness-and-validation.md`). The orchestrator requires the review/upgrade path before any further-downstream stage runs. |

Example: developer is in the Architecture stage, runs brainstorm, continues
with Architecture → no additional action required, because no other document
stage was affected. If the architecture doc then republishes, pseudocode,
test plan, dev order, and final design go stale automatically — detected by
hash, not by tracking "which command ran".

## The dynamic transition lock

The set of legal commands is **computed fresh on every command** from three
inputs: current stage state, the freshness map, and whether a brainstorm
session is open. It is not a static table with exceptions bolted on.

### Normal state (no brainstorm open)

Allowed commands:

1. The next stage(s) per the transition table whose inputs are **present and
   fresh** (this is what makes "skip fresh stages" legal and "jump over stale
   ones" impossible).
2. `/velpari-brainstorm` (always).
3. Discipline/view commands (`/velpari-status`, `/velpari-doctor`,
   `/velpari-show-*`, configure commands).

Everything else → hard block + message naming the correct command.

### Brainstorm-open state

The allowed set collapses to exactly **two doors**:

1. **Continue the current stage** — the discussion feeds the stage in progress.
2. **Restart at PRD** — the Phase 2 entry point; the first artifact-bearing
   stage. Choose this when the discussion produced a change: PRD revise starts
   the forward re-validation of the chain.

Every other stage command is locked with a guide message:
*"Brainstorm session open — continue `<current-stage>` or restart at
`/velpari-prd`."* Discipline/view commands stay available. Closing or
approving the brainstorm restores the normal state, with staleness recomputed
from whatever the brainstorm caused to republish.

### Self-healing routing

A blocked command is never a dead end — it is a routing decision:

1. On any invalid transition, the orchestrator computes the **earliest stale
   stage** (or the single legal next stage) and names it:
   *"RTM is outdated after PRD v1.3. Run `/velpari-rtm`."*
2. At every moment there is **exactly one correct next command**, and the
   system always says what it is — in the block message, in `/velpari-status`,
   and in the per-turn status injection.
3. The developer cannot get lost: any wrong command returns to the correct
   path in one step. This is the "self-healing" property — the workflow
   repairs its own sequence instead of erroring and abandoning the developer.

## Invariants (must hold in the implementation)

1. **Deterministic.** The legal-command set is a pure function of
   (state, freshness map, brainstorm-open flag). No LLM judgment, no hidden
   exceptions.
2. **No silent transitions.** Every blocked command produces a named-correct-
   command message; every allowed forward step surfaces a `Next:` hint.
3. **Brainstorm writes stay locked to the run folder.** While a brainstorm is
   open, edit/write outside the run's `brainstorm/` folder is hard-blocked
   (unchanged from today).
4. **Handoff is the ultimate gate.** Whatever happens mid-chain, nothing
   reaches Senai while any artifact is stale.

## Relationship to the execution modes

- First run: the lock reduces to the static strict table (everything
  downstream is "stale" because it doesn't exist yet) —
  `01-first-run-sequence.md`.
- Mode 2 (full forward): brainstorm approve marks everything stale; the lock
  then walks the developer stage by stage.
- Mode 3 (continue mid-chain): the lock allows jumping over **fresh** stages
  and blocks at the first **stale** input — `02-revision-workflows.md`.

## Implementation notes (shipped 2026-09-20)

How the mechanism above is realized in code (plan
`.IDE_Plans/velpari-dynamic-lock-brainstorm-anytime_plan_20260920_2142_v1.0.md`):

1. **Pause/resume model (D1).** "Brainstorm open" IS
   `state.currentStage === "brainstorming"`. Opening from a later stage
   records the prior stage on `state.pausedStage` and flips the stage to
   `brainstorming` — no orthogonal open-flag. Three run-locked,
   history-appending primitives in `core/state.ts` own the lifecycle:
   `openBrainstormSession` (pause + reset the per-session dispatch count),
   `resumeFromBrainstorm(cwd, door)` (door `"continue"` → back to
   `pausedStage`; door `"restart-prd"` → lands at `brainstormed` so the PRD
   chain restarts), `discardBrainstormSession` (close without an artifact;
   resumes `pausedStage`, or `none` on a first run). They are NOT
   STAGE_TRANSITIONS rows — `advanceStage` is untouched.
2. **Door selection (D3).** Chosen at approve time when `pausedStage` is
   present: the `--restart-prd` argument wins, otherwise a picker when the
   TUI is available, default continue. First run (no `pausedStage`) = no
   choice, the existing advance to `brainstormed`.
3. **Discard path (D7).** `velpari_brainstorm_session({ action: "discard" })`
   — the close path that is neither publish nor full reset.
4. **One legal-command function (D6).** `stages/transition-lock.ts:
   computeLegalCommands` is the single source of truth for legality:
   two-door collapse while a session is open, stale declared-input blocks,
   earliest-stale routing, update-mode self-loop (a stage whose own
   published artifact is stale may always re-run — that run is the remedy).
   runStage, the publish-tool whitelist, the approve refusal, the
   `before_agent_start` `next:` line, and `/velpari-status`'s `Next:` line
   all delegate to it. Stage DATA (gate rows, inputs) stays in the registry
   via `STAGE_LOCK_SPECS` (pipeline execution order).
5. **Lock precedence (D4).** While a session is open, the brainstorm-folder
   mutation lock owns all edit/write gating; the stage-folder lock is
   suppressed, including writes to the paused stage's folder.
6. **Per-session caps (D5).** `brainstormDispatchCount` resets to 0 at
   session open; the per-session cap (3) is unchanged.
