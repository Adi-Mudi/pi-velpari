# 08 — Command Reference

The full pi_velpari command surface in the finalized sequence. For behavior
details, follow the links into the topic documents.

## Stage commands (10)

| Command | Phase | Produces (published) |
|---|---|---|
| `/velpari-brainstorm <mission>` | 1 — Discovery | `Doc/brainstorm/brainstorm-<topic>.md` |
| `/velpari-prd` | 2 — Requirements | `Doc/requirements/PRD_<project>.md` |
| `/velpari-rtm` | 2 — Requirements | `Doc/requirements/RTM_<project>.md` |
| `/velpari-feasibility` | 2 — Requirements | `Doc/feasibility/feasibility-study_<project>.md` |
| `/velpari-architecture-generator` | 3 — Design | `Doc/design/design_<project>.md` |
| `/velpari-atomic-function` | 3 — Design | `Doc/atomic-functions/atomic-functions_<project>.md` |
| `/velpari-pseudocode` | 3 — Design | `Doc/pseudocode/pseudocode_<project>.md` |
| `/velpari-testplan` | 4 — Validation & Handoff | `Doc/tests/test-plan_<project>.md` + `test-cases_<project>.md` |
| `/velpari-development-order` | 4 — Validation & Handoff | `Doc/development-order/development-order_<project>.md` |
| `/velpari-final-design` | 4 — Validation & Handoff | `Doc/design/final-design_<project>.md` |

Notes:
- `/velpari-brainstorm` is invocable at **any** stage as discussion mode —
  see `04-brainstorm-and-locking.md`.
- `/velpari-final-design` produces a consolidation document, not HTML
  (historical name; the `/velpari-html-design` name is reserved for a future
  mockup generator).
- **Publish target (Phase 11, Q3):** the `Doc/…` paths above are what a stage
  writes when markdown writes are ON. The **default is DB-only** — approve
  writes store rows + the YAML export beside the DB + a git commit and
  NOTHING to `Doc/`; the `Doc/…` files are then the store kind's human view
  (`/velpari-export` + the `show` commands). Legacy projects keep their
  files; opt in with `"velpari": {"markdownWrites": true}` in `files.json`.

## Approve commands (10)

| Command | Role |
|---|---|
| `/velpari-approve-brainstorm` | Bespoke brainstorm gate (understanding confirmed, no open questions, notes complete). |
| `/velpari-prd-approve` … `/velpari-final-design-approve` (9 commands) | Manual publish fallback for stages 2–10. Identical gate chain to the `velpari_stage_publish` tool: revision gate → artifact gate (validation layers 1–3) → publish → full doctor audit. |

The normal path publishes inline: the parent LLM calls the
`velpari_stage_publish` tool after the developer confirms the preview. The
typed approve commands exist for recovery when that path is unavailable.

## Setup / configure commands (6)

| Command | Purpose |
|---|---|
| `/velpari-configure-inputs` | Framework, projectName, code/test/doc/excluded paths → `files.json`. Empty-project safe. |
| `/velpari-configure-requirements` | Requirements profile (optional; default = common PSRS core). |
| `/velpari-configure-standards` | Standards overlay (optional). |
| `/velpari-configure-agents` | Role → custom agent name mapping → `agents.json`. |
| `/velpari-agents` | View + validate the mapping. |
| `/velpari-generate-sub-agents` | Per-phase dynamic agent generation (phase auto-detected from run state; `--phase N` overrides) — see `05-sub-agent-generation.md`. |

## Ops / discipline commands (9)

| Command | Purpose |
|---|---|
| `/velpari-status` | Current stage, run, staleness summary, the single correct next command. |
| `/velpari-doctor` | Full audit anytime: setup, secrets, agents, formats, freshness/staleness, ID coverage, reviewer verdicts, DB integrity/links/portfolio. |
| `/velpari-reset` | Discard the current run (destructive; confirmed). Published store rows — including run `migrated` — survive; only the run's draft rows are deleted. |
| `/velpari-handoff` | Final validation → `.pi/senai/architect-inputs.json`. Blocks on any staleness. |
| `/velpari-design-logging` | Cross-cutting logging architecture plan (after Design approved; not a stage). |
| `/velpari-reconfirm` | Re-confirm a stale artifact whose changed inputs have no impact (see below). |
| `/velpari-backfill <kind>` | One-step import of a pre-store project into its store DB (`--from-export` rebuilds from the YAML beside the DB). Store-only; no stage advance. |
| `/velpari-portfolio` | List the portfolio registry (`Doc/store/portfolio.db`); `--repair` rebuilds it from the spokes. |
| `/velpari-migrate-store` | One-time legacy migration (Phase 11, RES-3): `--dry-run` reports per project/kind and writes nothing; `--execute` confirms first, then imports into the store under run `migrated`, re-exports the YAMLs beside each DB, verifies, and commits per project. |

### `/velpari-reconfirm` — the re-confirm path (spec 02: second resolution path)

When a declared input of a published artifact changed but the change has
**no impact** on that artifact, re-confirm clears the staleness without a
republish. Gates and behavior:

- **Picker over the actionable stale set only** — `input-changed` items,
  one artifact at a time, showing `changedInputs`. A cancelled picker or a
  declined confirm writes nothing.
- **`input-missing` and `no-stamp` are refused** (republish-only): "no
  impact" is incoherent against a vanished input, and legacy unstamped
  artifacts need a real publish.
- **Audit triple per re-confirm**: (a) the mandated Change Log line
  `Reviewed after `<artifact>` vX.Y — no changes required.` appended to the
  published artifact (upstream version from its frontmatter,
  `unknown-version` fallback); (b) the freshness manifest entry re-stamped
  with current normalized hashes + a `reconfirmedAt` marker (RTM JSON
  sidecar `extraPaths` recomputed too); (c) a `history.jsonl` entry when a
  run is active.
- **Write target (Phase 11):** the target is chosen by EXISTENCE. A published
  `Doc/` file → the line is appended to it (legacy / flag-ON projects). No
  published file (the DB-only default) → the line appends to the store
  envelope's `changeLog` column, followed by a checkpoint — the audit trail
  survives the retired markdown write.
- Freshness hashing for re-confirmed/newly published entries excludes the
  `## Change Log` section (`hashv: 2`), so the audit line itself never
  re-stales downstream consumers. Legacy (`hashv`-less) entries keep
  whole-file checking until their next publish or re-confirm.

## View commands (8)

`/velpari-show-brainstorm`, `/velpari-show-prd`, `/velpari-show-rtm`,
`/velpari-show-feasibility`, `/velpari-show-design`, `/velpari-show-pseudocode`,
`/velpari-show-testplan`, `/velpari-show-logging` — read-only display of
working or published artifacts.

## Wrapper (1)

`/velpari-prd-rtm` — runs PRD then RTM in sequence. No auto-approve.

## Flags

| Flag | Effect |
|---|---|
| `--velpari-skip-doctor` | Skip the doctor pass (diagnostic use). |
| `--velpari-stage <stage>` | Hard override of the target stage (diagnostic use). |
| `--velpari-fix` | After `/velpari-doctor`, offer the interactive fix picker. |
| `--velpari-run-reviewer` | Force the adversarial reviewer at intermediate tier. |

## Transition table

Mirrors `STAGE_TRANSITIONS` in `pi-extension/src/core/constants.ts`
(runtime source of truth). The full table with state names is in
`01-first-run-sequence.md` §Stage transition table. On revision runs the
static table is filtered by the dynamic transition lock — see
`04-brainstorm-and-locking.md`.

## Per-stage doc scope (summary)

Every stage reads **all prior published artifacts** + `files.json` +
requirements profile (compact) + standards overlay + agent mapping. The
per-command scope is checked before any LLM call (the historical
`COMMAND_SCOPE` table name; the live surface is
`commands/index.ts:COMMAND_NAMES`). The finalized addition: scope checking
also verifies input **freshness**, not just presence
(`03-staleness-and-validation.md`).
