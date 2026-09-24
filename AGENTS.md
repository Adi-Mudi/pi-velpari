# AGENTS.md — Pi-Velpari

Agent-focused guidance for the `pi-velpari` Pi extension. Parallels `Pi-Orchestra_v4/AGENTS.md`.

- `.pi/velpari/` — local config: `files.json` v4 (framework + paths), `agents.json` (role→agent map), `requirements-profile.json`; run state (`state.json`) + run lock (`.lock/`).
- `.IDE_Plans/velpari/` — working copies, per-run history (`runs/<run-id>/history.jsonl`), doctor reports.
- `Doc/` — published artifacts (artifacts of record).
- `.pi/senai/architect-inputs.json` — handoff target consumed by Senai.
- See `Doc/velpari-sequence/` (README as entry) for the full sequence doc set; `README.md` for install; `CHANGELOG.md` for history.

## Project overview

`pi-velpari` adds stage-gated slash commands for the **pre-production** phase of software work:

```
Brainstorm → PRD → RTM → Feasibility → Design → Atomic Functions →
Pseudocode → Test Plan → Development Order → Final Design → Handoff
```

It mirrors Pi-Senai's discipline model (state-gated runs, working/published copy separation, doctor audit, single-source-of-truth state file) for the upstream half of the lifecycle. Velpari produces the requirements package that Senai's `/senai-generate-architect` consumes.

## Tech stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js LTS (currently 20+; tests use `node --test`)
- **Package manager:** npm
- **Build:** `tsc` (see `tsconfig.json`); ESM under `dist/`
- **Peer dependencies:** `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox` (Pi core — never bundled).
- **Runtime plugin (not bundled):** `pi-interactive-subagents` (≥3.7.2). End users install once via `pi install github.com:HazAT/pi-interactive-subagents`. Velpari never `import`s it — every reference is text in a comment or scout description.
- **One runtime dependency (B3/D1):** `yaml` (^2), imported only by L0 data modules (`core/yaml-data.ts` and the `*-data.ts` sidecar modules). No test framework, no linter.

## Build and test

Always build before testing.

```bash
npm run build
npm test
npm run test:e2e   # RUN_E2E=1 + pi on PATH
```

**Thermal protocol (2026-09-21):** the full unit + e2e gate runs in **GitHub Actions** (`.github/workflows/test.yml`, triggered on `bug-fix` too). Local runs during development are `npm run build` + targeted `node --test dist/pi-extension/test/<file>.test.js` only — the dev machine overheats under the full local suite.

## Layered architecture

`pi-extension/src/` follows the official 4-layer orchestrator layout. Each layer has a single concern and a strict dependency direction: a file in layer N may import from any layer < N, never upward.

| # | Layer | Folder | Rule |
|---|---|---|---|
| 0 | Domain | `core/`, `io/` | Pure logic + atomic-write helpers. Imports nothing else from `src/`. |
| 1 | Stage logic | `stages/`, `ops/`, `doctor/`, `view/` | Per-stage handlers + registry; ops; diagnostics; read-only display. Imports L0 only. |
| 2 | Presentation | `ui/`, `hooks/` | TUI widgets; Pi lifecycle hooks (one file per event). Imports L0–1. |
| 3 | Composition | `commands/`, `index.ts` | Slash commands (one file each); extension entry. Wiring only. |

`ops/` and `view/` are velpari-local L1 groupings. **Layering is enforced** by `pi-extension/test/architecture-alignment.test.ts`. Adding a folder requires adding it to `src/layers.ts`.

## Project structure (top-level)

```
.
├── package.json, tsconfig.json, README.md, CHANGELOG.md
├── AGENTS.md                            # this file
├── pi-extension/                        # extension source (4-layer layout)
│   ├── src/{core,io,stages,ops,doctor,view,ui,hooks,commands}/
│   └── test/                            # node:test unit + e2e suites
├── skills/                              # stage skill markdown + bundled scout agents
├── Doc/                                 # published artifacts (grouped by stage)
├── resources/technologies/              # one .md per tech (sub-agent generator input)
├── DevPlan/                             # persistent roadmap
└── .IDE_Plans/                          # temp planning + run state
```

Full tree: `tree -L 2` or read individual folders for detail.

## Key design principles

1. **Zero hallucination.** Every claim traces back to a user-provided statement in a brainstorm note or an earlier approved artifact.
2. **Auto-publish (v1.6.0).** Working copies go to `.IDE_Plans/velpari/runs/`. Published copies in `Doc/` are produced only via the `velpari_stage_publish` tool after the parent LLM gets a "yes" at the preview gate (revision gate + artifact gate + post-publish doctor audit all pass). The 9 per-stage `/velpari-<stage>-approve` commands are the manual fall-back.
3. **Stage gates are enforced.** A stage cannot start until its prerequisites are approved. `constants.ts:STAGE_TRANSITIONS` is the single source of truth.
4. **Scout pattern via real visible subagents.** Stages 2–10 use 4 parallel subagents via `pi-interactive-subagents` in visible multiplexer panes. Each writes a report to `<runDir>/<stage>/scouts/<role>-report.json`. The parent LLM orchestrates spawning, waiting, and writing the working copy. Brainstorm dispatches are read-only. `.pi/velpari/agents.json` maps roles to custom agent names; report paths stay role-keyed.
5. **Brainstorm lifecycle v2.1 — understand-first with hard lock + multiplexer gate.** Parent LLM runs a conversational UNDERSTAND loop and confirms before anything else runs (scan gate, scout dispatch, notes writing, approve). Multiplexer (zellij/tmux/wezterm/cmux) is required; override via `PI_SUBAGENT_MUX`. **Brainstorm-anytime (v2.3, 2026-09-20):** the v2.2 single-shot guard is gone — `/velpari-brainstorm` opens from ANY stage. From `none` it starts a fresh run; from any other stage it pauses that stage (`state.pausedStage`) via `openBrainstormSession`. Only a nested open (session already open) is blocked. At approve, a paused run picks a door: continue the paused stage (default / picker) or restart at the PRD (`--restart-prd`). `velpari_brainstorm_session({action:"discard"})` closes a session without publishing.
6. **Decision ledger.** Brainstorm DISCUSS tracks every question state (draft → discussing → agreed / not-wanted(+reason) / replaced). Rejected ideas keep their reason. `/velpari-approve-brainstorm` hard-blocks on any draft/discussing.
7. **Scan gate with consent (v2.1: always asks).** Five branches: Run all / code+doc only / community only / adjust / skip. Community scan IS the web-search consent (FR-52) and requires explicit confirm. Brainstorm scouts are read-only (dispatcher strips write/edit/bash).
8. **Gated approve + audit log.** `/velpari-approve-brainstorm` hard-blocks on unconfirmed understanding, open questions, and missing/empty/`_TBD_` notes sections. On success publishes atomically, writes the dispatch audit log, clears session fields, advances stage, surfaces a `Next: /velpari-prd` hint.
9. **Helper ↔ atomic relationship.** Helpers live in `## Helper Functions` of the PRD; atomics in `Doc/atomic-functions.md`. Atomics are leaf nodes; helpers may call atomics.
10. **Stages 6–10 are required and ordered.** `/velpari-atomic-function` → `/velpari-pseudocode` → `/velpari-testplan` → `/velpari-development-order` → `/velpari-final-design`. None can be skipped.

10a. **Atomic-function tier-driven schema.** ISO/IEC 29110 tiers (Entry/Basic/Intermediate/Advanced) + IEC 62304 criticality (A/B/C) + IEC 61508 SIL 1-4. Profile in `.pi/velpari/files.json:atomic`. Doctor gate enforces tier-aware rigor at publish time. Defaults to `{ basic / A / none }`.

10b. **Reviewer sub-agent (Plan A + D).** The only adversarial critic. Plan D generalizes to 4 stages: `atomic-function` (original), `pseudocode`, `testplan`, `design`. Tier gate: required at advanced, opt-in at intermediate via `--velpari-run-reviewer`, skip at entry/basic. Doctor consumes the verdict via the stage→verifier map (`doctor/checks/reviewer-verdict.ts:REVIEWER_STAGE_SPECS` + `verifierSpecForArtifact` at the publish gate; `checkVerifierVerdictsSection` for anytime reporting). Pattern modeled on Anthropic Constitutional AI (adversarial critique), Cursor Composer/Reviewer, SWE-Agent Manager/Editor/Reviewer, ISO/IEC 14764 (independent review per maintenance type).

10c. **Freshness stamps + stale set (B4 + A3).** Every publish stamps `inputs:` (a JSON scalar mapping input id → SHA-256) into the artifact frontmatter and upserts `.pi/velpari/freshness.json` (`core/freshness.ts`). `computeStaleSet` compares declared inputs against the stamps: `input-changed` / `input-missing` are errors — stage-start hard-blocks (`stages/registry.ts`), the publish gate refuses (`doctor/gate.ts`), and the doctor freshness section reports them (`doctor/checks/freshness.ts`). `no-stamp` (legacy unstamped artifact) is a warning; publish continues. The stale-downstream check is hash-driven via the same stale set (mtime loop removed). The logging plan is intentionally outside this machinery (info note only).

10d. **Layer-2 ID coverage + handoff gate (A4 + A6).** `core/id-coverage.ts` checks that upstream ids appear downstream: PRD FR/NFR → design (§1 `Source FRs` + §5 NFR columns only — never §7 prose), AF → pseudocode (`AF: AF-N` lines), FR/AF → test-cases (`Traces` column), AF → development-order (`AFs:` lists). Legacy tolerance: zero parseable refs → `not-checkable` warning (never blocks); some refs → missing ids are errors. Dev-order duplicate AF = warning. Enforced at stage publish (gate branch), doctor (`ID coverage` section), and `/velpari-handoff` — which also blocks on any `input-changed`/`input-missing` stale item (no-stamp warns) before building the payload. The skill templates (`velpari-pseudocode`, `velpari-testplan`, `velpari-development-order`) demand the references, so new runs are machine-checkable.

10e. **Re-confirm path + normalized hashing (A5).** `/velpari-reconfirm` is the second stale-resolution path: a picker over `input-changed` stale items only (`input-missing`/`no-stamp` are republish-only), one artifact at a time; a cancelled picker writes nothing. Each confirm writes the audit triple: the mandated Change Log line ``Reviewed after `<artifact>` vX.Y — no changes required.`` in the published artifact (upstream version from its frontmatter, `unknown-version` fallback), a manifest re-stamp with `reconfirmedAt` (RTM `extraPaths` recomputed), and a history entry. Freshness hashing is **normalized** for `hashv: 2` manifest entries — the `## Change Log` section is excluded (`core/fingerprints.ts:hashFileContentNormalized`), so the audit line never re-stales downstream consumers; entries without `hashv` keep legacy whole-file checking until their next publish/re-confirm (no mass-staling). All new publishes stamp `hashv: 2`. The command edits a published `Doc/` artifact from code — a stated, narrow exception to the publish-only invariant; the LLM `tool_call` lock is unaffected.

10f. **DB-primary reads (Phase 6) + DB-auditing doctor (Phase 7).** The per-project SQLite store (`Doc/store/<project>/index.db`) is the single machine source of truth; markdown/YAML/HTML are human views (DB-rendered for 5 artifacts — prd, rtm, atomic-functions, test-cases, development-order; LLM-authored + hash-bound for 5 hybrid docs — design, pseudocode, testplan-plan, feasibility-study, final-design). Stages + scouts read `## DB Input Slices` blocks from the store only; brainstorm notes remain the one file-based input; the reviewer agent is the sole slice+view exception (drift = a finding). Sidecar YAML files are retired as sources (legacy read fallback until Phase 11) — YAML is a download view via `/velpari-export`. A pre-store project recovers with the one-step `/velpari-backfill <kind>` import (43rd command; idempotent, store-only — no Doc/ write, no stage advance, no git commit). Phase 7: the doctor's data checks read store rows directly (sidecar fallback + a `/velpari-backfill` warning for pre-store projects); new SQL checks audit the DB itself — G4 integrity (`PRAGMA quick_check` + `integrity_check`, stamping `store_meta.integrity_checked_at` on standalone `/velpari-doctor` runs only, never in the embedded post-publish run) and the `links` adjacency orphan audit; the secrets scan sweeps DB text columns; id-coverage uses store link edges (tc_trace/step_af) with sidecar fallback.

11. **Deterministic, not creative.** File paths, file formats, state JSON shape, stage transitions, handoff schema are all fixed by code.
12. **Mirrors Senai's discipline.** Same control surface (approve/status/reset/configure/doctor), state file layout, scout-pattern UI.
13. **Feasibility v2 — decision stage with evidence.** Read-first, then consent-gated reuse scan (70/30 thresholds, license + repo-freshness gate), then language selection (configured framework wins; otherwise mandatory spikes — one `feasibility-spike` agent per candidate language builds+runs the core function). Publish hard-blocks until decision + selected language are recorded.
14. **Sub-agent generator (v2, per-phase).** `/velpari-generate-sub-agents` emits project-specific sub-agents by deterministic assembly, one generation phase at a time (`core/agents-config.ts:GENERATION_PHASES`): P1 = 4 brainstorm roles; P2 = PRD/RTM/feasibility scouts (+ 2 feasibility-conditional); P3 = design/atomic-function/pseudocode scouts + all 4 reviewers; P4 = testplan/development-order/final-design scouts. The phase auto-detects from the run state; `/velpari-generate-sub-agents --phase N` overrides. Phase-boundary hints (`core/agent-freshness.ts`) recommend regenerating when a run enters a phase without fresh generated agents; the doctor audits per-phase freshness (inputs republished after generation → regenerate recommended, warning only) and reviewer presence per tier policy (error when required). Safety layers unchanged: one confirmation gate per run, never-overwrite contract, drift manifest at `.pi/velpari/generated-manifest.json`.

## State and artifacts

State file: `.pi/velpari/state.json` (full schema in `core/state.ts`). Run lock: `.pi/velpari/.lock/`. Run history lives in per-run `.IDE_Plans/velpari/runs/<run-id>/history.jsonl` — state.json no longer carries `history[]` (the `RunState.history` field is optional + deprecated; `core/history.ts:loadHistory` is the reader). A legacy `.IDE_Plans/velpari/state.json` is migrated on first `loadState`.

Working copies:
```
.IDE_Plans/velpari/runs/<run-id>/{brainstorm,prd,rtm,feasibility,design,pseudocode,testplan}/
```

Published copies (grouped layout in `Doc/`):
```
Doc/
├── brainstorm/brainstorm-<topic-slug>.md
├── requirements/{PRD,RTM}_<projectName>.md
├── feasibility/feasibility-study_<projectName>.md
├── design/design_<projectName>.md
├── pseudocode/pseudocode_<projectName>.md
├── tests/{test-plan,test-cases}_<projectName>.md
├── atomic-functions/atomic-functions_<projectName>.md
└── development-order/development-order_<projectName>.md
```

Legacy flat `Doc/PRD*.md` etc. remain readable as fallback paths.

## Stage workflow

| Stage transition | Command |
|---|---|
| `none` → `brainstorming` | `/velpari-brainstorm <mission>` |
| `brainstorming` → `brainstormed` → `drafting-prd` | `/velpari-approve-brainstorm` |
| `brainstormed` → `drafting-prd` | `/velpari-prd` |
| `drafting-prd` → `drafted-prd` → `building-rtm` | `/velpari-prd-approve` |
| `drafted-prd` → `building-rtm` | `/velpari-rtm` |
| `building-rtm` → `built-rtm` → `analyzing-feasibility` | `/velpari-rtm-approve` |
| `built-rtm` → `designing` (skip — update cycles) | `/velpari-architecture-generator` |
| `built-rtm` → `analyzing-feasibility` | `/velpari-feasibility` |
| `analyzing-feasibility` → `analyzed-feasibility` → `designing` | `/velpari-feasibility-approve` |
| `analyzed-feasibility` → `designing` | `/velpari-architecture-generator` |
| `designing` → `designed` → `analyzing-atomic-functions` | `/velpari-architecture-generator-approve` |
| `designed` → `analyzing-atomic-functions` | `/velpari-atomic-function` |
| `analyzing-atomic-functions` → `analyzed-atomic-functions` → `writing-pseudocode` | `/velpari-atomic-function-approve` |
| `analyzed-atomic-functions` → `writing-pseudocode` | `/velpari-pseudocode` |
| `writing-pseudocode` → `wrote-pseudocode` → `planning-tests` | `/velpari-pseudocode-approve` |
| `wrote-pseudocode` → `planning-tests` | `/velpari-testplan` |
| `planning-tests` → `planned-tests` → `ordering-development` | `/velpari-testplan-approve` |
| `planned-tests` → `ordering-development` | `/velpari-development-order` |
| `ordering-development` → `ordered-development` → `finalizing-design` | `/velpari-development-order-approve` |
| `ordered-development` → `finalizing-design` | `/velpari-final-design` |
| `finalizing-design` → `finalized-design` → `handoff-ready` | `/velpari-final-design-approve` |
| `finalized-design` → `handoff-ready` | `/velpari-handoff` |

## Sequence nuances (7 things to remember)

1. **Each stage reads ALL prior approved artifacts**, not just the immediate predecessor.
2. **`files.json` is a global input read by every stage.** Configured once via `/velpari-configure-inputs`.
3. **`requirements-profile.json` is read by every stage** as compact metadata (never the full profile).
4. **No auto-chains; user runs each next command by hand (v1.6.2+).** Each stage boundary is a manual confirm-then-write step.
5. **Feasibility skip:** `/velpari-architecture-generator` from `built-rtm` is allowed only when a published feasibility study exists (update-cycle path). Otherwise `/velpari-feasibility` must run first. Skip is a choice, never forced.
6. **Approve commands.** `/velpari-approve-brainstorm` is bespoke to brainstorm. Stages 2–10 publish via the `velpari_stage_publish` tool; the 9 per-stage `/velpari-<stage>-approve` commands are the manual fall-back (same gate chain).
7. **`/velpari-final-design`** produces a final-design consolidation doc (not HTML). Previously named `/velpari-html-design`, then `/velpari-design`.

> See [Doc/velpari-sequence/](Doc/velpari-sequence/README.md) for the full sequence doc set.

## Command surface

**44 commands total** (see `commands/index.ts:COMMAND_NAMES` for the full list):
- **10 stage** — 5 pre-production (`brainstorm`, `prd`, `rtm`, `feasibility`, `architecture-generator`) + 3 build-planning (`atomic-function`, `pseudocode`, `testplan`) + 2 execution/consolidation (`development-order`, `final-design`).
- **10 approve (fall-back)** — 9 per-stage `/velpari-<stage>-approve` + the bespoke `/velpari-approve-brainstorm`.
- **8 ops/discipline** — `status`, `reset`, `handoff`, `doctor`, `design-logging`, `reconfirm` (A5), `backfill` (Phase 6 — 43rd command), `portfolio` (Phase 10 — 44th command).
- **6 configure** — `configure-inputs`, `configure-requirements`, `configure-standards`, `configure-agents`, `agents`, `generate-sub-agents`.
- **1 wrapper** — `prd-rtm`.
- **8 view** — `show-<stage>` + `show-logging`.
- **1 export** — `export` (Phase 5): on-demand document download from the DB store (read-only, no publish/gate changes).

## Coding conventions

- TypeScript strict mode; prefer explicit types; export public interfaces from their modules.
- `path.join` for all paths; atomic writes via `io/atomic-write.ts`; ESM imports with explicit `.js` extensions.
- Keep command handlers thin. State logic → `state.ts`; prompt logic → `prompt.ts`. Don't mutate loaded state in place — use `advanceStage()` and `saveState()`.
- **Per-command doc scope is the source of truth** — checked via `checkDocScope` pre-LLM (the historical `commands.ts:COMMAND_SCOPE` table name; the live registration surface is `commands/index.ts:COMMAND_NAMES`). Drift is a defect.
- **No `/velpari-architect` command.** Velpari produces inputs; Senai generates architecture. (FR-47)
- **No runtime dependency on Senai.** TUI patterns re-implemented in `pi-extension/src/ui/` using Pi primitives. (FR-55)
- **Uniform subagent pattern.** All scouts via `subagent()` from `pi-interactive-subagents`. Stages 2–10 use `core/stage-runner.ts:runStageWithScouts()`; brainstorm uses `stages/brainstorm/dispatcher.ts` (read-only tools enforced).
- **Roles fixed, agent names swappable.** `core/agents-config.ts:VELPARI_ROLES`. `.pi/velpari/agents.json` maps role → custom name; absence = defaults. Report paths stay role-keyed. FR-52 web-search consent is anchored on the ROLE.
- **Framework is one-time setup** via `/velpari-configure-inputs` (files.json v4). No `/velpari-framework` command. (FR-49)
- **WEB SEARCH AGENT is consented at the scan gate.** Never auto-invoke. (FR-52)
- **`/velpari-approve-brainstorm`** is bespoke; per-stage fall-back commands error in brainstorm stage. Use fall-back for stages 2–10. (FR-58/59, NFR-14)
- **Output documents use `projectName` suffix.** Never hardcode "Pi-Velpari" in a file path. Use `paths.ts:buildGroupedPath()` / `resolveDocArtifact()`. (FR-67..71, NFR-15)
- **Grouped `Doc/` layout (Phase 7).** New writes go to category subfolders. Legacy flat paths remain readable; nothing moved/deleted.
- **PSRS shape (Phase 7).** 20 required sections (validated by `core/psrs.ts`); User Stories / Success Metrics / FR / NFR tables carry a `Status` column.
- **Living documents / update mode.** Changes start at `/velpari-brainstorm` (change mode); stages revise, never regenerate. Append-only IDs, deprecate-don't-delete, version bump, mandatory Change Log entry.
- **Sequence hardening.** `STAGE_GATE` rejects wrong-stage commands. **Transition lock (A1):** all legality decisions — gate, brainstorm-open two-door collapse, stale-input blocks, earliest-stale routing, update-mode self-loops — delegate to `stages/transition-lock.ts:computeLegalCommands`; `STAGE_LOCK_SPECS` (registry) feeds it stage data in execution order. `io/run-lock.ts` serializes `state.json` mutations. `tool_call` hook locks edit/write to active stage's run folder (brainstorm-open lock wins over the stage-folder lock); **Phase 8: `Doc/store/**` is edit/write-locked ALWAYS (store-scope guard — the store is written only by the publish tool, backfill, reconfirm, export; bash bypass accepted, checksums + integrity/orphan audits backstop), and `/velpari-reset` deletes the run's DRAFT store rows before clearing state (published rows survive).** `before_agent_start` injects `<velpari_status>` every turn (`next:` + paused stage from the lock).
- **Feasibility skip (update cycles)** is allowed when `core/paths.ts:hasPublishedFeasibility` returns true.
- **Design stage command is `/velpari-architecture-generator`** (not `/velpari-design`). StageKey unchanged.
- **Store DB is git-committed raw; the publish chain auto-heals the user repo's `.gitattributes`/`.gitignore`** (ops/git-attributes.ts — binary attr + WAL ignores for BOTH the per-project DBs and the portfolio registry; healed files join the publish commit) and the merge/recovery runbook ships at `skills/db-store-merge-runbook.md` (rebuild path: `/velpari-backfill <kind> --from-export`). Phase 9, §15.4.
- **Portfolio registry (Phase 10, §15.5): `Doc/store/portfolio.db` is the metadata-only hub** (project name, db path, last publish/run/stage — NO artifact rollups). The publish chain syncs it pre-commit (fail-open, outside the store transaction; every write ends `wal_checkpoint(TRUNCATE)`); `/velpari-portfolio --repair` rebuilds it from the spokes. D8: `mermaid_text` starting `image:` = asset ref relative to the owning DB dir, rendered as a markdown image (renderers never touch the fs; the doctor portfolio check is the sole missing-asset detector and rejects `..` traversal).
- **`/velpari-final-design`** (Stage 10) — name reflects what it does (a consolidation doc, not HTML).
- **No subagent-spawning code anywhere.** If you reach for a subagent API, re-read the design principles.
- **`ctx.ui.setStatus(key, text)` is the TUI footer API** (v0.5.1). Velpari uses the key `"velpari"`.
- **Flags:** `--velpari-skip-doctor`, `--velpari-stage`, `--velpari-fix`, `--velpari-run-reviewer`. Registered via `pi.registerFlag` in `index.ts`.
- **RTM YAML sidecar is the source of truth.** Edit the sidecar (`RTM_<project>.yaml`; legacy `.json` is a read-only fallback), never the published markdown.
- **SHA-256 fingerprints on every RTM link.** Stamped at publish time; doctor reports suspect/unknown-id/orphan as errors.
- **Publish gate + automatic doctor audit.** Both publish and fall-back commands run `doctor/gate.ts:runPublishGate` pre-write and full `runDoctor` post-write. Errors + warnings both block the advance (v1.2.1 policy).
- **RFC 2119 + EARS** for FR/NFR wording. `findFrRowsMissingKeywords` flags non-conforming rows.
- **YAML frontmatter on published artifacts** (`artifact`, `runId`, `stage`, `version`, `generatedAt`).
- **Phase vocabulary (MVP traceability).** Every FR/NFR row carries `Phase` (positive int; Phase 1 = MVP). RTM JSON requires `phase` per row. PRD Phase edits flag RTM rows as suspect via fingerprints.
- **MVP coverage gate.** `core/mvp-coverage.ts:checkMvpCoverage` compares PRD Phase-1 ids against RTM JSON. `/velpari-handoff` blocks on errors.
- **Architecture generator is standards-aligned** (arc42 + Rozanski & Woods + SEI ATAM/ADD + C4 + Nygard ADR + Bass/Clements/Kazman). Required sections: `## 0`, `## 0.4`, `## 5`, `## 9`, `## 10`, `## 11`, `## 12`, `## 13`, `## 14`. Style choice = ADR-001 (mandatory, accepted, ≥2 options). Every `Approach` cell in §5 names a tactic from `core/tactic-catalog.ts:TACTIC_CATALOG`. **C4 diagrams mandatory** (Context/Container/Component, all Mermaid). `CURRENT_SHAPE_MAJOR` + `REQUIRED_SECTION_COUNT` in `core/shape.ts` are the source of truth for shape compatibility. Multi-design: `files.json:projectNames: ["alpha", "beta"]` (or legacy single `projectName`).

## Testing

- `pi-extension/test/` uses Node's built-in test runner. `npm test` builds, then runs `node --test` on `dist/pi-extension/test/**/*.test.js` excluding `test/e2e/`.
- One module per test file. Temp dirs via `fs.mkdtempSync`. For command tests, build the handler map with `registerCommands` + a mock `ExtensionAPI`.
- E2E suites in `pi-extension/test/e2e/` (RUN_E2E=1 + `pi` on PATH). 8 suites: registration, doctor, config, stage-gates, brainstorm-gates, ops-doctor, generate-sub-agents, tier2-brainstorm-only. Embedded bash-channel scripts must not contain backticks or `${...}`.
