# Changelog

All notable changes to this project will be documented in this file.

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
  transitions land in `STAGE_TRANSITIONS`. `/velpari-approve` publishes
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
  `/velpari-approve` hard-blocks a feasibility publish until the session
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
- **Approve revision gate.** `/velpari-approve` refuses to publish a
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
  `/velpari-approve` and `/velpari-approve-brainstorm` stamp on publish;
  doctor gains a `Frontmatter` check section.
- **RTM JSON sidecar as source of truth.** New `core/rtm-data.ts`
  (`validateRtmData` / `diffRtmData` / `renderRtmMarkdown`). The RTM
  stage writes `<runDir>/rtm/RTM_<projectName>.json`; `/velpari-approve`
  regenerates the published markdown from the JSON, so the markdown can
  never drift from the data. Doctor gains an `RTM data` check section;
  `skills/velpari-rtm.md` updated for the JSON-first workflow.
- **SHA-256 content fingerprints on RTM links.** New
  `core/fingerprints.ts` (hash / extract / check / stamp /
  countTraceIssues). `/velpari-approve` stamps each RTM row with the
  hash of the published PSRS requirement it traces to. Doctor gains a
  `Fingerprints` check: `suspect` / `unknown-id` / `orphan` links are
  errors, `untracked` is a warning.
- **RFC 2119 + EARS requirement wording.** `skills/velpari-prd.md`
  requires shall/should/may (RFC 2119) and EARS patterns in FR/NFR rows;
  `core/psrs.ts:findFrRowsMissingKeywords` flags rows without keywords
  and doctor reports them as warnings in the PSRS section.
- **Publish gate.** New `doctor/gate.ts:runPublishGate` runs inside
  `/velpari-approve`: the PRD must pass `validatePsrs` and RTM rows are
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
  markdown. `/velpari-approve` blocks RTM rows whose phase differs from
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
