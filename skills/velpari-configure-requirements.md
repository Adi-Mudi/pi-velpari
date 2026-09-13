---
name: velpari-configure-requirements
description: Pi-Velpari Requirements Profile stage — captures the user-confirmed requirements profile (application type, domain, development method, regulated flag, required sections) via the research-based profile workflow and persists it to .pi/velpari/requirements-profile.json. Profile selection is OPTIONAL and supports the common PSRS core as a first-class choice. No LLM-driven subagent fan-out; deterministic two-phase flow with native Pi selectors.
---

# Configure Requirements Stage

Select a built-in requirements profile or the common PSRS core based on
the user's answers, and persist the selection to
`.pi/velpari/requirements-profile.json`. The profile metadata flows into
every downstream stage prompt as a compact projection (see PRD §5 and
§11 of `Doc/velpari-requirements-orchestration-design.md`).

## Goal

By the end of this stage:

- `.pi/velpari/requirements-profile.json` either exists with a valid
  profileId (built-in or common-core) OR is intentionally absent.
- The user has explicitly confirmed the selected profile (if any).
- Web research (if any) was offered **before** profile recommendations.
- The handler never invents a profile and never saves one without an
  explicit save-confirm.

## Research-based profile workflow

The workflow is **deterministic and report-only**. The handler:

1. Captures core answers via `ctx.ui.input(title, placeholder)`:
   what, who, problem (free text, required), and novelty / platforms /
   sensitiveData / externalSystems / existingCodebase (yes/no via
   `ctx.ui.confirm`).
2. Captures fixed-choice answers via `ctx.ui.select(title, options)`:
   application type, domain, development method, security level.
3. Asks for **web-research consent BEFORE recommendations**. On
   consent, hands a compact research prompt to the parent LLM via
   `pi.sendUserMessage`. The prompt explicitly says **profile
   selection is pending**, **must not save a profile**, and never
   includes a final selected profile id. Findings are suggestions
   only.
4. Computes deterministic recommendations: the common PSRS core +
   up to two closest built-in profiles, with a score (0–100),
   reasons, and trade-offs for each.
5. User picks a profile via `ctx.ui.select`. The handler then asks
   one final save-confirm (`ctx.ui.confirm`) and writes the profile
   JSON.
6. If no exact built-in matches the answers, the handler calls
   `runFallbackActions` to surface the documented fallback options:
   `Use common PSRS core` (real choice), `Use closest built-in
   profile` (real choice), `Update Velpari`, `Stop`. No fake
   custom-profile action.

## Profile recommendation shape

```ts
interface ProfileRecommendation {
  kind: "common-core" | "built-in";
  profileId: string;
  label: string;
  score: number;        // 0..100
  reasons: string[];    // why this profile fits the answers
  tradeoffs: string[];  // known caveats the user should weigh
  builtIn?: BuiltInProfile;
}
```

Recommendations are deterministic and sorted by `score DESC, profileId
ASC`. The common PSRS core is always present with a baseline score.
Up to two closest built-in profiles appear below. The picker labels
include the score so the user can compare at a glance.

## Common PSRS core

The common PSRS core (`core-psrs-v1`) is a first-class, versioned
profile. It represents the baseline PSRS structure every project
should have (Objective, Problem, Actors, Scope, MVP, Phases, FR, NFR,
Data and Interfaces, Errors and Edge Cases, Constraints, Dependencies
and Risks, Out of Scope, Open Questions, Acceptance Criteria, Helper
Function Candidates). It is a **real valid choice** — not a fallback
because nothing matched. The user may select it explicitly even when a
domain-specific profile exists.

## Built-in profile library

The library ships with deterministic suggestions for common cases. The
current set lives in
`pi-extension/src/requirements-profile.ts:DEFAULT_PROFILE_LIBRARY`:

- `core-psrs-v1` — common PSRS core (always present)
- `banking-web-v1` — web + banking + regulated
- `healthcare-ai-v1` — ai + healthcare + safety-critical
- `web-general-v1` — web + general + agile
- `api-general-v1` — api + general + agile
- `mobile-general-v1` — mobile + general + agile
- `automotive-safety-v1` — iot + automotive + safety-critical
- `government-web-v1` — web + government + waterfall
- `ai-general-v1` — ai + general + agile

When no built-in profile matches, the handler surfaces the fallback
actions via `ctx.ui.select`. It never invents a profile silently.

## Native Pi UI calls

| Question / step | API used |
|---|---|
| Free-text (what/who/problem/platforms) | `ctx.ui.input(title, placeholder)` |
| Yes/no (consent / save) | `ctx.ui.confirm(title, message)` |
| Fixed choice (novelty / type / domain / method / security / regulated / profile / fallback) | `ctx.ui.select(title, options)` |

The picker labels are title-cased for readability. For
application types, domains, and development methods, the labels match
the enum identifiers via `core-psrs-v1` → `"Core Psrs V1"` etc. — see
the picker mappings in `configure-requirements.ts`.

## Research consent rules

- Default OFF. The user must explicitly opt in via `ctx.ui.confirm`.
- Research consent is asked **before** recommendations are produced so
  any findings can inform the choice. The handoff is a compact prompt
  to the parent LLM via `pi.sendUserMessage`. The prompt:
  - Says `"Profile selection: PENDING"`.
  - Says `"MUST NOT save or write a profile"`.
  - **Does NOT include a final selected profile id.**
  - Asks for citations, not invented requirements.
- If research consent is granted but no ExtensionAPI is available,
  warn the user and skip the handoff; profile still saves with
  `researchConsent: true` and empty `researchSources`.
- Research findings are suggestions only. They never become
  requirements without explicit user confirmation.

## Output contract

The persisted profile is JSON with these keys:

```json
{
  "version": "1.1.0",
  "profileId": "banking-web-v1",
  "profileKind": "built-in",
  "applicationType": "web",
  "domain": "banking",
  "developmentMethod": "regulated",
  "regulated": true,
  "securityLevel": "high",
  "requiredSections": ["security", "audit", "transaction-integrity", "compliance", "privacy"],
  "conditionalQuestions": ["Does it process money or financial records?", "..."],
  "outputVariant": "compliance",
  "createdAt": "<iso>",
  "researchConsent": false,
  "researchSources": []
}
```

A common-core selection produces a profile with `profileKind:
"common-core"` and `profileId: "core-psrs-v1"`.

The same JSON is read back by every downstream stage handler via
`loadRequirementsProfile(cwd)` and projected into a compact metadata
object via `compactProfileMetadata(profile)`. Only the compact projection
is injected into stage prompts (never the full profile).

## Doctor reporting

`/velpari-doctor` reports on the profile **without mutating it**:

- Profile mode: `built-in` or `common-core`.
- Profile id and version (with expected version comparison).
- Research consent flag and research source count.
- A note that Doctor is report-only and never selects, fixes, or
  generates a profile.

## Hard rules

- Never invent a profile. Report the gap when nothing matches.
- Never silently flip regulated / outputVariant / profileKind.
- Never fetch the web directly from this handler.
- Save only after explicit save-confirm.
- If research consent is granted but no ExtensionAPI is available,
  warn the user and skip the handoff; profile still saves with
  `researchConsent: true` and empty `researchSources`.
- Common PSRS core is a real selection, never a fallback for missing
  matches.
- The handler never picks the user's profile; the user picks via
  `ctx.ui.select` and confirms via `ctx.ui.confirm`.
- Research prompt says `Profile selection: PENDING` and never
  contains a final selected profile id.
