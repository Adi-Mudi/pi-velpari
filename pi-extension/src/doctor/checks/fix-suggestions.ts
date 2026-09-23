/**
 * Centralized fix-suggestion lookup (Phase 3).
 *
 * Every actionable `DiagnosticItem` carries a `suggestion` string that
 * tells the developer how to fix the issue. Centralizing the strings
 * here means one place to author + maintain them; checks call
 * `suggestionFor("missing:scout-agent")` instead of duplicating prose.
 *
 * Adding a new check = add a new fingerprint to `SUGGESTIONS` and a
 * corresponding assertion in `test/doctor-fix-suggestions.test.ts`.
 */

export const SUGGESTIONS = {
	// State / config / docs
	"no-active-run": "Run `/velpari-brainstorm <mission>` to start a run.",
	"config-missing": "Run `/velpari-configure-inputs`.",
	"config-invalid": "Edit `.pi/velpari/files.json` to fix the schema.",
	"profile-missing": "Run `/velpari-configure-requirements` to capture the requirements profile.",
	"doc-dir-missing": "It will be created when you publish the first artifact via `/velpari-prd-approve`.",
	"project-name-missing": "Run `/velpari-configure-inputs` to set the project name.",

	// Grouped / legacy paths
	"artifact-missing": "Run the matching stage command to generate this artifact (e.g. `/velpari-prd`).",
	"artifact-legacy-only": "Rerun the corresponding stage command to regenerate in the grouped layout.",

	// PSRS / RTM
	"psrs-missing": "Run `/velpari-brainstorm <mission>` first, then `/velpari-prd`.",
	"psrs-invalid": "Fix the listed issues in the PSRS.",
	"fr-wording":
		"Rewrite the flagged FR rows in EARS shape with an RFC 2119 keyword, e.g. \"When a user submits X, the system SHALL save X\" — see skills/velpari-prd.md 'Requirement Wording'.",
	"psrs-legacy-only": "Rerun `/velpari-prd` to regenerate the grouped PSRS with current schema.",
	"trace-link-asymmetric":
		"RTM sidecar `tests[]` is the requirement↔test link authority (D3) — reconcile the asymmetric link at the next `/velpari-rtm` or `/velpari-testplan` revise and republish.",
	"rtm-missing": "Run `/velpari-rtm` after the PRD stage.",
	"rtm-unknown-id":
		"Either add the missing ids to the PSRS or remove them from the RTM. Traceability is bidirectional.",
	"frontmatter-missing":
		"Republish the artifact: re-run its stage command, then `/velpari-rtm-approve` — frontmatter is auto-injected at publish time.",
	"rtm-json-missing":
		"Re-run `/velpari-rtm` (update mode) so the working copy gains the JSON sidecar, then `/velpari-feasibility-approve`.",
	"rtm-json-invalid":
		"Fix the RTM JSON sidecar issues in the working copy, then `/velpari-architecture-generator-approve`. The schema is in skills/velpari-rtm.md.",
	"rtm-json-drift":
		"Never hand-edit the published RTM markdown — edit the JSON sidecar via `/velpari-rtm` update mode and republish; approve regenerates the markdown from the data.",
	"fingerprint-suspect":
		"A requirement changed after the RTM linked to it. Re-run `/velpari-rtm` in update mode to review the design/test links, then `/velpari-atomic-function-approve`.",
	"fingerprint-untracked":
		"Republish the RTM (`/velpari-rtm` update mode + `/velpari-pseudocode-approve`) — approve stamps fingerprints automatically.",

	// Phase 2 (Level B) — auto-remediable. Added alongside
	// the SAFE_WHITELIST entry so the suggestion is suggested
	// identically from the picker and the SUGGESTIONS table is
	// complete for `SuggestionKey` typing.
	"working-published-drift":
		'The working copy in `.IDE_Plans/velpari/runs/<runId>/` diverged from the published copy under `Doc/`. Run `/velpari-doctor --velpari-fix` and pick "Fix all safe items" to sync.',
	"phase-mismatch":
		"The RTM row phase differs from the PRD Phase column for the same id. Re-run `/velpari-rtm` in update mode and copy the phase from the PRD (1 = MVP), then `/velpari-testplan-approve`.",
	"mvp-incomplete":
		"Phase-1 (MVP) requirements are not fully covered. Re-run `/velpari-rtm` in update mode to add the missing rows/test links, then `/velpari-development-order-approve`.",

	// Feasibility v2
	"feasibility-doc-invalid":
		"Fix the listed section issues in the feasibility working copy (template: skills/velpari-feasibility.md), then `/velpari-final-design-approve`.",
	"feasibility-session-incomplete":
		"Re-run `/velpari-feasibility` and finish the reuse-scan decision + language selection (velpari_feasibility_session tool) before approving.",
	"feasibility-record-missing":
		"Republish the feasibility study (`/velpari-feasibility` update mode + approve) — the publish serializes the decision record from the session automatically (B3/D9).",
	"feasibility-record-invalid":
		"Republish the feasibility study (`/velpari-feasibility` update mode + approve) so the decision record is regenerated from the settled session.",

	// Living documents
	"stale-downstream":
		"Re-run the named stage command — it runs in update mode and revises the published artifact against the updated upstream.",
	"stale-input":
		"Republish the stale stage: re-run its stage command (update mode), then the matching `/velpari-<stage>-approve` — or run `/velpari-reconfirm` to mark the artifact as reviewed when the changed input has no impact on it (spec 02: one artifact at a time). The stale set is tracked in `.pi/velpari/freshness.json`.",
	"stale-input-missing":
		"An input artifact vanished — re-confirm is not valid here (D4). Republish the stale stage: re-run its stage command (update mode), then the matching `/velpari-<stage>-approve`. The stale set is tracked in `.pi/velpari/freshness.json`.",
	"freshness-no-stamp":
		"Republish the artifact (stage command in update mode + the matching `/velpari-<stage>-approve`) — publish stamps input hashes automatically (B4).",
	"id-coverage-missing":
		"Revise the downstream stage (re-run its stage command in update mode) so every upstream id is referenced, then the matching `/velpari-<stage>-approve`. Layer-2 coverage rules are in Doc/velpari-sequence/03-staleness-and-validation.md.",
	"id-coverage-not-checkable":
		"The downstream doc is a pre-A4 format (no parseable id references) — regenerate or revise its stage to gain ID traceability. Nothing is blocked; this is a traceability upgrade path.",
	"rtm-deprecated-ref":
		"Mark the RTM rows for deprecated requirements as `deprecated` (never delete them), or re-run `/velpari-rtm` in update mode.",
	"stale-run-lock":
		"The lock holder is gone. It is auto-stolen on the next state mutation; if it persists, delete `.pi/velpari/.lock/`.",

	// Multiplexer / subagent provider
	"unknown-multiplexer": "Start pi inside tmux, zellij, wezterm, or cmux.",
	"subagent-ext-missing":
		"Reinstall pi-velpari (`pi install npm:@adi-mudi/pi-velpari@1.0.2-bundled`); pi-interactive-subagents is now bundled and should appear under pi-velpari's node_modules/.",
	"zellij-close-pane":
		"During the brainstorm stage, do NOT manually focus a subagent pane. cmux/tmux/wezterm are not affected.",

	// Scout agents
	"scout-agent-missing":
		"Run any `/velpari-<stage>` command to trigger auto-install, or place the file manually at `.pi/agents/<id>.md`.",
	"scout-agent-bad-frontmatter":
		"Add the missing frontmatter fields. Required: name, description, tools, thinking, session-mode, auto-exit, spawning.",

	// Agent mapping (agents.json)
	"agent-config-invalid": "Fix or delete `.pi/velpari/agents.json`, then run `/velpari-configure-agents`.",
	"agent-mapping-missing":
		"Run `/velpari-configure-agents` to remap the role, or place the agent file at the expected path.",

	// Stage skill markdowns
	"skill-missing": "Restore the skill markdown from the bundled `skills/` directory or git history.",
	"skill-bad-contract": "Fix the listed contract checks in the skill markdown.",

	// Secret scan
	"secret-detected": "Move secrets to environment variables. Never commit them.",

	// Setup progress
	"setup-files": "Run `/velpari-configure-inputs`.",
	"setup-brainstorm": "Run `/velpari-brainstorm <mission>`.",
	"setup-prd": "Run `/velpari-prd` (after brainstorm).",
	"setup-rtm": "Run `/velpari-rtm` (after PRD).",
	"setup-profile": "Run `/velpari-configure-requirements`.",
	"setup-approve": "Run `/velpari-prd-approve-brainstorm` after brainstorm.",

	// Official-extension readiness (Phase 5 of official-extension plan)
	"official.missing-pi-package-keyword": 'Add "pi-package" to package.json:keywords for gallery discovery.',
	"official.missing-pi-extensions":
		'Add pi.extensions array to package.json pointing at "./pi-extension/src/index.ts".',
	"official.missing-bundled-subagents-dep":
		'Add "pi-interactive-subagents": ">=3.7.2" to dependencies and bundledDependencies (per official Pi docs § Dependencies).',
	"official.missing-npmignore": "Create .npmignore excluding .IDE_Plans/, Doc/, tests, and .github/.",
	"official.wrong-install-name":
		'Update README.md install line from "pi install npm:pi-velpari" to "pi install npm:@adi-mudi/pi-velpari".',
	"official.missing-package-json":
		"package.json is missing at the project root. Run doctor from inside the pi-velpari repo, or restore the file.",

	// v1.4.0 — /velpari-design-logging (cross-cutting discipline command)
	"logging-plan-missing":
		"Optional: run /velpari-design-logging to produce a logging architecture plan at Doc/observability/logging-plan_<project>.md.",
	"logging-plan-overlay-required":
		"Required: the active standards overlay mandates a logging plan. Run /velpari-design-logging to produce one.",
	"logging-plan-sections-missing":
		"Edit the plan to include every required heading. The canonical list lives in pi-extension/src/core/logging-plan.ts:LOGGING_PLAN_REQUIRED_SECTIONS.",
	"logging-plan-frontmatter-missing":
		"Re-run /velpari-design-logging so the frontmatter (artifact, project, version, created) is stamped by the renderer.",
	"logging-plan-retention-short":
		"Increase the retention tier with the longest duration in §7 to meet the overlay's minimum (see overlay profile.json:loggingRequirements.retentionMonths).",
	"logging-plan-tamper-evident-missing": "Edit §8 to declare tamper-evident storage (append-only, WORM, or signed).",

	// v1.x — atomic-tier doctor (ISO/IEC 29110 + IEC 61508/IEC 62304)
	"atomic-rows-missing":
		"Re-run /velpari-atomic-function. The working copy must carry at least one AF row in the Atomic Functions table.",
	"atomic-base-core-missing":
		"Fill the missing base-core field (afId, name, purpose, signature, source, cohesion, verification, testable). Base-core fields are required at every tier.",
	"atomic-tier-missing":
		"Fill the missing tier-required field. See skills/velpari-atomic-function.md § Output Format for the tier-aware schema. Run /velpari-configure-inputs to change the tier if it's wrong.",
	"atomic-cohesion-invalid":
		"Set cohesion to `perfect-atomic` (leaf) or `functional` (one task). Per Yourdon & Constantine 1979, lower cohesion (coincidental/logical/temporal) is a code smell.",
	"atomic-verification-invalid":
		"Set verification to one of {Test, Demonstration, Inspection, Analysis} per IEEE 29148 §6.4.9.3.",
	"atomic-testable-invalid":
		"Set testable=yes. Atomic functions are leaf-level testable units (Clean Code, ISO 25010 testability).",
	"atomic-complexity-exceeded":
		"Reduce complexity to ≤ 10 (ISO 25010 modifiability threshold). Refactor: split into smaller pure functions.",
	"atomic-ears-invalid":
		"Set earsPattern to one of {Ubiquitous, Event-driven, State-driven, Unwanted, Optional} per Mavin EARS 2009.",
	"atomic-arg-count-high": "Reduce argCount to 0-2 (Clean Code rule). Wrap related arguments in a parameter object.",
	"atomic-coupling-high":
		"Reduce coupling=high — refactor dependencies into separate atomic functions or introduce an interface boundary.",
	"atomic-risk-missing":
		"Set risk to {low, medium, high} per PMBOK. Advanced tier (regulated industry) requires explicit risk classification.",

	// B3 — YAML sidecars (D6/D7)
	"af-data-missing":
		"Re-run `/velpari-atomic-function` (update mode) so the working copy gains the YAML sidecar, then republish — approve regenerates the markdown from the data.",
	"af-data-invalid":
		"Fix the atomic-functions YAML sidecar issues in the working copy, then republish. The schema is in skills/velpari-atomic-function.md (two-file contract).",
	"af-data-drift":
		"Never hand-edit the published atomic-functions markdown — edit the YAML sidecar via `/velpari-atomic-function` update mode and republish; approve regenerates the markdown from the data.",
	"tc-data-missing":
		"Re-run `/velpari-testplan` (update mode) so the working copy gains the YAML sidecar, then republish — approve regenerates the markdown from the data.",
	"tc-data-invalid":
		"Fix the test-cases YAML sidecar issues in the working copy, then republish. The schema is in skills/velpari-testplan.md (two-file contract).",
	"tc-data-drift":
		"Never hand-edit the published test-cases markdown — edit the YAML sidecar via `/velpari-testplan` update mode and republish; approve regenerates the markdown from the data.",
	"do-data-missing":
		"Re-run `/velpari-development-order` (update mode) so the working copy gains the YAML sidecar, then republish — approve regenerates the markdown from the data.",
	"do-data-invalid":
		"Fix the development-order YAML sidecar issues in the working copy, then republish. The D8 schema (steps with id/module/afs/dependsOn, acyclic) is in skills/velpari-development-order.md (two-file contract).",
	"do-data-drift":
		"Never hand-edit the published development-order markdown — edit the YAML sidecar via `/velpari-development-order` update mode and republish; approve regenerates the markdown from the data.",
} as const;

export type SuggestionKey = keyof typeof SUGGESTIONS;

/**
 * Look up the suggestion for a fingerprint. Throws on unknown keys so
 * typos fail loudly during test runs.
 */
export function suggestionFor(key: SuggestionKey): string {
	const value = SUGGESTIONS[key];
	if (value === undefined) {
		throw new Error(`Unknown suggestion fingerprint: ${key}`);
	}
	return value;
}

/**
 * How the doctor is allowed to apply a fix for a fingerprint.
 *
 * - `"interactive"` (default): the doctor surfaces the suggestion and
 *   asks the developer to confirm before anything runs. Used for any
 *   fix that would change artifact content.
 * - `"auto-safe"`: the doctor can apply a deterministic, low-blast-radius
 *   transformation without prompting. Reserved for Phase 2 (Level B).
 *   Adding an entry to `FIX_LEVELS` as `"auto-safe"` REQUIRES a paired
 *   `RemediateFn` in `doctor/checks/remediate/<fingerprint>.ts`; the
 *   picker and dispatcher fail loudly otherwise.
 * - `"agentic"`: the doctor builds a structured brief and hands off to
 *   the parent LLM via `pi.sendUserMessage`. Reserved for Phase 3
 *   (Level C); used for content-semantic items like fingerprint-suspect
 *   and phase-mismatch.
 */
export type FixLevel = "interactive" | "auto-safe" | "agentic";

/**
 * Per-fingerprint fix level.
 *
 * Missing keys fall back to `"interactive"` in `levelFor`, so adding
 * new fingerprints to `SUGGESTIONS` without touching this map is safe
 * (the conservative default applies).
 *
 * Phase 2 populates the `"auto-safe"` entries; Phase 3 populates
 * `"agentic"` entries. Each `"auto-safe"` entry MUST have a paired
 * `RemediateFn` in `doctor/checks/remediate/<fingerprint>.ts` — the
 * dispatcher in `doctor/fix-dispatch.ts:dispatchFixChoice` rejects
 * `"auto-safe"` keys without a registered function.
 */
export const FIX_LEVELS: Partial<Record<SuggestionKey, FixLevel>> = {
	// Phase 2 (Level B — declarative auto-remediate). Each entry has a
	// paired RemediateFn under pi-extension/src/doctor/checks/remediate/.
	"frontmatter-missing": "auto-safe",
	"fingerprint-untracked": "auto-safe",
	"working-published-drift": "auto-safe",

	// Phase 3 (Level C — agentic fix via parent LLM). Each entry
	// triggers `buildFixBrief` and dispatches a structured prompt
	// to the parent LLM via `pi.sendUserMessage`. The parent LLM runs
	// the matching /velpari-* command in update mode.
	"fingerprint-suspect": "agentic",
	"phase-mismatch": "agentic",
	"mvp-incomplete": "agentic",
	"rtm-unknown-id": "agentic",
};

/**
 * Fingerprints cleared for declarative auto-remediation. Enforced at
 * `doctor/remediate.ts:runRemediate` runtime — passing a fingerprint
 * NOT in this set throws (defense in depth on top of the `FIX_LEVELS`
 * check). Updating either one without the other is a bug.
 */
export const SAFE_WHITELIST: ReadonlySet<string> = new Set([
	"frontmatter-missing",
	"fingerprint-untracked",
	"working-published-drift",
]);

/**
 * Look up the fix level for a fingerprint. Defaults to `"interactive"`,
 * so unknown or unset fingerprints are treated conservatively (doctor
 * always asks before applying).
 */
export function levelFor(key: SuggestionKey): FixLevel {
	return FIX_LEVELS[key] ?? "interactive";
}
