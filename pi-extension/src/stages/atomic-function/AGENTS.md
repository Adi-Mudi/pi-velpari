# `stages/atomic-function/` — Layer contract

For AI agents and human contributors working inside `stages/atomic-function/`. The root `pi-extension/src/AGENTS.md` covers the whole extension source; this one is scoped to the atomic-function dedicated layer.

## Purpose

Atomic-function is Stage 6 of the Velpari sequence — required, runs after Design (Stage 5) is approved. It decomposes the published design + upstream artifacts into a list of small, leaf-node, testable atomic functions, then publishes them to `Doc/atomic-functions_<projectName>.md` via the `velpari_stage_publish` tool (which calls `handleApprove` internally). The manual fallback command `/velpari-atomic-function-approve` runs the same gate chain.

## Layer rule

This folder is **Layer 1** (stage logic). Every file may import from `core/` and `io/` only. **Never import upward** (no imports from `ui/`, `hooks/`, `commands/`, or `stages/atomic-function.ts` itself). Enforced by `pi-extension/test/architecture-alignment.test.ts`.

## The 7 phases (this layer is a LIBRARY, not a runtime)

Atomic-function's life cycle is decomposed into 7 phases. After the v1.5.0 one-command publish upgrade, the **layer is the library** — the runtime entry point is `velpari_stage_publish` (registered in `stages/stage-publish-tool.ts`), shared by all 9 stages.

| # | Phase | File | Responsibility |
|---|---|---|---|
| 1 | Pre-condition | `pre-condition.ts` | Stage gate + state load + atomic profile derivation + reviewer gate decision |
| 2 | Prompt assembly | `prompt.ts` | Build stage prompt with `## Atomic Profile` + `## Update Mode` blocks |
| 3 | Scout dispatch | `scout-dispatch.ts` | Bootstrap agents, build scout slots, apply reviewer filter |
| 4 | Reviewer (helpers) | `reviewer.ts` | Verdict type + schema guard + doctor-gate mapping |
| 5 | Merge (tier schemas) | `merge.ts` | `BASE_CORE_FIELDS` + `TIER_FIELDS` + `requiredFieldsFor(tier)` |
| 6 | Preview | `preview.ts` | Preview prompt template + `formatPreviewQuestion()` |
| 7 | Publish | `velpari_stage_publish` tool (registered in `stages/stage-publish-tool.ts`) | Runtime work lives in `ops/approve.ts` (called by the tool). The former `publish.ts` marker-constant file was removed in the 2026-09-21 dead-code cleanup — it carried no runtime behavior. |

## Sequence

```
state = designed (or analyzing-atomic-functions for redraft)
  → Phase 1 pre-condition (gate + state load + atomic profile + reviewer gate)
  → Phase 2 prompt (## Atomic Profile + ## Update Mode blocks)
  → Phase 3 scout-dispatch (bootstrap + slots + reviewer filter)
  → parent LLM (skills/velpari-atomic-function.md)
      → Phase 4 reviewer helpers (verdict schema)
      → Phase 5 merge helpers (tier-aware schema)
      → Phase 6 preview helpers (AskUserQuestion preview gate)
  → user says "yes"
  → parent LLM calls velpari_stage_publish
  → ops/approve.ts:handleApprove (publish gate → atomic write → doctor audit → advanceStage)
  → Doc/atomic-functions/<projectName>.md published; state = analyzed-atomic-functions
  → next command: /velpari-pseudocode
```

Full mechanics: `core/stage-runner.ts`, `ops/approve.ts`.

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

## Adding a new phase file

1. Create `stages/atomic-function/<phase>.ts` with the typed `run*` function and explicit input/output types.
2. Update the phase table above.
3. Add unit tests under `pi-extension/test/stages/atomic-function/<phase>.test.ts`.
4. Wire the phase into `index.ts` (composer) at the correct position in the sequence.

## Out of scope

- **Phase 7 publish** — the runtime publish work lives in `ops/approve.ts:handleApprove`, called by `velpari_stage_publish` after the parent LLM gets "yes" at the preview gate. All 9 stages share this runtime entry point.
- **Reviewer at other stages** — only atomic-function uses the reviewer today. Plan D will generalize.
