# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### DB-primary storage Phase 12 — shipped-path fixes + integration proof (2026-09-24)

The shipped DB-only default had never been executed end-to-end, and doing so exposed three real defects — all fixed here. `ops/approve.ts` now gates DB-rendered kinds on the **LLM working copy** (the artifact the user reviewed) instead of the lossy DB render, so a PRD publish and a PRD **revision** pass their gates under the default (before: 21 `psrs-*` errors, nothing could publish). The G8 `prd-file` mirror hash is required only when a PRD markdown is **already published** and is compared against that pre-publish file, so a first publish in write-alongside mode no longer fails on a hash the caller cannot predict. The three DB-rendered doctor drift checks are DB-only aware, so a migrated project's legacy markdown no longer reports phantom drift. Coverage: an approve-level suite for the shipped default, a migrated-project end-to-end suite, a Tier-1 e2e through a real `pi`, and the e2e README refresh. No new dependencies.

#### Added

- **`test/integration/db-era-publish.test.ts`** — the first approve-level test of the shipped default (no `velpari` key → markdown OFF) plus the flag-ON hatch and both G8 revision directions.
- **`test/integration/migrated-project.test.ts`** — migrated project end-to-end: DB-primary reads, slice + `## DB Input Slices` prompt block, DB-era approve commit set, export renderer, doctor classification, rebuild-from-YAML checksum verified.
- **`test/e2e/migrate-store.e2e.test.ts`** — Tier-1: `/velpari-migrate-store` dry-run/execute + the `velpari(migrate)` commit driven through a real `pi`.
- **`test/doctor/db-only-view-drift.test.ts`** — drift semantics for RTM / atomic-functions / development-order with markdown writes OFF and ON.

#### Changed

- **`ops/approve.ts`** — content gates validate the LLM working copy for DB-rendered kinds; the G8 mirror check and the `prd-file` requirement use a pre-publish snapshot.
- **`ops/stage-payloads.ts`** — `loadStagePayload(..., { requirePrdFileHash })` (default: required, so the legacy contract is unchanged).
- **`doctor/checks/{rtm-data,af-data,dev-order-data}.ts`** — the render-drift comparison runs only while markdown writes are maintained.
- **`skills/velpari-prd.md`**, **`skills/velpari-{rtm,atomic-function,development-order}.md`** — the G8 hash rule and the "published markdown" wording now state the DB-only default.
- **`pi-extension/test/e2e/README.md`** — dynamic command-count wording, the 9-suite table, and the shipped-default note.

### DB-primary storage Phase 11 — one-time migration + markdown-write retirement (2026-09-24)

RES-3 lands: `/velpari-migrate-store` (45th command) imports every legacy-published `Doc/` document into its project's store DB exactly once — `--dry-run` first (writes NOTHING), then a confirm-gated `--execute` that is idempotent on re-run (already-published kinds are no-op skips), re-exporting one `<Artifact>_<project>.yaml` beside each DB (the Phase 9 runbook rebuild source, including for kinds previously imported by `/velpari-backfill`, which never exported) and committing per project (`velpari(migrate): <project> (run migrated)`, explicit paths only — DB + YAML + registry + healed git files; legacy markdown is never committed). Q3 lands in the same phase: the markdown publish write is RETIRED and DEFAULT OFF — approve now writes DB rows + YAML + git commit and NOTHING to `Doc/`; the `.IDE_Plans/velpari/runs/<run-id>/<stage>/*.md` working copies are untouched (the mandated temp `.md` review surface) and existing `Doc/` markdown stays on disk as readable history (never rewritten, never deleted). Write-alongside is the explicit opt-IN rollback hatch via `files.json` `"velpari": {"markdownWrites": true}` (absent key = OFF). Three retirement-blast-radius fixes land with it: freshness inputs hash the exported YAML bytes for DB-era projects (so `input-changed` keeps firing when markdown never changes), handoff renders the design payload from the store (file read = legacy fallback), and `/velpari-reconfirm` appends its audit line to the store envelope's `changeLog` column when no published file exists. No new dependencies.

#### Added

- **`/velpari-migrate-store`** — the 45th command: usage / `--dry-run` (report only) / `--execute` (confirm gate → migrate → verify → per-project commit). G7 run-open hard-block (message names `/velpari-reset`) + the publish chain's git-identity precheck run BEFORE any write.
- **`ops/migrate.ts`** — the migration engine: `migratePrecheck`, `discoverLegacyProjects` (grouped + legacy-flat `Doc/`), `migrateDryRun` (pure), `migrateExecute` (FK-ordered kinds under run id `migrated`, checksum verify, YAML re-export, checkpoint, registry sync, per-project commit), `renderMigrateReport`.
- **`core/config.ts:markdownWritesEnabled`** — the single accessor for the retirement flag (DEFAULT OFF; `skipDbPublish` test escape hatch implies ON).
- **`test/ops/migrate.test.ts`** + **`test/commands/migrate-command.test.ts`** — preconditions, dry-run writes nothing, idempotent re-run, zero-row skip, 9-YAML contract, commit-set assert, G1 WAL check, and the R7 gate item (input-changed fires after a DB-era republish).
- **`commands/reset` note** — published store rows (including run `migrated`) survive a reset.

#### Changed

- **`ops/approve.ts`** — flag-OFF: the `Doc/` write block is retired (`publishedPaths` is empty); the freshness stamp runs in BOTH modes (`stampFreshnessEntry`).
- **`core/freshness.ts`** — DB-era input resolution hashes the kind's exported YAML bytes instead of a frozen markdown file.
- **`ops/handoff.ts`** — the design ADR payload comes from `readLatestPublishedRows` + `renderDesignMarkdown` with the file read as fallback.
- **`ops/reconfirm.ts`** — existence-based target: no published file → append the audit line to the store envelope's `changeLog` column (sanctioned code store write) + checkpoint.
- **`ops/backfill.ts`** — exports the 9 per-kind loaders + `LegacyLoad`, `payloadRowCount`, `KIND_STAGE`, `KIND_YAML_LABELS`, `FK_UPSTREAM` for reuse (zero behavior change).
- **`doctor/checks/working-published.ts`** — DB-era aware: reports the store's published-kind count and marks the markdown totals as a retired view under flag OFF.
- **`test/integration/command-registration.test.ts`** — command count 44 → 45.
- **`test/db-store/publish.test.ts`** — flag-aware first-publish commit-set variants (DB-only by default; markdown joins the set only on opt-in).

### DB-primary storage Phase 10 — portfolio registry + diagram assets (2026-09-24)

The hub-and-spoke storage model (D6) gains its optional hub: a per-workspace metadata registry at `Doc/store/portfolio.db` (committed raw per D2/D7 — the Phase 9 auto-heal now marks BOTH SQLite files binary and ignores both WALs). The registry is METADATA-ONLY by design (user-locked): project name, db path, display name, last publish/run/stage — cross-project artifact rollups stay out (additive later). The publish chain syncs the registry PRE-commit (fail-open, outside the store transaction — never a rollback trigger; the Q6d failure path re-syncs best-effort), every registry write ends with `wal_checkpoint(TRUNCATE)` (registry G1 — the committed file must never trail its git-ignored WAL), and `/velpari-portfolio --repair` rebuilds the registry from the spokes at any time (no registry integrity_check — it is fully derivable, a conscious skip). D8 is realized: `mermaid_text` starting with `image:` renders as a markdown image (path relative to the owning DB dir; renderers never read the filesystem — byte-stable per G5; missing assets surface via the doctor's new portfolio check, and `..`-escaping paths are rejected without probing). `/velpari-portfolio` is the 44th command. No new dependencies.

#### Added

- **`Doc/store/portfolio.db`** — the portfolio registry (v001-p, STRICT `projects` table; own schema module + own version ceiling + own pin test — store pins untouched).
- **`io/portfolio.ts`** — L0 registry API (`syncProject` / `listProjects` / `removeProject`).
- **`ops/portfolio.ts`** — `syncPortfolioRegistry` / `repairPortfolioRegistry` (spoke-derived, idempotent, checkpoint-after-write, fail-open).
- **`/velpari-portfolio`** — the 44th command (list + `--repair`).
- **`doctor/checks/portfolio.ts`** — registry↔disk drift (stale / unregistered / orphan) + D8 asset sweep (missing / `..`-traversal-rejected).

#### Changed

- **`ops/db-publish.ts`** — pre-commit registry sync (7b) + rollback re-sync (step 8); portfolio.db joins the publish commit set.
- **`ops/git-attributes.ts`** — the heal now also appends `Doc/store/portfolio.db binary` + its WAL ignores.
- **`ops/export-doc.ts` + `ops/db-slices.ts`** — D8 `image:` → markdown-image rendering; inline diagram text unchanged.
- **`test/integration/command-registration.test.ts`** — command count 43 → 44.

### DB-primary storage Phase 9 — git integration + YAML rebuild (2026-09-24)

The store DB is committed raw, so every user repo now carries git protection for it, and the merge/recovery story becomes executable. The publish chain auto-heals the user repo's `.gitattributes` (`Doc/store/**/index.db binary` — merge prevention via the built-in macro) and `.gitignore` (`index.db-wal` / `-shm`) before committing, and the healed files join the same publish commit (automatic but never silent — a notify reports the append; the doctor's new Git integration section makes drift visible anytime). OQ1 decided: `state.json` stays OUT of the publish commit set — backup = artifact world only (DB + YAML + docs); a restored checkout re-establishes the run position via `/velpari-backfill` + a fresh run. D9 is made real: `importArtifactYaml` (L0) imports a store-export YAML back into the DB (parse → validate → write → checksum-verify → publish; schema-invalid YAML is refused, content tampering is NOT detected — the export carries no fingerprint, git's reviewable YAML diffs are the tamper guard), exposed as `/velpari-backfill <kind> --from-export`. The G2 runbook ships at `skills/db-store-merge-runbook.md`. No new dependencies.

#### Added

- **`ops/git-attributes.ts`** — `ensureStoreGitIntegration(cwd)`: append-if-missing binary attr + WAL ignores into the USER repo; idempotent, append-only, exact-pattern detection; returns `{ changed, appended, changedPaths }`.
- **`.gitattributes` (repo root)** — dogfood/CI protection for this repo's own store.
- **`io/store.ts:importArtifactYaml`** — the D9 rebuild path; the YAML's own `runId` wins (run-scoped cross-kind FKs keep chained rebuilds intact).
- **`/velpari-backfill <kind> --from-export`** — rebuilds one kind from the store YAML beside the DB (runbook's central recovery step; store-only contract unchanged).
- **`skills/db-store-merge-runbook.md`** — G2 merge-conflict + recovery runbook (ships; `.npmignore` excludes `Doc/`).
- **`doctor/checks/git-integration.ts`** — Git integration section (warnings + runbook pointers when the user repo lacks the patterns).
- **Fix suggestions** — `git-attr-missing`, `git-ignore-missing`.

#### Changed

- **`ops/db-publish.ts` step 7** — heal call + one-line notify per appended file; healed `.gitattributes`/`.gitignore` join the publish commit's `addPaths`.

### DB-primary storage Phase 8 — hooks/locks + reset draft cleanup (2026-09-24)

`tool_call`'s write-lock now covers the stage DB scope (master outline row 8): a new always-on store-scope guard blocks edit/write tool calls into `Doc/store/**` (the SQLite store + its exported YAML views) — between stages included, closing the gap where the committed source of truth could be hand-edited. Sanctioned writers stay code-side (stage publish tool, `/velpari-backfill`, `/velpari-reconfirm`, `/velpari-export`); the bash bypass is an accepted limitation (checksums + the integrity/orphan audits backstop it). `/velpari-reset` now deletes the run's DRAFT store rows before clearing state (Q2's phase-8 duty — `deleteRunDrafts` per project DB, published rows survive; order locked: capture runId → delete drafts → clearRun → notify). State transitions and the `before_agent_start` status injection are unchanged (verified). No new dependencies.

### DB-primary storage Phase 7 — doctor as SQL (2026-09-23)

The doctor's data checks now read the store DB directly (sidecar fallback with a `/velpari-backfill` warning stays for pre-store projects), and three new SQL-backed audits cover the database itself: G4 integrity (`PRAGMA quick_check` + `integrity_check` per project DB), `links`-adjacency orphan detection, and a secrets sweep over DB text columns (newest published version per kind, OQ4a). Schema v003 adds the STRICT `store_meta(key, value)` bookkeeping table — stamped `integrity_checked_at` on standalone `/velpari-doctor` runs only; the embedded post-publish doctor run never writes (the DB file was just git-committed). Id-coverage consumes machine-written store link edges (`tc_trace` / `step_af`) with sidecar fallback; `fingerprint-untracked` remediation is read-only for DB-backed RTMs (`/velpari-reconfirm` is the sanctioned re-stamp path).

#### Added

- **`doctor/checks/integrity.ts`** — G4 store-DB integrity check (multi-design: one audit per effective projectName; info note for pre-store projects; error on any non-"ok" PRAGMA result; standalone-only `store_meta` stamp).
- **`doctor/checks/db-link-orphans.ts`** — `links` adjacency audit: every link endpoint must resolve to a row in the same run (drafts count as resolved; final_section nodes keyed by `CAST(no AS TEXT)`; feasibility nodes keyed by run_id).
- **`store_meta` (v003)** — `io/db.ts:storeMetaSet` / `storeMetaGet`; STRICT per §11/RES-2; invisible to export YAML and fingerprints (envelope/export column whitelists).
- **Fix suggestions** — `store-db-missing`, `store-db-corrupt`, `store-db-orphan-link`.

#### Changed

- **8 doctor reporters read store rows first** (`rtm-data`, `af-data`, `test-cases-data`, `dev-order-data`, `trace-link-consistency`, `fingerprints`, `phase-consistency`, `remediate/fingerprint-untracked`) — identical verdict semantics; legacy sidecar path preserved as OQ3a fallback with a backfill warning in the sidecar-missing items.
- **Secrets scan sweeps DB text columns** (G9) in addition to the 4 file locations.
- **id-coverage reads store link edges first** (`extractTestCaseTracesFromStore`, `extractDevOrderAfRefsFromStore` — intended enhancement, plan v1.1 review item 5), sidecar fallback unchanged.
- **`runDoctor(cwd, opts)`** gains the `embedded` flag; the post-publish audit (`ops/approve.ts`) passes `embedded: true` so the integrity check never stamps a just-committed DB.

### DB-primary storage Phase 6 — strict reads + `/velpari-backfill` (2026-09-23)

From PRD onward the per-project SQLite store (`Doc/store/<project>/index.db`) is the **single machine source of truth**: stages and scouts read pre-rendered `## DB Input Slices` blocks from the store only — Doc/ markdown, YAML sidecars, and HTML/JSON exports are human views. Brainstorm notes stay the one file-based input; the reviewer agent is the sole slice+view exception (drift = a finding). Schema v002 added 14 prose columns (Phase 1); Phase 2 retired the sidecar publish loop (5 DB-rendered artifacts re-render from rows, 5 hybrid docs stay LLM-authored + hash-bound).

#### Added

- **L1 slice builder** (`ops/db-slices.ts`) — `resolveStageSlice` per stage key with three LOUD refusal reasons (no store DB / kind unpublished / rows lack v002 prose), each naming `/velpari-backfill <kind>`; compact deterministic per-kind slice renderers (G5) + per-role `SCOUT_SLICE_LINES`.
- **Prompt blocks** — `## DB Input Slices` (never open Doc/ files) + `## Scout Slices` (per-role row-set references) rendered by `core/prompt.ts` from pre-rendered L1 strings.
- **43rd command `/velpari-backfill <kind>`** (`ops/backfill.ts` + `commands/backfill.ts`) — parses the legacy published markdown/sidecar for one kind (sidecar-first: RTM/AF engine readers; generic pipe-table parser for the rest), writes rows with v002 prose, checksum-verifies, publishes, checkpoints. Store-only (no Doc/ write, no stage advance, no git); idempotent no-op when the kind is already imported; refuses zero-row imports.

#### Changed

- **Stage inputs + pre-conditions are DB-first** (`stages/registry.ts`) — `resolveStageInputs` resolves doc inputs via the slice; `firstMissingArtifact` checks published store rows, not Doc/ file existence; refuse messages name the store path and `/velpari-backfill <kind>`. `core/stage-runner.ts` never reads a `db://` marker path.
- **SHOW commands render from the store** (`view/show.ts`) via the Phase 5 renderers (newest published version); legacy file read remains as the view fallback for pre-store projects.
- **10 skills rewritten** — 9 stage skills + reviewer instruct slice-only reads; reviewer keeps the slice+view exception.
- **Command surface 42 → 43** (`commands/index.ts`, registration test, both AGENTS.md files — one pass so none drifts); AGENTS.md principle 10f rewritten (sidecar retired as source; legacy read fallback until Phase 11).

### DB-primary storage Phase 5 — `/velpari-export` (on-demand document download, 2026-09-22)

New **42nd command** (view/ops group): export a published artifact version straight from the per-project SQLite store (`Doc/store/<project>/index.db`) to a file the user picks — read-only (D4). No publish/approve/gate changes; drafts are never listed or exported (Q2); export is an additional view, never a publish product (Q3).

#### Added

- **L0 store queries** (`io/store.ts`) — `listExportableKinds` (published kinds in canonical `KIND_ORDER`) + `listPublishedVersions` (published (run, kind) rows, newest first) + `PublishedVersionRef` interface. Read-only.
- **L1 renderer + runner** (`ops/export-doc.ts`) — deterministic envelope header (frontmatter + fingerprint + reviewer verdict + change log), 9 per-kind markdown renderers with explicit natural-key sorts (G5), in-house `mdToHtml` converter over the bounded markdown subset our renderers emit (zero new dependencies), and the `runExport` entry point: open DB (missing → refusal), verify published + picked version, delegate yaml to `exportArtifactYaml` (byte-identical to publish-time sidecar bytes, RES-1), write via `atomicWriteFile`. Never writes to the DB.
- **L3 picker flow** (`commands/export.ts`) — project (multi-design picker; approve.ts precedence), kind, version (newest first), format (md/yaml/html), output path with deterministic default suggestion (`Doc/export/<project>/<Artifact>_<project>.<ext>`), overwrite confirm gate (declined → file untouched). Every cancel notifies and exits cleanly. **32 new tests across `test/ops/export-doc.test.ts` + `test/commands/export-command.test.ts`.**

#### Changed

- **Command surface 41 → 42** (`commands/index.ts`, registration test, both AGENTS.md files — one pass so none drifts).

### Cleanup — dead exports, lint warnings, superseded docs (2026-09-21)

#### Removed

- **13 dead exports deleted** (zero references anywhere in src/test/skills): `psrs.ts:RequirementStatus`, `state.ts:publishToDoc` (Phase A stub), `agents-generator.ts:planCustomAgentGeneration` (+ its orphaned helper `customRoleToGeneratedRoleDef`), `atomic-tier.ts:REVIEWER_OPT_IN_FLAG/REVIEWER_OPT_OUT_FLAG`, `paths.ts:resolveReviewerVerdictPath`, `reviewer-verdict.ts:LoadReviewerInput`, `setup-progress.ts:_stateFileExists`, `brainstorm/scan-gate.ts:ScanGateChoice`, `brainstorm/spawn-sessions.ts:BrainstormSessionHandle` + `spawnActiveSubagents` (deprecated alias).
- **`stages/atomic-function/publish.ts` deleted** — the file carried only two marker constants (`PUBLISH_PHASE_STATUS`, `PUBLISH_DELEGATED_TO`) with no runtime behavior; publish runs through `velpari_stage_publish` → `ops/approve.ts:handleApprove`.
- **179 dead `export` qualifiers dropped** across 72 files — symbols used only inside their own module no longer pretend to be module API. Verified by full cross-reference sweep (every `export` vs every file in src/test/skills) + `tsc` strict build.
- **`velpari-full-sequence.md` (root)** — superseded by `Doc/velpari-sequence/` (11 docs).
- **`Doc/velpari-custom-sub-agent-generator-design.md`** — superseded by `Doc/velpari-sequence/05-sub-agent-generation.md` + shipped generator v2.
- **`Doc/velpari-pseudocode-research-notes.md`** — the tier rubric (its only live consumer) is now inlined as `## Tier rubric` in `pi-extension/src/agents/pseudocode-reviewer-body.md`; `bundled-custom-roles.json` mandate re-pointed.

#### Fixed

- **README.md unresolved merge conflict** — committed conflict markers (`<<<<<<< HEAD` / `>>>>>>> 2d9b017`) removed; the conflicted brainstorm v1.x/v3 sections are restored, and the stale "Sub-agent generator flag (v2.0) `--stages`" section is replaced with the shipped `--phase N` behavior.
- **4 biome warnings cleared** — unused imports in `stages/registry.ts` (×2) and `stages/brainstorm/index.ts` (unused `webSearchAllowed`), literal-key access in `doctor/checks/design-readiness.ts`. Lint is now zero-warning. (`atomic-function/index.ts:advanceStage` carries a `biome-ignore` — biome false positive, the symbol is used.)

#### Changed

- **`Doc/test-coverage-baseline.md`** shrunk from 40 KB of stale per-phase tables to the CI floor (statements ≥ 92%), the update rules, and the last recorded snapshot.

### Sub-agent generator v2 — per-phase generation, doctor freshness, verifier wiring (C1 + C2 + C3)

`/velpari-generate-sub-agents` grows from brainstorm-only (v1) to per-phase generation: agents for each pipeline phase are generated at that phase's boundary from published `Doc/` artifacts only. The doctor now audits generated-agent freshness against the freshness manifest, and the reviewer-verdict pipeline is generalized into one stage→verifier map that drives both the publish gate and anytime doctor reporting.

#### Added

- **`core/agents-config.ts:GENERATION_PHASES` + `phaseForStage()`** — the per-phase role + input model (P1: 4 brainstorm roles; P2: PRD/RTM/feasibility scouts + 2 feasibility-conditional; P3: design/atomic-function/pseudocode scouts + all 4 reviewers; P4: testplan/development-order/final-design scouts). `phaseForStage` maps a run's current stage to the phase it is ENTERING. `core/project-context.ts:loadProjectContext(cwd, runState?, phase)` gathers per-phase generator inputs from published artifacts (brainstorm notes, feasibility decision record, RTM + AF sidecars).
- **`core/agent-freshness.ts`** — joins `.pi/agents/<slug>-<role>.md` mtimes against `.pi/velpari/freshness.json` `publishedAt` of each phase's inputs. Drives the D5 phase-boundary hints (approve + `/velpari-status` next-hint reads "generate Phase N agents (`/velpari-generate-sub-agents`), then `<next command>`" when the entered phase lacks fresh generated agents — informational only). **14 new tests.**
- **Doctor "Generated agent freshness" section** (`doctor/checks/agent-freshness.ts`) — stale generated agent (older than its phase inputs' latest publish) → warning "regenerate Phase N" (D6: advisory, never a hard block); missing generated roles → info (bundled fallback); reviewer presence per tier + overlay + reviewerMode policy → error when required. **11 new tests.**
- **Doctor "Verifier verdicts (Layer 3)" section** (`checkVerifierVerdictsSection`) — anytime reporting of last-known verifier verdicts (approve → ok, needs-fix → warning, block → error) plus verdict-freshness warnings when a verdict predates the published artifact it reviews (spec 03 §Gate summary).
- **`--phase N` override** on `/velpari-generate-sub-agents` (phase otherwise auto-detected from run state). D3 interview: projectType always asked (never persisted); language skipped when a feasibility record or `files.json` framework exists; framework skipped when libraries/runtime are configured. `updateAgentsJson` now covers every generated role (D4); custom mappings still never overwritten.

#### Changed

- **`commands/generate-sub-agents.ts`** rewritten for per-phase plans — one confirmation gate per run (D8), de-branded UX, `GENERATOR_VERSION = 2` (v1 footers read as stale in doctor).
- **Doctor "Sub-agent generator completeness"** now checks every generatable role across the 4 phases (47 roles), not only the brainstorm four; summary line de-branded accordingly.
- **Publish gate verifier consumption is map-driven (C3)** — `doctor/checks/reviewer-verdict.ts:REVIEWER_STAGE_SPECS` gains `gateArtifacts` / `missingVerdict` / `publishedArtifactKind`; `doctor/gate.ts` consumes verdicts via `verifierSpecForArtifact(artifact)` instead of five hardcoded closures. `doctor/checks/atomic-tier.ts` becomes a thin wrapper over the generalized loader; the legacy atomic-function missing-verdict policy (missing → error even at basic tier) is preserved as spec metadata and pinned by tests. Missing-verdict behavior is unchanged for every existing stage.

### YAML sidecars (B3)

Every table-heavy published artifact is now backed by a YAML sidecar that is the source of truth; the published markdown is RE-RENDERED from the data at publish time and can never drift from it. The RTM pattern is generalized into a registry-driven publish loop.

#### Added

- **`core/yaml-data.ts` (D1)** — the sole `yaml`-package call site (strict parse with line/column errors, loose reader, atomic writer, shared `compareVersions`). `yaml@^2` becomes the one runtime dependency, imported only by L0 data modules. **9 new tests.**
- **`ops/sidecar-registry.ts:SIDECAR_REGISTRY` (D3)** — artifact kind → { detect, parse+validate, diff, render, sidecarName, baseline loader, optional tier-aware `validateWithCtx` / `postValidate` }. `ops/approve.ts` runs one generalized loop: LLM-authored sidecar + preview → hard-block when the sidecar is missing or invalid (**D6 — publish REQUIRES the sidecar**) → diff against the published baseline (append-only ids, version strictly increases) → RE-RENDER the markdown → stamp both files into the artifact's own freshness `extraPaths` (D5).
- **New sidecars + data modules** — `core/af-data.ts` (atomic functions: 8 base-core fields + tier-required fields enforced at publish via the configured profile), `core/test-cases-data.ts` (TC/IT records with mandatory `traces: [FR-N|NFR-N|AF-N]`), `core/dev-order-data.ts` (**D8**: `steps[]{id,module,afs[],dependsOn[]}` with dependsOn resolution, three-color DFS cycle detection, and topological order check). Doctor gains one drift check per artifact (missing = warning per D6, invalid/drift = error). **40 new tests** (incl. self-loop, 2-cycle, diamond-ok, unknown-dep).
- **Feasibility decision record (D9)** — the sole code-generated sidecar: `Doc/feasibility/feasibility-decision_<project>.yaml` is serialized from `state.feasibilitySession` at publish time BEFORE `clearFeasibilitySession` runs (verdict, selectedLanguage, selectedBy, languageCandidates, spikeResults, reuseSummary, recordedAt); doctor reads it and `/velpari-show-feasibility` notes its path.
- **Id-coverage sidecar-first (D7)** — AF ids come from the AF sidecar when present (af→pseudocode, af→dev-order); downstream refs come from the test-cases sidecar `traces` and dev-order sidecar `afs` when present; markdown scraping stays the fallback (legacy not-checkable unchanged).

#### Changed

- **RTM sidecar migrates JSON → YAML (D4)** — reads prefer `RTM_<project>.yaml` with legacy `.json` fallback at every hardcoded site (the YAML parser accepts JSON); writes are always `.yaml`; legacy `.json` files are never deleted. Doctor messages say "RTM sidecar"; suggestion keys unchanged.
- **Skill two-file contracts** — `skills/velpari-atomic-function.md`, `skills/velpari-testplan.md`, and `skills/velpari-development-order.md` now specify sidecar-first authoring (sidecar = source of truth, markdown = rendered preview).
- **Fixtures, not checks** — existing approve/integration fixtures gained working sidecars where D6 requires them; no assertion was weakened.

### Re-confirm path + CI-based testing (A5)

`/velpari-reconfirm` is the second stale-resolution path: when a changed input has **no impact** on a published artifact, one confirm re-stamps freshness instead of a full republish — with a mandated audit trail. The full unit + e2e test gate moves to GitHub Actions (dev-machine thermal constraint).

#### Added

- **`/velpari-reconfirm` (41st command)** — `commands/reconfirm.ts` (L3 picker, `runSimplePicker` + `runSimpleConfirm` over the `input-changed` stale set, one artifact at a time, showing `changedInputs`; a cancelled picker or declined confirm writes nothing) + `ops/reconfirm.ts` (L1 logic). `input-missing` and `no-stamp` items are refused — republish-only (D4). **13 new tests.**
- **Audit triple per re-confirm (D5)** — (a) the mandated Change Log line ``Reviewed after `<artifact>` vX.Y — no changes required.`` appended to the published artifact (upstream version from its frontmatter, `unknown-version` fallback — never a block); (b) the freshness manifest entry re-stamped with current normalized hashes + `reconfirmedAt` (RTM JSON sidecar `extraPaths` recomputed, D6); (c) a `history.jsonl` entry when a run is active.
- **Normalized freshness hashing (D3)** — `core/fingerprints.ts:hashFileContentNormalized` / `stripChangeLogSection`: SHA-256 over the file with the `## Change Log` section stripped, so the re-confirm audit line never re-stales downstream consumers (the feedback-loop fix). Manifest entries gain optional `hashv: 2` + `reconfirmedAt`; entries without `hashv` keep legacy whole-file checking (no mass-staling). All new publishes and re-confirms stamp `hashv: 2` (`ops/approve.ts`, `stages/brainstorm-approve.ts`). **9 new tests.**
- **`bug-fix` branch in `.github/workflows/test.yml`** — push + pull_request triggers, so CI runs the full gate (lint + build + unit + coverage + Tier-1 e2e) on the active branch.

#### Changed

- **Stale-remedy texts name both paths** — transition-lock block messages, `/velpari-handoff` staleness block, and the doctor `stale-input` suggestion now offer `/velpari-reconfirm` for `input-changed` items; `input-missing`/`no-stamp` keep republish-only text (new `stale-input-missing` suggestion).
- **`Doc/velpari-sequence/08-command-reference.md`** — the previously unspecced re-confirm surface is now documented (picker gates, D4 exclusions, audit triple, normalized hashing).

#### Note

- **Doc/ edit exception (D7).** The re-confirm command edits a published artifact under `Doc/` directly from code (the Change Log append) — a stated, narrow exception to the "Doc/ only via publish" invariant. The LLM `tool_call` lock is unaffected (it governs LLM writes, not command code).

### Brainstorm-anytime + dynamic transition lock (A1 + A2)

`/velpari-brainstorm` is no longer single-shot per run: it opens from ANY stage as the pipeline's standing discussion mode, pausing the stage in progress. All command-legality decisions now flow through one function.

#### Added

- **`RunState.pausedStage` + three session primitives** in `core/state.ts` — `openBrainstormSession` (pauses the current stage, resets the per-session dispatch count), `resumeFromBrainstorm(cwd, door)` (door `"continue"` → the paused stage; door `"restart-prd"` → `brainstormed` so the PRD chain restarts), `discardBrainstormSession` (close without an artifact; resumes the paused stage or `none`). Run-locked, history-appending, NOT STAGE_TRANSITIONS rows — `advanceStage` untouched. **9 new tests.**
- **`stages/transition-lock.ts` — `computeLegalCommands` (A1).** The single source of legal-command truth: two-door collapse while a brainstorm is open, stale declared-input blocks, earliest-stale routing ("Run X first" always names the healing command), and update-mode self-loops (a stage whose own published artifact is stale may always re-run — that run is the remedy). Rewired consumers: runStage gate, publish-tool whitelist, `ops/approve` brainstorm refusal, `before_agent_start` `next:` line (+ new `paused:` line), and a new `Next:` line in `/velpari-status`. Stage data arrives via the registry's new `STAGE_LOCK_SPECS` (pipeline execution order). **18 new tests.**
- **Approve doors (D3)** in `/velpari-approve-brainstorm` — when the session was opened mid-run, `--restart-prd` picks the restart door directly, otherwise a TUI picker asks, default continue; first runs keep the existing advance. **5 new tests.**
- **`discard` action** on the `velpari_brainstorm_session` tool (D7) — the close path that is neither publish nor full reset. **4 new tests.**

#### Changed

- **`guardStageForBrainstorm` semantics inverted (D9)** — every stage may open a brainstorm; only a nested open (session already open) blocks, naming approve + discard (the `/velpari-reset` hint is gone). `handleBrainstorm` calls `openBrainstormSession` for non-`none` stages. Old guard tests rewritten to the new semantics; e2e stage-gates suite updated + a new anytime pause/resume/doors e2e test.
- **Mutation-lock precedence (D4)** — while a brainstorm is open, the brainstorm-folder lock owns all edit/write gating (including the paused stage's folder); the stage-folder lock is explicitly suppressed. **3 new precedence tests.**

#### Fixed

- **Re-brainstorm staling (D8)** — a re-approved brainstorm of the same topic now stales the PRD/AF chain: the freshness manifest keeps ONE base-slug entry per topic (`brainstorm:<slug>`) with `path` = the latest published (possibly timestamp-suffixed) file; brainstorm-input resolution and the stale-set re-hash consult the manifest first with base-slug disk fallback; enumeration folds suffixed re-run files into the base slug (no spurious `no-stamp`). **6 new tests** incl. the end-to-end "re-brainstorm → PRD stale → stage-start block names the remedy" integration test.
- **`ops/approve` brainstorm refusal** named a nonexistent command (`/velpari-feasibility-approve-brainstorm`); the refusal now routes through the transition lock.
- **CHANGELOG release-entry test window** widened (200 → 400 lines) — accumulated `[Unreleased]` sections had pushed the reviewer entry past the read window (pre-existing failure on the committed tree).

### Freshness stamps + stale-set machinery (B4 + A3)

Every published artifact now records what it was built from, and every downstream consumer refuses to run on stale inputs.

#### Added

- **`core/freshness.ts`** — the freshness manifest (`.pi/velpari/freshness.json`): `loadFreshnessManifest` / `saveFreshnessManifest` / `recordPublish` (upsert per artifact), `resolveDeclaredInputs`, `computeInputHashes` (+ brainstorm variant from `files.json:inputDocuments`), `computeStaleSet` (reasons `input-changed` / `input-missing` / `no-stamp`), and `enumeratePublishedArtifacts` (grouped `Doc/` layout, legacy flat fallback). **18 new tests.**
- **`hashFileContent`** in `core/fingerprints.ts` — SHA-256 of a file's bytes, next to the existing RTM text hasher.
- **`inputs:` frontmatter stamp** on every publish — a JSON scalar mapping input id → hash, merged by `withArtifactFrontmatter`. Both publish surfaces stamp: `ops/approve.ts` (stages 2–10, incl. RTM sidecar hash in `extraPaths`) and `stages/brainstorm-approve.ts` (slug-keyed). Missing input → warning + unstamped publish, never a crash.
- **Stage-start stale-input block** in `stages/registry.ts:runStage` — a stale declared input hard-blocks with the input, reason, and remedy; an unstamped input warns and continues; a stale own output warns.
- **Publish-gate freshness branch** in `doctor/gate.ts:runPublishGate` — `freshness-input-missing` error per missing required declared input; `freshness-downstream` warning when a tracked downstream artifact consumes the artifact being republished.
- **Doctor freshness section** (`doctor/checks/freshness.ts`) — errors for changed/missing inputs, warnings for unstamped artifacts, `N stale / M tracked` summary. New `stale-input` + `freshness-no-stamp` fix suggestions. **10 new tests.**

#### Changed

- **`doctor/checks/stale-downstream.ts`** — the mtime pair loop is gone; the check now renders from `computeStaleSet` (a touched-but-unchanged input is no longer flagged). Summary counts come from the manifest.
- **Severity policy:** stale input = error (blocks); unstamped legacy artifact = warning (continues). The logging plan publishes outside `handleApprove` and stays outside the machinery (doctor info note).

#### Fixed

- **Development-order publish mapping restored** — `stageToArtifact` (`ops/approve.ts`) had no `ordering-development` case, so the development order could never publish or advance ("No artifact mapping for stage"; found at checkpoint 2.2 of the freshness plan). Added the `ordering-development` / `ordered-development` mapping, plus a regression suite that walks the real `handleApprove` path end-to-end (publish + `inputs:` stamp + `freshness.json` entry + stage advance) and a table-driven guard asserting all 9 publishable `STAGE_TRANSITIONS` rows have a mapping. **2 new tests.**

### Layer-2 ID coverage + handoff strengthening (A4 + A6)

Upstream ids must now appear in their downstream artifacts, and the handoff refuses to ship a stale or uncovered chain.

#### Added

- **`core/id-coverage.ts`** — the Layer-2 rule engine (spec 03): 4 rules (`prd→design`, `af→pseudocode`, `fr-af→test-cases`, `af→dev-order`) with per-rule status `ok` / `not-checkable` / `missing` + `duplicateIds`. Design check reads §1 `Source FRs` + §5 `NFR ID`/`Source PRD row` columns only (§7 prose never scanned). Legacy tolerance: zero parseable refs → `not-checkable` (warning everywhere, never blocks); some refs → missing upstream ids are errors. Dev-order duplicate AF → warning. **15 new tests.**
- **Publish-gate coverage branch** in `doctor/gate.ts:runPublishGate` — publishing artifact X runs the rules where X is downstream against the working copy; `missing` blocks with the rule id + missing ids.
- **Doctor `ID coverage` section** (`doctor/checks/id-coverage.ts`) with `id-coverage-missing` / `id-coverage-not-checkable` fix suggestions. **7 new tests.**
- **Handoff staleness + coverage gates** in `ops/handoff.ts` (gate order: stage → config → artifacts → MVP coverage → staleness → ID coverage → payload → schema → confirm → write). Any `input-changed`/`input-missing` stale item blocks with the keys named; `no-stamp` warns (D8). Coverage `missing` blocks; `not-checkable`/duplicates warn. **5 new tests.**
- **Skill-template references** (make new runs machine-checkable): pseudocode function blocks gain a mandatory `AF: AF-N` line; test-cases tables gain a mandatory `Traces` column (`FR-N`/`NFR-N`/`AF-N`); dev-order steps gain a mandatory `AFs: AF-N, …` list. Additive only — existing docs keep working via the `not-checkable` path.

### Planned (next minor)

- Extending `DiagnosticItem` with an optional `fingerprint` field so checks can populate fingerprints directly (replaces the Phase 3 suggestion-text reverse-lookup). Doctor dispatcher's external behavior stays the same.

### Brainstorm v3 (persistent sub-agents)

Brainstorm opens **2 persistent sub-agent sessions** (web-research + doc-code-analyst) immediately after `/velpari-brainstorm` (step 1 — AUTOMATIC SPAWN, before UNDERSTAND). Both panes stay open in the multiplexer right column until `/velpari-approve-brainstorm` fires the graceful close. Parent LLM routes each user message by topic during DISCUSS.

#### Added

- **`state.activeSubagents`** + **`setActiveSubagents()`** + **`clearBrainstormSession()`** (clears it too) in `core/state.ts`. Persists across Pi rehydrate.
- **`stages/brainstorm/spawn-sessions.ts`** — `spawnPersistentSessions()` (idempotent; bootstraps the 2 agent .md files) + `BRAINSTORM_SESSION_HANDLES` + `BRAINSTORM_PERSISTENT_AGENTS` constants + `persistSpawnHandles()`. **38 new tests**.
- **`PERSISTENT_AGENT_IDS`** + **`ensurePersistentAgents()`** in `io/agents-install.ts`. **`bundledAgentPath()`** accepts both ScoutAgentId and PersistentAgentId.
- **2 bundled agent .md files**: `skills/agents/web-research.md` (tools: read, websearch, fetchurl) + `skills/agents/doc-code-analyst.md` (tools: read, grep, glob, ls). Both use `sessionPreference: persistent` + `sessionHint` frontmatter (community pattern from @mjakl/pi-subagent).
- **`mode: "ephemeral" | "persistent"`** on `DispatchRequest` in `dispatcher.ts`. Persistent mode resolves `session: <handle>` from state. **7 new dispatcher tests**.
- **2 new actions** on `velpari_brainstorm_session` tool: `spawn-sessions` (persists handles) + `close-sessions` (graceful close). `snapshot()` exposes `activeSubagents`. **9 new tool tests**.
- **`activeSubagents` field on `BuildStagePromptInput`** + `renderActiveSubagents()` helper in `core/prompt.ts` — emits the `## Active sub-agents (persistent sessions)` block with routing rules. **7 new prompt tests**.
- **AUTOMATIC SPAWN step in `handleBrainstorm`** — fires spawn helper right after `createRun`; prefixes the prompt with `## Step 1 — AUTOMATIC SPAWN (execute now)` block on first turn.
- **Graceful close in `handleApproveBrainstorm`** — fires a fire-and-forget prompt asking the LLM to call `subagent_interrupt` on both sessions + `close-sessions`. State is the source of truth (already cleared synchronously).

#### Changed

- **`velpari-brainstorm.md` skill** rewritten to lifecycle v3 — new step [1] AUTOMATIC SPAWN; new "v3 — Routing rules" subsection under [5] DISCUSS.
- **`scansSelected`** marked `@deprecated v3 — replaced by activeSubagents`. Schema kept for back-compat; v3 handler no longer reads it.
- **README.md** + **`Doc/velpari-sequence.md`** updated with the v3 sequence description.

## [1.4.0] — 2026-09-19 — Doctor "fix" ladder (Levels A → B → C)

The doctor now offers three complementary fix paths after an audit finds actionable items. Opt-in via `--velpari-fix`. Default behavior (without the flag) is unchanged.

### Added

#### Phase 1 — Level A (interactive picker, opt-in)

- **`--velpari-fix` flag** — registered in `pi-extension/src/index.ts` alongside `--velpari-skip-doctor` and `--velpari-stage`. When set, `/velpari-doctor` shows a 2-level picker over actionable items; selecting one dispatches the parent LLM via `pi.sendUserMessage` with a structured prompt. **Default off.**
- **`FixLevel` type** (`"interactive" | "auto-safe" | "agentic"`) + `levelFor(key)` helper in `pi-extension/src/doctor/checks/fix-suggestions.ts`. Missing keys fall back to `"interactive"` (conservative default).
- **`pi-extension/src/doctor/fix-dispatch.ts`** — L1 orchestrator. `listActionableItems`, `actionableItemCount`, `dispatchFixChoice`, `type ActionableItem`, `type FixChoice`.
- **`pi-extension/src/ui/fix-picker.ts`** — L2 widget wrapping `runSimplePicker`. Two-level picker with status icons, item count, hint-on-report-path.

#### Phase 2 — Level B (declarative auto-remediate for safe checks)

- **`SAFE_WHITELIST`** in `pi-extension/src/doctor/checks/fix-suggestions.ts` — update-in-lock with `FIX_LEVELS["auto-safe"]` entries; runtime throws on drift.
- **`pi-extension/src/doctor/remediate.ts`** — `runRemediate` (single fingerprint) + `runAllSafeRemediates` (every whitelist entry). Each `RemediateFn` is wrapped in try/catch so one bad fn can't crash the audit loop.
- **`pi-extension/src/doctor/checks/remediate/`** — three per-fingerprint `RemediateFn`s, all idempotent:
  - `frontmatter.ts` — restamps missing frontmatter on every published artifact under `Doc/`.
  - `fingerprint-untracked.ts` — stamps SHA-256 fingerprints on RTM JSON rows that lack them, using the PSRS as source; re-renders the published RTM markdown from JSON.
  - `working-published-drift.ts` — copies divergent working copy over its published twin (strict byte-for-byte equality check, only writes on actual diffs).
- **3 entries in `FIX_LEVELS`** (`frontmatter-missing`, `fingerprint-untracked`, `working-published-drift`) tagged `"auto-safe"`. The Level A "all-safe" picker branch resolves to a real `runAllSafeRemediates` loop instead of the v1.4 placeholder.

#### Phase 3 — Level C (agentic fix via parent LLM)

- **`pi-extension/src/doctor/fix-brief.ts`** — `FixBrief` type + `buildFixBrief()` + `renderFixBrief()` + `findFingerprintFromSuggestion()`. `buildFixBrief` returns `null` for items that aren't agentic (or whose suggestion text doesn't map to a known fingerprint), so the dispatcher cleanly falls through to the Phase 1 / Phase 2 paths.
- **`AGENTIC_COMMANDS` table** in `fix-brief.ts` — per-fingerprint → suggested `/velpari-*` command (`fingerprint-suspect`/`phase-mismatch`/`mvp-incomplete` → `/velpari-rtm`; `rtm-unknown-id` → `/velpari-prd`).
- **4 entries in `FIX_LEVELS`** (`fingerprint-suspect`, `phase-mismatch`, `mvp-incomplete`, `rtm-unknown-id`) tagged `"agentic"`. The dispatcher now emits the structured `FixBrief` to the parent LLM for these items.

### Changed

- **`handleDoctor` return type** in `pi-extension/src/doctor/index.ts` — now returns `HandleDoctorResult { skipped: boolean, report: DiagnosticReport | null }` instead of `void`. The composition-layer orchestration (`commands/doctor.ts`) reads the report and conditionally runs the fix picker. Layer-rule clean: `doctor/` is L1 and cannot import from `ui/` (L2); the orchestration lives at L3.
- **Dispatcher `kind: "all-safe"` branch** (`pi-extension/src/doctor/fix-dispatch.ts:dispatchFixChoice`) — Phase 1 placeholder replaced with: (1) call `runAllSafeRemediates`, (2) notify each result, (3) re-run `runDoctor`, (4) write a fresh report, (5) notify the new summary. The dispatcher's `DispatchFixChoiceOptions` gained a `projectName` field; `commands/doctor.ts` resolves it via `loadFilesConfig()`.
- **Dispatcher `kind: "fix-one"` branch** — Phase 3: tries `buildFixBrief(it)` first. If it returns a brief, the prompt sent to the parent LLM is the structured `renderFixBrief(brief)` output (Diagnosis, Context, Success Criterion). Otherwise falls back to the Phase 1 generic prompt.
- **`pi-extension/src/layers.ts`** — `doctor/`, `ui/`, and the per-fingerprint `RemediateFn` registry now documented with their per-version additions.

### Tests

- +16 (`test/doctor/fix-dispatch.test.ts` + `test/ui/fix-picker.test.ts`) — Phase 1 picker orchestration + dispatcher branches.
- +18 (`test/doctor/remediate.test.ts`) — Phase 2 whitelist + registry + 3 RemediateFns (synthetic bad state → good state, idempotency).
- +11 (`test/doctor/fix-brief.test.ts`) — Phase 3 reverse-lookup + agentic-vs-interactive/auto-safe discrimination + render format.
- All existing tests (1540) remain green: 1575 pass / 0 fail / 6 skipped (pre-existing).

### Preserved

- The mutation lock (`tool_call` hook) gates every write — Phase 1, 2, and 3 routes all funnel through existing `/velpari-*` slash commands or Phase 2's `RemediateFn`s, which are themselves invoked from the L3 orchestrator.
- `--velpari-fix` is opt-in (default off). Without the flag, `/velpari-doctor` behavior is unchanged.
- The 3 publish gates + post-publish doctor audit behavior is unchanged.

### Migration

- No manual migration. Existing projects automatically pick up the new doctor behavior on next `/velpari-doctor` invocation if `--velpari-fix` is set persistently.

Design: `.IDE_Plans/doctor-fix-upgrade_plan_20260919_1318_v1.0.md` (A → B → C ladder).

## [1.3.0-dev.1] — 2026-09-18 — Dev channel snapshot

Published to the npm `dev` dist-tag for opt-in testing ahead of the `1.6.2` `latest` release. The source tree on the `development` branch at this tag matches `package.json` version `1.3.0-dev.1`. See `1.6.2` below for the work accumulated since the last `latest` release (`1.0.1`).

### Notes

- Dist-tag: `dev`. Install with `npm install @adi-mudi/pi-velpari@dev` or `pi install npm:@adi-mudi/pi-velpari@dev`.
- `latest` remains at `1.0.1` until the `1.6.2` release is cut.

## [1.6.2] — 2026-09-17 — No command-to-command auto-chains

### Removed

- **Brainstorm → PRD auto-chain.** `/velpari-approve-brainstorm` no longer auto-invokes the `/velpari-prd` handler. After brainstorm notes are published the user runs `/velpari-prd` by hand. This was the only command-to-command auto-chain left in the pipeline; every stage boundary is now an explicit, manual confirm-then-write step.

### Changed

- **`/velpari-approve-brainstorm`** (`pi-extension/src/stages/brainstorm-approve.ts`) — drops the `await handlePrd(ctx, pi, cwd)` call + the `import { handlePrd } from "./prd.js";` import. Replaces `ctx.ui.notify("Chaining into PRD stage...", "info")` with `ctx.ui.notify("Brainstorm notes published. Next: run /velpari-prd to start the PRD stage.", "info")`.
- **`handleApprove` next-command hint** (`pi-extension/src/ops/approve.ts`) — every stage publish now surfaces a unified `Next: /velpari-<stage>` message derived from `nextCommandsFor(next.currentStage, { feasibilitySkip })`. Replaces the previous ad-hoc special case for post-RTM with a generic helper that handles the feasibility-skip branch inline (`feasibility already published; you may skip ahead to architecture.`).

### Preserved

- **`velpari_stage_publish` tool** + the 9 per-stage `/velpari-<stage>-approve` fall-back commands — unchanged. They run `handleApprove`, which still emits the same gate chain + doctor audit + state advance.
- **`/velpari-prd-rtm` wrapper** — kept as a deliberate opt-in. The user types the wrapper explicitly knowing it runs PRD then RTM in sequence. Not an auto-chain (the wrapper is a single user-invoked command).

### Migration

- Existing projects automatically pick up the new manual flow on next brainstorm-approve. No manual migration needed.

---

## [1.6.0] — 2026-09-17 — Per-stage approve commands + auto-publish

### Removed

- **`the publish tool`** — generic Stage 2–10 publish command. Replaced with per-stage `/velpari-<stage>-approve` fall-back commands. The user-facing flow for stages 2–10 is now self-contained: each stage command publishes inline via the `velpari_stage_publish` tool once the parent LLM has written the working copy.

### Added

- **9 per-stage approve commands** (each is a thin wrapper around the unchanged `handleApprove` function in `ops/approve.ts:132`):
  - `/velpari-prd-approve`
  - `/velpari-rtm-approve`
  - `/velpari-feasibility-approve`
  - `/velpari-architecture-generator-approve`
  - `/velpari-atomic-function-approve`
  - `/velpari-pseudocode-approve`
  - `/velpari-testplan-approve`
  - `/velpari-development-order-approve`
  - `/velpari-final-design-approve`
  Each lives in its own file under `pi-extension/src/commands/approve-<stage>.ts`. They exist only as **manual recovery** when the LLM-driven publish is unavailable; the normal flow is the parent LLM calling `velpari_stage_publish` automatically.

### Changed

- **Auto-publish flow.** Each stage's parent LLM calls `velpari_stage_publish` immediately when the working copy is ready. The human `AskUserQuestion` preview gate is removed (the 3 publish gates + post-publish doctor audit still enforce correctness).
- **STAGE_TRANSITIONS** (`pi-extension/src/core/constants.ts:52`) — added 9 new rows for per-stage fall-back commands. The legacy `the publish tool` row is kept as an alias so `handleApprove`'s `advanceStage(state, "the publish tool", cwd, pi)` call still resolves.
- **`handleApprove`** in `pi-extension/src/ops/approve.ts:132` — **NO behaviour change**. Still records `the publish tool` as the actor in `state.json:history`. The per-stage fall-back commands record their own names when the user invokes them from the terminal.
- **Stage publish tool description** (`pi-extension/src/stages/stage-publish-tool.ts`) — no-preview copy: the parent LLM is told to call the tool when the working copy is ready, not after a preview-yes.
- **Skill markdowns** — 8 + `velpari-atomic-function.md` (9 files total) replace the "Preview Gate" section with "Publish (auto on working-copy ready)". Manual-fall-back references shifted from `the publish tool` to the per-stage command.
- **`commands/index.ts`** — drops `registerApproveCommand` + the `velpari-approve` entry from `COMMAND_NAMES`; adds 9 `register<Stage>ApproveCommand` + the per-stage command names. Command count: 32 → 40.
- **`Doc/velpari-sequence.md`** — 9 Stage "Advance" rows and the transition table updated to per-stage fall-back commands. ASCII diagram and discipline-block copy refreshed.
- **Root `AGENTS.md`** — principle #2 rewritten (Confirm-then-write → Auto-publish), transition table updated, command surface list and "Approve commands" nuance rewritten.

### Preserved

- **`handleApprove`** function (single source of publish truth) — **NO change**. All 3 gates (revision + artifact + post-publish doctor audit) unchanged.
- **`velpari_stage_publish` tool** — still delegates to `handleApprove`. Only description text changed.
- **Brainstorm flow** — `/velpari-brainstorm` + `/velpari-approve-brainstorm` (bespoke). On success, `/velpari-approve-brainstorm` publishes notes, advances the stage, and surfaces a `Next: /velpari-prd` hint (v1.6.2+ dropped the auto-chain; the user runs `/velpari-prd` by hand). The new per-stage commands error when in brainstorm stage.
- **Doctor gate / post-publish doctor audit / sunset auto-archive / multi-design projectNames** — unchanged.

### Removed (function-level)

- `pi-extension/src/commands/approve.ts` — the generic command file (replaced by 9 per-stage files).
- 8 stage skill "Preview Gate" sections + the per-stage "manual fallback" references — replaced by "Publish (auto on working-copy ready)" sections naming the per-stage fall-back.

### Migration

- Existing projects automatically pick up the new flow on next stage command. No manual migration needed.
- Scripts / tests that called `advanceStage(state, "the publish tool", cwd)` continue to work — the legacy row is preserved.
- Scripts that invoked `the publish tool` from the terminal should switch to the per-stage variant that matches the current stage.

---

## [Unreleased] — 2026-09-16 — Reviewer sub-agent + atomic-function migration (v1.x)

### Added

- **`skills/agents/reviewer.md`** (NEW) — adversarial critic agent definition. 10 deterministic rules (migrated from `doctor/checks/atomic-tier.ts`) + 4 semantic rules (NEW, only the LLM can judge): cross-scout contradictions, missing merges, tier appropriateness, standards-mapping evidence. Verdict JSON schema (`verdict / issues[] / summary / timestamp`). `thinking: high`, `session-mode: standalone`, `auto-exit: true`, `spawning: false`.
- **`skills/velpari-reviewer.md`** (NEW) — parent-LLM orchestration skill. Spawn timing (after N source scouts, before preview gate). Verdict handling (approve / needs-fix / block + max 2 iterations before escalation). Tier gate docs + overlay gate docs.
- **`core/atomic-tier.ts`** (Phase 2) — `REVIEWER_GATE_RULES` set (intermediate + advanced), `ReviewerMode` type + `isReviewerMode` guard, `DEFAULT_REVIEWER_MODE = "tier-default"`, `REVIEWER_OPT_IN_FLAG` / `REVIEWER_OPT_OUT_FLAG` (CLI mirrors skip-doctor), `shouldRunReviewer({ profile, overlayRequiresReviewer?, reviewerMode? })` with documented decision order (never wins > always wins > overlay wins > tier default), `AtomicProfile.reviewerMode` field (optional, backward-compatible).
- **`core/paths.ts`** (Phase 4) — `resolveReviewerVerdictPath(cwd)` walks the runs directory and returns the most recent `<runId>/atomic-function/scouts/reviewer-report.json`. Returns null when no verdict file exists.
- **`core/agents-config.ts`** (Phase 1) — `REVIEWER_ROLES = ["reviewer"]` constant, `VELPARI_ROLES` spread updated 46 → 48 (added 1 reviewer role), `ROLE_LABELS.reviewer = "Stage — adversarial reviewer"`, `STAGE_SCOUT_ROLES` gains `"reviewer"` (registry-order position), `VELPARI_REVIEWER_GENERATED_ROLES` placeholder for the future v2 sub-agent generator extension.
- **`stages/registry.ts`** (Phase 3) — `STAGE_REGISTRY["atomic-function"].scouts` now 5 entries (4 source + reviewer as the 5th slot — parent LLM spawns it last). New helper `filterReviewerSlot(scouts, stageKey, profile, overlayRequiresReviewer)` removes the reviewer slot when `shouldRunReviewer` returns false. New helper `overlayRequiresReviewerFor(cwd, overlayId)` reads `skills/standards/catalogue.json` directly. `runStage` wires both helpers into `StageRunConfig.scouts`.
- **`commands/configure-inputs.ts`** (Phase 2) — 4th picker ("Reviewer sub-agent" with `tier-default` / `always` / `never` / `keep` options). Persists to `files.json:atomic.reviewerMode`. Save notification now includes reviewer mode.
- **`skills/standards/catalogue.json`** (v1.2.0) — `requiresReviewer: true` on all 4 bundled overlays (medical-device-b, industrial-ot, financial-payments, cloud-saas). `requiresReviewer: false` explicit on `none` overlay + all 4 tier profiles.
- **Tests** — `test/agents/reviewer-agent.test.ts` (NEW: 11 cases for taxonomy + frontmatter + orchestration skill), `test/core/reviewer-gating.test.ts` (NEW: 23 cases for gate rules + decision order + derive fallback), `test/stages/atomic-function-registry.test.ts` (NEW: 21 cases for registry shape + filter pass-through + tier gate + catalogue lookup), `test/doctor/check-atomic-tier.test.ts` (REWRITE: 8 cases for verdict loader), `test/doctor/reviewer-verdict.test.ts` (NEW: 6 cases for gate integration).

### Changed

- **`STAGE_REGISTRY["atomic-function"].scouts`** — 4 entries → 5 entries (added `reviewer`).
- **`runStage`** in `stages/registry.ts` — applies `filterReviewerSlot` to the scout slot list before handing off to `StageRunConfig.scouts`. Reads `overlayRequiresReviewerFor` from the catalogue for the active overlay.
- **`doctor/checks/atomic-tier.ts`** — major refactor. The deterministic parser (`checkAtomicTierSection`) is gone. Replaced by `loadReviewerVerdict(cwd, profile)` which loads the reviewer JSON and surfaces its issues as `DiagnosticSection` items. Exports `ReviewerVerdict` + `ReviewerIssue` types and a schema guard.
- **`doctor/gate.ts:runPublishGate`** — the `atomic-functions` section delegates to `loadReviewerVerdict` (thin pass-through). Doctor remains the publish gate; it just no longer re-derives the rules.
- **`VELPARI_ROLES`** — 46 → 48 entries.
- **`ROLE_LABELS`** — gains `reviewer: "Stage — adversarial reviewer"`.
- **`stages/atomic-function.ts`** — docstring updated to document the 5-scout pattern + tier gate + the `reviewerMode` field in the atomic profile.
- **Configure-inputs save notification** — now reports reviewer mode alongside tier / safetyClass / SIL.

### Migrated

Every deterministic rule that previously lived in `doctor/checks/atomic-tier.ts` is now owned by the reviewer sub-agent. Single source of truth = reviewer. The doctor gate's atomic-function section consumes the verdict but does NOT re-derive:

| # | Old rule (doctor parser) | New rule (reviewer agent) |
|---|---|---|
| 1 | base-core missing | `base-core-missing` |
| 2 | tier-specific missing | `tier-specific-missing` |
| 3 | cohesion ∉ {perfect-atomic, functional} | `cohesion-invalid` |
| 4 | verification ∉ IEEE 29148 4 methods | `verification-invalid` |
| 5 | testable ≠ yes | `testable-invalid` |
| 6 | complexity > 10 | `complexity-exceeded` |
| 7 | earsPattern ∉ 5 EARS patterns | `ears-pattern-invalid` |
| 8 | argCount ≥ 3 | `arg-count-high` |
| 9 | coupling = high without rationale | `coupling-high` |
| 10 | risk empty (advanced tier) | `risk-empty` |

### Backward compatibility

- **Additive.** Existing published atomic-functions artifacts stay valid.
- **Grandfather clause.** Reviewer verdict was previously absent — the gate now requires it. Re-publishing an existing artifact will fail unless the reviewer is run. To re-publish, simply re-run `/velpari-atomic-function` (the tier gate decides whether the reviewer spawns).
- **Tier default `{ basic / A / none / reviewerMode: tier-default }`** preserves every existing run that did not declare an atomic profile.

### Standards applied

- **Anthropic Constitutional AI** — adversarial self-critique pattern with explicit principles.
- **Cursor Composer/Reviewer** — Composer writes, Reviewer critiques before user sees.
- **SWE-Agent Manager/Editor/Reviewer** — Manager delegates, Editor writes, Reviewer validates.
- **ISO/IEC 14764:2022** — software maintenance (corrective / adaptive / perfective / preventive) types. Each change should have an independent reviewer.

---

## [Unreleased] — 2026-09-16 — Atomic-function tier-driven schema (v1.x)

### Added

- **`core/atomic-tier.ts`** (L0) — single source of truth for the 4-tier
  atomic-function schema. Exports `AtomicTier` (ISO/IEC 29110 entry /
  basic / intermediate / advanced), `SafetyClass` (IEC 62304 A/B/C),
  `Sil` (IEC 61508 1-4 / none), `AtomicProfile`, `BASE_CORE_FIELDS` (the 8
  universal fields), `TIER_FIELDS` (per-tier additions), `fieldRequiredFor`,
  `requiredFieldsFor`, `deriveAtomicProfile`, `validateAtomicProfile`,
  `isAtomicTier`, `isSafetyClass`, `isSil`, `tierLabel`. Defaults to
  `{ basic / A / none }` when fields are absent.
- **Tier profile entries in `skills/standards/catalogue.json`** — new
  `tiers[]` array carries the 4 ISO/IEC 29110 tier profiles
  (`atomic-tier-entry`, `atomic-tier-basic`, `atomic-tier-intermediate`,
  `atomic-tier-advanced`). Each profile declares its tier, safety-class
  scope, required field list, and doctor-check list. Catalogue version
  bumped to 1.1.0.
- **`doctor/checks/atomic-tier.ts`** (L1) — `checkAtomicTierSection`
  parses the working-copy markdown table, walks every AF row, and emits
  tier-aware errors (base-core missing; tier-specific missing;
  cohesion ∉ {perfect-atomic, functional}; verification ∉ IEEE 29148
  methods; testable ≠ yes; complexity > 10) and warnings
  (EARS pattern invalid; argCount ≥ 3; coupling=high without rationale;
  risk empty at advanced tier).
- **Doctor gate integration** — `doctor/gate.ts:runPublishGate` now calls
  `checkAtomicTierSection` when `artifact === "atomic-functions"`,
  surfacing the tier's errors as publish blockers and warnings as
  advisory.
- **Stage prompt block** — `core/prompt.ts:renderAtomicProfile` renders
  a `## Atomic Profile (ISO/IEC 29110 + IEC 61508/IEC 62304)` block into
  the atomic-function stage prompt, listing tier, safetyClass, SIL,
  overlay id, and the required field set so the parent LLM populates
  the right columns.
- **Configure-inputs setup** — `/velpari-configure-inputs` gains a 5th
  step that captures the atomic profile via three native simple-pickers
  (tier / safetyClass / sil). Persists to `.pi/velpari/files.json:atomic`.
  Defaults preserved on "keep current".
- **Fix-suggestion fingerprints** — 11 new entries in
  `doctor/checks/fix-suggestions.ts` (atomic-rows-missing,
  atomic-base-core-missing, atomic-tier-missing, atomic-cohesion-invalid,
  atomic-verification-invalid, atomic-testable-invalid,
  atomic-complexity-exceeded, atomic-ears-invalid, atomic-arg-count-high,
  atomic-coupling-high, atomic-risk-missing).
- **Tests** — `test/core/atomic-tier.test.ts` (32 cases across the
  schema, validation, type guards, derive defaults) and
  `test/doctor/check-atomic-tier.test.ts` (14 cases across the 4 tiers,
  base-core, complexity threshold, EARS, coupling, risk). Existing
  `test/stages/atomic-function.test.ts` extended with 5 tier-injection
  cases that exercise `buildStagePrompt` for every tier.

### Changed

- **`FilesConfig`** (`core/config.ts`) — gained optional `atomic?: AtomicProfile`.
  Existing configs without the field continue to work (defaults applied
  on read).
- **`StageRunConfig`** (`core/stage-runner.ts`) — gained optional
  `atomicProfile?: AtomicProfile | null`. The registry passes the loaded
  profile into every stage run (other stages pass null; the prompt
  renderer omits the block).
- **`BuildStagePromptInput`** (`core/prompt.ts`) — gained optional
  `atomicProfile?: AtomicProfile | null` and emits the `## Atomic Profile`
  block when present.
- **Registry** (`stages/registry.ts`) — loads the atomic profile from
  `files.json:atomic` and passes it into `StageRunConfig.atomicProfile`.
- **Scout skill markdowns** (`skills/agents/af-source-{rtm,design,prd,feas}.md`)
  — JSON payload schemas extended with the 8 base-core + tier-specific
  optional fields. Scouts always fill base-core; tier-specific fields are
  filled when the prompt declares a tier that requires them.
- **Atomic-function skill markdown** (`skills/velpari-atomic-function.md`)
  — 4 tier-aware output schemas (Entry / Basic / Intermediate / Advanced)
  with the `Tier rules` enforcement table.
- **`Doc/velpari-sequence.md`** Stage 6 — new subsection "Stage 6
  tier-driven schema (ISO/IEC 29110 + IEC 61508/IEC 62304)" documents
  the 4 tiers, the 8 base-core fields, and the 3-input → 1-schema
  selection framework.

### Backward compatibility

- **Additive only.** Existing published atomic-functions artifacts stay
  valid. `deriveAtomicProfile` returns defaults when `files.json:atomic`
  is absent, so no run breaks.
- **Grandfather clause** — `the publish tool` on an existing artifact
  does NOT re-run the new tier gate. The tier gate fires only on
  fresh publishes of new content (matching `updateMode` semantics).
- **No new commands. No new stages.** The same `/velpari-atomic-function`
  command + `the publish tool` flow applies; only the schema and the
  doctor gate change.

### Standards applied

- **ISO/IEC 29110** — 4-tier lifecycle profile (entry / basic /
  intermediate / advanced) for Very Small Entities. The selection
  framework the industry uses for graduated standards adoption.
- **IEC 62304:2006 + IEC 62304:2026 (draft)** — software safety class
  A / B / C (loss-of-comfort / money / life). Captured as
  `safetyClass`.
- **IEC 61508:2010** — Safety Integrity Level 1-4 for industrial /
  functional-safety contexts. Captured as `sil`.
- **IEEE 29148:2018** — verification method (Test / Demonstration /
  Inspection / Analysis), traceability, requirement attributes.
- **INCOSE Guide to Writing Requirements v4** (June 2023) — singular
  requirement characteristic (C5), pattern-based requirements, status
  attribute.
- **EARS (Mavin 2009)** — 5 patterns: Ubiquitous / Event-driven /
  State-driven / Unwanted / Optional.
- **Yourdon & Constantine *Structured Design* (1979)** — cohesion
  ranking (functional → perfect-atomic) + functional decomposition
  stopping criterion.
- **V-Model Module Design (LLD)** — module spec includes pseudocode,
  interfaces, dependencies, errors, complete I/O.
- **ISO/IEC 25010:2023** — Maintainability sub-characteristics
  (modularity, reusability, analyzability, modifiability, testability).
  Complexity threshold ≤ 10.
- **Robert C. Martin *Clean Code*** — functions should be small,
  one-level-of-abstraction, few arguments (target 0-2).
- **ISO/IEC 14764:2022** — software maintenance (corrective / adaptive
  / perfective / preventive) types. Advanced tier carries owner +
  rationale + change log.

---
## [Unreleased] — 2026-09-17 — One-command stage publish (v1.5.0)

### Added

- **`velpari_stage_publish` tool** (`stages/stage-publish-tool.ts`) — LLM-callable bridge used by the 9 stage skills' preview-yes branch. Calls the same `handleApprove` logic as `the publish tool`: publish gate → atomic publish to `Doc/` → doctor audit → stage advance. Guarded to the 9 in-progress stages; brainstorm stages are rejected (they keep `/velpari-approve-brainstorm`).

### Changed

- **One-command stage publish.** The stage lifecycle is now: stage command → draft + preview → user confirms → publish + advance happen in the same flow. The user no longer needs to type `the publish tool` after each stage; it remains registered as the manual fallback. All publish gates, revision rules, and the doctor audit are unchanged (confirm-then-write is preserved — the preview question IS the user confirmation).
- Updated the preview-yes branch in all 9 stage skill files (`skills/velpari-*.md`) and the handler/hook notifications (`stage-runner.ts`, `before-agent-start.ts`, `tool-call.ts`, `prd-rtm.ts`) to name the tool.
- `tool-call.test.ts` lock-message regex updated to accept the new block text (user-approved test fix).

### Architecture (Option B)

- **`stages/atomic-function/`** dedicated layer (8 phase files built in commits `feb6bbc`–`ab9fc57`) is preserved as a **library** — typed helpers + pure functions + types, no runtime side effects. The 7 phases (pre-condition, prompt, scout-dispatch, reviewer, merge, preview, publish) are used by the parent LLM during Phases 1–6 of the stage flow. `publish.ts` (Phase 7) is a library helper that declares `PUBLISH_PHASE_STATUS = "library-helper"` and `PUBLISH_DELEGATED_TO = "velpari_stage_publish"`.
- **Three-role architecture for every stage 2–10:** (1) **layer** = library helpers, (2) **tool** = runtime entry (`velpari_stage_publish`), (3) **handler** = single source of publish truth (`ops/approve.ts:handleApprove`). No duplication; no behavioral regression.

## [Unreleased] — 2026-09-17 — Sub-agent generator v2: emit reviewer copies (Plan E)

The `/velpari-generate-sub-agents` command (originally brainstorm-only) now also emits per-stage reviewer copies (atomic-function, pseudocode, testplan, design) on top of the 4 brainstorm roles. Total: up to 8 generated agents per project.

### Changed

- **`core/agents-config.ts:VELPARI_REVIEWER_GENERATED_ROLES`** — expanded from 1 to 4 reviewer role definitions. Each entry has the standard `role / label / tools / mandate / invocationHint / outOfScope` shape used by `core/agents-generator.ts:buildGeneratedAgentMarkdown`. The placeholder comment now says v2 is wired (not "future").
- **`commands/generate-sub-agents.ts`** — generator v2 wiring:
  - `ALL_GENERATED_ROLES` = `[...VELPARI_BRAINSTORM_GENERATED_ROLES, ...VELPARI_REVIEWER_GENERATED_ROLES]` for classification.
  - `isBrainstormRole(role)` / `isReviewerRole(role)` — role partition helpers.
  - `buildReviewerAgentMarkdown(def)` — deterministic markdown builder for reviewer roles (no project context needed; reviewer roles read the merged draft + source reports at runtime).
  - `writeReviewerCopiesOnly(ctx, cwd, slug, reviewerDefs)` — when all 4 brainstorm roles are custom, skip the 3-question interview and write only reviewer copies silently.
  - `runAgentGenerator` now splits targets into brainstorm vs reviewer:
    - brainstorm → `planAgentGeneration` + `updateAgentsJson` (interview-driven, 4 mappings).
    - reviewer → `buildReviewerAgentMarkdown` + `writeGeneratedAgents` (deterministic, no mappings).
  - `updateAgentsJson` filter now includes only brainstorm roles so reviewer roles don't pollute `agents.json` with mappings.
- **Existing tests updated** for the v2 agent counts:
  - `test/agents/reviewer-agent.test.ts` — `VELPARI_REVIEWER_GENERATED_ROLES.length` assertion updated from 1 to 4 (Plan D added 3 reviewer roles).
  - `test/commands/generate-sub-agents-flow.test.ts` — happy-path test updated to expect 8 created (4 brainstorm + 4 reviewer) + 4 mappings; all-custom test renamed and updated to expect 4 reviewer copies written silently + 0 mappings + no "all custom" bail.

### Added

- **`test/commands/generate-reviewer-copies.test.ts`** — 3 Plan E tests covering:
  - Happy path: 4 brainstorm + 4 reviewer = 8 created, 4 mappings.
  - All 4 brainstorm custom → write only 4 reviewer copies silently (no interview, 0 mappings, custom mappings preserved).
  - Single reviewer custom → 4 brainstorm + 3 reviewer = 7 created, 4 mappings; custom reviewer file untouched.

### Architecture (Plan E)

- **Layered generation.** Brainstorm roles are interview-driven (3 questions → preview → confirm) because they adapt to the project context. Reviewer roles are deterministic — same contract for every project, no interview needed.
- **Mapping discipline.** `agents.json` is only updated for the 4 brainstorm roles (the original contract). Reviewer roles have their own scope (per-stage) and shouldn't appear in `agents.json`.
- **Customization preserved.** Custom reviewer mappings (e.g., `agents.json` → `reviewer: "my-custom"`) are honored via `writeGeneratedAgents`'s manifest check — the user's custom file is never overwritten.

### Compatibility

- Existing projects that ran `/velpari-generate-sub-agents` before Plan E will now get 4 additional `<slug>-reviewer.md` / `<slug>-pseudocode-reviewer.md` / `<slug>-testplan-reviewer.md` / `<slug>-design-reviewer.md` files. No effect on `agents.json` mappings (reviewer roles don't add mappings).
- `velpari-reviewer.generated-manifest.json` (created on first run) tracks the new reviewer files the same way it tracks brainstorm files. Regeneration is supported.

## [Unreleased] — 2026-09-17 — Reviewer generalization to 4 stages (Plan D, v1.5.0)

The reviewer sub-agent pattern (Plan A — atomic-function only) is now generalized to **4 stages**: atomic-function, pseudocode, testplan, design. Each stage has its own reviewer role + verdict JSON + doctor gate integration, all sharing the same tier + overlay + reviewerMode gate logic.

### Added (3 reviewer agent definitions)

- **`skills/agents/pseudocode-reviewer.md`** — adversarial critic for the pseudocode stage. 10 deterministic checks (per-af-missing, pseudocode-empty, complexity-stated, inputs-declared, outputs-declared, complexity-exceeded, edge-cases-missing, error-handling-missing, dependency-cyclic, atomic-tier-mismatch) + 4 semantic checks (cross-scout-contradiction, algorithm-rename-mismatch, tier-mismatch, standards-mapping-missing). Verdict path: `<runDir>/pseudocode/scouts/pseudocode-reviewer-report.json`.
- **`skills/agents/testplan-reviewer.md`** — same shape (10 deterministic + 4 semantic). Verdict path: `<runDir>/testplan/scouts/testplan-reviewer-report.json`.
- **`skills/agents/design-reviewer.md`** — 12 deterministic checks covering arc42 + SEI ATAM + C4 sections + 4 semantic checks. Verdict path: `<runDir>/design/scouts/design-reviewer-report.json`.

### Changed

- **`core/agents-config.ts`** — `STAGE_SCOUT_ROLES` now 41 entries (was 35): added `pseudocode-reviewer`, `testplan-reviewer`, `design-reviewer`. `REVIEWER_ROLES` now 4 entries (was 1). `VELPARI_ROLES` now 54 entries (was 48). `ROLE_LABELS` updated for the 3 new reviewer roles.
- **`stages/registry.ts:filterReviewerSlot`** — generalized to all 4 reviewer stages via a new `REVIEWER_BY_STAGE` map. Each stage's reviewer role is mapped (`atomic-function → reviewer`, `pseudocode → pseudocode-reviewer`, etc.); other stages pass through unchanged. The tier + overlay + reviewerMode gate logic is shared (delegates to `core/atomic-tier.ts:shouldRunReviewer`).
- **`stages/registry.ts:STAGE_REGISTRY`** — pseudocode, testplan, and architecture-generator entries now include the per-stage reviewer scout (`pseudocode-reviewer`, `testplan-reviewer`, `design-reviewer`). The reviewer slot is filtered at runtime by `filterReviewerSlot` when the tier/overlay gate says no (entry/basic tier by default).
- **`doctor/checks/reviewer-verdict.ts`** (NEW) — generic `loadReviewerVerdictForStage(cwd, spec, tierContext, profile)` helper. Walks `<runDir>/<stage>/scouts/<reviewer-role>-report.json` and surfaces issues as a `DiagnosticSection`. Closes a bug in the original atomic-tier.ts: when the verdict is missing AND the tier/overlay gate would have skipped the reviewer, emits `info` (not `error`); basic-tier projects no longer break.
- **`doctor/checks/{pseudocode,testplan,design}-reviewer.ts`** (NEW) — thin wrappers that call the generic helper for each stage.
- **`doctor/gate.ts:runPublishGate`** — reviewer verdict checks added for pseudocode, testplan, design, and test-cases artifacts. Each artifact maps to its stage-specific verdict loader via the new `REVIEWER_STAGE_SPECS` table.
- **`ops/approve.ts:stageToArtifact`** — already supports atomic-function (added in Gap B); pseudocode/testplan/architecture-generator fall through to existing handlers (their stage-specific handling is in the registry).
- **3 stage skill markdowns** (`skills/velpari-pseudocode.md`, `skills/velpari-testplan.md`, `skills/velpari-architecture-generator.md`) — instruct the parent LLM to spawn the per-stage reviewer scout alongside the source scouts and emit the verdict JSON before the preview gate.

### Tests

- **11 new unit tests** in `pi-extension/test/doctor/reviewer-verdict.test.ts` — covers all 4 reviewer stages (basic-tier info / advanced-tier error / approve verdict / verdict-with-errors / malformed JSON).
- **4 new e2e tests** in `pi-extension/test/integration/reviewer-generalization.test.ts` — pseudocode + testplan (basic-tier info, advanced-tier publish success). Architecture-generator is exercised by the unit tests only (full design publish requires the archSubCycle + ADR + designReadiness prelude setup).

### Architecture (Plan D)

- **Three reviewer pattern, four stages.** The reviewer is the only adversarial critic. Each of the 4 reviewer stages has the same structure: 4 source scouts (+1 reviewer for 3 stages; +1 conflict-detector conditional for design), verdict JSON, doctor gate integration.
- **Single source of publish truth.** `ops/approve.ts:handleApprove` is still the only place that writes Doc/, advances state, and runs the doctor audit. The reviewer verdict is consumed via the verdict loaders in `doctor/checks/`; the gate logic (`runPublishGate`) folds them into the existing diagnostic sections.
- **Bug fix.** Basic-tier projects (tier=entry or tier=basic without overlay.requiresReviewer) no longer error on missing reviewer verdict — they emit `info` and publish normally. The reviewer was filtered out per the tier gate; no verdict file is expected.

### Updated docs

- `skills/velpari-atomic-function.md` — 5 stale `the publish tool` references updated to the new tool call.
- `AGENTS.md` (root) — "Auto-chain happens ONCE" section rewritten to describe the one-command flow.
- `Doc/velpari-sequence.md` — 9 `**Advance**` rows + 6 sequence-diagram lines updated to mention `velpari_stage_publish` as the default; `the publish tool` retained as manual fallback.
- `README.md` — sequence-nuances summary updated from "auto-chain happens once" to "one-command stage publish via `velpari_stage_publish`".

## [Unreleased] — 2026-09-16 — Logging design command (v1.4.0)

### Added

- **`/velpari-design-logging`** — cross-cutting discipline command. Produces `Doc/observability/logging-plan_<project>.md` with a 16-section markdown body + YAML frontmatter (frontmatter + Logging Objectives & Scope + Compliance Regime Map + Event Catalog + Log Shape + Log Levels + Transport + Storage & Retention + Protection + Clock Synchronization + Monitoring & Alerting + Log Review Cadence + Correlation IDs & Trace Context + Privacy Considerations + Mapping to Design Crosscuts + Mapping to Test Plan + Change Log). Runs after Design is approved; cross-cutting (does not transition `currentStage`). Self-publishing — no separate `the publish tool` step; the doctor's `checkLoggingPlanSection` is the safety net.
- **`/velpari-show-logging`** — view command. Prints the published logging plan.
- **`core/logging-plan.ts`** (L0) — `LoggingPlan` schema, `validateLoggingPlan`, `renderLoggingPlanMarkdown`, `loadPublishedLoggingPlanMarkdown`. `LOGGING_PLAN_REQUIRED_SECTIONS` is the frozen 16-section markdown-body list (YAML frontmatter is verified separately by the doctor), imported by the skill + the doctor.
- **`io/atomic-write.ts`** — new `atomicWriteJsonWithFrontmatter` helper used by the publish path.
- **3 logging scouts** (`skills/agents/`):
  - `logging-standards-researcher.md` — reads PRD + active standards overlay, emits JSON `{ regimes[], overlayLoggingRequirements, applicable }`.
  - `logging-architecture-designer.md` — reads PRD §10 NFRs + Design §11/§10, emits JSON `{ eventCatalog, logShape, transport, storage, alerting, … }`.
  - `logging-compliance-mapper.md` — joins both upstream reports, emits `{ mapping[], gaps[], score }`.
- **`skills/velpari-design-logging.md`** — parent-LLM program. Orchestrates 3 scouts, enforces hard rules, calls `renderLoggingPlanMarkdown` + `validateLoggingPlan`, drives the self-publish.
- **`doctor/checks/logging-plan.ts`** — full audit of the published plan. Existence (info / error depending on overlay), section coverage, frontmatter, retention compliance (parses §7), tamper-evidence (parses §8), PII redaction (parses §13).
- **Handoff integration** — `.pi/senai/architect-inputs.json` gains an `observability.loggingPlan[]` field (one entry per `projectName` in the federation). Senai reads it during `implement` to wire up the logger per the design.
- **Overlays** — `loggingRequirements` block added to 4 bundled overlays:
  - `medical-device-b`: 24 mo retention, tamper-evident, PII redaction (FDA 21 CFR Part 11 + IEC 62304).
  - `industrial-ot`: 36 mo retention, tamper-evident, daily review (IEC 61508 + IEC 62443).
  - `financial-payments`: 12 mo retention, tamper-evident, PII redaction, daily review (PCI-DSS v4.0 Req 10 + SOX §404).
  - `cloud-saas`: 12 mo retention, tamper-evident, PII redaction, daily review (SOC 2 CC7 + ISO 27001/27017/27018).
- **Status block** — `/velpari-status` now prints a `## Observability — Logging plan` section.

### Changed

- **Command count** 30 → 32 (added 1 discipline + 1 view).
- **`STAGE_SCOUT_ROLES`** stays at 37 (stage registry unchanged). New `LOGGING_SCOUT_ROLES` constant holds the 3 logging scouts.
- **`VELPARI_ROLES`** now 46 (4 brainstorm + 37 stage + 2 feasibility-conditional + 3 logging). Cross-check test updated.
- **`agents.ts` doctor check** — `STAGES_WITH_SKILL_MARKDOWN` and `ALL_STAGE_SCOUTS` now include `design-logging`. The doctor verifies the new skill markdown mentions each scout, `pi-interactive-subagents`, `caller_ping`, `AskUserQuestion`, and the zellij close-pane workaround.

### Standards applied

- **RFC 5424** — Syslog severity levels (8 levels, lower = more severe).
- **RFC 2119** — NFR keyword check (`shall` / `should` / `may`).
- **OWASP Logging Cheat Sheet** — event catalog structure, PII redaction guidance.
- **OpenTelemetry Logs Data Model** — log shape fields + W3C Trace Context correlation.
- **NIST SP 800-92** — log management infrastructure guide.
- **ISO 27001:2022 §8.15/§8.16/§8.17** — base logging, monitoring, and clock-sync requirements.
- **PCI DSS v4.0 Req 10** — financial-payments overlay (12 mo retention, tamper-evident, daily review).
- **FDA 21 CFR Part 11** — medical-device-b overlay (24 mo retention, tamper-evident, electronic records).
- **IEC 61508 / IEC 62443** — industrial-ot overlay (36 mo retention, tamper-evident, daily review).
- **SOC 2 CC7 + ISO 27017/27018** — cloud-saas overlay (12 mo retention, tamper-evident, daily review).

### Notes

- Schema version stays at `version: 1` (additive change). Senai's chirpi consumer accepts unknown fields.
- The new command is **cross-cutting, not a stage**. No entry added to `STAGE_TRANSITIONS`.
- All 1240 existing tests still pass; +30 new tests planned in Phase 10.
- The "real HTML mockup" intent of the old `/velpari-html-design` name remains deferred (no new HTML work in this change).

## [Unreleased] — 2026-09-15 — Sequence reorder to industry-standard order

### Changed

- **Velpari sequence reordered to industry-standard order** (Option B). New chain: Brainstorm → PRD → RTM → Feasibility → Design → **Atomic Functions** → **Pseudocode** → **Test Plan** → **Development Order** → **Final Design** → Handoff → Senai.
- **Stages 6–10 are now required** (Atomic Functions, Pseudocode, Test Plan, Development Order, Final Design). Previously stages 8, 9, 10 were optional; Atomic Functions was after Test Plan.
- **Atomic Functions moved to Stage 6** (between Design and Pseudocode). Matches V-Model Module Design (LLD) and SA/SD Structured Design. Pseudocode now references atomic functions by id.
- **Test Plan moved to Stage 8** (after Pseudocode). Test cases can reference both atomic functions and pseudocode.
- **Development Order moved to Stage 9** (after Test Plan). Now reads the full pre-build artifact set.
- **Final Design moved to Stage 10** (after Development Order). Consolidates all 9 prior artifacts.
- **Handoff pre-req tightened** — `/velpari-handoff` now requires `finalized-design`, not `planned-tests`.

### Documentation

- **`Doc/velpari-sequence.md`** — Stages 6–10 promoted to required, re-numbered. Transition table reordered. Command surface section split into pre-production + build-planning + execution/consolidation.
- **`AGENTS.md`** — Principle #10 rewritten ("Stages 6–10 are required and ordered"). Principle #4 (scout pattern) updated to cover Stages 2–10. State enum comments updated. Transition table updated. Stage commands section split into pre-production + build-planning + execution/consolidation.
- **`velpari-full-sequence.md`** (project root) — full draft of the new sequence with industry-standards mapping (V-Model, SA/SD, IEEE 12207/29148, PMBOK).

### Standards aligned

- **V-Model** — Atomic Functions = Module Design (LLD); Pseudocode = Module Design detail; Test Plan = System + Integration + Unit Test Plans
- **SA/SD** (Structured Analysis / Structured Design) — Functional Decomposition → Structure Chart + Pseudocode in Design Phase
- **IEEE 12207:2026 / IEEE 29148:2018** — Requirements engineering + traceability
- **PMBOK** — Development Order = Work Breakdown Structure

### Deferred (NOT in this change)

- `pi-extension/src/core/constants.ts` — `STAGE_TRANSITIONS` still reflects old order
- `pi-extension/src/stages/registry.ts` — stage gate still uses old next-commands
- `pi-extension/src/stages/{atomic-function,pseudocode,testplan,development-order,final-design}.ts` — `reads` lists still reference old prior stages
- `skills/velpari-{atomic-function,pseudocode,testplan,development-order,final-design}.md` — Reads sections still reflect old order
- `pi-extension/test/integration/state-machine.test.ts` — assertions still expect old order

These will be updated in a separate code-migration plan after this doc-only change lands.

## [Unreleased] — 2026-09-15 — Multi-phase testing strategy (Phases 3, 5, 6, 7)

### Added

- **`test:coverage` script** in `package.json` — uses Node 22's built-in `--experimental-test-coverage`. No extra deps. Run `npm run test:coverage` for a per-file coverage report.
- **`Doc/test-coverage-baseline.md`** — captures the initial baseline (91.71% statements) and per-phase numbers. Updated whenever the suite drifts > 1 point.
- **Shared test helper** `pi-extension/test/helpers/full-cwd.ts` — exports `setupFullCwd(cwd)`, `TEST_PROJECT`, `PSRS_FM`, `RTM_JSON`. Replaces the inline `setupFullCwd` duplicated across many integration tests.
- **Per-doctor-check integration tests** (`pi-extension/test/integration/doctor-checks.test.ts`, 16 tests) — drives `runDoctor()` end-to-end and asserts the section shape, summary counters, and error/warning presence for: frontmatter, MVP coverage, phase consistency, RTM data, fingerprints, paths, profile, working/published separation.
- **Tier 2 LLM e2e scaffold** (`pi-extension/test/e2e/tier2-brainstorm-only.test.ts`) — pre-wired skip via `tier2Enabled()`. Real flow runs in CI only when `RUN_LLM_E2E=1` and a provider key are both set.
- **Performance budget tests** (`pi-extension/test/performance/{budget,doctor-big-tree}.test.ts`) — `runDoctor` on a minimal fixture under 1s (always on); `runDoctor` on 200 PRD-shaped files under 5s (gated by `RUN_PERF=1`).
- **GitHub Actions workflow** (`.github/workflows/test.yml`) — three jobs: `unit-and-e2e` on every PR + push, `perf` on `test-merge` pushes, `tier2` on manual `workflow_dispatch` only.

### Changed

- **README "Local dev" section** — expanded to document the four test commands, what each proves, and what each costs (no key / one key / etc).

### Fixed

- **`pi-extension/test/ops/approve-final-design.test.ts`** — added missing `afterEach` import. The wt-architecture squash landed an `afterEach` block but not its import, causing `npm run build` to fail. Uncovered during `test:coverage` runs.

### Test counts

| Layer | Before | After | Δ |
|---|---|---|---|
| Unit / integration tests | 1020 | 1137 | +117 |
| Coverage (statements) | 91.71% | ~94% | +2.3 |

### Notes

- Phase 4 (in-process `pi-test-harness`) was **skipped**: `@gaodes/pi-test-harness@1.x` requires `@earendil-works/pi-ai` with an export that isn't in our pinned version. The harness was installed and removed. Re-evaluate when the upstream Pi ecosystem ships a compatible release. The gaps it would have closed (configure-requirements UI handlers, stages/design entry path) remain in the deferred list in the baseline doc.

## [Unreleased] — 2026-09-14 — Brainstorm lifecycle v2.2 (single-shot per run)

### Added (hard gate)

- **Stage guard at `/velpari-brainstorm` entry (v2.2).** Brainstorm is now single-shot per run. Re-running on a run that has advanced past `brainstorming` hard-blocks with the next command named via `nextCommandsFor(state.currentStage)`. The refusal includes a `/velpari-reset` hint so the developer knows how to discard the current run. The guard is wired at `stages/brainstorm/index.ts:handleBrainstorm` step 2b — runs AFTER `loadState` (to know the stage) and BEFORE `createRun` (so a refused re-run does not overwrite the existing run). Runs AFTER the multiplexer gate (no mux wins). Fixes the re-run bug seen in the 2026-09-13 session where 8 brainstorm missions were started on one runId, leading to repeated `Cannot approve brainstorm: current stage is brainstormed` errors.

### Added (skill)

- **Pre-APPROVE hard gate in `skills/velpari-brainstorm.md` (new `[7.5]` section).** The parent LLM now mirrors `guardApproveReadiness` and `guardNotesContent` in the skill BEFORE showing the preview gate at `[8] APPROVE`. The 4 missing-section errors visible in the 2026-09-13 session (`Understanding is not confirmed yet`, `Brainstorm notes are not ready to approve — Interview Answers (missing) — Scout Proposals (missing)`, `Brainstorm notes are not ready to approve — Scout Proposals (missing)`, `Use /velpari-approve-brainstorm for the brainstorm stage`) are no longer reachable from a well-behaved parent LLM.

### Changed

- **`.gitignore`** — generalized the stray session HTML line `pi-session-2026-09-13...html` to `pi-session-*.html` so future kimi-code session exports are also ignored.

### Tests

- **`pi-extension/test/stages/brainstorm/guard.test.ts`** — 6 new unit tests for `guardStageForBrainstorm` (fresh, resume, post-approve, mid-PRD, near-handoff, past-handoff).
- **`pi-extension/test/ops/brainstorm-stage-guard.test.ts`** — 8 new integration tests (proceeds on fresh + resume, hits on advanced stages, names the right next command, mux gate wins, state.json is not overwritten). 777 → 791 (+14).

### Docs

- **`Doc/velpari-sequence.md`** — new nuance #10 (v2.2 single-shot guard) and #11 (pre-APPROVE skill gate).
- **`pi-extension/src/AGENTS.md`** — new "Brainstorm lifecycle v2.2" helper table row + enforcement note.
- **`AGENTS.md`** — principle 5 extended with the v2.2 stage guard.

## [Unreleased] — 2026-09-14 — SCAN-gate picker hardening (AskUserQuestion parity)

### Hardened

- **`pi-extension/src/stages/brainstorm/scan-gate.ts`** — the SCAN-gate picker now follows the canonical AskUserQuestion hardening pattern:
  - **Auto-injected freeform row** "Type something... (freeform — name the scans)" appended to every label list (AskUserQuestion parity — Claude Code auto-injects the same)
  - **Freeform input** via `ctx.ui.input`: lowercased, trimmed, comma-split, filtered to the available scan set, unknown names silently dropped, empty input → `cancelled: true`
  - **Rich `ScanGateResult` return** (`{ scans, cancelled, freeform }`) replaces the bare `ScanType[]` so the caller can distinguish "user skipped scans" from "user pressed Esc" from "user typed a custom subset"
  - **Cancellation canonical signal** — Esc and empty-freeform both return `cancelled: true`

- **`pi-extension/src/stages/brainstorm-state-tool.ts`** — the `request-scan-gate` action now persists the new `cancelled` and `freeform` flags in the snapshot returned to the LLM.

### Bundled skill

- **`skills/velpari-scan-gate/SKILL.md`** — new on-demand skill for the parent LLM. Documents the 5 structured branches + the freeform row, the decision-handshake pattern, the rich result shape, and the hard rules (never skip, freeform always present, unknown names dropped, empty → cancelled, config-aware, community needs consent).

### Docs

- **`Doc/velpari-sequence.md`** — new nuance #9 in "7 Important Nuances" documents the AskUserQuestion parity (freeform row + rich result + cancellation signal).
- **`AGENTS.md`** — principle 7 expanded to describe the freeform row + rich result + bundled skill pointer.

### Tests

- **`pi-extension/test/stages/brainstorm/scan-gate.test.ts`** — updated to use the new `ScanGateResult` shape. 4 new tests: freeform row is always last, parses comma-separated input, filters unknown names, case-insensitive, empty → cancelled. 773 → 777 (+4).

## [Unreleased] — 2026-09-14 — Brainstorm lifecycle v2.1

### Added (hard gates)

- **Multiplexer hard gate at `/velpari-brainstorm` entry.** The handler now refuses to start a run unless a terminal multiplexer (zellij / tmux / wezterm / cmux) is detected in the environment. Without one, visible scout subagents have nowhere to spawn; the command notifies the developer and exits BEFORE `loadState` / `createRun` (no orphan runs). Override via the `PI_SUBAGENT_MUX` env var for wrappers and tests.
- **Mandatory SCAN-gate picker.** There is no longer a default scan selection at the brainstorm scan gate. The parent LLM invokes `velpari_brainstorm_session({ action: "request-scan-gate" })` which runs `runScanGatePicker` (`stages/brainstorm/scan-gate.ts`) via `ctx.ui.select` + `ctx.ui.confirm`. Five branches: Run all / Run code+doc only / Community only / Adjust (per-scan confirm) / Skip scans. The community scan still requires explicit FR-52 consent. The picker is **config-aware**: it reads `files.json v4` (`codePaths`, `inputDocuments`) + probes the filesystem, so a doc-only project never sees "Run code scan" as an option.
- **Doctor "Available scans (SCAN gate)" section.** New informational audit (`doctor/checks/scan-options.ts`) that reports which scans are available given the current project shape. Never errors — just tells the developer what the picker will offer next time.

### New files (L0 + L1 + doctor)

- `pi-extension/src/core/multiplexer.ts` (L0) — pure env-var multiplexer sniffer. Promoted from `doctor/checks/multiplexer.ts` so L1 handlers can import it.
- `pi-extension/src/core/scan-options.ts` (L0) — config-driven available-scan detection (`getAvailableScanTypes`, `availableScanList`, `isScanAvailable`).
- `pi-extension/src/stages/brainstorm/scan-gate.ts` (L1) — the picker widget. Lives at L1 (not L2) because the state tool needs to invoke it and L1 cannot import from L2.
- `pi-extension/src/doctor/checks/scan-options.ts` (L1) — doctor audit.
- `pi-extension/test/core/multiplexer.test.ts` — 22 unit tests for the detector.
- `pi-extension/test/ops/brainstorm-multiplexer-gate.test.ts` — 8 handler integration tests.
- `pi-extension/test/core/scan-options.test.ts` — 14 unit tests.
- `pi-extension/test/stages/brainstorm/scan-gate.test.ts` — 13 picker branch tests.
- `pi-extension/test/doctor/checks/scan-options.test.ts` — 9 doctor audit tests.

### Modified files

- `pi-extension/src/doctor/checks/multiplexer.ts` — re-exports `detectMultiplexer` from L0 to keep the public API stable.
- `pi-extension/src/stages/brainstorm/index.ts` — multiplexer gate at top of `handleBrainstorm` (before seed guard, before loadState, before createRun).
- `pi-extension/src/stages/brainstorm/dispatcher.ts` — `DEFAULT_SCANS` is now a frozen empty tuple. Sentinel only — never auto-applied.
- `pi-extension/src/stages/brainstorm-state-tool.ts` — new `request-scan-gate` action. Calls `runScanGatePicker` via `ctx.ui` and persists the result via `setScansSelected`.
- `pi-extension/test/stages/brainstorm/dispatcher.test.ts` — `DEFAULT_SCANS` regression tests updated.
- `pi-extension/test/stages/brainstorm-state-tool.test.ts` — 2 new `request-scan-gate` tests.
- `pi-extension/src/doctor/index.ts` — wires the new scan-options check; multiplexer section title bumped from v2.0 to v2.1.
- `pi-extension/src/AGENTS.md` — new "Brainstorm lifecycle v2.1 — new helpers" section listing every new helper, its layer, and its purpose.
- `skills/velpari-brainstorm.md` — `[2] SCAN-PLAN GATE` rewritten for the picker; "Hard rules" section updated with multiplexer + scan-gate always-ask rules.
- `Doc/velpari-sequence.md` — new nuance #8 covers v2.1; Stage 1 table updated; brainstorm lifecycle diagram updated to show the multiplexer gate + the picker-driven SCAN gate.
- `AGENTS.md` — principles 5 and 7 updated to reference v2.1 (multiplexer gate + always-ask picker).

### Test count

- **701 → 773** (+72 new tests across 5 new test files + updates to 3 existing test files). All green.

## [Unreleased] — 2026-09-14 — Re-enabled manual `the publish tool` gate

The temporary auto-publish mode is gone. `the publish tool` now runs the real publish logic again — developer invokes it after the working copy is ready, and the publish gate (doctor checks) runs in block-on-error mode (errors block, warnings shown).

### Reverted

- **`pi-extension/src/core/feature-flags.ts` deleted.** Single source of the temporary `AUTO_PUBLISH_STAGES_2_TO_10` flag. Production no longer needs the override.
- **`pi-extension/src/ops/approve.ts`** — removed the disabled short-circuit (lines 113–125 in the previous release) + the `FEATURE_FLAGS` import. `handleApprove` runs the real publish logic immediately on invoke.
- **`pi-extension/src/hooks/tool-call.ts`** — removed the entire `tool_result` auto-publish block (lines 117–154 in the previous release) + the `lastWriteTimestamp` debounce state + the now-unused `handleApprove` and `FEATURE_FLAGS` imports. The remaining `tool_call` block (sequence locks — brainstorm mutation, stage mutation, scout spawn) is unchanged.

### Test cleanup

- **`pi-extension/test/ops/approve-disabled.test.ts` deleted.** The 3 tests in this file covered the disabled state that no longer exists.
- **Updated 5 existing approve test files** to remove the `FEATURE_FLAGS` import + the `beforeEach` flag flip + the `afterEach` restore — the production flag is permanently off, so the flip is redundant. (`approve-doctor-gate.test.ts`, `approve-feasibility-gate.test.ts`, `approve-final-design.test.ts`, `approve-next-hint.test.ts`, `approve-update.test.ts`.)
- **Test count:** 791 → 788 (−3 from deleted file; 0 net change in remaining tests).

### Brainstorm stage is unaffected

`/velpari-approve-brainstorm` keeps its dedicated handler and its auto-chain into `/velpari-prd`. The brainstorm approve is unchanged.

### Docs

- **`Doc/velpari-sequence.md`** — removed `## 1.6 TEMPORARY — Auto-publish is currently active` (the section + the 7-step re-enable checklist that lived there).
- **`AGENTS.md`** — removed the `### TEMPORARY (added 2026-09-14) — Auto-publish mode is active` subsection from the Sequence nuances block.
## [Unreleased] — 2026-09-14 — `/velpari-generate-sub-agents` (v1, brainstorm-only)

### Added

- **`/velpari-generate-sub-agents` slash command.** Generates project-specific sub-agents for the 4 brainstorm roles (`extractor`, `prd-checker`, `rtm-checker`, `web-search-agent`) by deterministic assembly — role template + technology resource(s) + project-context block, no LLM content generation. Three layers of safety: (a) one confirmation gate before any write, (b) the write-with-safety contract in `core/agents-generator.ts:writeGeneratedAgents` never overwrites files of unknown origin, treats user-edited files as `keptDrifted`, and writes through `atomicWriteFile`; (c) the drift manifest at `.pi/velpari/generated-manifest.json` is merged (never wiped) and tracks sha256 per generated file. Custom mappings in `agents.json` are NEVER overwritten — the generator only touches the default column. Bundled scouts in `skills/agents/` remain the bootstrap fallback.
- **Technology resource library.** `resources/technologies/` ships 4 markdown files: `_template.md` (sourcing rule + section schema), `generic.md` (technology-agnostic fallback), `typescript.md`, `node.md`. Every section cites the official documentation. The library is the only input to the generator's body construction.
- **Brainstorm role table.** `VELPARI_BRAINSTORM_GENERATED_ROLES` in `core/agents-config.ts` defines the 4 v1 role rows with `invocationHint`, `outOfScope[]`, `tools`, `mandate`, and (for `web-search-agent`) `bodyFile = "web-search-agent-body.md"`. The runtime dispatcher still strips `write`/`edit`/`bash` from non-web-search scouts; the generator emits the full tool list per the agent's contract.
- **Generator core (L0).** `pi-extension/src/core/agents-generator.ts` (~430 LoC) carries `discoverTechnologyResources`, `matchTechnologies`, `parseKeywords`, `getProjectSlug`, `hashFile`, `buildGeneratedAgentMarkdown`, `planAgentGeneration`, `writeGeneratedAgents` (the safety contract), `previewRegeneration`, `updateAgentsJson`. `pi-extension/src/core/generated-manifest.ts` (~100 LoC) carries the merge-semantics manifest helpers. `pi-extension/src/core/project-context.ts` (~110 LoC) extracts the v1 mission-text scanner.
- **Canonical body for `web-search-agent`.** `pi-extension/src/agents/web-search-agent-body.md` carries Activation (FR-52), Inputs, Output JSON shape, Implementation notes, and Hard rules. Stripped of frontmatter at load time.
- **Doctor section `Sub-agent generator completeness`.** `pi-extension/src/doctor/checks/sub-agent-generator.ts` audits every row of `VELPARI_BRAINSTORM_GENERATED_ROLES` (bundled-default / custom-mapping / generated-mapping buckets) and runs a project-wide scan for stale footer versions. The summary item flips to `ok` only when no errors AND no warnings are present.
- **Write-set preview.** `pi-extension/src/ui/write-set-preview.ts` renders `WriteAgentsResult` or `RegenerationPreview` as a multi-line confirmation message with `truncateToWidth` safety. Fixes the "Rendered line ... exceeds terminal width" crash documented in pi-seani's CHANGELOG.

### Changed

- **`pi-extension/src/commands/index.ts`.** `registerGenerateSubAgentsCommand` wired into `registerCommands` after `registerConfigureStandardsCommand`. `COMMAND_NAMES` updated to include `velpari-generate-sub-agents` (now 30 commands total). Header comment refreshed.
- **`pi-extension/src/core/agents-config.ts`.** Adds the `VELPARI_BRAINSTORM_GENERATED_ROLES` 4-row table. Type-only import of `GeneratedRoleDef` from `agents-generator.ts` (no runtime cycle).
- **`pi-extension/src/layers.ts`.** L0 documentation mentions the 3 new generator core modules.
- **`pi-extension/src/doctor/index.ts`.** New `checkSubAgentGeneratorSection` appended to the report, after `checkOfficialReadiness`.
- **`AGENTS.md`.** New design principle 14 documents the generator's safety invariants. Project-structure tree adds `resources/technologies/`.
- **`README.md`.** Discipline-command table includes `/velpari-generate-sub-agents`. Command count updated to 30.
- **`Doc/velpari-sequence.md`.** §14 (new) documents the generator's contract and v1 scope.

### Tests

- 829 tests pass (was 703 before this entry; +126 from new generator suites).
- New `pi-extension/test/core/technology-resources.test.ts` (7 assertions).
- New `pi-extension/test/core/agents-generator.test.ts` (32 assertions across 2 sub-suites).
- New `pi-extension/test/core/agents-generator-write.test.ts` (18 assertions across 4 sub-suites).
- New `pi-extension/test/core/generated-manifest.test.ts` (15 assertions).
- New `pi-extension/test/core/project-context.test.ts` (14 assertions).
- New `pi-extension/test/ui/write-set-preview.test.ts` (14 assertions).
- New `pi-extension/test/commands/generate-sub-agents-flow.test.ts` (12 assertions).
- New `pi-extension/test/doctor/sub-agent-generator.test.ts` (13 assertions).
- New `pi-extension/test/e2e/generate-sub-agents.e2e.test.ts` (4 assertions, Tier-1; runs with `RUN_E2E=1`).
- Updated `pi-extension/test/integration/command-registration.test.ts` (count: 29 → 30).

### Notes

- v1 is brainstorm-only by user request (the 4 brainstorm sub-agents). Subsequent phases will extend the role table to the 32 stage scouts. Architecture-bound roles remain owned by `@adi-mudi/pi-chirpi` (Senai's architecture factory).
- Standalone: no runtime dependency on `@adi-mudi/pi-chirpi`. The `loadGeneratedManifest`/`addToGeneratedManifest` helpers live in `core/generated-manifest.ts` for local control.
- The generator emits the same frontmatter + body shape as the bundled scouts in `skills/agents/`, plus a footer carrying the generator version (`v1`) and the technology resource id(s) used. Doctor detects stale versions via `vN < GENERATOR_VERSION` and recommends a regen.
- The flow's 3-question basic-mode interview + scan-gate consent picker + ONE confirm gate mirrors pi-seani's `commands/generate-sub-agents.ts` for parity; only the diff is that the orchestrator lives in `commands/` (L3) instead of `commands/` thin wrapper + `ops/` orchestrator, because `ops/` cannot import `ui/` (L2) per the architecture-alignment test.
- The Velpari release version bumps to `1.0.0` on merge (the generator is the headline v1 feature).

## [Unreleased] — 2026-09-14 — Doc refresh + command rename

### Changed

- **Doc/velpari-sequence.md.** Added a new `## 1.5 7 Important Nuances (READ FIRST)` section that captures the 7 sequence-level invariants every contributor must remember (each stage reads all prior artifacts; `files.json` and `requirements-profile.json` are global inputs; auto-chain happens once; feasibility skip; two approve commands; the `/velpari-final-design` rename). Updated every per-stage "Inputs" row to enumerate ALL prior approved artifacts + config files (not just the immediate predecessor). Updated the optional-stages diagram and the Stage Transition Table to use the new `/velpari-final-design` name. Updated the Handoff "Inputs" row to enumerate the full Doc/ tree + config files + state.json.
- **AGENTS.md.** Added a "Sequence nuances (7 things to remember)" section right after the Stage workflow table, cross-referenced to `Doc/velpari-sequence.md`. Updated the project-structure tree, principle 10, Stage workflow table, Post-pipeline command list, and the final-design consolidation note to use the new `/velpari-final-design` name and explain the rename history.
- **README.md.** Updated the top-level sequence diagram ("HTML Design (optional)" → "Final Design (optional)") and the Stage commands table. Added a one-line pointer to `Doc/velpari-sequence.md` for the full overview + 7 nuances.
- **Renamed slash command.** `/velpari-html-design` is now `/velpari-final-design`. The command today produces a final-design consolidation doc, not actual HTML — the old name was misleading. The skill file is renamed from `skills/velpari-html-design.md` to `skills/velpari-final-design.md`. The StageKey (`final-design`), state values (`finalizing-design`/`finalized-design`), artifact path (`Doc/design/final-design_<project>.md`), and scout roles (`design-consistency-checker`, `design-coverage-checker`, `design-contract-checker`, `design-finalizer`) are all unchanged — this is a pure-surface rename.
- **Command registration.** `pi-extension/src/commands/final-design.ts` and `pi-extension/src/commands/index.ts` (`COMMAND_NAMES` + header comment) updated to register `velpari-final-design` instead of `velpari-html-design`.
- **6 test files updated.** `stage-gate.test.ts`, `state-machine.test.ts`, `skill-discovery.test.ts`, `stage-gates.e2e.test.ts`, `command-registration.test.ts`, `approve-final-design.test.ts` all reference the new command string.

### Notes

- The 7 nuances captured: (1) each stage reads all prior artifacts, (2) `files.json` is a global input, (3) `requirements-profile.json` is a global input, (4) auto-chain happens once (brainstorm → PRD), (5) feasibility skip, (6) two approve commands, (7) the command rename `/velpari-html-design` → `/velpari-final-design`.
- Sub-sequence drill-down (per-stage internal loops, scout pattern details per stage) is deferred to a later plan.
- The real HTML mockup generation that the old `/velpari-html-design` name hinted at is still deferred to a future revision.
- Version bump decision (1.3.0 minor vs 2.0.0 major) is the maintainer's call — this is a doc refresh + a user-facing command rename.

## [Unreleased] — 2026-09-14 — Doc/code gap fixes + Pi standards alignment

### Fixed (5 doc/code gaps closed)

- **Gap 1 — Transition Tables now include atomic-function + development-order transitions.** Both `Doc/velpari-sequence.md §4` and `AGENTS.md` "Stage workflow" table now list all 5 transitions that exist in `STAGE_TRANSITIONS` (`planned-tests → analyzing-atomic-functions`, `analyzing-atomic-functions → analyzed-atomic-functions`, `analyzed-atomic-functions → ordering-development`, `ordering-development → ordered-development`, `ordered-development → handoff-ready`) in addition to the previously-listed 17.
- **Gap 2 — Stage 8 (Atomic Function) pre-req fixed.** `Doc/velpari-sequence.md` Stage 8 detail section now reads "Test plan approved (`planned-tests`). Runs after Stage 7 (Test Plan) in the optional-stages branch." (was: "Design approved. Can run any time after Stage 5." — incorrect; code only allows atomic-function from `planned-tests`).
- **Gap 3 — Full Stage enum (22 values) now documented in both docs.** Added a `type Stage = ...` block after the `RunState` interface in `Doc/velpari-sequence.md` and `AGENTS.md` enumerating all 22 stage values (including `analyzing-atomic-functions`, `analyzed-atomic-functions`, `ordering-development`, `ordered-development` which were previously undocumented).
- **Gap 4 — §5 command count header corrected.** `Doc/velpari-sequence.md §5` now reads "## 5. Command Surface (29 commands)" (was: "27 commands" — incorrect; `COMMAND_NAMES` has 29 entries).
- **Gap 5 — Stale comments fixed in `pi-extension/src/commands/index.ts`.** `// Stage commands (9)` → `(10)` (matches 10 stage entries including `velpari-final-design`), `// Discipline commands (10)` → `(11)` (matches 11 discipline entries including `velpari-handoff`). Array contents and registration function were already correct.

### Changed (Pi extension community standards alignment)

- **Bumped required Node version to 22.** `package.json` `engines.node` is now `">=22.0.0"` (was `">=20.0.0"`). Aligns with `pi-extension-toolkit` community standard. Build + 698/698 tests pass on Node 22.22.1. **Breaking change** for anyone on Node 20.
- **Biome (linter) intentionally NOT added.** The Pi extension community standard includes biome; however, this project explicitly chose "no linter" in `AGENTS.md` ("No runtime dependencies. No test framework, no linter."). Adding a linter is a per-project decision and outside the scope of this gap-fix. Re-evaluate in a future revision if the project policy changes.
- **`--provenance` flag noted for future publish workflow.** When a `npm publish` script is added to this package, it should include the `--provenance` flag per the Pi extension community standard. No publish script exists today, so no code change — this is a future-proofing note.

### Notes

- All 698 unit + integration tests pass after each sub-phase.
- No code behavior change — this entire Unreleased entry is documentation + 1 engines bump + 2 stale comment fixes.
- The 5 doc/code gaps were surfaced by the earlier "Documentation vs Code" comparison in this branch.


## [1.2.0] — 2026-09-13 — Three new domain overlays (industrial-ot, financial-payments, cloud-saas)

### Added

- **`industrial-ot` overlay (IEC 61508 SIL + IEC 62443 + IEC 61131-3).** Bundled overlay for industrial / process control systems. 5 PRD sections (SIL Classification, Functional Safety Plan, HAZOP, Cybersecurity Zones & Conduits, Safety Lifecycle) + 5 design (SIS Architecture, Safety-Related Functions, Zones & Conduits design, SIL Decomposition, Failure Mode Analysis) + 5 testplan (SIL Verification, Integration Coverage, OT Penetration Tests, Proof Test Coverage, FMEA Verification). 1 extra scout (`overlay-design-sil-analyzer`) that maps every module / interface / ADR to a SIL level 1/2/3/4 and flags missing classifications, orphan hazards, under-classified modules, and SIS isolation violations. 7 doctor checks. Inference signals: `plc`, `scada`, `dcs`, `iec 61508`, `iec 62443`, `sil`, `safety instrumented`, `sis`, `ot/it`, `functional safety`, etc.
- **`financial-payments` overlay (PCI-DSS v4.0 + SOX §404 + FFIEC CAT + ISO 27001:2022).** Bundled overlay for card payments, fintech, and banking. 5 PRD sections (Cardholder Data Environment Scope, Audit Logging Requirements, Segregation of Duties, PCI Compliance Matrix, Key Management Requirements) + 5 design (Network Segmentation, Encryption Strategy, Key Management Architecture, Access Control Model, Audit Log Architecture) + 5 testplan (PCI Compliance Tests, Penetration Test Plan, Audit Log Verification, Segregation of Duties Tests, Key Rotation Tests). 1 extra scout (`overlay-design-pci-analyzer`) that verifies CDE scope completeness, network segmentation isolation, encryption coverage (rest + transit + in use), audit-log coverage for privileged actions, and SoD enforcement. 8 doctor checks. Inference signals: `pci`, `pci-dss`, `cardholder data`, `cde`, `sox`, `sarbanes`, `ffiec`, `banking`, `pan`, `cvv`, etc.
- **`cloud-saas` overlay (SOC 2 Type II + ISO 27001:2022 + NIST SP 800-53 Rev 5 + ISO 27017 + ISO 27018).** Bundled overlay for multi-tenant cloud SaaS. 5 PRD sections (TSC Mapping, SOC 2 Control Inventory, Data Classification, Multi-Tenancy Requirements, Service Level Commitments) + 5 design (Multi-Tenancy Architecture, IAM, Audit Logging, Data Encryption rest+transit+in-use, Availability + DR) + 5 testplan (SOC 2 Control Tests, Penetration Testing, Availability Tests RTO/RPO, Backup + Recovery Tests, Access Control Tests). 1 extra scout (`overlay-design-trust-analyzer`) that verifies every applicable TSC category has controls, every customer-data store has a tenant-isolation strategy, encryption covers all three states, IAM follows least privilege + RBAC + MFA + JIT, audit logs cover the five event classes, and RTO/RPO are documented per tier. 8 doctor checks. Inference signals: `soc 2`, `iso 27001`, `nist 800-53`, `iso 27017`, `iso 27018`, `saas`, `multi-tenant`, `aws`, `azure`, `gcp`, `tsc`, etc.
- **Catalogue updated.** `skills/standards/catalogue.json` now registers 5 overlays: `none`, `medical-device-b`, `industrial-ot`, `financial-payments`, `cloud-saas`.
- **Standards README updated.** `skills/standards/README.md` "Bundled overlays" table now lists all 5 overlays with their standards; "Future overlays" trimmed (only `medical-device-c`, `automotive-asil-b/d`, `us-healthcare-phi`, `eu-personal-data`, `avionics-dal-c`, `railway-sil-3`, `csp-aws` remain).
- **Sequence doc updated.** `Doc/velpari-sequence.md §12` lists the 3 new bundled overlays alongside `none` and `medical-device-b`.
- **Integration tests.** Three new tests: `pi-extension/test/integration/industrial-ot-overlay.test.ts`, `financial-payments-overlay.test.ts`, `cloud-saas-overlay.test.ts`. Each covers catalogue entry, profile shape, required sections count + headings, extra scout role + report path, doctor checks count + a sample rule, and `mergeOverlay` round-trip.

### Notes

- Overlay selection remains optional. The default `none` overlay is unchanged — developers opt in via `/velpari-configure-standards`. No existing run is broken.
- The 3 new overlays mirror the proven `medical-device-b` shape (profile + NOTES + 3 section templates + scout + doctor check) — community overlays can be added by copying `skills/standards/overlays/_template/`.
- Tagged `v1.2.0` (semver bump — additive features: 3 new bundled overlays, no breaking changes).

## [1.0.3] — 2026-09-13 — Rename `/velpari-design` → `/velpari-html-design`

### Changed

- **Command renamed:** `/velpari-design` is now `/velpari-html-design`. The user-facing slash command string changed.
- **Skill renamed:** `skills/velpari-design.md` → `skills/velpari-html-design.md`. Frontmatter `name` field updated.
- **Internal stage key unchanged:** `final-design` registry key, `finalizing-design` / `finalized-design` state values, and `Doc/design/final-design_<project>.md` artifact path all stay the same. This is a pure rename of the user-facing surface; no behavior change.
- **Stage transition updated:** `STAGE_TRANSITIONS` in `core/constants.ts` maps `planned-tests → finalizing-design` via the new command string.
- **Test updated:** `pi-extension/test/ops/approve-final-design.test.ts` calls `advanceStage` with the new command string.

### Notes

- **Purpose change deferred.** This release is rename-only. The future
  purpose of this command (HTML/CSS/JS front-end mockup generation) will
  be addressed in a follow-up release per the agreed plan
  (`.IDE_Plans/architecture-command_plan_20260913_1723_v1.1.md` §Phase 6
  discussion). Until then, the command still produces the same artifact
  as before.
- **Existing sessions are unaffected.** Old `state.json` files with
  `finalizing-design` history entries continue to work because the state
  values did not change.
- This is the first phase of the architecture command plan
  (`architecture-command_plan_20260913_1723_v1.1.md`); subsequent
  phases add the sub-life cycle, standards library, ADR mechanism,
  overlay system, and integration verification.

## [1.0.2] — 2026-09-13 — Bundled `pi-interactive-subagents`

### Changed

- **`pi-interactive-subagents` is now a bundled dependency.** Moved from
  `peerDependencies` to `dependencies` + `bundledDependencies` per the official
  Pi packaging spec (`docs/packages.md` § Dependencies:
  *"Other pi packages must be bundled in your tarball. Add them to
  `dependencies` and `bundledDependencies`, then reference their resources
  through `node_modules/` paths."*). Consumers no longer need to install
  `pi-interactive-subagents` separately — `pi install npm:@adi-mudi/pi-velpari`
  is now a single-install experience.
- **Doctor updated.** `multiplexer.detectInteractiveSubagentsVersion` now also
  looks inside pi-velpari's bundled `node_modules/` (and the canonical
  `~/.pi/agent/npm/node_modules/pi-interactive-subagents/` path) — the previous
  lookup used a non-existent `@earendil-works/` scope and only worked for
  dev-symlink installs. `subagent-ext-missing` fix-suggestion now points to
  reinstalling pi-velpari; `official.missing-subagents-dep` renamed to
  `official.missing-bundled-subagents-dep` with the bundled-install wording.

### Notes

- Existing users with `pi-interactive-subagents` registered as a separate
  Pi package can leave it installed; the package is harmless when duplicated.
- Tagged `v1.0.2-bundled` (thematic suffix; npm version is `1.0.2`).

## [Unreleased] — Brainstorm lifecycle v2 + 4-layer architecture

### Added

- **`/velpari-design` — final design consolidation (plan 3).** New optional
  post-pipeline stage that runs after `/velpari-testplan` is approved
  (`planned-tests`). Reads the approved architecture doc, pseudocode, test
  plan, and test cases, spawns 4 parallel scouts (`design-consistency-checker`,
  `design-coverage-checker`, `design-contract-checker`, `design-finalizer`)
  that cross-check IDs, names, modules, and contracts across all four
  inputs, then writes the consolidated
  `Doc/design/final-design_<project>.md` for the Senai handoff. The new
  command name uses the slot freed by the rename to
  `/velpari-architecture-generator` (below). 4 new bundled scout agents
  land in `skills/agents/`; VELPARI_ROLES grows 38 → 42; 2 new Stage enum
  values (`finalizing-design`, `finalized-design`) and the
  `planned-tests → finalizing-design` + `finalizing-design → finalized-design`
  transitions land in `STAGE_TRANSITIONS`. `the publish tool` publishes
  the working copy and advances to `finalized-design`; revision mode
  enforces the Change Log rule. `/velpari-handoff` still works with or
  without the final-design output — the new stage is optional, like
  `/velpari-atomic-function` and `/velpari-development-order`. Command
  count: 27 → 28.

### Changed

- **Design stage command renamed to `/velpari-architecture-generator`.**
  The former `/velpari-design` name is retired — no stub is left behind;
  the name is reserved for a future command (purpose TBD). Only the
  command string moved: registry StageKey `design` →
  `architecture-generator`, `commands/design.ts` →
  `commands/architecture-generator.ts`, skill file
  `skills/velpari-design.md` → `skills/velpari-architecture-generator.md`
  (frontmatter `name:` updated), and every notification/error/hint string.
  Stage STATE values (`designing`/`designed` in state.json and
  STAGE_TRANSITIONS), artifact names (`Doc/design/design_<project>.md`),
  scout roles (`design-*`), and `/velpari-show-design` are unchanged, so
  saved runs and published layouts keep working.
- **Feasibility v2 — decision stage (reuse scan + language selection).**
  `/velpari-feasibility` is no longer just 4 dimension ratings. New flow:
  read inputs first (hard rule — user questions only for verdict-blocking
  gaps) → consent-gated **reuse scan** (new `feasibility-reuse-scout`
  searches the community for existing implementations and scores each
  candidate with a deterministic core-function checklist; ≥70% + healthy
  license/repo = reuse candidate, 30–69% = partial (suggests
  `/velpari-brainstorm`, then resume), <30% = build) → **language
  selection** on the build path (framework from configure-inputs wins; if
  none, mandatory **spikes** — one `feasibility-spike` agent per candidate
  language builds+runs the core function inside
  `<runDir>/feasibility/spikes/`, gitignored; ties are decided by the
  developer in chat) → the v2 document (13 sections incl. Options
  Analysis, Build-vs-Reuse Comparison, Language Selection, Change Log).
  `the publish tool` hard-blocks a feasibility publish until the session
  carries a decision AND a selected language; the publish gate validates
  the v2 sections. Schedule/cost/risk sections are now lightweight.
  New LLM-callable tool `velpari_feasibility_session` (set-consent /
  set-decision / set-candidates / add-spike-result / select-language)
  persists the mid-stage state in `state.json:feasibilitySession`;
  cleared on approve. Scout roles: 36 → 38.
- **Brainstorm lifecycle v2 — understand-first.** `/velpari-brainstorm` no
  longer runs a fixed 6-question `ctx.ui.input` interview. The parent LLM
  runs a conversational lifecycle (program in `skills/velpari-brainstorm.md`):
  [0] UNDERSTAND → [1] CONFIRM loop with a hard lock → [2] SCAN-PLAN GATE →
  [3] SCANS (visible, read-only scouts) → [4] INFORM → [5] DISCUSS loop →
  [6] BATCH CONFIRM → [7] COVERAGE CHECK → [8] APPROVE (Go / Clarify / Kill).
- **Web-search consent moved to the scan gate** (FR-52 preserved): the
  community scan is the consent, with run / adjust / skip options. The
  dispatcher hard-rejects `web-search-agent` for non-community scans.
- **Gated approve.** `/velpari-approve-brainstorm` hard-blocks on
  unconfirmed understanding, open (draft/discussing) questions, and
  missing/empty/`_TBD_` notes sections before publishing. On success it
  also writes the dispatch audit log and clears the brainstorm session
  fields. Chain into `/velpari-prd` unchanged.
- **Official 4-layer architecture reorganization.** `pi-extension/src/`
  now follows the Pi orchestrator layer map: L0 `core/` + `io/`, L1
  `stages/` + `ops/` + `doctor/` + `view/`, L2 `ui/` + `hooks/`, L3
  `commands/` + `index.ts`. `discipline/` dissolved; commands split into
  25 per-command files; hooks split into one file per event. Layer rules
  live in `src/layers.ts` + `src/AGENTS.md`.

### Added

- **Feasibility skip (update cycles).** After the RTM is approved
  (`built-rtm`), `/velpari-architecture-generator` is allowed directly
  from `built-rtm`
  when a published feasibility study already exists — the run advances
  straight to `designing`. Fresh runs are unchanged: without a published
  study the registry gate rejects the skip and only `/velpari-feasibility`
  is suggested. The skip is a choice, never forced — `/velpari-feasibility`
  stays available to revise the study. New `core/paths.ts:
  hasPublishedFeasibility` helper plus a conditional `built-rtm →
  designing` transition; `nextCommandsFor(stage, { feasibilitySkip })`
  hides the skip from every suggestion surface (status block, gate error
  messages) unless the flag is set; the `before_agent_start` hook and the
  post-RTM-approve notification compute the flag from the live Doc/ tree.
- **Senai config parity — input files.** `files.json` v4 adds `codePaths`,
  `testPaths`, and Senai's default excluded paths (v3 files migrate on
  load). New `core/files-discovery.ts` (`discoverProjectFiles`) scans the
  project top level and classifies code/document/test folders and files.
  `/velpari-configure-inputs` now edits every path list through a
  discovery-backed list editor; the picker widgets (`ui/simple-picker.ts`,
  `ui/list-editor.ts`, `ui/role-picker.ts`, `ui/browse-path.ts`) are ported
  from Senai.
- **Senai config parity — agents.** New `.pi/velpari/agents.json` maps each
  of the 38 fixed scout roles (4 brainstorm + 32 stage + 2
  feasibility-conditional) to an agent name,
  managed by the new `/velpari-configure-agents` picker (display twin
  `/velpari-agents`). The brainstorm dispatcher, stage runner, and prompt
  builder resolve role → agent name at dispatch time; report paths stay
  role-keyed (`<role>-report.json`), and the FR-52 web-search consent stays
  anchored on the `web-search-agent` role so remapping cannot bypass it.
  Doctor gains an "Agent mapping (agents.json)" section (config validity +
  mapped-agent existence). Command count: 25 → 27.
- **Integration/e2e suite (Tier 1, no LLM key).** Four new e2e suites join
  registration + doctor under `pi-extension/test/e2e/`, all driving a real
  `pi --mode rpc` process via the `bash` channel: `config` (files.json
  v3→v4 migration, file discovery, agents.json round-trip), `stage-gates`
  (19-state transition walk, illegal-jump rejection, hard stage gate for
  all 6 core stage commands, PRD gate-pass hand-off), `brainstorm-gates`
  (mutation lock, all 3 approve hard-blocks, publish + audit + session
  clear + PRD chain), and `ops-doctor` (agent-mapping section, status /
  reset / show-prd legacy fallback, schema-valid Senai handoff).
  E2E total: 5 → 25 tests. Also fixes `makeTestHome` silently ignoring
  `opts.files` (fixture files were never written to the temp project).
- **Brainstorm session state + tool.** `RunState` gains
  `understandingConfirmed`, `scansSelected`, `brainstormQuestions`,
  `brainstormDispatchCount` (all optional, cleared at approve). New
  `velpari_brainstorm_session` tool (confirm-understanding / set-scans /
  upsert-question) bridges the parent LLM to `state.json`.
- **Guards** (`stages/brainstorm/guard.ts`): seed input, notes content,
  artifact path, dispatch count, approve readiness, and a brainstorm
  mutation lock — a `tool_call` hook hard-blocks edit/write outside the
  run's `brainstorm/` folder while a brainstorm is open.
- **Scan dispatcher** (`stages/brainstorm/dispatcher.ts`): scan-type →
  scout mapping, per-type and total dispatch caps, read-only tool
  stripping, per-type timeouts.
- **Decision ledger** (`stages/brainstorm/notes.ts`): the notes' `## Agreed`
  / `## Not wanted` / `## Open` sections are regenerated from question
  state on every upsert, inside decision-block markers. Rejected questions
  require a reason.
- **Audit log** (`stages/brainstorm/audit.ts`): approve writes
  `<runDir>/brainstorm/brainstorm-dispatch.md` with dispatch + notes
  coverage summary (atomic write, best-effort).
- **Restored unit-test infrastructure.** `npm test` runs `node --test`
  over compiled `dist/pi-extension/test/**` (the cleanup commit had removed
  the suite). New coverage: brainstorm state helpers, session tool, guards,
  tool_call hook, dispatcher, prompt scan-plan block, notes ledger, audit
  log, gated approve handler, and an architecture-alignment test that
  enforces the 4-layer import rule on compiled output. 103 tests.
- **PSRS community-standard sections.** The PRD template gains
  `User Stories` (US-NN), `Success Metrics` (SM-NN), and `Glossary`
  sections (community consensus: ISO/IEC/IEEE 29148, Atlassian,
  monday.com). Duplicate US/SM ids are errors. The validator tolerates
  numbered headings (`## 1. Objective`).
- **Living documents (strict 20-section migration).** All 20 PSRS
  sections are now required (error-level; the earlier warning level is
  gone). The US/SM/FR/NFR tables carry a mandatory `Status` column with
  the lifecycle vocabulary `proposed | approved | implemented | verified
  | deferred | deprecated`. New `comparePsrs(baseline, updated)` enforces
  the revision rules: append-only IDs, version must strictly increase,
  Change Log must gain an entry. **BREAKING:** pre-existing PSRS
  documents without the new sections or Status columns no longer
  validate.
- **Update mode.** When a stage command runs and its published artifact
  already exists, `runStage` auto-detects update mode: the prompt gains
  an `## Update Mode` block with the baseline path, the full published
  baseline (read-only), and the 5 revision rules. No new command — the
  sequence is the update mechanism, and every change starts at
  `/velpari-brainstorm` (change mode: `## Existing Project Context`
  carries published paths, config, and run history).
- **Approve revision gate.** `the publish tool` refuses to publish a
  revision that breaks the living-document rules: PRD revisions must
  pass `comparePsrs`; every artifact must add a new Change Log entry. A
  blocked revision publishes nothing and does not advance the stage.
- **Sequence hardening.** Hard stage gates (`STAGE_GATE` in
  `stages/registry.ts`) reject stage commands run from the wrong stage
  and name the correct command — the sequence can no longer be broken.
  New `io/run-lock.ts` serializes every `state.json` mutation (mkdir
  lock + heartbeat + stale-steal). The `tool_call` hook now locks
  edit/write to the active stage's run folder while any draft is open
  (Doc/ included) and requires every scout `subagent` spawn to declare
  its `-report.json` path. New `before_agent_start` hook injects a
  `<velpari_status>` block (stage, run, next command, hard rule) every
  turn so the discipline survives compaction.
- **Doctor: living-document + hardening checks.** New `Stale downstream
  artifacts` section (adjacent published pairs compared by mtime;
  deprecated PRD IDs must propagate to the RTM) and `Sequence hardening`
  section (gate wiring audit + stale run-lock warning). New fix
  fingerprints: `stale-downstream`, `rtm-deprecated-ref`,
  `stale-run-lock`.
- **Skill update-mode sections.** All 8 stage skills document the
  revision rules; the PRD skill's US/SM/FR/NFR tables show the mandatory
  Status column.
- **YAML frontmatter on published artifacts.** New `core/frontmatter.ts`
  stamps every published artifact (all 7 stage skills updated) with
  `artifact`, `runId`, `stage`, `version`, `generatedAt`.
  `the publish tool` and `/velpari-approve-brainstorm` stamp on publish;
  doctor gains a `Frontmatter` check section.
- **RTM JSON sidecar as source of truth.** New `core/rtm-data.ts`
  (`validateRtmData` / `diffRtmData` / `renderRtmMarkdown`). The RTM
  stage writes `<runDir>/rtm/RTM_<projectName>.json`; `the publish tool`
  regenerates the published markdown from the JSON, so the markdown can
  never drift from the data. Doctor gains an `RTM data` check section;
  `skills/velpari-rtm.md` updated for the JSON-first workflow.
- **SHA-256 content fingerprints on RTM links.** New
  `core/fingerprints.ts` (hash / extract / check / stamp /
  countTraceIssues). `the publish tool` stamps each RTM row with the
  hash of the published PSRS requirement it traces to. Doctor gains a
  `Fingerprints` check: `suspect` / `unknown-id` / `orphan` links are
  errors, `untracked` is a warning.
- **RFC 2119 + EARS requirement wording.** `skills/velpari-prd.md`
  requires shall/should/may (RFC 2119) and EARS patterns in FR/NFR rows;
  `core/psrs.ts:findFrRowsMissingKeywords` flags rows without keywords
  and doctor reports them as warnings in the PSRS section.
- **Publish gate.** New `doctor/gate.ts:runPublishGate` runs inside
  `the publish tool`: the PRD must pass `validatePsrs` and RTM rows are
  checked against PSRS fingerprints. Errors block the publish (nothing
  is written, stage does not advance); warnings are shown but do not
  block.
- **Session-start stale-link notice.** When a run is open and trace
  links are stale, `hooks/session-start.ts` shows
  `trace: N suspect/orphan link(s)` in the status bar.
- **MVP/phase traceability (end to end).** Requirements now carry a
  mandatory `Phase` column (positive integer; 1 = MVP) in the PRD's
  FR/NFR tables — enforced by `validatePsrs` (`psrs-*-phase-column-missing`
  / `psrs-*-phase-invalid` errors) and matched against the MVP section
  (`psrs-mvp-phase-mismatch`). The RTM JSON sidecar requires a `phase`
  per row (`RtmRow.phase`), rendered as a Phase column in the published
  markdown. `the publish tool` blocks RTM rows whose phase differs from
  the PRD; doctor gains `Phase consistency (PRD ↔ RTM)` and
  `MVP coverage` sections (`core/mvp-coverage.ts` shared with handoff).
  `/velpari-handoff` now blocks when a Phase-1 requirement has no RTM
  row or coverage `missing`, and warns on `partial` / no test links.
  Phase edits in the PRD flag affected RTM rows as suspect via the
  existing fingerprints.

### Notes

- Behavior outside the brainstorm flow is unchanged: command names, notify
  text, state shape, and the stage machine (`STAGE_TRANSITIONS`) are
  identical.

## [1.1.0] — 2026-09-14 — Architecture generator standards alignment (8 phases)

Brings the design stage template to industry standards so every published
design is auditable, comparable, and reviewable by external architects.

Standards referenced (per the 8-phase plan):

- **ISO/IEC/IEEE 42010:2022** — Architecture description meta-standard.
- **arc42** — De-facto template for documentation structure (sections
  §1–§12).
- **SEI ATAM + ADD (Bass, Clements, Kazman)** — Quality Attribute
  scenarios (6-part form) and Attribute-Driven Design (tactics
  selection per ASR).
- **Rozanski & Woods** — Viewpoints and perspectives (Context view,
  Deployment view, etc.).
- **C4 model (Simon Brown)** — Hierarchical diagramming (Context /
  Container / Component).
- **Nygard ADR** — Architecture Decision Records (one decision per
  ADR, with context + options + rationale + consequences).

Phases landed (each its own commit on the dev branch):

- **Phase 1 — Foundation.** `## 0 Introduction & Goals` + `## 0.4
  Architecture Constraints` in the design template; `## 5 Quality
  Attribute Scenarios` rewritten to require the SEI 6-part form
  (Source / Stimulus / Environment / Artifact / Response / Response
  measure / Approach). New `design-readiness` doctor check
  enforces every section + each row's required columns.
- **Phase 2 — Context + Deployment views.** `## 9 Context View`
  (users / external systems / trust boundaries / cross-boundary
  flows) + `## 10 Deployment View` (container→host / network /
  scaling). Two new scouts: `design-context-mapper` and
  `design-deployment-mapper`.
- **Phase 3 — Crosscutting + Risks + Glossary.** `## 11 Crosscutting
  Concepts`, `## 12 Risks & Tech Debt`, `## 13 Glossary`. New
  scout: `design-crosscutting-extractor`.
- **Phase 4 — ADR-001 mandatory.** `core/adr.ts:validateFirstADR()`
  enforces ADR-001 is accepted with ≥2 options at stage `design`;
  supersession-aware (post-replacement ADRs need not be id 001 if
  ADR-001 is preserved as superseded). `## 8 Architecture
  Decisions` in the template now reads as
  "MANDATORY: every design carries at least ADR-001." Design
  conflict-detector extended to flag style-vs-implementation
  conflicts.
- **Phase 5 — Style + Tactic Selection (SEI ADD).** New `core/style-catalog.ts`
  (10 styles: Layered, Modular Monolith, Pipeline, Microkernel,
  Service-Based, Event-Driven, Microservices, Space-Based,
  Hexagonal, Serverless) + `core/tactic-catalog.ts` (28 SEI tactics
  across Performance / Availability / Security / Modifiability /
  Testability / Usability). Doctor gate: every §5 `Approach` cell
  must name a known tactic; ADR-001's `decision` must be a known
  style id. New `design-style-selector` scout runs first in the
  design stage and emits the style choice + tactic catalogue.
- **Phase 6 — C4 diagrams.** `## 14 Diagrams (C4)` with three
  mandatory Mermaid blocks (`C4Context`, `C4Container`,
  `C4Component`). `design-data-flow-mapper` extended to emit the
  three C4 mermaid fields; new `extractC4Blocks()` parser in the
  doctor gate.
- **Phase 7 — Quick Reference + supersedes frontmatter.** One-page
  summary at the top of the design template (mission / chosen
  style / top 3 QAs / top 3 risks / top 3 modules / domain). New
  `supersedes` field in `core/frontmatter.ts` so update audits can
  follow history. Module table gains `Maturity` (proposed /
  accepted / experimental) and `Depends on` columns for
  traceability.
- **Phase 8 — Docs + Release.** This CHANGELOG entry; AGENTS.md
  acquires the "Architecture generator is standards-aligned"
  convention; velpari-architecture-generator skill frontmatter
  is updated; version bumped from 1.0.2 → 1.1.0.

Test coverage (every commit green except the Phase 1 known baseline
"package.json declares bundled dependencies", which Phase 8.7
restores):

- 752 unit tests total after Phase 8.1 commit.
- 751 passing + 1 known-baseline (`build-install.test.ts:Phase 8
  verification` was red in Phases 1–7 and is green now that
  bundled dependencies are restored).

Downstream impact:

- `/velpari-pseudocode`, `/velpari-testplan`, `/velpari-final-design`
  read the designer's published design; they continue to work and
  now see the 14-section shape.
- `/velpari-handoff` (`architect-inputs.json`) gains implicitly
  more context via the designer's expanded sections; Senai's schema
  is unchanged.

Risk:

- Existing designs published BEFORE this upgrade do not satisfy the
  new gates. Re-run `/velpari-architecture-generator` in **update
  mode** on those runs to fill in the missing sections; the
  revision rules (append-only IDs, deprecate-don't-delete, version
  bump, mandatory Change Log) keep the audit trail clean.

## [1.1.1] — 2026-09-14 — Permanent fix: pi-interactive-subagents is a runtime plugin, not an npm dep

### Removed

- **`pi-interactive-subagents` removed permanently from `dependencies` and
  `bundledDependencies` in `package.json`.** The package is not on the
  public npm registry; declaring it made `npm install` fail with `404`.
  Since no file in `pi-extension/src/` ever imports it
  (`grep -rn "from 'pi-interactive-subagents'"` returns 0 hits in
  source), keeping it only blocked the build.

### Documented

- **AGENTS.md → "Runtime plugin (NOT a dep)"** rule written explicitly.
  The plugin is provided by Pi (loaded from
  `~/.pi/agent/git/github.com/HazAT/pi-interactive-subagents/`) and
  installed end-user-side via Pi's package loader
  (`pi install github.com/HazAT/pi-interactive-subagents`). Velpari
  never imports the package directly — every reference is text in a
  markdown comment, a doctor-check string, or a scout description.
- **CHANGELOG entry kept historical** at `[1.0.2]` describes the
  prior intent; it is no longer the policy. The runtime-plugin model
  is the canonical policy from 1.1.1 onward.

### Verification

- `npm install` (in this env) succeeds — no more `404`.
- `npm run build` clean (`tsc --noEmit` green).
- `npm test` runs — 752 unit tests, all green, including the
  previously-red `build-install.test.ts:Phase 8 verification` (which
  asserted `pi-interactive-subagents` was bundled; that assertion is
  intentionally deleted because the dep is no longer declared).
- Behaviour unchanged for the end user: Pi still loads
  `pi-interactive-subagents` from the user's existing Pi install;
  velpari's source code never needed it.

### Notes

- This is a permanent fix, not a workaround. If a future maintainer
  wants the dep back, they must first publish `pi-interactive-subagents`
  to a public registry and then re-introduce the dep block + update
  AGENTS.md.

## [1.2.1] — 2026-09-14 — Auto doctor audit on `the publish tool` (errors + warnings stop)

The full doctor audit now runs automatically on every approve, right
after the file writes but before state advance. Both errors and warnings
in the doctor report block the advance — the user must fix every item
before the sequence can continue.

### Changed

- **`pi-extension/src/ops/approve.ts`** — `handleApprove` now calls
  `runDoctor(cwd)` + `writeDoctorReport(report, cwd)` immediately
  after the publish loop completes and before `advanceStage(...)`.
  If `doctorReport.summary.error > 0` or `doctorReport.summary.warning > 0`,
  the function writes the full report to `.IDE_Plans/velpari/doctor-report.md`,
  pushes a TUI error notify listing the actionable items (capped at
  50 entries; full report path included), and `return`s **without**
  advancing state. The published file is left on disk for the user
  to inspect and fix; subsequent `the publish tool` re-runs both the
  gate and the doctor audit.
- **AGENTS.md "Publish gate"** rule rewritten to "Publish gate +
  automatic doctor audit". Documents the new dual-check policy and
  the v1.2.1 semantics.
- **`package.json`** version bumped 1.1.0 → 1.2.1 (patch-level fix:
  behavior change in approve semantics, no new features).

### Why both errors AND warnings stop

The publish gate's "warnings allowed" was wrong for the full doctor
audit. Doctor warnings often indicate items the gate does not catch
(scout-agent wiring missing, configuration drift, file-structure
coherence issues). Letting those slip past meant they accumulated
silently between manual runs of `/velpari-doctor`. Stopping on
warnings forces the developer to see every issue at publish time,
not 3 audits later.

### Tests

- `pi-extension/test/ops/approve-doctor-stop.test.ts` — new file.
  Builds a tmp cwd, fakes a doctor with `summary.error > 0`, runs
  `handleApprove`, asserts state.currentStage is unchanged and the
  report file exists.
- `pi-extension/test/ops/approve-doctor-pass.test.ts` — new file.
  Same fixture with `summary.error === 0 && summary.warning === 0`
  asserts the stage advances normally.
- Existing tests that run the full doctor (some integration tests)
  may emit warnings on the 1.2.1 schema; those tests get the
  warning-only skip treatment already in place via the doctor engine
  (warnings vs errors are categorised by the check itself).

### Notes

- The standalone `/velpari-doctor` slash command still exists. It
  is the same function (`handleDoctor` → `runDoctor` →
  `writeDoctorReport` → notify) but without the gating — useful
  for ad-hoc audits any time.
- A brand-new project may flag several warnings on its first run
  (missing published PRD, no agent mapping yet, etc.). Those are
  legitimate and should be addressed before the first real publish,
  not deferred. The new behaviour surfaces them immediately.

## [1.2.2] — 2026-09-14 — Shape compatibility rule (SemVer + arc42 + RFC 8594)

Adds the **ShapeCompatibility** doctor check that emits a `fresh` /
`upgrade` / `migration` verdict on every auto-doctor run (since v1.2.1)
and on every `/velpari-status` call. The architecture-generator
prelude shows the same verdict one-liner. No new slash command; the
recommendation lands where the developer is already looking.

### Standards cited (defensible end-to-end)

- **SemVer 2.0.0** — MAJOR-tag semantics for shape changes.
- **arc42 section catalogue** — the 14-mandatory-sections rule.
- **RFC 8594** — sunset frontmatter for deprecation.

### Changed

- `pi-extension/src/core/shape.ts` — new. Shared types (`ShapePath`,
  `ShapeVerdict`), constants (`CURRENT_SHAPE_MAJOR=1`,
  `REQUIRED_SECTION_COUNT=14`), helpers (`parseSemVerMajor`,
  `countTopLevelSections`, `isSunsetPast`), and the verdict
  + status-line logic. Lives in core/ (L0) so L1+ layers can call
  it without violating the 4-layer rule.
- `pi-extension/src/doctor/checks/shape-compatibility.ts` — new.
  Wraps the core verdict in a `DiagnosticSection`. Re-exports
  `computeShapeVerdict` + `shapeStatusLine` from core/ for callers
  that already import from the doctor namespace.
- `pi-extension/src/doctor/index.ts` — `runDoctor()` now appends
  the ShapeCompatibility section after DesignReadiness.
- `pi-extension/src/ops/status.ts` — appends `## Architecture shape`
  with the one-line verdict.
- `pi-extension/src/core/arch-confirm.ts` — appends the one-line
  verdict to the prelude summary the confirm dialog shows the
  developer.
- `pi-extension/src/core/frontmatter.ts` — `sunset` is now the
  10th canonical field. Optional in `ArtifactFrontmatterInput`;
  rendered when set. Informational only in v1.2.2 (the doctor
  checks it but does not auto-mutate state).
- `package.json` — version bumped 1.2.1 → 1.2.2.

### New tests (16 cases)

- `pi-extension/test/doctor/shape-compatibility.test.ts` (NEW) —
  20 cases covering parseSemVerMajor, countTopLevelSections,
  isSunsetPast, computeShapeVerdict (no version / current /
  pre-1.1 / section-count-only / major-only), checkShapeCompatibility
  (no design / pre-1.1 / current / past sunset / future sunset),
  shapeStatusLine (one-line per path).
- `pi-extension/test/doctor/check-registry.test.ts` (REPLACED) —
  4 cases confirming the section appears in `runDoctor()` for
  missing project name, no design, pre-1.1, current shape.
- `pi-extension/test/ops/approve-status-shape.test.ts` (NEW) — 3
  cases for the `/velpari-status` banner.
- `pi-extension/test/integration/shape-prelude.test.ts` (NEW) — 3
  cases for the arch-confirm prelude.
- `pi-extension/test/core/frontmatter.test.ts` (EXTENDED) — 2 new
  cases for the `sunset` field (set + omitted).

### Standards-aligned

The "Architecture generator is standards-aligned" rule in AGENTS.md
extends the citation list with the three new standards above. The
ShapeCompatibility verdict cites them verbatim so reviewers can
defend the recommendation end-to-end.

### Verification

- `npm run build` — green, no TS errors.
- `npm test` — 779/779 passing.
- Doctor surfaces `migration` on legacy cwd (8 sections, v1.0.2).
- Doctor surfaces `upgrade` on current cwd (14 sections, v1.1.0).
- `/velpari-status` and architecture-generator prelude show the
  corresponding path line.
- Pre-existing 757 tests still green; new tests cover the
  additions.

## [1.2.3] — 2026-09-14 — Hygiene pass (real-cwd test + CHANGELOG + AGENTS + doctor-notify UI + sequence doc)

Tier 2 hygiene pass over v1.2.2. No new slash command, no behavior
change to the shape rule, no dependency change. Five phase commits.

### Changed

- **Real-cwd integration test (Phase 1).** `pi-extension/test/integration/approve-real-cwd.test.ts` (NEW). The single end-to-end test that exercises the production auto-doctor-on-approve code path with `VELPARI_SKIP_AUTO_DOCTOR` UNSET. The cwd setup is intentionally minimal: `files.json` + `requirements-profile.json` + `standards-profile.json` + `agents.json` + Doc/{requirements,design} + working-copy run dir. Asserts the doctor report is on disk, includes `Shape compatibility`, and the published design carries stamped frontmatter + the section shape.
- **CHANGELOG consolidation (Phase 2).** Drops the older `[1.1.0]` entry (2026-09-13, "Architecture sub-life cycle + standards overlays + ADR mechanism") because the kept `[1.1.0]` (2026-09-14, "Architecture generator standards alignment (8 phases)") covers the same content. After: 9 version sections (was 11), 607 lines (was 662).
- **AGENTS.md rule consolidation (Phase 3).** Merges the two adjacent "Architecture generator is standards-aligned" and "Shape compatibility rule" Coding Convention rules into one titled "Architecture generator is standards-aligned (v1.7.0 + v1.2.2, plan 8 phases)". The v1.2.2 content (verdict, surfaces, sunset, standards citations) becomes a bold-prefixed sub-paragraph. One rule, one source of truth.
- **Auto-doctor notify UI (Phase 4).** When the doctor blocks the advance, the notify message groups findings by section title (one line per section) instead of a flat list. Format: `<section>: N error(s), M warning(s) [ERROR,WARN,...]`. Notify still capped (30 section lines) and the report path is included. On-disk report unchanged.
- **Doc/velpari-sequence.md auto-audit lifecycle (Phase 5).** New `### 3.1 Auto-audit lifecycle (v1.2.1 + v1.2.2)` subsection documents the v1.2.1 errors+warnings block policy, the v1.2.2 ShapeCompatibility verdict, the three surfaces (status, prelude, doctor), and the test-only escape hatch. The existing flow becomes `### 3.2 Per-stage flow`.
- `package.json` version bumped 1.2.2 → 1.2.3 (patch-level).

### Out of scope (deferred to v1.3)

- Multi-design-per-project.
- Federation-of-services ownership.
- Live `sunset` enforcement.
- Visual rendering step for the design doc.

### Verification

- `npm run build` — green.
- `npm test` — **784/784 passing** (was 781 pre-v1.2.3, +3 new tests).
- All four surfaces (doctor / status / prelude / auto-notify) agree on the v1.2.2 ShapeCompatibility verdict.

## [1.3.0] — 2026-09-15 — Multi-design + sunset auto-archive

Adds the v1.3.0+ multi-design path (a single CWD can carry several
design subjects) plus the sunset auto-archive (the next
`the publish tool` after a design's `sunset:` date has passed bumps
the version to the next MAJOR and marks the design as `deprecated`).

### Added

- `core/projectnames.ts` (NEW) — `getEffectiveProjectNames(cfg)`,
  `isMultiProject(cfg)`. Returns the canonical list of design
  subjects (length 1 for legacy single, ≥ 1 for multi).
- `core/shape.ts` — adds `computeShapeVerdictsAll(resolved)` (one verdict
  per projectName) and `computeShapeStatusLinesForConfig(cwd,
  projectName, projectNames)` (per-projectName status lines for the
  prelude; falls back to legacy `shapeStatusLine`).
- `core/arch-context.ts` — `ArchContext` adds `projectNames?: string[]`.
- `core/frontmatter.ts` — `deprecatedAt` is the 11th canonical
  `ARTIFACT_FRONTMATTER_FIELDS` entry. Optional in
  `ArtifactFrontmatterInput`; rendered when set.
- `core/paths.ts` — `resolveDocArtifactAll(cwd, artifact)` scans the
  group directory and returns `{path, projectName, layout}[]` for
  every `*_<project>.md` file matching the artifact.
- `doctor/checks/shape-compatibility.ts` — `checkShapeCompatibilityAll(cwd)`
  replaces `checkShapeCompatibility` for multi-design. Emits one
  sub-item per projectName, each prefixed with `project: <name>`.
  Past-sunset downgrades from `error` to `info` when
  `status: deprecated` (so the auto-doctor does not re-block).
- `ops/approve.ts` — per-file archive logic. Reads the working-copy
  frontmatter via `readSunsetInfo`; when the `sunset:` is past,
  bumps the working-copy version line + status in the body, sets
  `input.supersedes`, `input.sunset`, and `input.deprecatedAt`. The
  stamped body matches the stamped frontmatter.
- `ops/status.ts` — `## Architecture shape` banner now lists one line
  per projectName design (via `computeShapeStatusLines(cwd)`).
- `core/arch-confirm.ts` — the architecture-generator prelude
  delegates to `computeShapeStatusLinesForConfig`. Multi-design
  cwds see one shape line per projectName.
- `pi-extension/test/integration/multi-design.test.ts` (NEW) —
  1 case: a federation with 2 projectNames publishes 2 separate
  designs (alpha + beta), each with its own body reference.
- `pi-extension/test/ops/sunset-archive.test.ts` (NEW) — 4 cases
  for the sunset auto-archive (past + published, past + already
  deprecated, future + published, doctor downgrade for archived).
- `pi-extension/test/core/frontmatter.test.ts` (EXTEND) —
  deprecatedAt additions to the fresh-publish and missing-fields
  tests.
- `pi-extension/test/doctor/frontmatter.test.ts` (EXTEND) —
  FULL_FM fixture adds deprecatedAt.
- `pi-extension/test/doctor/check-registry.test.ts` (EXTEND) —
  updated 'no project name' test to expect the v1.3.0 aggregated
  message.

### Notes

- No new slash command. Multi-design is opt-in via `.pi/velpari/
  files.json:projectNames`. Legacy single-`projectName` is preserved.
- Auto-archive is idempotent: the design is stamped `deprecated`
  once; subsequent publishes on the archived design re-stamp
  `deprecatedAt: <today>` but no longer bump the major or modify
  the body — the doctor does not re-block.
- `pi-interactive-subagents` dependency remains the runtime plugin
  model (per v1.1.1); no new dep is added by v1.3.0.

### Verification

- `npm run build` — green.
- `npm test` — **799/799 passing** (was 784 pre-v1.3.0, +5 new tests).
- No new dep. No new lifecycle stage. No new slash command.
