# `stages/atomic-function/` — Layer contract

This file is for AI agents and human contributors working inside `stages/atomic-function/`. The root `pi-extension/src/AGENTS.md` covers the whole extension source; this one is scoped to the atomic-function dedicated layer.

## Purpose

Atomic-function is Stage 6 of the Velpari sequence — required, runs after Design (Stage 5) is approved. It decomposes the published design + upstream artifacts into a list of small, leaf-node, testable atomic functions, then publishes them to `Doc/atomic-functions_<projectName>.md` (via the `velpari_stage_publish` tool, which calls `handleApprove` internally). The manual fallback command `/velpari-atomic-function-approve` runs the same gate chain.

This layer exists because atomic-function is the **only stage** with a tier-driven schema (ISO/IEC 29110 + IEC 61508 / IEC 62304), the only stage with a **reviewer sub-agent** (adversarial critic), and the only stage where the parent LLM's life cycle is broken into 7 distinct phases that all need clean separation of concerns.

## Layer rule

This folder is **Layer 1** (stage logic). Every file may import from `core/` and `io/` only. **Never import upward** (no imports from `ui/`, `hooks/`, `commands/`, `stages/atomic-function.ts` itself). Enforced by `pi-extension/test/architecture-alignment.test.ts`.

Same-layer imports between the 7 phase files are allowed (e.g. `pre-condition.ts` may import from `merge.ts` for `requiredFieldsFor`).

## The 7 phases (this layer is a LIBRARY, not a runtime)

Atomic-function's life cycle is decomposed into 7 phases. Each phase owns its inputs, outputs, and tests. After the v1.5.0 one-command publish upgrade, the **layer is the library** — the runtime entry point is `velpari_stage_publish` (registered in `stages/stage-publish-tool.ts`), shared by all 9 stages.

| # | Phase | File | Responsibility |
|---|---|---|---|
| 1 | Pre-condition | `pre-condition.ts` | Stage gate + state load + atomic profile derivation + reviewer gate decision |
| 2 | Prompt assembly | `prompt.ts` | Build stage prompt with `## Atomic Profile` + `## Update Mode` blocks |
| 3 | Scout dispatch | `scout-dispatch.ts` | Bootstrap agents, build scout slots, apply reviewer filter |
| 4 | Reviewer (helpers) | `reviewer.ts` | Verdict type + schema guard + doctor-gate mapping |
| 5 | Merge (tier schemas) | `merge.ts` | `BASE_CORE_FIELDS` + `TIER_FIELDS` + `requiredFieldsFor(tier)` |
| 6 | Preview | `preview.ts` | Preview prompt template + `formatPreviewQuestion()` |
| 7 | Publish (library helper) | `publish.ts` | Re-exports `PUBLISH_PHASE_STATUS = "library-helper"` + `PUBLISH_DELEGATED_TO = "velpari_stage_publish"`. Runtime work lives in `ops/approve.ts` (called by the tool). |

## Sequence

```
state = designed (or analyzing-atomic-functions for redraft)
        │
        ▼
  PHASE 1 — pre-condition.ts       (library)
        │  STAGE_GATE check, loadState, deriveAtomicProfile, shouldRunReviewer
        ▼
  PHASE 2 — prompt.ts              (library)
        │  build prompt with ## Atomic Profile + ## Update Mode
        ▼
  PHASE 3 — scout-dispatch.ts      (library)
        │  bootstrap agents, build slots, apply reviewer filter
        ▼
  parent LLM (driven by skills/velpari-atomic-function.md)
        │
        ├── PHASE 4 — reviewer.ts    (library helpers for parent LLM)
        │   verdict schema + handling
        ▼
        ├── PHASE 5 — merge.ts       (library helpers for parent LLM)
        │   tier-aware schema builders
        ▼
        ├── PHASE 6 — preview.ts     (library helpers for parent LLM)
        │   AskUserQuestion preview gate
        ▼
  user says "yes"
        │
        ▼
  parent LLM calls velpari_stage_publish (stages/stage-publish-tool.ts)
        │
        ▼
  ops/approve.ts:handleApprove (single source of publish truth)
        │  publish gate → atomic publish to Doc/ → doctor audit → advanceStage
        ▼
  Doc/atomic-functions/<projectName>.md published
  state = analyzed-atomic-functions
  next command: /velpari-pseudocode
```

## What lives where

| Concern | Location |
|---|---|
| Stage command registration | `commands/atomic-function.ts` (Layer 3 — composition root) |
| Stage gate + scout slot config | `stages/registry.ts:STAGE_GATE`, `STAGE_REGISTRY["atomic-function"]` (Layer 1 — registry) |
| Generic stage runner | `core/stage-runner.ts:runStageWithScouts` (Layer 0 — domain) |
| Atomic profile schema | `core/atomic-tier.ts` (Layer 0 — domain) |
| Reviewer verdict source of truth | `doctor/checks/atomic-tier.ts` (Layer 1 — diagnostics; consumer of the JSON, never writer) |
| Parent LLM orchestration program | `skills/velpari-atomic-function.md` (bundled skill) |
| Reviewer agent definition | `skills/agents/reviewer.md` (bundled agent) |
| Reviewer orchestration program | `skills/velpari-reviewer.md` (bundled skill) |

## Refactor plan

This folder is created incrementally across 8 phases (see `.IDE_Plans/atomic-function-layer_plan_20260916_2349_v1.0.md`). Each phase = one commit + tests + build check.

| Phase | Lands |
|---|---|
| 1 | Layer skeleton (this commit) |
| 2 | Pre-condition extraction |
| 3 | Prompt extraction |
| 4 | Scout dispatch extraction |
| 5 | Reviewer types + helpers |
| 6 | Tier schema helpers |
| 7 | Preview helper |
| 8 | Composer wiring + delete legacy file |

## Adding a new phase file

1. Create `stages/atomic-function/<phase>.ts` with the typed `run*` function and explicit input/output types.
2. Update the phase table above.
3. Add unit tests under `pi-extension/test/stages/atomic-function/<phase>.test.ts`.
4. Wire the phase into `index.ts` (composer) at the correct position in the sequence.

## Out of scope

- **Phase 7 publish** — `publish.ts` is a library helper (Option B). The runtime publish work lives in `ops/approve.ts:handleApprove`, called by `velpari_stage_publish` after the parent LLM gets "yes" at the preview gate. All 9 stages share this runtime entry point. See plan §"Plan B — Option B".
- **Reviewer at other stages** — only atomic-function uses the reviewer today. Plan D will generalize.
- **Self-contained pattern generalization** — already done for ALL 9 stages via the `velpari_stage_publish` tool. Plan C is complete (covered by the v1.5.0 cherry-pick).