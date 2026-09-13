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

/** The 32 stage-scout ids from STAGE_REGISTRY, in registry order. */
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
	// atomic-function
	"af-source-rtm",
	"af-source-pseudocode",
	"af-source-prd",
	"af-source-testcases",
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

/** Every Velpari scout role: 4 brainstorm + 36 stage + 2 feasibility-conditional = 42. */
export const VELPARI_ROLES = [
	...BRAINSTORM_ROLES,
	...STAGE_SCOUT_ROLES,
	...FEASIBILITY_CONDITIONAL_ROLES,
] as const;
export type VelpariRole = (typeof VELPARI_ROLES)[number];

/** Identity map: every role defaults to the bundled agent of the same name. */
export const DEFAULT_AGENTS: Record<VelpariRole, string> = Object.fromEntries(
	VELPARI_ROLES.map((role) => [role, role]),
) as Record<VelpariRole, string>;

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
	"pseudo-algorithm-extractor": "Pseudocode — algorithm extractor",
	"pseudo-edge-case-handler": "Pseudocode — edge-case handler",
	"pseudo-complexity-analyzer": "Pseudocode — complexity analyzer",
	"pseudo-consolidator": "Pseudocode — consolidator",
	"testplan-strategy-designer": "Test plan — strategy designer",
	"testplan-unit-test-generator": "Test plan — unit-test generator",
	"testplan-integration-test-generator": "Test plan — integration-test generator",
	"testplan-coverage-tracer": "Test plan — coverage tracer",
	"af-source-rtm": "Atomic functions — from RTM",
	"af-source-pseudocode": "Atomic functions — from pseudocode",
	"af-source-prd": "Atomic functions — from PRD",
	"af-source-testcases": "Atomic functions — from test cases",
	"do-topology": "Dev order — topology",
	"do-risk": "Dev order — risk",
	"do-test": "Dev order — test coverage",
	"do-value": "Dev order — user value",
	"design-consistency-checker": "Final design — consistency checker",
	"design-coverage-checker": "Final design — coverage checker",
	"design-contract-checker": "Final design — contract checker",
	"design-finalizer": "Final design — finalizer",
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
