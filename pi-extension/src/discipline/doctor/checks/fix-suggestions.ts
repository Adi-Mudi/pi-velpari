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
	"no-active-run": "Run `/velpari-discuss <mission>` to start a run.",
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
		"Run `/velpari-discuss <mission>` first, then `/velpari-prd`.",
	"psrs-invalid": "Fix the listed issues in the PSRS.",
	"psrs-legacy-only":
		"Rerun `/velpari-prd` to regenerate the grouped PSRS with current schema.",
	"rtm-missing": "Run `/velpari-rtm` after the PRD stage.",
	"rtm-unknown-id":
		"Either add the missing ids to the PSRS or remove them from the RTM. Traceability is bidirectional.",

	// Multiplexer / subagent provider
	"unknown-multiplexer":
		"Start pi inside tmux, zellij, wezterm, or cmux.",
	"subagent-ext-missing":
		"Install: `pi install git:github.com/HazAT/pi-interactive-subagents`",
	"zellij-close-pane":
		"During the discussion stage, do NOT manually focus a subagent pane. cmux/tmux/wezterm are not affected.",

	// Scout agents
	"scout-agent-missing":
		"Run any `/velpari-<stage>` command to trigger auto-install, or place the file manually at `.pi/agents/<id>.md`.",
	"scout-agent-bad-frontmatter":
		"Add the missing frontmatter fields. Required: name, description, tools, thinking, session-mode, auto-exit, spawning.",

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
	"setup-discuss": "Run `/velpari-discuss <mission>`.",
	"setup-prd": "Run `/velpari-prd` (after discussion).",
	"setup-rtm": "Run `/velpari-rtm` (after PRD).",
	"setup-profile": "Run `/velpari-configure-requirements`.",
	"setup-approve": "Run `/velpari-approve-discuss` after discussion.",

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
