/**
 * agents.json — maps each Velpari scout role to an agent name (Senai parity).
 *
 * The file lives at `.pi/velpari/agents.json`. It is NOT auto-created:
 * absence means "all defaults" (the identity map DEFAULT_AGENTS). It is
 * written only by /velpari-configure-agents (or by hand, if you know the
 * role names).
 *
 * Roles: the 4 brainstorm scout roles (BRAINSTORM_ROLES, mirroring
 * io/agents-install.ts:SCOUT_AGENT_IDS) plus the 36 stage-scout ids
 * (STAGE_SCOUT_ROLES, extracted from stages/registry.ts:STAGE_REGISTRY in
 * registry order) plus the 2 feasibility v2 conditional roles
 * (FEASIBILITY_CONDITIONAL_ROLES). VELPARI_ROLES is the union — 42 roles total.
 *
 * Layer 0. Imports only node builtins, ./constants.js, ../io/atomic-write.js
 * (same layer), and getAgentDir/parseFrontmatter from
 * @earendil-works/pi-coding-agent (external dep).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { PATHS } from "./constants.js";
import { atomicWriteJson } from "../io/atomic-write.js";
import type { GeneratedRoleDef } from "./agents-generator.js";
import { getBundledCustomRoles, loadCustomRoles } from "./custom-roles.js";

export const AGENTS_CONFIG_FILE = "agents.json";
export const AGENTS_CONFIG_COMMENT =
	"Velpari config: maps each Velpari scout role to an agent name. Managed by /velpari-configure-agents. Hand-edit only if you know the role names.";

/** The 4 brainstorm scout roles (mirrors io/agents-install.ts:SCOUT_AGENT_IDS). */
export const BRAINSTORM_ROLES = [
	"extractor",
	"prd-checker",
	"rtm-checker",
	"web-search-agent",
] as const;

/** The 35 stage-scout ids from STAGE_REGISTRY, in registry order. */
export const STAGE_SCOUT_ROLES = [
	// prd
	"fr-extractor",
	"nfr-checker",
	"helper-detector",
	"consolidator",
	// rtm
	"rtm-requirement-tracer",
	"rtm-test-case-linker",
	"rtm-coverage-analyzer",
	"rtm-consolidator",
	// feasibility
	"feasibility-tech",
	"feasibility-schedule",
	"feasibility-cost",
	"feasibility-risk",
	// design
	"design-style-selector",
	"design-module-decomposer",
	"design-contract-definer",
	"design-data-flow-mapper",
	"design-error-definer",
	// pseudocode
	"pseudo-algorithm-extractor",
	"pseudo-edge-case-handler",
	"pseudo-complexity-analyzer",
	"pseudo-consolidator",
	// testplan
	"testplan-strategy-designer",
	"testplan-unit-test-generator",
	"testplan-integration-test-generator",
	"testplan-coverage-tracer",
	// atomic-function (Stage 6 — runs BEFORE pseudocode in industry-standard order)
	"af-source-rtm",
	"af-source-design",
	"af-source-prd",
	"af-source-feas",
	// Reviewer scouts (Phase D — Plan D reviewer-generalization). Each
	// reviewer is gated by tier + overlay + reviewerMode via
	// stages/registry.ts:filterReviewerSlot + core/atomic-tier.ts:shouldRunReviewerForStage.
	"reviewer", // atomic-function
	"pseudocode-reviewer",
	"testplan-reviewer",
	"design-reviewer",
	// development-order
	"do-topology",
	"do-risk",
	"do-test",
	"do-value",
	// final-design
	"design-consistency-checker",
	"design-coverage-checker",
	"design-contract-checker",
	"design-finalizer",
	// v1.4.0 — /velpari-design-logging cross-cutting discipline command.
	// These 3 scouts live in their own constant (below) because they are
	// NOT part of STAGE_REGISTRY — logging is a cross-cutting discipline
	// command, not a stage. Keeping them out of STAGE_SCOUT_ROLES
	// preserves the registry-order cross-check in agents-config.test.ts.
] as const;

/**
 * v1.4.0 — /velpari-design-logging cross-cutting discipline command.
 * 3 scouts run in parallel; not part of STAGE_REGISTRY.
 * Kept in its own array so STAGE_SCOUT_ROLES stays in registry order
 * (test gate in agents-config.test.ts).
 */
export const LOGGING_SCOUT_ROLES = [
	"logging-standards-researcher",
	"logging-architecture-designer",
	"logging-compliance-mapper",
] as const;

/**
 * Feasibility v2 conditional agents (feasibility-v2 upgrade). NOT part of
 * the 4-scout wave — spawned conditionally by the parent LLM: the reuse
 * scout only after web-research consent, the spike agent only on the
 * build-from-scratch path with no configured framework. Kept out of
 * STAGE_SCOUT_ROLES so the registry-order cross-check stays intact.
 */
export const FEASIBILITY_CONDITIONAL_ROLES = [
	"feasibility-reuse-scout",
	"feasibility-spike",
] as const;

/**
 * v1.x — Reviewer sub-agents (Plan D). The reviewer is the **only adversarial
 * critic** in Velpari — it critiques the merged draft + scout reports after
 * the N source scouts finish. Each stage's reviewer is gated by tier +
 * overlay + reviewerMode via stages/registry.ts:filterReviewerSlot +
 * core/atomic-tier.ts:shouldRunReviewerForStage. The atomic-function reviewer
 * ships first (Plan A); pseudocode / testplan / design reviewers ship with
 * Plan D. Each reviewer writes its verdict JSON to
 * `<runDir>/<stage>/scouts/<stage>-reviewer-report.json`. The doctor gate
 * (runPublishGate) loads the appropriate verdict per artifact.
 */
export const REVIEWER_ROLES = [
	"reviewer", // atomic-function (Plan A)
	"pseudocode-reviewer", // Plan D
	"testplan-reviewer", // Plan D
	"design-reviewer", // Plan D
] as const;

/** Every Velpari scout role: 4 brainstorm + 38 stage + 2 feasibility-conditional + 3 logging + 4 reviewer = 51. */
export const VELPARI_ROLES = [
	...BRAINSTORM_ROLES,
	...STAGE_SCOUT_ROLES,
	...FEASIBILITY_CONDITIONAL_ROLES,
	...LOGGING_SCOUT_ROLES,
	...REVIEWER_ROLES,
] as const;
export type VelpariRole = (typeof VELPARI_ROLES)[number];

/**
 * Role definitions for the 4 brainstorm sub-agents (v1 of
 * `/velpari-generate-sub-agents`). Each row carries the inputs
 * `buildGeneratedAgentMarkdown` needs:
 *   - `role` / `label` — file name + human label
 *   - `tools` — full tool list (runtime dispatcher may strip; see below)
 *   - `mandate` — one-line description of the job
 *   - `invocationHint` — when the harness should auto-spawn this agent;
 *     becomes part of the YAML `description:` frontmatter
 *   - `outOfScope` — explicit boundaries the agent must respect
 *   - `bodyFile` — optional canonical body file under
 *     `pi-extension/src/agents/<bodyFile>`. When present, replaces the
 *     standard mandate / outOfScope / completion contract template.
 *
 * Runtime note: the brainstorm dispatcher (`stages/brainstorm/dispatcher.ts`)
 * strips `write` / `edit` / `bash` from non-web-search scouts at dispatch
 * time. The generator emits the full tool list per the agent's contract;
 * the dispatcher enforces read-only behavior in the multiplexer pane.
 * The web-search-agent's `WebSearch` + `FetchURL` survive the strip.
 *
 * This table is the v1 brainstorm-only scope. Stage scouts (the other 34
 * roles) are added in subsequent sections.
 */
export const VELPARI_BRAINSTORM_GENERATED_ROLES: readonly GeneratedRoleDef[] = [
	{
		role: "extractor",
		label: "Brainstorm — Answer Extractor",
		tools: ["read", "write", "bash"],
		mandate:
			"Capture each interview answer verbatim from the brainstorm interview and classify it as new-requirement, refinement, or helper-function. Write a structured JSON report to the assigned artifact path.",
		invocationHint:
			"Spawn in the brainstorm SCANS step after the user confirms the understanding. Extract structured proposals from the active brainstorm notes.",
		outOfScope: [
			"Do not edit the brainstorm notes (read-only).",
			"Do not write or modify PRD, RTM, or any other artifact — those stages run later.",
			"Do not search the web (use web-search-agent for that).",
			"Do not call other subagents (you are a leaf specialist).",
		],
	},
	{
		role: "prd-checker",
		label: "Brainstorm — PRD Delta Checker",
		tools: ["read", "write", "bash"],
		mandate:
			"Read the existing PRD (when present). For each interview answer, classify it as an update to an existing FR-N or as a brand-new FR-N. Emit a JSON delta report.",
		invocationHint:
			"Spawn in the brainstorm SCANS step in parallel with the other code+doc scouts. Cross-check the active brainstorm notes against the published PRD (when present) for missing requirements, scope drift, and contradictions.",
		outOfScope: [
			"Do not edit the PRD or any other artifact (read-only).",
			"Do not write or create source files.",
			"Do not search the web (use web-search-agent for that).",
			"Do not call other subagents (you are a leaf specialist).",
		],
	},
	{
		role: "rtm-checker",
		label: "Brainstorm — RTM Impact Checker",
		tools: ["read", "write", "bash"],
		mandate:
			"Read the existing RTM (when present). For each FR-N touched by an interview answer, identify test-case implications. Emit a JSON report.",
		invocationHint:
			"Spawn in the brainstorm SCANS step in parallel with the other code+doc scouts. Audit the active brainstorm notes + PRD against the published RTM (when present) for missing requirement mappings and orphan test cases.",
		outOfScope: [
			"Do not edit the RTM or any other artifact (read-only).",
			"Do not write or create source files.",
			"Do not search the web (use web-search-agent for that).",
			"Do not call other subagents (you are a leaf specialist).",
		],
	},
	{
		role: "web-search-agent",
		label: "Brainstorm — Web Research (Consent-Gated)",
		tools: ["read", "write", "bash", "WebSearch", "FetchURL"],
		mandate:
			"Fetch external references for the user's input — community resources (Stack Overflow, Reddit, GitHub issues), official documentation (language, framework, library docs), and similar open-source projects. Emit a JSON report.",
		invocationHint:
			"Spawn in the brainstorm SCANS step ONLY when the user picked the community scan at the scan-plan gate (FR-52 web-search consent). Without consent the parent LLM must not spawn this agent.",
		outOfScope: [
			"Do not edit any files (read-only).",
			"Do not edit brainstorm notes (read-only).",
			"Do not run shell commands or modify code.",
			"Do not improvise outside web research — if the user's question is not a web lookup, say so and return immediately.",
			"Do not call other subagents (you are a leaf specialist).",
		],
		// Canonical body replaces the standard template for this specialist.
		bodyFile: "web-search-agent-body.md",
	},
];

/** Identity map: every role defaults to the bundled agent of the same name. */
export const DEFAULT_AGENTS: Record<VelpariRole, string> = Object.fromEntries(
	VELPARI_ROLES.map((role) => [role, role]),
) as Record<VelpariRole, string>;

/**
 * v1.x — Reviewer role definitions for the v2 sub-agent generator
 * (Plan E). Today, `/velpari-generate-sub-agents` is brainstorm-only
 * and does NOT emit reviewer copies. Plan E wires the generator to
 * emit per-stage reviewer copies using this table as the input.
 *
 * 4 reviewer roles — one per reviewer stage (Plan D):
 *   reviewer               — atomic-function (Plan A)
 *   pseudocode-reviewer    — pseudocode stage (Plan D)
 *   testplan-reviewer      — testplan stage (Plan D)
 *   design-reviewer        — architecture-generator / design (Plan D)
 *
 * Mirrors `VELPARI_BRAINSTORM_GENERATED_ROLES` so the v2 generator can
 * reuse `core/agents-generator.ts:buildGeneratedAgentMarkdown` for the
 * reviewer role without changing the deterministic-assembly contract.
 */
export const VELPARI_REVIEWER_GENERATED_ROLES: readonly GeneratedRoleDef[] = [
	{
		role: "reviewer",
		label: "Stage — adversarial reviewer",
		tools: ["read", "write", "bash"],
		mandate:
			"Read the merged working-copy draft and the N source-scout reports; emit a structured verdict JSON (errors / warnings / info + final verdict = approve | needs-fix | block). The verdict is the single source of truth for tier checks at publish time — the doctor gate consumes it but does not re-derive any rule.",
		invocationHint:
			"Spawn after the N source scouts finish and after the parent LLM has merged their reports into a draft, but before the preview gate. Tier gate (Advanced required, Intermediate opt-in via --velpari-run-reviewer, Entry skip) + overlay gate (required when overlay.requiresReviewer=true) live in core/atomic-tier.ts:shouldRunReviewer.",
		outOfScope: [
			"Do not spawn subagents (you are a leaf specialist).",
			"Do not write any artifact other than the verdict JSON to <reviewerReportPath>.",
			"Do not edit the working copy — your job is to flag issues, the parent LLM applies fixes.",
			"Do not override doctor errors — the verdict is additive to the doctor gate, never subtractive.",
		],
	},
	{
		role: "pseudocode-reviewer",
		label: "Stage — adversarial reviewer (pseudocode)",
		tools: ["read", "write", "bash"],
		mandate:
			"Read the merged pseudocode draft and the 4 source-scout reports (pseudo-algorithm-extractor, pseudo-edge-case-handler, pseudo-complexity-analyzer, pseudo-consolidator). Emit a structured verdict JSON — per-af-missing, pseudocode-empty, complexity-stated, inputs-declared, outputs-declared, complexity-exceeded, edge-cases-missing, error-handling-missing, dependency-cyclic, atomic-tier-mismatch + cross-scout-contradiction, algorithm-rename-mismatch, tier-mismatch, standards-mapping-missing.",
		invocationHint:
			"Spawn after the 4 source scouts finish and the parent LLM merges the per-AF pseudocode body. Verdict path: <runDir>/pseudocode/scouts/pseudocode-reviewer-report.json. Tier gate shared with atomic-function reviewer.",
		outOfScope: [
			"Do not spawn subagents (you are a leaf specialist).",
			"Do not write any artifact other than the verdict JSON to <reviewerReportPath>.",
			"Do not edit the working copy — your job is to flag issues, the parent LLM applies fixes.",
			"Do not override doctor errors — the verdict is additive to the doctor gate, never subtractive.",
		],
	},
	{
		role: "testplan-reviewer",
		label: "Stage — adversarial reviewer (testplan)",
		tools: ["read", "write", "bash"],
		mandate:
			"Read the merged test-plan + test-cases drafts and the 4 source-scout reports (testplan-strategy-designer, testplan-unit-test-generator, testplan-integration-test-generator, testplan-coverage-tracer). Emit a structured verdict JSON — test-plan-missing, test-cases-missing, test-strategy-stated, coverage-target-stated, per-af-test, test-pyramid-balanced, test-independence, assertion-quality, flaky-pattern, coverage-traceability + cross-scout-contradiction, test-misnaming, tier-mismatch, standards-mapping-missing.",
		invocationHint:
			"Spawn after the 4 source scouts finish and the parent LLM merges the test-plan + test-cases bodies. Verdict path: <runDir>/testplan/scouts/testplan-reviewer-report.json. Tier gate shared with atomic-function reviewer.",
		outOfScope: [
			"Do not spawn subagents (you are a leaf specialist).",
			"Do not write any artifact other than the verdict JSON to <reviewerReportPath>.",
			"Do not edit the working copy — your job is to flag issues, the parent LLM applies fixes.",
			"Do not override doctor errors — the verdict is additive to the doctor gate, never subtractive.",
		],
	},
	{
		role: "design-reviewer",
		label: "Stage — adversarial reviewer (design)",
		tools: ["read", "write", "bash"],
		mandate:
			"Read the merged design draft and the 5 source-scout reports (design-style-selector, design-module-decomposer, design-contract-definer, design-data-flow-mapper, design-error-definer). Emit a structured verdict JSON covering arc42 + SEI ATAM + C4 sections — section-0-missing, section-04-missing, section-5-missing, section-9-missing, section-10-missing, section-11-missing, section-12-missing, section-13-missing, section-14-missing, adr-001-present, qa-scenarios-stated, c4-diagrams-complete + cross-scout-contradiction, adr-inconsistent, tier-mismatch, standards-mapping-missing.",
		invocationHint:
			"Spawn after the 5 source scouts finish and the parent LLM merges the design body (arc42 sections). Verdict path: <runDir>/design/scouts/design-reviewer-report.json. Tier gate shared with atomic-function reviewer.",
		outOfScope: [
			"Do not spawn subagents (you are a leaf specialist).",
			"Do not write any artifact other than the verdict JSON to <reviewerReportPath>.",
			"Do not edit the working copy — your job is to flag issues, the parent LLM applies fixes.",
			"Do not override doctor errors — the verdict is additive to the doctor gate, never subtractive.",
		],
	},
];

/** Human labels for pickers and error messages (tone: skills/agents/<id>.md frontmatter). */
export const ROLE_LABELS: Record<VelpariRole, string> = {
	extractor: "Brainstorm — answer extractor",
	"prd-checker": "Brainstorm — PRD delta checker",
	"rtm-checker": "Brainstorm — RTM impact checker",
	"web-search-agent": "Brainstorm — web research (consent-gated)",
	"fr-extractor": "PRD — FR extractor",
	"nfr-checker": "PRD — NFR checker",
	"helper-detector": "PRD — helper detector",
	consolidator: "PRD — consolidator",
	"rtm-requirement-tracer": "RTM — requirement tracer",
	"rtm-test-case-linker": "RTM — test-case linker",
	"rtm-coverage-analyzer": "RTM — coverage analyzer",
	"rtm-consolidator": "RTM — consolidator",
	"feasibility-tech": "Feasibility — technical",
	"feasibility-schedule": "Feasibility — schedule",
	"feasibility-cost": "Feasibility — cost",
	"feasibility-risk": "Feasibility — risk",
	"feasibility-reuse-scout": "Feasibility — reuse scan (consent-gated)",
	"feasibility-spike": "Feasibility — language spike",
	"design-module-decomposer": "Design — module decomposer",
	"design-contract-definer": "Design — contract definer",
	"design-data-flow-mapper": "Design — data-flow mapper",
	"design-error-definer": "Design — error definer",
	"design-style-selector": "Design — style selector",
	"pseudo-algorithm-extractor": "Pseudocode — algorithm extractor",
	"pseudo-edge-case-handler": "Pseudocode — edge-case handler",
	"pseudo-complexity-analyzer": "Pseudocode — complexity analyzer",
	"pseudo-consolidator": "Pseudocode — consolidator",
	"testplan-strategy-designer": "Test plan — strategy designer",
	"testplan-unit-test-generator": "Test plan — unit-test generator",
	"testplan-integration-test-generator": "Test plan — integration-test generator",
	"testplan-coverage-tracer": "Test plan — coverage tracer",
	"af-source-rtm": "Atomic functions — from RTM",
	"af-source-design": "Atomic functions — from design",
	"af-source-prd": "Atomic functions — from PRD",
	"af-source-feas": "Atomic functions — from feasibility",
	"do-topology": "Dev order — topology",
	"do-risk": "Dev order — risk",
	"do-test": "Dev order — test coverage",
	"do-value": "Dev order — user value",
	"design-consistency-checker": "Final design — consistency checker",
	"design-coverage-checker": "Final design — coverage checker",
	"design-contract-checker": "Final design — contract checker",
	"design-finalizer": "Final design — finalizer",
	// v1.4.0 — /velpari-design-logging
	"logging-standards-researcher": "Logging design — standards researcher",
	"logging-architecture-designer": "Logging design — architecture designer",
	"logging-compliance-mapper": "Logging design — compliance mapper",
	// v1.x — reviewer sub-agent (Phase 1 of reviewer plan)
	reviewer: "Stage — adversarial reviewer",
	// Plan D — reviewer-generalization to pseudocode / testplan / design
	"pseudocode-reviewer": "Stage — adversarial reviewer (pseudocode)",
	"testplan-reviewer": "Stage — adversarial reviewer (testplan)",
	"design-reviewer": "Stage — adversarial reviewer (design)",
};

/** agents.json shape. `agents` is sparse — missing roles fall back to DEFAULT_AGENTS. */
export interface AgentConfig {
	version: 1;
	agents: Partial<Record<VelpariRole, string>>;
}

/** Absolute path to `.pi/velpari/agents.json` for the given project root. */
export function getAgentConfigPath(cwd: string): string {
	return join(cwd, PATHS.CONFIG_DIR, AGENTS_CONFIG_FILE);
}

/**
 * Load agents.json. Returns null when the file is missing (absence means
 * "all defaults"). Throws `Invalid agent config at <path>: ...` on bad JSON,
 * wrong version, unknown role, or non-string value. The `_comment` field is
 * stripped before validation.
 */
export function loadAgentConfig(cwd: string): AgentConfig | null {
	const configPath = getAgentConfigPath(cwd);
	let raw: string;
	try {
		raw = readFileSync(configPath, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new Error(`Invalid agent config at ${configPath}: ${(err as Error).message}`);
	}
	let parsed: AgentConfig;
	try {
		parsed = JSON.parse(raw) as AgentConfig;
		delete (parsed as unknown as Record<string, unknown>)._comment;
		validateAgentConfig(parsed);
	} catch (err) {
		throw new Error(`Invalid agent config at ${configPath}: ${(err as Error).message}`);
	}
	return parsed;
}

/** Save agents.json atomically, with the `_comment` header field. */
export function saveAgentConfig(cwd: string, config: AgentConfig): void {
	atomicWriteJson(getAgentConfigPath(cwd), { _comment: AGENTS_CONFIG_COMMENT, ...config });
}

/**
 * Validate an AgentConfig. Throws with the allowed-role list in the message
 * when an unknown role is present.
 */
export function validateAgentConfig(config: AgentConfig): void {
	if (config.version !== 1) {
		throw new Error("Missing or invalid 'version' field (expected 1)");
	}
	if (!config.agents || typeof config.agents !== "object" || Array.isArray(config.agents)) {
		throw new Error("Missing or invalid 'agents' field");
	}
	for (const [role, agentName] of Object.entries(config.agents)) {
		if (agentName !== undefined && typeof agentName !== "string") {
			throw new Error(`agents.${role} must be a string`);
		}
		if (!(VELPARI_ROLES as readonly string[]).includes(role)) {
			throw new Error(
				`Unknown role "${role}". Allowed roles: ${VELPARI_ROLES.map(
					(r) => `${ROLE_LABELS[r]} (${r})`,
				).join(", ")}`,
			);
		}
	}
}

/** Resolve the agent name for a role: explicit mapping wins, else DEFAULT_AGENTS. */
export function resolveAgentName(config: AgentConfig | null, role: VelpariRole): string {
	const mapped = config?.agents?.[role];
	if (mapped) return mapped;
	return DEFAULT_AGENTS[role];
}

/** Absolute path to Pi's user-level agents directory (`~/.pi/agent/agents`). */
export function getUserAgentsDir(): string {
	return join(getAgentDir(), "agents");
}

/** Names that resolve without any file on disk — the 42 bundled defaults. */
const BUNDLED_DEFAULT_NAMES: ReadonlySet<string> = new Set(VELPARI_ROLES);

/**
 * Overlay scout role prefix (Phase 5). Any role beginning with `overlay-`
 * is loaded from an overlay's `scouts/<role>.md` rather than the bundled
 * agents. The role is the overlay's responsibility; agents.json can map
 * it to a custom agent name, but absence means "use the overlay's
 * bundled scout".
 *
 * This function is the gate the registry uses to decide whether a role
 * is a static bundled scout or an overlay-specific scout.
 */
export function isOverlayRole(role: string): boolean {
	return role.startsWith("overlay-");
}

/**
 * Resolve the agent name for an arbitrary role. Overlay roles fall back
 * to the role name itself (the overlay's bundled scout), not a bundled
 * default. Used by the conditional-scout spawn logic in stages/registry.ts.
 */
export function resolveOverlayAgentName(role: string): string {
	return role;
}

/**
 * Check that every explicitly mapped agent name actually exists somewhere:
 * project `.pi/agents/<name>.md`, the user agents dir, or the bundled
 * defaults. Returns one error string per missing mapping (empty = all good).
 */
export function validateMappedAgents(cwd: string, config: AgentConfig): string[] {
	const errors: string[] = [];
	for (const [role, agentName] of Object.entries(config.agents)) {
		if (!agentName) continue;

		const projectPath = join(cwd, ".pi", "agents", `${agentName}.md`);
		const userPath = join(getUserAgentsDir(), `${agentName}.md`);
		const isBundled = BUNDLED_DEFAULT_NAMES.has(agentName);

		if (!isBundled && !existsSync(projectPath) && !existsSync(userPath)) {
			errors.push(
				`Custom agent "${agentName}" for role ${ROLE_LABELS[role as VelpariRole]} (${role}) not found. Expected ${projectPath} or ${userPath}.`,
			);
		}
	}
	return errors;
}

export type AgentSource = "project" | "user" | "bundled";

export interface DiscoveredAgent {
	name: string;
	description: string;
	source: AgentSource;
	filePath?: string;
}

function isDirectory(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/** Walk up from cwd to the nearest `.pi/agents/` directory (Senai pattern). */
export function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

/**
 * Discover all agents visible to this project, in priority order:
 *   1. project `.pi/agents/*.md` (nearest, walking up from cwd)
 *   2. user agents dir (`getAgentDir()/agents`)
 *   3. the 42 bundled defaults
 *   4. the project's custom-role defaults (from `.pi/velpari/custom-roles.json`)
 *   5. the bundled custom-role starter (fallback for fresh projects)
 * Dedup by name — first source wins.
 */
export function discoverAgents(cwd: string): DiscoveredAgent[] {
	const agents: DiscoveredAgent[] = [];
	const seen = new Set<string>();

	const projectAgentsDir = findNearestProjectAgentsDir(cwd);
	if (projectAgentsDir) {
		for (const agent of loadAgentsFromDir(projectAgentsDir, "project")) {
			if (!seen.has(agent.name)) {
				agents.push(agent);
				seen.add(agent.name);
			}
		}
	}

	for (const agent of loadAgentsFromDir(getUserAgentsDir(), "user")) {
		if (!seen.has(agent.name)) {
			agents.push(agent);
			seen.add(agent.name);
		}
	}

	for (const role of VELPARI_ROLES) {
		if (!seen.has(role)) {
			agents.push({ name: role, description: ROLE_LABELS[role], source: "bundled" });
			seen.add(role);
		}
	}

	// Custom-role defaults: project-level overrides bundled starter.
	const projectCustom = loadCustomRoles(cwd);
	if (projectCustom) {
		for (const role of projectCustom.roles) {
			if (!seen.has(role.role)) {
				agents.push({
					name: role.role,
					description: `${role.label} (custom role from .pi/velpari/custom-roles.json)`,
					source: "bundled",
				});
				seen.add(role.role);
			}
		}
	} else {
		// No project custom-roles.json — fall back to the bundled starter
		// so /velpari-agents / /velpari-configure-agents still surface the
		// pseudocode-reviewer as a known role.
		const bundledCustom = getBundledCustomRoles();
		for (const role of bundledCustom.roles) {
			if (!seen.has(role.role)) {
				agents.push({
					name: role.role,
					description: `${role.label} (custom role, bundled starter)`,
					source: "bundled",
				});
				seen.add(role.role);
			}
		}
	}

	return agents;
}

function loadAgentsFromDir(dir: string, source: "project" | "user"): DiscoveredAgent[] {
	const agents: DiscoveredAgent[] = [];
	if (!existsSync(dir)) return agents;

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		const filePath = join(dir, entry);
		const parsed = parseAgentFile(filePath);
		if (parsed) {
			agents.push({ ...parsed, source });
		}
	}

	return agents;
}

/** Parse `name` + `description` from an agent file's frontmatter. */
function parseAgentFile(
	filePath: string,
): { name: string; description: string; filePath: string } | undefined {
	try {
		const content = readFileSync(filePath, "utf8");
		const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
		const name = String(frontmatter.name ?? "").trim();
		const description = String(frontmatter.description ?? "").trim();
		if (!name || !description) return undefined;
		return { name, description, filePath };
	} catch {
		return undefined;
	}
}
