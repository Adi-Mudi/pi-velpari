# 05 — Sub-Agent Generation (Per-Phase, Dynamic)

How Velpari's sub-agents are produced in the finalized sequence. The problem
this solves: static configuration happens at project start, but each phase
generates the planning documents and artifacts that the *next* phase's agents
need — agents can't be fully configured in advance because their context
doesn't exist yet.

## The model: static contract, dynamic content

| | Static (never dynamic) | Dynamic (regenerated per phase) |
|---|---|---|
| **What** | Role table, scout count per stage, report paths (`<role>-report.json`), stage gates, doctor checks, the reviewer's adversarial position | Agent definition *content*: project context, technology focus, which published artifacts to read, domain vocabulary, the concrete requirement list to verify |
| **Why** | This is the orchestration contract — if it changed, nothing would be verifiable | This is what makes agents project-aware instead of generic |

Generation stays **deterministic assembly** — role template + technology
resource(s) + project-context block. No LLM content generation for agent
wiring. The LLM writes artifact content, never agent definitions.

## Trigger points: the phase boundaries

Agents for Phase N are generated **after the last approve of Phase N−1** —
the exact moment that phase's published artifacts became complete and
immutable. The post-approve `Next:` hint names the generation step before the
next stage command. Doctor validation runs immediately after generation.

```text
[Phase N−1 last approve]
   → GENERATE Phase N agents
   → DOCTOR validate (agents exist, fresh, mapped, not drifted)
   → Phase N stages run
```

## Inputs: published `Doc/` artifacts ONLY

The generator reads **only final published artifacts from `Doc/`** — never
working copies in `.IDE_Plans/velpari/runs/`, never discussion drafts. Reasons:

1. Working copies are mutable — an agent generated from a draft is stale the
   moment the draft changes at the preview gate.
2. Published artifacts are immutable, versioned, and doctor-audited — the
   generator's input is trustworthy by construction.
3. The trigger becomes unambiguous: last approve of Phase N−1 = all inputs
   exist in final form.
4. Same law as the stages themselves: every stage reads all prior **approved**
   artifacts; the generator follows it too.

## What each phase generates

| Boundary | Input (published only) | Agents generated |
|---|---|---|
| Before Phase 1 | mission + `files.json` + technology resources (no artifacts exist yet — the only phase without document input) | 4 brainstorm roles: extractor, prd-checker, rtm-checker, web-search-agent |
| Before Phase 2 | brainstorm notes | PRD scouts · RTM scouts · feasibility scouts (+ `feasibility-reuse-scout`, `feasibility-spike`) |
| Before Phase 3 | PRD + RTM + feasibility (language/framework now known) + requirements profile + standards overlay | design scouts + design-reviewer · atomic-function scouts + reviewer · pseudocode scouts + pseudocode-reviewer · testplan-reviewer (all 4 reviewers generate here — see implementation notes) |
| Before Phase 4 | design + atomic functions + pseudocode (+ all earlier) | testplan scouts · development-order scouts · final-design scouts |

## Verifier agents are the issue-finders

Each phase's generated team includes **verifier roles** (coverage-checkers,
consistency-checkers, adversarial reviewers). Because they are generated with
the actual upstream document content in context, they verify semantically:

- When the PRD gains FR-27, the regenerated design-stage verifier knows
  FR-27's text and checks the design genuinely handles it (Layer 3 validation —
  see `03-staleness-and-validation.md`).
- Verifier verdicts (`approve | needs-fix | block`) are written to role-keyed
  report files and consumed by the publish gate. **Agents detect; code
  enforces.** The orchestrator gates on verdicts, never on its own judgment.

This is why the generator upgrade and the content-validation upgrade are the
same work: Layer 3 only works when verifiers carry real project context.

## Safety layers (unchanged from generator v1)

1. **One confirmation gate** before any write.
2. **Never-overwrite contract** — files of unknown origin are never touched;
   user-edited generated files are preserved (`keptDrifted`); writes go
   through atomic write.
3. **Drift manifest** (`.pi/velpari/generated-manifest.json`) — merged, never
   wiped; sha256 per generated file; detects staleness after regeneration.

Custom mappings in `agents.json` are NEVER overwritten — the generator only
touches the default column. Report paths stay role-keyed, so custom agent
names never break report collection.

## Doctor validation at each boundary

The doctor's agent section (extended) checks, before a phase starts:

1. Every role of the upcoming phase has an agent file and an `agents.json`
   mapping.
2. Generated agents are **fresh**: generated after the latest publish of every
   artifact they depend on (mtime/hash compare via the drift manifest +
   freshness manifest). Stale → recommend regeneration.
3. Reviewer presence per tier gate (advanced tier / reviewer-required overlay
   → reviewer agent must exist).
4. No stale generator versions (footer `vN` < current).

## Fallback (permanent)

A project that never runs the generator works end-to-end with the bundled
static scouts in `skills/agents/`. Dynamic generation is an enhancement layer,
never a requirement — this protects determinism and offline use.

## Regeneration on revision runs

When a revision run republishes artifacts, the agents of every **downstream
phase** become stale (their context no longer matches the documents). The
phase-boundary doctor check catches this: entering Phase N with agents older
than the republished inputs → regeneration recommended first. Agents are cheap
to regenerate; stale verifiers are expensive to trust.

## Implementation notes (shipped 2026-09-21 — generator v2)

Plan `.IDE_Plans/velpari-generator-v2_plan_20260921_1105_v1.0.md`. The shipped
v2 applies these refinements to the model above:

1. **Phase mapping is one constant.** `core/agents-config.ts:GENERATION_PHASES`
   lists the roles + published-input keys per phase; `phaseForStage(stage)`
   maps the run's current stage to the phase it is ENTERING (completed stages
   resolve to their successor's phase). The generator auto-detects the phase
   from run state; `/velpari-generate-sub-agents --phase N` overrides.
   `GENERATOR_VERSION = 2` — v1 files read as stale footers in doctor.
2. **Interview (D3).** projectType is always asked (never persisted); the
   language question is skipped when a feasibility decision record exists
   (Phase 3+) or `files.json` pins `framework.language`; the framework
   question is skipped when `files.json` already carries libraries/runtime.
3. **Severity policy (D6).** Doctor reports stale generated agents as
   **warnings** ("regenerate Phase N"), never errors — the bundled scouts are
   the permanent fallback. Reviewer *presence* is an **error** only when the
   tier + overlay + reviewerMode policy requires the reviewer
   (`core/atomic-tier.ts:shouldRunReviewer`).
4. **Freshness source.** `core/agent-freshness.ts` compares each generated
   agent's mtime against the freshness manifest `publishedAt` of its phase
   inputs. The same module drives the phase-boundary next-hints on approve
   and `/velpari-status` ("generate Phase N agents, then `<next command>`" —
   informational only, never a legality decision).
5. **Verifier wiring (C3).** `doctor/checks/reviewer-verdict.ts` holds the
   single stage→verifier map (`REVIEWER_STAGE_SPECS`); the publish gate
   consumes verdicts through `verifierSpecForArtifact` instead of per-artifact
   closures, and `/velpari-doctor` reports last-known verdicts + verdict
   freshness in the "Verifier verdicts (Layer 3)" section. One deviation from
   the phase table above: `testplan-reviewer` is generated in **Phase 3**
   (with the other three reviewers), not Phase 4 — the verdict is only needed
   at testplan publish, and Phase 3 already generates every reviewer.
