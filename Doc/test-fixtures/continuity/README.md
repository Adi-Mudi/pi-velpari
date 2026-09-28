# Continuity dry-run fixture (N25)

Gate-shaped fixture project for the Phase-E continuity dry-run
(`scripts/e2e-continuity-dryrun.mjs` + `pi-extension/test/e2e/continuity-dryrun.e2e.test.ts`).

Everything here is INPUT ONLY — the driver copies what it needs into a
throwaway temp workspace (fresh git repo, fresh state). Nothing in this
folder is ever executed or published by the repo's own tests directly.

## Layout

| Path | Purpose |
|---|---|
| `config/files.json` | Shipped-default project config (no `velpari` key → DB-only publish, markdown OFF) |
| `brainstorm/brainstorm-notes.md` | Run-folder notes (`<runDir>/brainstorm/brainstorm-notes.md`) — 7 required sections |
| `<workingDir>/` per stage | Working copy `*.md` + `payload/<kind>-payload.json`, named exactly as `STAGE_APPROVE_MAP.workingDir` |
| `expected-failures.json` | Known-defect ledger (user ruling 2026-09-28): assertions that reproduce a filed N24 defect |

Working-copy folders: `prd`, `rtm`, `feasibility`, `design`,
`atomic-functions`, `pseudocode`, `tests` (test-plan + test-cases),
`development-order`, `final-design`.

## Contracts the fixture satisfies

1. **PSRS**: `prd/PRD_ContinuityApp.md` carries all 20 sections, the FR/NFR
   tables with `Phase` + `Status` columns (FR-01..03, NFR-01..02).
2. **RTM fingerprints**: `rtm/payload/rtm-payload.json` rows carry the exact
   `targetSha256` of the corresponding PRD requirement substance
   (`core/fingerprints.ts:extractRequirementFingerprints`) and cover EVERY
   PRD id (orphan/unknown-id block the gate; suspect is a doctor error).
3. **Feasibility v2**: 13 numbered sections + a real verdict word
   (`Final: Go`). The decision row itself comes from the settled
   `state.feasibilitySession` at approve time (adapter merges it).
4. **Design**: §0 + §0.4 + §5 QA table (8 required columns, `cache` tactic),
   §9–§14 incl. C4 blocks, `## Architecture Decisions` with a valid
   accepted ADR-001 style choice (≥2 options), and the id-coverage cells
   (Module Breakdown `Source FRs` = FR-01..03; QA `NFR ID` = NFR-01..02).
   `state.archSubCycle` (`contextLoaded` + `developerConfirmed`) is set by
   the driver before publish.
5. **ID coverage**: pseudocode mentions `AF-01..03`; test-cases mentions
   `FR-01..03` + `AF-01..03`; development-order lists every `AF-*` once per
   step (`AFs:` lines).
6. **Payloads**: envelope `version ≥ 1` + non-empty `stage`/`generatedAt`;
   row sets mirror `ops/stage-payloads.ts:ROWS_BY_KIND` (unknown fields
   rejected). The development-order payload has `devStep`/`stepDep`/`stepAf`
   but NO `devLane` rows — publish-time `finalizeDevLanes` computes the
   canonical lane map (exercises `buildLaneName`, so the N36 naming change
   flows through this fixture automatically).
7. **Git**: the driver inits a repo + pins identity (publish precheck).

## Known-defect ledger

The dry run runs in the SHIPPED DEFAULT mode (DB-only). Two filed Phase-1
defects make parts of the chain behave differently from the plan's ideal
assertions; the driver logs them as `KNOWN-FAIL <id>` (exit 0) instead of a
failure, and reports `STALE LEDGER` (exit 1) if a listed defect stops
reproducing:

- `N24-01` — stage-entry transitions never advance state (the driver applies
  documented workaround W1: a manual `advanceStage` so the publish chain can
  still be exercised).
- `N24-13` — the publish gate resolves declared inputs as `Doc/*.md` while
  DB-only publishes leave only store rows (the driver applies documented
  workaround W2: after each publish it seeds the upstream markdown a
  write-alongside publish would have produced).

See `.IDE_Plans/velpari/n24-static-audit-findings_20260928.md` in the master
checkout for the full findings table.
