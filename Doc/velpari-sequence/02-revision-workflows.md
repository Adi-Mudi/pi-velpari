# 02 — Revision Workflows (Updates & Upgrades)

This document defines what happens **after** a project has completed (or
partially completed) a first pass: revisions, updates, and upgrades.
For the first-time strict sequence, see `01-first-run-sequence.md`.

## The core rule

> **You may skip stages. You may not skip staleness.**

A stage may be skipped exactly when its published artifact is still **fresh** —
none of its input artifacts have changed since it was published. The moment an
upstream artifact republishes, every downstream artifact goes **stale** and
must be re-validated before anything further downstream may run. How staleness
is computed and enforced: `03-staleness-and-validation.md`.

## The 3 execution modes

### Mode 1 — Full sequence (first run)

Strict order, every stage, no skips. Defined in `01-first-run-sequence.md`.
This is the only mode where "no skips" applies absolutely.

### Mode 2 — Partial restart + full forward pass

The developer re-enters at brainstorm and revises **every** downstream stage
in order. Use when the change is broad (new feature area, changed scope,
switched technology).

```text
/velpari-brainstorm "<the change>"   (change mode — existing project context)
        │
        ▼
/velpari-approve-brainstorm  →  all downstream artifacts marked stale
        │
        ▼
/velpari-prd (update mode) → approve → /velpari-rtm (update mode) → approve
        → /velpari-feasibility (update mode) → approve
        → … every stage revises in order …
        → /velpari-handoff
```

Update mode never regenerates: it loads the published baseline and applies the
revision rules — append-only IDs (never renumber/reuse), deprecate-don't-delete
(removals stay with status `deprecated` + reason), version bump (minor for
additions-only, major for deprecations or acceptance-criteria changes),
mandatory Change Log entry, new rows start `proposed`. The publish gate blocks
any revision that breaks these rules.

### Mode 3 — Partial restart + continue from a mid-chain stage

The developer re-enters at brainstorm, then continues **directly at the stage
they need** — skipping stages whose artifacts are still fresh.

```text
/velpari-brainstorm "<the change>"  →  approve
        │
        ▼
staleness computed over the whole chain
        │
        ├─ artifacts before the change's impact: FRESH → stages skippable
        │
        ▼
developer runs the earliest stale stage (update mode) → approve
        → continue forward (revise-or-reconfirm per remaining stale stage)
        → fresh stages beyond that: runnable immediately
```

Example (the canonical case): developer is maintaining a completed project and
changes one requirement. Brainstorm → PRD revise → RTM revise → feasibility is
**fresh** (requirements wording changed, viability didn't) → skip straight to
`/velpari-architecture-generator` in update mode → downstream stages revise or
re-confirm → handoff.

## Feasibility skip = a staleness consequence, not a special case

Feasibility's inputs are the PRD + RTM (requirements) — its verdict (reuse /
build / language) depends on *what* the system must do, not on wording tweaks.

- Change doesn't touch requirements → published study stays fresh →
  `/velpari-architecture-generator` runs directly from `built-rtm`. The skip
  is a choice, never forced: `/velpari-feasibility` remains available to
  revise the study.
- Change touches requirements in a way that could affect viability (scope,
  scale, core function) → study is stale → the developer must pass through
  feasibility: **revise** (re-run in update mode) or **re-confirm** ("reviewed,
  no impact" — see below).

No special "skip feasibility" flag exists in the finalized model. The generic
staleness machinery decides, uniformly, for every stage.

## Resolving a stale artifact: two paths

| Path | What happens | When to use |
|---|---|---|
| **Revise** | Re-run the stage command in update mode. Baseline injected, revision rules enforced, new Change Log entry, version bump. | The upstream change actually affects this document. |
| **Re-confirm** | Developer reviews and declares "no impact". Freshness hash re-stamped + mandatory Change Log line: "Reviewed after `<artifact>` vX.Y — no changes required." | The upstream change is real but irrelevant to this document. |

Both paths leave an audit trail. Neither is silent. A stale artifact that is
never resolved blocks every downstream stage and blocks `/velpari-handoff`.

The re-confirm path is implemented as **`/velpari-reconfirm`** (see
`08-command-reference.md`): a picker over the `input-changed` stale set, one
artifact at a time (`input-missing` / `no-stamp` stay republish-only). Each
confirm appends the mandated Change Log line (upstream version read from its
frontmatter), re-stamps the freshness manifest with normalized hashes
(`hashv: 2` — the `## Change Log` section is excluded, so the line itself
never re-stales downstream) plus a `reconfirmedAt` marker, and writes a
history entry.

## What triggers a revision run

Always `/velpari-brainstorm`. Brainstorm is the single entry point for
changes — this is what keeps the zero-hallucination rule intact (every claim
traces to a user statement or an earlier approved artifact). The brainstorm
captures **what changed and why**; that record feeds the impact assessment.

Brainstorm can also be invoked purely for discussion with no artifact change —
then nothing goes stale and the developer simply continues the current stage.
See `04-brainstorm-and-locking.md` for the locking rules around open
brainstorm sessions.

## Worked examples

### Example A — wording fix in one NFR (small change)

1. `/velpari-brainstorm "clarify NFR-7 response-time wording"` → approve.
2. PRD revises (minor version bump, Change Log entry).
3. Staleness: RTM row for NFR-7 turns suspect (fingerprint mismatch) → RTM
   revises that row → re-stamps fingerprints.
4. Feasibility, design, atomic functions, pseudocode, test plan, dev order,
   final design: content unaffected → **re-confirm** each (or revise only the
   ones that quote the wording). Chain clean.
5. `/velpari-handoff` unblocked.

### Example B — new feature (broad change)

1. Brainstorm the feature → approve.
2. PRD revises (new FR ids, append-only) → RTM revises (new rows) →
   feasibility **revised** (scope grew — viability question re-opened) →
   architecture revises → atomic functions gain new AF ids → pseudocode →
   test plan → dev order → final design.
3. This is Mode 2: every stage passes through update mode.

### Example C — developer in Development notices a feasibility issue

(The stage-6.3 scenario.) The project already handed off; Senai is building.
1. `/velpari-brainstorm "spike showed language X can't meet NFR-3"` → approve.
2. Feasibility marked stale → developer **revises** feasibility (new decision,
   possibly new language).
3. Staleness cascades: design, atomic functions, pseudocode, test plan, dev
   order, final design all stale.
4. Senai-side work pauses; the Velpari chain re-validates from architecture
   forward (Mode 3 — PRD/RTM untouched, still fresh).
5. New handoff package issued. Senai resumes from the updated package.

### Example D — pure discussion, no change

Developer runs brainstorm mid-stage to think through a question, changes
nothing, and continues the current stage. No artifact republishes → nothing
goes stale → zero workflow impact.

## Door semantics at approve (shipped 2026-09-20)

Modes 2 and 3 are chosen explicitly when the brainstorm is approved — the
**two doors** (`04-brainstorm-and-locking.md`):

1. **Continue the paused stage** (Mode 3) — the run returns to the stage it
   was paused from. Staleness decides what may actually run: fresh stages
   stay skippable, the earliest stale stage is what the lock routes to.
2. **Restart at the PRD** (Mode 2) — the run lands at `brainstormed`; the
   whole chain re-validates forward from `/velpari-prd` in update mode.

Selection: `/velpari-approve-brainstorm --restart-prd` picks door 2
directly; otherwise a picker asks when the TUI is available; the default is
continue. A session opened on a first run has no paused stage and no choice
— it advances to `brainstormed` as before.

## Re-brainstorm staling fix (shipped 2026-09-20)

An approved re-brainstorm of the same topic MUST stale the PRD/AF chain
through the normal staleness machinery (`03-staleness-and-validation.md`).
The bug: re-run publishes wrote a timestamp-suffixed file and recorded the
freshness manifest under the suffixed key, while downstream artifacts
resolved their brainstorm input by base slug — the downstream never went
stale. The fix (D8): the manifest keeps ONE entry per topic
(`brainstorm:<base-slug>`) whose `path` always points at the latest
published file (suffixed or not), and brainstorm-input resolution consults
the manifest first with base-slug disk fallback. Old suffixed files stay on
disk untouched; enumeration folds them into the base slug so they never
report a spurious `no-stamp`.
