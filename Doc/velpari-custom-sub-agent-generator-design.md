# Velpari Custom Sub-Agent Generator — Design Rationale

- Date: 2026-09-16 21:30
- Author: velpari planning run
- Status: v1.0 (initial design)
- Plan: `.IDE_Plans/custom_sub_agent_generator_plan_20260916_2130_v1.0.md`

## Why this exists

The previous pseudocode standardization upgrade added tier-aware fields + a 5-question rubric. The natural next question: **who enforces that the published pseudocode actually follows the rubric?**

Two options were considered.

### Option A — Doctor check (rejected)

A new `doctor/checks/pseudocode-tier.ts` would validate tier stamps + field coverage + required sections. This is the standard Velpari approach: doctor checks run at publish time and block state advancement on errors.

**Rejected because:**
1. Doctor checks live in `core/doctor/` (L1). They are coupled to velpari internals (paths, frontmatter, fs). Hard to extend with project-specific rules.
2. Users cannot customize the rules without patching the extension.
3. Doctor rules are static. They do not see project context (framework, projectName) the way a sub-agent can.
4. The reviewer pattern is more aligned with the existing scout model (4 parallel agents per stage).

### Option B — Custom sub-agent generator + reviewer sub-agent (chosen)

The existing `/velpari-generate-sub-agents` already produces project-specific sub-agents via deterministic assembly (role template + technology resource(s) + project-context block, no LLM content generation). It uses the same write-with-safety contract that protects user edits. We extend it with a `--custom` flag that emits **custom roles** — project-defined sub-agents — from `.pi/velpari/custom-roles.json`. The first example is `pseudocode-reviewer`.

**Chosen because:**
1. **Reuses existing infrastructure.** Manifest, write-with-safety, role template, body-file resolver all work unchanged.
2. **User-editable rules.** The reviewer body file (`agents/pseudocode-reviewer-body.md`) is the rule source-of-truth. Editing the body = changing the rules. The write-with-safety contract preserves user edits.
3. **Visible in multiplexer panes.** The reviewer runs like any scout — visible, async, interruptible. Better UX than a silent doctor check.
4. **Extensible.** Future reviewers (test-plan-reviewer, design-reviewer, etc.) reuse the same mechanism. One pattern, many agents.
5. **No new slash command.** The generator extension keeps the user's mental model intact.

## Architectural decisions

### A1 — Custom roles live in `.pi/velpari/custom-roles.json`

A project's custom roles are defined in a project-level JSON file, not hard-coded in `agents-config.ts`. This mirrors the existing pattern: bundled roles (the v1 brainstorm set) are immutable; project custom roles are editable. Same shape as `agents.json` and `requirements-profile.json`.

**File shape:**

```json
{
  "_comment": "Velpari custom sub-agent roles. ...",
  "version": 1,
  "roles": [
    {
      "role": "pseudocode-reviewer",
      "label": "Pseudocode — tier-compliance reviewer",
      "tools": ["read", "write", "bash"],
      "mandate": "...",
      "invocationHint": "...",
      "outOfScope": [...],
      "bodyFile": "pseudocode-reviewer-body.md"
    }
  ]
}
```

### A2 — Extend `/velpari-generate-sub-agents`, do not create a new command

Adding a `--custom` flag keeps the user's mental model intact:

- `/velpari-generate-sub-agents` — emit the 4 bundled brainstorm roles (today's behavior).
- `/velpari-generate-sub-agents --custom` — also emit any custom roles from `.pi/velpari/custom-roles.json`. If the file does not exist, copy the bundled starter first, ask for confirmation, then generate.
- `/velpari-generate-sub-agents --custom-only` — emit only custom roles (no brainstorm).

The confirmation dialog + write-with-safety contract apply equally to bundled and custom roles.

### A3 — Reviewer is a normal sub-agent, spawned at publish time

`/velpari-approve` for the pseudocode stage spawns the `pseudocode-reviewer` (read-only) before publishing. This is where the doctor check would normally run. Replacing the doctor call with a sub-agent spawn keeps the publish-gate mechanism intact:

```
/velpari-pseudocode:
  4 scouts (algorithm-extractor, edge-case-handler, complexity-analyzer, consolidator)
    → writes working copy <runDir>/pseudocode/pseudocode.md
    → preview gate

/velpari-approve (pseudocode stage):
  spawn <slug>-pseudocode-reviewer (visible multiplexer pane)
    reads Doc/pseudocode/pseudocode_<projectName>.md
    emits JSON { verdict, fieldCoverage, findings[] }
  if findings has any "blocking" → block publish + show findings
  else → publish + advance state
```

The reviewer output is JSON; the publish gate maps the verdict to a pass/warn/fail state transition. This is the same wiring a doctor check would have.

### A4 — Reviewer body file is the rule source-of-truth

`pi-extension/src/agents/pseudocode-reviewer-body.md` lists every check the reviewer performs. Editing the body file = changing the rules. The write-with-safety contract preserves user edits (the manifest tracks sha256; user-edited files are kept on regenerate).

**Initial check list (11 checks):**

1. Tier stamp present on every function block
2. Tier matches the function's profile (heuristic — flags when tier seems off)
3. Required fields per tier present:
   - Tier 0 = signature only
   - Tier 1 = + Pseudocode + Returns
   - Tier 2 = + Inputs/Outputs + PRE/POST + Edge Cases + Errors + Complexity
   - Tier 3 = + Dependencies + Side effects
4. PRECONDITIONS are well-formed (use EARS / RFC 2119 keywords where applicable)
5. POSTCONDITIONS describe observable state changes
6. Edge cases table is non-empty for Tier 2+
7. Errors list is non-empty for Tier 2+
8. Complexity present for Tier 2+ (Big-O format)
9. Dependencies list non-empty for Tier 3 (no orphans)
10. Side effects list non-empty for Tier 3 (no orphans)
11. Signature parameters carry type + constraint annotations

**Output JSON shape:**

```json
{
  "reviewId": "pseudocode-reviewer-<timestamp>",
  "source": "pseudocode-reviewer",
  "reviewedAt": "ISO-8601",
  "projectName": "<projectName>",
  "verdict": "pass" | "warn" | "fail",
  "functionsReviewed": 12,
  "fieldCoverage": {
    "tierStamp": 12,
    "signature": 12,
    "description": 9,
    "pseudocode": 10,
    "inputs": 10,
    "outputs": 10,
    "preconditions": 10,
    "postconditions": 10,
    "edgeCases": 10,
    "errors": 10,
    "complexity": 10,
    "dependencies": 2,
    "sideEffects": 2
  },
  "findings": [
    {
      "severity": "blocking" | "advisory",
      "function": "createUser",
      "field": "errors",
      "message": "Tier 2 function missing Errors section",
      "evidence": "### Function: createUser — no **Errors:** block"
    }
  ]
}
```

## Layer discipline

Per `pi-extension/src/AGENTS.md`:

- `core/custom-roles.ts` is L0 — imports only `node:*`, `./paths.js`, `./constants.js`, `../io/atomic-write.js`.
- `core/bundled-custom-roles.json` is L0 data — read at runtime, not imported.
- `agents/pseudocode-reviewer-body.md` is L0 data — resolved via `agents-generator.ts:resolveBodyFilePath`.
- `stages/registry.ts` (L1) gains a new field `postReviewers` on `STAGE_REGISTRY.pseudocode`.
- `skills/velpari-pseudocode.md` is data, not source.

The architecture-alignment test (`test/architecture-alignment.test.ts`) enforces no upward imports.

## Security model

The existing write-with-safety contract is preserved unchanged:

1. Files of unknown origin are NEVER overwritten.
2. Files the manifest proves we generated AND the user never edited (hash matches) are overwritten in place.
3. User-edited files (hash drift) are kept and reported as `keptDrifted`.
4. New files are written and added to the manifest.
5. Manifest writes are merged (never wiped).

This means: editing the bundled pseudocode-reviewer body file = the user's edit survives regeneration. Editing the generated `.pi/agents/<slug>-pseudocode-reviewer.md` = the user's edit survives regeneration. The contract is identical for built-in and custom roles.

## Risk and mitigations

| Risk | Mitigation |
|---|---|
| Reviewer is too strict and rejects valid pseudocode | Severity split: blocking vs advisory. Only blocking findings stop publish. |
| Custom-roles JSON schema drift over time | Strict validator with descriptive errors. Round-trip test in unit suite. |
| Generator extension breaks existing brainstorm flow | `--custom` is additive. Default behavior unchanged. All existing tests must pass. |
| Reviewer body file is too large to assemble | Same assembly as built-in roles. Tested via `buildGeneratedAgentMarkdown`. |
| Stage runner change breaks other stages | `postReviewers` is opt-in. Only pseudocode sets it; all others have empty arrays. |

## Future extensions (separate plans)

1. **`design-reviewer`** — reviews published design_<projectName>.md for arc42 section coverage, ADR-001 presence, C4 diagrams.
2. **`prd-reviewer`** — reviews PRD for RFC 2119 keywords, Phase column, MVP coverage.
4. **`rtm-reviewer`** — reviews RTM JSON for fingerprint health, Phase consistency, MVP coverage X/Y.
5. **`testplan-reviewer`** — reviews test plan + test cases for traceability, coverage.
6. **`feasibility-reviewer`** — reviews feasibility study for 13-section v2 template, decision + selectedLanguage presence.

All follow the same custom-role pattern. Each has its own canonical body file. The mechanism generalizes; the content is per-stage.

## References

- `Doc/velpari-pseudocode-research-notes.md` — tier rubric source-of-truth
- `pi-extension/src/core/agents-generator.ts` — existing generator (Phase 4 of /velpari-generate-sub-agents)
- `pi-extension/src/core/agents-config.ts` — existing role registry
- `pi-extension/src/core/generated-manifest.ts` — manifest tracker
- `pi-extension/src/agents/web-search-agent-body.md` — example body file format
- `pi-extension/src/AGENTS.md` — layer contract
- IEEE 1016-2009, V-Model LLD, Meyer Design by Contract, JSDoc trio — community standards cited in the tier rubric