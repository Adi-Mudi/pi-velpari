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
		"It will be created when you publish the first artifact via `/velpari-approve`.",
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
		"Republish the artifact: re-run its stage command, then `/velpari-approve` — frontmatter is auto-injected at publish time.",
	"rtm-json-missing":
		"Re-run `/velpari-rtm` (update mode) so the working copy gains the JSON sidecar, then `/velpari-approve`.",
	"rtm-json-invalid":
		"Fix the RTM JSON sidecar issues in the working copy, then `/velpari-approve`. The schema is in skills/velpari-rtm.md.",
	"rtm-json-drift":
		"Never hand-edit the published RTM markdown — edit the JSON sidecar via `/velpari-rtm` update mode and republish; approve regenerates the markdown from the data.",
	"fingerprint-suspect":
		"A requirement changed after the RTM linked to it. Re-run `/velpari-rtm` in update mode to review the design/test links, then `/velpari-approve`.",
	"fingerprint-untracked":
		"Republish the RTM (`/velpari-rtm` update mode + `/velpari-approve`) — approve stamps fingerprints automatically.",
	"phase-mismatch":
		"The RTM row phase differs from the PRD Phase column for the same id. Re-run `/velpari-rtm` in update mode and copy the phase from the PRD (1 = MVP), then `/velpari-approve`.",
	"mvp-incomplete":
		"Phase-1 (MVP) requirements are not fully covered. Re-run `/velpari-rtm` in update mode to add the missing rows/test links, then `/velpari-approve`.",

	// Feasibility v2
	"feasibility-doc-invalid":
		"Fix the listed section issues in the feasibility working copy (template: skills/velpari-feasibility.md), then `/velpari-approve`.",
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
		"Install: `pi install git:github.com/HazAT/pi-interactive-subagents`",
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
	"setup-approve": "Run `/velpari-approve-brainstorm` after brainstorm.",

	// Official-extension readiness (Phase 5 of official-extension plan)
	"official.missing-pi-package-keyword":
		'Add "pi-package" to package.json:keywords for gallery discovery.',
	"official.missing-pi-extensions":
		'Add pi.extensions array to package.json pointing at "./pi-extension/src/index.ts".',
	"official.missing-subagents-dep":
		'Add "pi-interactive-subagents": ">=3.7.2" to peerDependencies (bare name, matches HazAT\'s actual package).',
	"official.missing-npmignore":
		"Create .npmignore excluding .IDE_Plans/, Doc/, tests, and .github/.",
	"official.wrong-install-name":
		'Update README.md install line from "pi install npm:pi-velpari" to "pi install npm:@adi-mudi/pi-velpari".',
	"official.missing-package-json":
		"package.json is missing at the project root. Run doctor from inside the pi-velpari repo, or restore the file.",
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
