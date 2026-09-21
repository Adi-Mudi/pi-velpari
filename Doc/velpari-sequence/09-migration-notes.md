# 09 — Migration Notes: Finalized Sequence vs Current Implementation

The finalized sequence is documented first; the code is upgraded afterward
(sequence first, code second). This file is the bridge: every delta between
this spec and the code as it exists today. Each item needs its own
implementation plan (created later, one at a time). **No code changes are
authorized by this document.**

Legend: 🟢 small · 🟡 medium · 🔴 large

## A. Sequence & locking

| # | Delta | Size | Spec reference |
|---|---|---|---|
| A1 | **Dynamic transition lock** replaces/extends the static stage gate: legal commands computed from (state, freshness map, brainstorm-open flag); self-healing routing names the earliest stale stage in every block message. ✅ **Shipped 2026-09-20** (`stages/transition-lock.ts:computeLegalCommands` — single legal-command function; runStage gate, publish-tool whitelist, approve refusal, `before_agent_start` `next:` line, and `/velpari-status` Next line all delegate to it; earliest-stale routing + update-mode self-loop) — plan `.IDE_Plans/velpari-dynamic-lock-brainstorm-anytime_plan_20260920_2142_v1.0.md`. | 🔴 | `04` |
| A2 | **Brainstorm-anytime** removes the v2.2 single-shot-per-run guard; brainstorm becomes discussion mode from any stage with the two-door lock (continue current stage / restart at PRD). ✅ **Shipped 2026-09-20** (`RunState.pausedStage` + `openBrainstormSession` / `resumeFromBrainstorm` / `discardBrainstormSession` primitives; guard blocks only nested opens; two doors at approve via `--restart-prd` / picker / default-continue; `discard` tool action; brainstorm lock wins over stage lock per D4) — plan `.IDE_Plans/velpari-dynamic-lock-brainstorm-anytime_plan_20260920_2142_v1.0.md`. | 🔴 | `04` |
| A3 | **Freshness machinery** — input-hash stamps on every published artifact, `.pi/velpari/freshness.json` manifest, stale-set computation, stage-start + publish + handoff blocking, revise-or-reconfirm flow. Generalizes the existing RTM fingerprints + stale-downstream mtime check. ✅ **Shipped 2026-09-20** (stamps + manifest + stale-set + stage-start block + publish-gate block + doctor section; stale-downstream now hash-driven; handoff blocking stays with A6, re-confirm flow with A5) — plan `.IDE_Plans/velpari-freshness-staleness_plan_20260920_1750_v1.0.md`. | 🔴 | `03` |
| A4 | **Layer-2 ID coverage checks** generalized: PRD→design traceability, AF→pseudocode, FR/AF→test-cases, AF→dev-order DAG. (PRD→RTM coverage exists.) ✅ **Shipped 2026-09-20** (`core/id-coverage.ts` + publish-gate branch + doctor `ID coverage` section + skill-template references; legacy `not-checkable` = warning per D1, dev-order duplicate = warning per D2) — plan `.IDE_Plans/velpari-id-coverage-handoff_plan_20260920_2055_v1.0.md`. | 🟡 | `03` |
| A5 | **Re-confirm path** — "reviewed, no impact" re-stamp + mandatory Change Log line; new tool/command surface. ✅ **Shipped 2026-09-21** (`/velpari-reconfirm` — 41st command: `commands/reconfirm.ts` picker over `input-changed` items only (D2/D4), `ops/reconfirm.ts` audit triple: mandated Change Log line with upstream frontmatter version, manifest re-stamp with `hashv: 2` normalized hashing (Change Log excluded, D3) + `reconfirmedAt` + RTM `extraPaths` recompute (D6), history entry (D5); consumer texts name both paths) — plan `.IDE_Plans/velpari-reconfirm-ci_plan_20260920_2309_v1.0.md`. | 🟡 | `02`, `03` |
| A6 | **Handoff strengthened** — blocks on any staleness (not just MVP coverage errors); validates the package is self-contained. ✅ **Shipped 2026-09-20** (staleness block via `computeStaleSet` + ID-coverage block, both between MVP coverage and payload build; no-stamp = warning per D8; Layer-3 at handoff stays a future item) — plan `.IDE_Plans/velpari-id-coverage-handoff_plan_20260920_2055_v1.0.md`. | 🟢 | `01`, `03` |

## B. State & files

| # | Delta | Size | Spec reference |
|---|---|---|---|
| B1 | **Move control files to `.pi/velpari/`**: `state.json` + run lock from `.IDE_Plans/velpari/`; add `freshness.json`. Legacy-location migration on first run. ✅ **Shipped 2026-09-20** (state + lock + `freshness.json` location; freshness machinery is A3) — plan `.IDE_Plans/velpari-state-relocation_plan_20260920_1639_v1.0.md`. | 🟡 | `07` |
| B2 | **History out of `state.json`** — `history[]` moves to per-run `history.jsonl` under the run folder; state becomes config-sized. ✅ **Shipped 2026-09-20** — plan `.IDE_Plans/velpari-state-relocation_plan_20260920_1639_v1.0.md`. | 🟡 | `07` |
| B3 | **YAML sidecars** — RTM sidecar migrates JSON → YAML; new YAML sidecars for atomic functions, test cases, development order (DAG), feasibility decision record; renderers produce the published Markdown. ✅ **Shipped 2026-09-21** (registry-driven publish in `ops/approve.ts:SIDECAR_REGISTRY`; D4 dual-read for RTM; D6 require-sidecar at publish; D7 sidecar-first id-coverage; D8 dev-order DAG; D9 code-generated feasibility record) — plan `.IDE_Plans/velpari-yaml-sidecars_plan_20260921_0638_v1.0.md`. | 🟢 | `06` |
| B4 | **Frontmatter `inputs:` block** on every published artifact (Layer-1 stamps). ✅ **Shipped 2026-09-20** (renders as a JSON scalar mapping input id → SHA-256, after the canonical frontmatter fields) — plan `.IDE_Plans/velpari-freshness-staleness_plan_20260920_1750_v1.0.md`. | 🟢 | `03`, `06` |

Shipped-behavior notes for B4 + A3 (from the plan's locked decisions):

- **Logging-plan gap (D5).** The logging plan publishes outside `handleApprove`, so it is never stamped and never enumerated as a stale-able artifact. The doctor freshness section surfaces this as an info note only.
- **Severity policy (D7).** A stale declared input (`input-changed` / `input-missing`) is an **error** — stage-start hard-blocks, publish gate refuses, doctor reports errors. An unstamped input (`no-stamp`) is a **warning** — publish continues, doctor warns.

## C. Sub-agents

| # | Delta | Size | Spec reference |
|---|---|---|---|
| C1 | **Generator v2 — per-phase scope**: extend `/velpari-generate-sub-agents` from the 4 brainstorm roles to all stage roles, phase by phase; trigger = last approve of the previous phase; inputs = published `Doc/` artifacts only. ✅ **Shipped 2026-09-21** — plan `.IDE_Plans/velpari-generator-v2_plan_20260921_1105_v1.0.md` (`GENERATION_PHASES` + `phaseForStage`, phase auto-detect + `--phase N`, `GENERATOR_VERSION = 2`). | 🔴 | `05` |
| C2 | **Doctor "phase agent freshness" section**: agents exist, mapped, generated after latest publish of their input artifacts, reviewer presence per tier. ✅ **Shipped 2026-09-21** — same plan (`core/agent-freshness.ts` + doctor "Generated agent freshness" section; stale → warning, reviewer presence → error per tier policy). | 🟡 | `05` |
| C3 | **Verifier agents as Layer-3 validators**: verdict consumption at the publish gate (exists for 4 reviewer stages; extend coverage/verifier roles per phase). ✅ **Shipped 2026-09-21** — same plan (one verdict contract + `verifierSpecForArtifact` stage→verifier map driving the gate; doctor "Verifier verdicts (Layer 3)" anytime section; no new roles invented). | 🟡 | `03`, `05` |
| C4 | **v3 persistent brainstorm sessions** (auto-spawn web-research + doc-code-analyst panes, DISCUSS routing) — *deferred*. Revisit at the Stage-1 deep-dive; it fits the brainstorm-anytime model but is not required by it. The committed merge conflict in the legacy doc (`Doc/velpari-sequence.md:212–238`, retired 2026-09-20 — see git history) is resolved by this deferral decision. | — (deferred) | `04` |

## D. Documentation debt (legacy doc)

| # | Delta | Size |
|---|---|---|
| D1 | `Doc/velpari-sequence.md` (legacy, 1290 lines) contains committed merge-conflict markers (`:212–238`), a duplicated Stage-6 tier-schema section (`:323–359` + `:450–486`), and a duplicated sentence (`:12–17`). ✅ **Shipped 2026-09-20** — legacy file deleted; live pointers retargeted to `Doc/velpari-sequence/` (README as entry); content recoverable via git history. Plan `.IDE_Plans/velpari-state-relocation_plan_20260920_1639_v1.0.md`. | 🟢 |
| D2 | `AGENTS.md` references the legacy doc and the old locations (state in `.IDE_Plans/`). Update after B1–B3 land. ✅ **Done** — pointers retargeted to `Doc/velpari-sequence/` (2026-09-20, with D1); remaining stale lines (RTM sidecar wording, e2e suite count, 10b verdict-loader wording) cleaned 2026-09-21 — plan `.IDE_Plans/velpari-sequence-cleanup_plan_20260921_1430_v1.0.md`. | 🟢 |

## E. Suggested implementation order

Dependencies argue for this order (each unlocks the next):

1. **B1 + B2** — state/lock relocation + config-sized state (foundation). ✅
   **Done 2026-09-20** — plan
   `.IDE_Plans/velpari-state-relocation_plan_20260920_1639_v1.0.md`.
2. **B4 + A3** — freshness stamps + stale-set machinery (the enforcement core;
   A1, A5, A6 all hang off it). ✅ **Done 2026-09-20** — plan
   `.IDE_Plans/velpari-freshness-staleness_plan_20260920_1750_v1.0.md`.
3. **A4 + A6** — ID coverage + handoff strengthening. ✅ **Done 2026-09-20** — plan
   `.IDE_Plans/velpari-id-coverage-handoff_plan_20260920_2055_v1.0.md`.
4. **A1 + A2** — dynamic lock + brainstorm-anytime (behavior change on top of
   working staleness). ✅ **Done 2026-09-20** — plan
   `.IDE_Plans/velpari-dynamic-lock-brainstorm-anytime_plan_20260920_2142_v1.0.md`.
   (Includes the D8 re-brainstorm staling fix: the freshness manifest keys
   brainstorm entries on the base slug with `path` = latest published file,
   so an approved re-brainstorm stales the PRD/AF chain through A3.)
5. **A5** — re-confirm path. ✅ **Done 2026-09-21** — plan
   `.IDE_Plans/velpari-reconfirm-ci_plan_20260920_2309_v1.0.md`. (Includes the
   D3 normalized-hashing fix — freshness hashes exclude the `## Change Log`
   section for `hashv: 2` entries, so the mandated re-confirm line never
   re-stales downstream consumers — and the CI-on-`bug-fix` testing-protocol
   change: the full unit + e2e gate runs in GitHub Actions on push; local
   runs are targeted test files only, per the dev-machine thermal
   constraint.)
6. **B3** — YAML sidecars (format migration; independent, can interleave). ✅ **Done
   2026-09-21** — plan `.IDE_Plans/velpari-yaml-sidecars_plan_20260921_0638_v1.0.md`.
   (The D5 freshness switch — hashing sidecars instead of rendered `.md` as
   downstream inputs — stays DEFERRED as designed: sidecars join their own
   artifact's `extraPaths`; downstream declared inputs keep hashing the
   rendered markdown. A future cleanup may flip the hash target once every
   sidecar artifact is sidecar-backed in the wild.)
7. **C1 → C2 → C3** — generator v2 per phase, doctor section, verifier wiring. ✅ **Done
   2026-09-21** — plan `.IDE_Plans/velpari-generator-v2_plan_20260921_1105_v1.0.md`.
   (C1: `GENERATION_PHASES` + `phaseForStage` in `core/agents-config.ts`;
   `/velpari-generate-sub-agents` auto-detects the phase from run state,
   `--phase N` overrides, one confirmation gate per run; `GENERATOR_VERSION = 2`.
   C2: `core/agent-freshness.ts` joins generated agents against the freshness
   manifest — phase-boundary hints on approve/status, doctor "Generated agent
   freshness" section (stale → warning per D6, reviewer presence per tier
   policy → error); the completeness check now covers every generatable role.
   C3: one verdict contract + generalized loader in
   `doctor/checks/reviewer-verdict.ts`; the publish gate consumes verdicts via
   the `verifierSpecForArtifact` stage→verifier map; doctor gains the anytime
   "Verifier verdicts (Layer 3)" section with verdict-freshness reporting.)
8. **D1 + D2** — doc debt cleanup last. ✅ **Done** — D1 shipped 2026-09-20
   (legacy doc deleted); D2 + the audit-leftover stale lines closed
   2026-09-21 — plan `.IDE_Plans/velpari-sequence-cleanup_plan_20260921_1430_v1.0.md`.
9. **C4** — v3 persistent sessions, only if the Stage-1 deep-dive wants it.

Each step = one plan in `.IDE_Plans/`, executed after its own "approved".
