/**
 * Centralized fix-suggestion lookup (Phase 3).
 *
 * Every actionable `DiagnosticItem` carries a `suggestion` string that
 * tells the developer how to fix the issue. Centralizing the strings
 * here means one place to author + maintain them; checks call
 * `suggestionFor("missing:scout-agent")` instead of duplicating prose.
 *
 * Adding a new check = add a new fingerprint to `SUGGESTIONS` and keep
 * `test/doctor/checks/fix-suggestions.test.ts` (the coverage guard) green.
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
		"DB-backed RTM: fingerprints are stamped by publish — re-run the publishing stage or `/velpari-reconfirm` after input changes. Legacy sidecar project: republish the RTM (`/velpari-rtm` update mode + approve) — approve stamps fingerprints automatically.",

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

	// Multiplexer / subagent provider
	"unknown-multiplexer": "Start pi inside tmux, zellij, wezterm, cmux, or herdr.",
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

	// Phase 7 — store DB checks (doctor as SQL)
	"store-db-missing":
		"No store DB yet (or pre-store project). Publish an artifact via its stage approve, or import legacy artifacts with `/velpari-backfill <kind>`.",
	"store-db-corrupt":
		"The store DB failed SQLite integrity checking. Restore from git history (`git checkout <commit> -- Doc/store/`) or rebuild from the exported YAML beside the DB; do NOT keep writing to a corrupt DB.",
	"store-db-unreadable":
		"Doc/store/<project>/index.db exists but cannot be used (not a Velpari store, not a database, or unreadable). Remove the invalid file (the next publish re-creates it) or restore the real store — skills/db-store-merge-runbook.md § 2.",
	"store-db-orphan-link":
		"A trace link points at a row that does not exist in the store. Re-run the publishing stage (update mode) to regenerate consistent rows, or `/velpari-backfill <kind>` for legacy data.",

	// Phase 9 — git integration (G2a visibility)
	"git-attr-missing":
		"Add `Doc/store/**/index.db binary` to .gitattributes — or just publish once: the chain auto-heals the file (ops/git-attributes.ts) and commits it. Manual procedure: skills/db-store-merge-runbook.md.",
	"git-ignore-missing":
		"Add `Doc/store/**/index.db-wal` and `Doc/store/**/index.db-shm` to .gitignore — or just publish once: the chain auto-heals the file (ops/git-attributes.ts) and commits it. Manual procedure: skills/db-store-merge-runbook.md.",

	// Phase 10 — portfolio registry (§15.5 drift visibility)
	"portfolio-stale":
		"The registry points at a project DB that no longer exists. Run `/velpari-portfolio --repair` to resync (removes orphans, refreshes rows).",
	"portfolio-unregistered":
		"A per-project DB is not in the portfolio registry. Run `/velpari-portfolio --repair` (or just publish once — the chain syncs pre-commit).",
	"portfolio-orphan":
		"The registry is unreadable or holds rows with no backing data. Run `/velpari-portfolio --repair` to rebuild it from the per-project DBs (the registry is fully derivable — never hand-edit it).",
	"portfolio-asset-missing":
		"A design diagram references an image asset that is not on disk. Commit the asset beside the project DB (Doc/store/<project>/) or fix the image: path, then re-run /velpari-doctor.",
	"portfolio-asset-invalid":
		"A design diagram's image: path escapes the project DB directory (..) — paths must stay inside Doc/store/<project>/. Fix the diagram text via the design stage and republish.",

	// Phase 6 — versioning/locking/recovery visibility (N15, F7, N11, N13, N14)
	"hash-chain-broken":
		"A stored ledger row no longer matches its chain. Restore the store DB from git history (`git checkout -- Doc/store/<project>/index.db`) or rebuild from export (`/velpari-backfill <kind> --from-export`) — skills/db-store-merge-runbook.md § 2 / § 3. Never hand-edit audit_ledger/tx_log.",
	"baseline-superseded":
		"The consumer stage adopted a revision that has since been superseded. Run `/velpari-reconfirm` when there is no impact, or re-run the consumer stage to re-adopt the head revision.",
	"baseline-withdrawn":
		"The adopted revision was withdrawn — downstream content rests on pulled material. Re-run the consumer stage against the current head before publishing anything downstream.",
	"backup-missing":
		"The first snapshot is written by the next publish, `/velpari-db-reset` or `/velpari-migrate-store` (N9). Until then there is nothing to restore — skills/db-store-merge-runbook.md.",
	"backup-verify-failed":
		"Treat the newest snapshot as untrusted: fix the manifest/file mismatch (or take a fresh snapshot at the next publish) and prefer an older verified snapshot. Restore steps: skills/db-store-merge-runbook.md §7.",
	"backup-restore-hint":
		"Restore with `restoreBackupSnapshot` per skills/db-store-merge-runbook.md §7 — the pre-restore safety copy and post-restore quick_check are automatic.",
	"stale-lock-reset":
		"Clear it with `/velpari-reset` (confirm + audit, N13) — never delete `.pi/velpari/.lock/` by hand.",
	"worktree-removal":
		"Recreate the worktree (`git worktree add <path> <branch>`) to keep the run, or `/velpari-reset` to retire it. A bash-side removal cannot be blocked — doctor reports it instead (N14).",

	// Phase C — Doctor v2 (N22/N23). Each finding names its fix
	// (fix-command-per-finding, Senai pattern). FIX_LEVELS/SAFE_WHITELIST
	// entries land in Subphase 3.3 with their paired RemediateFns.
	"digest-contract-unavailable":
		"The Phase B digest API (io/db.ts) is not present in this build — no action; the check degrades until batch gate 1 merges Phase B.",
	"digest-not-stamped":
		"Publish once (any stage approve) — every Phase B content writer re-stamps `store-content-v1` automatically; until then the foreign-modification check cannot run.",
	"digest-mismatch":
		"Store content changed without a digest re-stamp — foreign modification or an un-stamped writer. Verify with `git status Doc/store/<project>/`: a foreign edit → restore per skills/db-store-merge-runbook.md; a velpari write → report the missing re-stamp as a defect.",
	"store-uncommitted":
		"The store changed since the last commit. Publish normally (the flow commits it) — if you edited `Doc/store/**` by hand, revert that edit; the store is written only by publish/backfill/reconfirm/export.",
	"semver-contract-unavailable":
		"The Phase D semver API (core/semver.ts) is not present in this build — no action; the check degrades until batch gate 1 merges Phase D.",
	"semver-bump-mismatch":
		"The declared `bump:` frontmatter does not match what actually changed. Recompute the bump (MAJOR = id/structure change, MINOR = additive, PATCH = wording) per Doc/velpari-sequence/ and republish the pair.",
	"soft-lock-contract-unavailable":
		"The Phase B soft-lock API (core/soft-lock.ts) is not present in this build — no action; the check degrades until batch gate 1 merges Phase B.",
	"environment-node-old":
		"Upgrade Node to the version in package.json:engines.node (node:sqlite-backed store requirement) — the doctor and store will not run reliably below it.",
	"environment-git-missing":
		"Install git and add it to PATH — publish commits, backups, and the store protection hook all need it.",
	"environment-pi-missing":
		"Install pi (`npm i -g @earendil-works/pi-coding-agent`) or fix PATH — e2e/RPC tooling and the extension host need the `pi` binary.",
	"environment-config-invalid":
		"Fix the flagged config key in files.json (see the message), or re-run `/velpari-configure-inputs` to rewrite the file.",
	"conformance-not-applicable":
		"Run conformance from the pi-velpari extension checkout or a project with pi-velpari installed under node_modules — nothing to check here.",
	"conformance-layer-mismatch":
		"Restore the 4-layer layout: every folder under pi-extension/src/ must be declared in src/layers.ts, and every declared folder must exist (architecture-alignment test is the oracle).",
	"conformance-hooks-missing":
		"Restore the hook registrations in pi-extension/src/hooks/index.ts — the session/tool_call gates are part of the extension contract.",
	"conformance-dep-violation":
		"Remove the forbidden import: velpari must not import chirpi or pi-interactive-subagents (text references only — see AGENTS.md Coding conventions).",
	"config-baseline-missing":
		"Run `/velpari-doctor --velpari-fix` and pick Fix all to record the config baseline (files.json/agents.json/requirements-profile.json hashes) — future drift is detected against it.",
	"config-drift":
		"A config file changed since the baseline. If the change is yours: run `/velpari-doctor --velpari-fix` and accept via the config-baseline item (Show details). If not: `git diff .pi/velpari/` to see the foreign edit, then restore or re-configure deliberately.",
	"config-unreadable":
		"files.json is not valid JSON. Run `/velpari-doctor --velpari-fix` (config-restore-git restores the last committed version when tracked) or fix the syntax by hand, then `/velpari-configure-inputs` to verify.",
	"config-restore-git":
		"Restore `.pi/velpari/files.json` from the last committed version (`git checkout HEAD -- .pi/velpari/files.json`) — only when you did not mean to keep the broken edit.",
	"generated-manifest-unreadable":
		"`.pi/velpari/generated-manifest.json` is corrupt — re-run `/velpari-generate-sub-agents` to regenerate the manifest and its files.",
	"generated-file-missing":
		"A manifest-tracked generated file was deleted — re-run `/velpari-generate-sub-agents` (the phase auto-detects) to restore it.",
	"generated-file-modified":
		"A generated file changed since it was generated — regenerate via `/velpari-generate-sub-agents`, or keep your edit deliberately and regenerate so the manifest matches.",
	"generated-file-bad-config":
		"The generated agent's frontmatter is incomplete/invalid — fix the fields (name, description, tools, thinking, session-mode, auto-exit, spawning) or regenerate via `/velpari-generate-sub-agents`.",
	"generated-file-unregistered":
		"An agent file carries the generator footer but is not in the manifest — regenerate via `/velpari-generate-sub-agents` so the file is tracked, or remove the footer if it is hand-authored.",
	"binding-mismatch":
		"This work belongs in another worktree/branch (N17). Restart the session there — no changes were made here.",
	"binding-conflict":
		"Two active declarations point at different worktrees — ask the user which line to follow, then close or complete the other plan/run (newest PENDING plan wins once the other is DONE).",
	"bookkeeping-drift":
		"Run `/velpari-doctor --velpari-fix` — the stage flag auto-advances to match the already-published artifact (bookkeeping only; content stays human-gated).",
	// The fix fingerprint for the row above (preflight/fix-all batch key;
	// FIX_LEVELS is typed on SuggestionKey, so it needs this entry).
	"bookkeeping-advance":
		"Run `/velpari-doctor --velpari-fix` — the stage flag auto-advances to match the already-published artifact (evidence-gated bookkeeping only; content stays human-gated).",
	"scaffold-missing":
		"Run `/velpari-doctor --velpari-fix` — the missing standard folders/baseline are created in one confirm-gated batch (N23).",
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
	// Phase C (N23) — bookkeeping-only self-heal, paired RemediateFns
	// under doctor/checks/remediate/ (Subphase 3.3).
	"bookkeeping-advance": "auto-safe",
	"scaffold-missing": "auto-safe",
	"config-restore-git": "auto-safe",

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
	// Phase C (N23) — paired fns registered in Subphase 3.3.
	"bookkeeping-advance",
	"scaffold-missing",
	"config-restore-git",
]);

/**
 * Look up the fix level for a fingerprint. Defaults to `"interactive"`,
 * so unknown or unset fingerprints are treated conservatively (doctor
 * always asks before applying).
 */
export function levelFor(key: SuggestionKey): FixLevel {
	return FIX_LEVELS[key] ?? "interactive";
}
