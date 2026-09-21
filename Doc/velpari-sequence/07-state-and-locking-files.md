# 07 — State & Locking Files

Where control data lives, and the rule that keeps it small.

## Location: `.pi/velpari/` — not `.IDE_Plans/`

Control data is **durable configuration**, so it lives with the other Velpari
config in `.pi/velpari/`. Temporary run material stays in `.IDE_Plans/`.

| Data | Location | Kind |
|---|---|---|
| `state.json` (run state) | `.pi/velpari/state.json` | control — moved from `.IDE_Plans/velpari/state.json` |
| Run lock | `.pi/velpari/.lock/` | control — moved from `.IDE_Plans/velpari/.lock/` |
| Freshness manifest | `.pi/velpari/freshness.json` | control (new — see `03-staleness-and-validation.md`) |
| `files.json`, `requirements-profile.json`, `standards-profile.json`, `agents.json`, `generated-manifest.json` | `.pi/velpari/` | control (already here) |
| Working copies, scout reports, spikes, dispatch logs | `.IDE_Plans/velpari/runs/<run-id>/` | temporary (unchanged) |
| Doctor report | `.IDE_Plans/velpari/doctor-report.md` | temporary (unchanged) |
| Run history / audit trail | `.IDE_Plans/velpari/runs/<run-id>/history.jsonl` (per-run) | temporary — **moved out of `state.json`** |

## The config-sized rule

> **Control files hold current values, never history. Reading one always
> shows *now*, never *everything that ever happened*.**

Concretely:

1. **`state.json`** — fixed shape, values overwritten in place:
   `runId`, `mission`, `currentStage`, `updatedAt`, plus the open-session
   fields (brainstorm-open flag, feasibility session) which are cleared when
   their session ends. It behaves like a config file.
2. **Freshness manifest** — one entry per artifact (`hash`, `publishedAt`,
   `inputs{}`), **overwritten on each republish**. Its size is bounded by the
   artifact count (~11 entries) forever. It cannot grow.
3. **Run lock** — fixed keys (holder pid, heartbeat, run id), overwritten.
   A few hundred bytes, always. Locking mechanics unchanged: atomic mkdir +
   heartbeat + stale-steal, serializing every `state.json` mutation.
4. **History does not live in control files.** Stage transitions, approvals,
   and audit events append to the **per-run** history file inside the run
   folder — many small files instead of one growing file.

### Resolved violation (shipped note)

~~Today's `state.json:history[]` appends an entry per transition~~ — **resolved
2026-09-20 (B2)**: history lives in the per-run `history.jsonl` inside the run
folder (`core/history.ts`); `state.json` is config-sized. The inline
`history[]` field stays in the schema as `@deprecated` optional only so legacy
state files and fixtures still parse; runtime readers use `loadHistory`.

## Why this matters

1. A growing state file eventually becomes the bottleneck and the corruption
   risk — every stage mutation rewrites it.
2. Config-sized files stay human-inspectable: a developer can open
   `state.json` or `freshness.json` and understand the whole situation at a
   glance.
3. Per-run history scales naturally: disk usage grows with actual work done,
   in the folder that's already the run's workspace — and disappears with
   `/velpari-reset`.
4. Recovery is simple: if a session dies, the lock's stale-steal + the
   config-sized state file are all the orchestrator needs to resume from the
   next valid stage (`01-first-run-sequence.md` §cross-session resume).

## Migration note (for existing projects)

On first run after the upgrade, the orchestrator reads the legacy locations
(`.IDE_Plans/velpari/state.json`, `.IDE_Plans/velpari/.lock/`), moves them to
`.pi/velpari/`, splits `history[]` out to the run folder, and continues.
Nothing is deleted until the move verifies. Details belong to the
implementation plan, not this spec.
