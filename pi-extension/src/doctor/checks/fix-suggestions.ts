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
	"doc-dir-missing":
		"It will be created when you publish the first artifact via `/velpari-prd-approve`.",
	"project-name-missing": "Run `/velpari-configure-inputs` to set the project name.",

	// Grouped / legacy paths
	"artifact-missing":
		"Run the matching stage command to generate this artifact (e.g. `/velpari-prd`).",
	"artifact-legacy-only":
		"Rerun the corresponding stage command to regenerate in the grouped layout.",

	// PSRS / RTM
	"psrs-missing":
		"Run `/velpari-brainstorm <mission>` first, then `/velpari-prd`.",
	"psrs-invalid": "Fix the listed issues in the PSRS.",
	"fr-wording":
		"Rewrite the flagged FR rows in EARS shape with an RFC 2119 keyword, e.g. \"When a user submits X, the system SHALL save X\" — see skills/velpari-prd.md 'Requirement Wording'.",
	"psrs-legacy-only":
		"Rerun `/velpari-prd` to regenerate the grouped PSRS with current schema.",
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
	"phase-mismatch":
		"The RTM row phase differs from the PRD Phase column for the same id. Re-run `/velpari-rtm` in update mode and copy the phase from the PRD (1 = MVP), then `/velpari-testplan-approve`.",
	"mvp-incomplete":
		"Phase-1 (MVP) requirements are not fully covered. Re-run `/velpari-rtm` in update mode to add the missing rows/test links, then `/velpari-development-order-approve`.",

	// Feasibility v2
	"feasibility-doc-invalid":
		"Fix the listed section issues in the feasibility working copy (template: skills/velpari-feasibility.md), then `/velpari-final-design-approve`.",
	"feasibility-session-incomplete":
		"Re-run `/velpari-feasibility` and finish the reuse-scan decision + language selection (velpari_feasibility_session tool) before approving.",

	// Living documents
	"stale-downstream":
		"Re-run the named stage command — it runs in update mode and revises the published artifact against the updated upstream.",
	"rtm-deprecated-ref":
		"Mark the RTM rows for deprecated requirements as `deprecated` (never delete them), or re-run `/velpari-rtm` in update mode.",
	"stale-run-lock":
		"The lock holder is gone. It is auto-stolen on the next state mutation; if it persists, delete `.IDE_Plans/velpari/.lock/`.",

	// Multiplexer / subagent provider
	"unknown-multiplexer":
		"Start pi inside tmux, zellij, wezterm, or cmux.",
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
	"agent-config-invalid":
		"Fix or delete `.pi/velpari/agents.json`, then run `/velpari-configure-agents`.",
	"agent-mapping-missing":
		"Run `/velpari-configure-agents` to remap the role, or place the agent file at the expected path.",

	// Stage skill markdowns
	"skill-missing":
		"Restore the skill markdown from the bundled `skills/` directory or git history.",
	"skill-bad-contract":
		"Fix the listed contract checks in the skill markdown.",

	// Secret scan
	"secret-detected":
		"Move secrets to environment variables. Never commit them.",

	// Setup progress
	"setup-files": "Run `/velpari-configure-inputs`.",
	"setup-brainstorm": "Run `/velpari-brainstorm <mission>`.",
	"setup-prd": "Run `/velpari-prd` (after brainstorm).",
	"setup-rtm": "Run `/velpari-rtm` (after PRD).",
	"setup-profile": "Run `/velpari-configure-requirements`.",
	"setup-approve": "Run `/velpari-prd-approve-brainstorm` after brainstorm.",

	// Official-extension readiness (Phase 5 of official-extension plan)
	"official.missing-pi-package-keyword":
		'Add "pi-package" to package.json:keywords for gallery discovery.',
	"official.missing-pi-extensions":
		'Add pi.extensions array to package.json pointing at "./pi-extension/src/index.ts".',
	"official.missing-bundled-subagents-dep":
		'Add "pi-interactive-subagents": ">=3.7.2" to dependencies and bundledDependencies (per official Pi docs § Dependencies).',
	"official.missing-npmignore":
		"Create .npmignore excluding .IDE_Plans/, Doc/, tests, and .github/.",
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
	"logging-plan-tamper-evident-missing":
		"Edit §8 to declare tamper-evident storage (append-only, WORM, or signed).",

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
	"atomic-arg-count-high":
		"Reduce argCount to 0-2 (Clean Code rule). Wrap related arguments in a parameter object.",
	"atomic-coupling-high":
		"Reduce coupling=high — refactor dependencies into separate atomic functions or introduce an interface boundary.",
	"atomic-risk-missing":
		"Set risk to {low, medium, high} per PMBOK. Advanced tier (regulated industry) requires explicit risk classification.",
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
