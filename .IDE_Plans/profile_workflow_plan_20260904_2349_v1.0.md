# Research-Based Requirements Profile Workflow Plan

- Confidence: 94%
- Version: v1.0
- Status: DONE

## Purpose

Correct the profile workflow so Velpari follows the researched Pi and requirements-management patterns:

- Native Pi selection for fixed choices.
- Free-text questions with `ctx.ui.input()`.
- Yes/no decisions with `ctx.ui.confirm()`.
- Optional profile selection.
- Common PSRS core fallback.
- Multiple profile approaches with reasons and trade-offs.
- Optional research before the final choice.
- Explicit user selection before saving.
- Report-only Doctor behavior.
- PSRS, RTM, grouped paths, stage transitions, and command names remain unchanged.

## Documents

- Truth: `/mnt/Just_Do_It/02_Devp_Soft/12_orchestra/Pi-Velpari/AGENTS.md` and current Velpari source behavior.
- References: [Pi Extensions](https://pi.dev/docs/latest/extensions), [Kimi agents](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html), [Kimi skills](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html), [Pi brainstorming workflow](https://github.com/coctostan/pi-superteam/blob/main/docs/guides/workflow.md), [Atlassian PRD template](https://www.atlassian.com/software/confluence/templates/product-requirements), [Perforce PRD guidance](https://www.perforce.com/blog/alm/how-write-product-requirements-document-prd), [IBM requirements management](https://www.ibm.com/think/topics/what-is-requirements-management), [GitHub SRS template](https://github.com/jam01/SRS-Template).
- targets: `pi-extension/src/requirements-profile.ts`, `pi-extension/src/configure-requirements.ts`, `pi-extension/src/doctor.ts`, `pi-extension/test/requirements-profile.test.ts`, `pi-extension/test/configure-requirements.test.ts`, `pi-extension/test/doctor.test.ts`, `skills/velpari-configure-requirements.md`, `README.md`, `CHANGELOG.md`, `AGENTS.md`, and relevant documents under `Doc/`.
- dependencies: Existing `ExtensionCommandContext`, `ctx.ui.input`, `ctx.ui.confirm`, `ctx.ui.select`, `pi.sendUserMessage`, profile JSON, PRD/RTM stage files, tests, and build scripts.
- tests: `npm run build`, `npm test`, focused profile/configuration/Doctor tests, and `git diff --check`.

## Confirmed scope

### In scope

- Add common-core profile and recommendation types.
- Replace typed choice questions with native Pi selectors.
- Ask research before final profile selection.
- Show multiple recommendations with reasons and trade-offs.
- Confirm before saving.
- Add common-core and closest-profile fallback actions.
- Update profile schema, tests, skill, Doctor, and documentation.
- Preserve version 1 profile compatibility where practical.

### Out of scope

- No PSRS section changes.
- No RTM structure changes.
- No grouped `Doc/` path changes.
- No direct web dependency or request.
- No subagent API code in extension handlers.
- No command name changes.
- No stage transition changes.
- No old file movement or deletion.
- No silent profile creation.
- No custom profile editor unless a safe, user-confirmed path is included by implementation.
- No Doctor profile repair behavior.

## Change items

### Change 1 - Add common-core profile and recommendations

- Type: EDIT
- File: `/mnt/Just_Do_It/02_Devp_Soft/12_orchestra/Pi-Velpari/pi-extension/src/requirements-profile.ts`
- FROM: Version 1 profile schema, exact-match-only `suggestProfiles()`, no common profile, no score/trade-off type.
- TO: Add a versioned common-core profile, `ProfileRecommendation`, scoring/reasons/trade-offs, and up to three deterministic recommendations.
- Reason: Match community brainstorming and common-core-plus-domain patterns.
- Status: PENDING

### Change 2 - Use native Pi selectors

- Type: EDIT
- File: `/mnt/Just_Do_It/02_Devp_Soft/12_orchestra/Pi-Velpari/pi-extension/src/configure-requirements.ts`
- FROM: `askChoice()` uses `ctx.ui.input()` and asks users to type choice values.
- TO: Use `ctx.ui.select(title, options)` for novelty, application type, domain, development method, security, regulated choice, recommendation, and fallback action; keep input for free text and confirm for consent.
- Reason: Follow the official Pi extension UI and community questionnaire patterns.
- Status: PENDING

### Change 3 - Research before final profile selection

- Type: EDIT
- File: `/mnt/Just_Do_It/02_Devp_Soft/12_orchestra/Pi-Velpari/pi-extension/src/configure-requirements.ts`
- FROM: Research consent and handoff happen after profile selection.
- TO: Ask research consent after collecting answers, before recommendations and selection; send a pending-profile research prompt that cannot save a profile.
- Reason: Ensure research informs the user but never silently selects or saves a profile.
- Status: PENDING

### Change 4 - Add fallback actions and common-core profile

- Type: EDIT
- Files: `pi-extension/src/requirements-profile.ts` and `pi-extension/src/configure-requirements.ts`
- FROM: No exact profile causes an error and the handler stops.
- TO: Offer common-core, closest built-in, and other explicit actions through native selection; support a real common-core profile representation and no-profile behavior.
- Reason: Support simple projects without mandatory profile complexity.
- Status: PENDING

### Change 5 - Update profile skill and Doctor

- Type: EDIT
- Files: `skills/velpari-configure-requirements.md` and `pi-extension/src/doctor.ts`
- FROM: Skill documents typed choices and research-after-selection; Doctor reports only profile presence.
- TO: Document optional/common-core/native-select research flow; Doctor reports profile mode, ID/version, common-core status, research state, and recommendations without mutation.
- Reason: Keep agents and Doctor aligned with the corrected workflow.
- Status: PENDING

### Change 6 - Update tests and documentation

- Type: EDIT
- Files: profile/configuration tests, Doctor tests, `README.md`, `CHANGELOG.md`, `AGENTS.md`, and relevant `Doc/` workflow/design files.
- FROM: Tests mock only `input` and `confirm`; docs describe mandatory profile selection and typed choices.
- TO: Add native-select mocks and corrected order tests; document optional profiles, common-core fallback, research-before-selection, and non-mutating Doctor behavior.
- Reason: Verify the researched workflow and prevent regressions.
- Status: PENDING

## Validation sequence

1. Confirm the installed `ctx.ui.select(title, options)` signature.
2. Read source and tests before editing.
3. Update the profile model and tests.
4. Update the configuration handler and skill.
5. Update Doctor and documentation.
6. Run `npm run build`.
7. Run focused profile/configuration/Doctor tests.
8. Run full `npm test`.
9. Run `git diff --check`.
10. Use a read-only quality review.
11. Update this plan with DONE/PENDING/FAILED status.

## Safety rules

- Do not move or delete existing files.
- Do not change PSRS, RTM, grouped paths, commands, or stage transitions in this scope.
- Do not add dependencies.
- Do not fetch the web directly from extension code.
- Do not spawn subagents from extension code.
- Do not save a profile before user selection.
- Do not invent a profile.
- Do not silently modify the selected profile.
- Do not modify package.json or package-lock.json.

## Execution status

- [x] Change 1 - Common profile and recommendations: DONE
- [x] Change 2 - Native Pi selectors: DONE
- [x] Change 3 - Research before final selection: DONE
- [x] Change 4 - Common-core and fallback actions: DONE
- [x] Change 5 - Skill and Doctor: DONE
- [x] Change 6 - Tests and documentation: DONE
- [x] Validation: DONE (build, focused tests, full suite: 455/455 passing, git diff --check)

## Retrospective

- What went well:
  - Native Pi `ctx.ui.select(title, options)` confirmed against `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:70`.
  - ProfileRecommendation schema (score/reasons/trade-offs) is small, deterministic, and easy to test.
  - Common PSRS core wired as a real ProfileKind (not a fallback branch).
  - Doctor remains report-only; no new mutation paths added.
- What failed:
  - One early test (`buildStagePrompt renders compact profile metadata`) needed its expected version to follow the bumped `REQUIREMENTS_PROFILE_VERSION` (`1.1.0`); fixed in `prompt.test.ts`.
  - Initial `Object.values(ENUM_LABELS)` typing made `askSelect` reject literal-union labels; widened to `string[]` annotations.
- What to improve next time:
  - Surface profile-version bumps in the prompt-render test names so future bumps are easy to grep.
  - Keep the SELECT/INPUT/CONFIRM pattern in the shared helper instead of duplicating into each question.
