/**
 * Per-role tool-contract check (DSI P1, decision D13).
 *
 * The doctor already validates that every `tools:` name is *known*
 * (`KNOWN_TOOL_NAMES`) and that the web-tool lock holds. It never
 * compared a role's on-disk tools to the role's *expected* set — so a
 * reviewer given `edit`, or a scout missing `write`/`bash`, passed clean
 * and then failed silently at run time.
 *
 * `roleToolContract(role)` (P0, `core/agent-schema.ts`) derives the
 * expected list from the bundled `skills/agents/<role>.md` template —
 * the template is the source of truth (DSI-2). This check compares each
 * role's effective agent file against that contract:
 *   - a missing contract tool → `error`;
 *   - an extra tool not in the contract → `warning`;
 *   - equal (order-insensitive) → `ok`.
 *
 * Absent agent files and roles with no template are skipped — the Scout
 * agents section owns presence.
 *
 * Layer 1 (stage logic) — imports `node:*`, `core/` (L0) and doctor
 * siblings.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { parseToolsValue, roleToolContract } from "../../core/agent-schema.js";
import {
	loadAgentConfig,
	resolveAgentName,
	VELPARI_ROLES,
	type AgentConfig,
	type VelpariRole,
} from "../../core/agents-config.js";
import { parseFrontmatter } from "./agents.js";
import { suggestionFor } from "./fix-suggestions.js";

/**
 * Test seam: override the role list and/or the contract resolver.
 * Production callers pass only `cwd`, so the bundled `VELPARI_ROLES` and
 * `roleToolContract` are used unchanged.
 */
export interface AgentToolContractOptions {
	/** Roles to audit (defaults to `VELPARI_ROLES`). */
	roles?: readonly string[];
	/** Contract resolver (defaults to `roleToolContract`). */
	contractFor?: (role: string) => string[] | null;
}

/**
 * Compare every Velpari role's on-disk agent `tools:` against its
 * template contract.
 *
 * @param cwd - Project root (holds `.pi/agents/` + `.pi/velpari/agents.json`).
 * @param options - Test seam; omit in production.
 * @returns The `"Agent tool contract"` diagnostic section.
 */
export function checkAgentToolContract(cwd: string, options: AgentToolContractOptions = {}): DiagnosticSection {
	const roles = options.roles ?? VELPARI_ROLES;
	const contractFor = options.contractFor ?? roleToolContract;
	const agentsDir = join(cwd, ".pi", "agents");
	const items: DiagnosticItem[] = [];

	let agentConfig: AgentConfig | null = null;
	try {
		agentConfig = loadAgentConfig(cwd);
	} catch {
		agentConfig = null;
	}

	let checked = 0;
	let skipped = 0;
	let missingCount = 0;
	let extraCount = 0;
	const seen = new Set<string>();

	for (const role of roles) {
		// VELPARI_ROLES lists the 4 reviewer roles twice (STAGE_SCOUT_ROLES
		// + REVIEWER_ROLES) — audit each role once.
		if (seen.has(role)) continue;
		seen.add(role);

		const contract = contractFor(role);
		if (!contract || contract.length === 0) {
			skipped++;
			continue;
		}

		const agentName = resolveAgentName(agentConfig, role as VelpariRole);
		const target = join(agentsDir, `${agentName}.md`);
		if (!existsSync(target)) {
			// The Scout agents section owns presence — skip here.
			skipped++;
			continue;
		}

		const fm = parseFrontmatter(readFileSync(target, "utf8"));
		const tools = parseToolsValue(fm.tools);
		const missingTools = contract.filter((t) => !tools.includes(t));
		const extraTools = tools.filter((t) => !contract.includes(t));
		checked++;

		if (missingTools.length > 0) {
			missingCount++;
			items.push({
				status: "error",
				message: `${agentName}.md (role ${role}) is missing contract tool(s): ${missingTools.join(", ")}.`,
				details: [`Contract tools: ${contract.join(", ")}`],
				suggestion: suggestionFor("scout-agent-bad-frontmatter"),
			});
		}
		if (extraTools.length > 0) {
			extraCount++;
			items.push({
				status: "warning",
				message: `${agentName}.md (role ${role}) carries tool(s) outside the contract: ${extraTools.join(", ")}.`,
				details: [`Contract tools: ${contract.join(", ")}`],
				suggestion:
					"Remove the extra tool(s) from the agent file, or add them to the bundled template at skills/agents/<role>.md if they are intentional.",
			});
		}
		if (missingTools.length === 0 && extraTools.length === 0) {
			items.push({
				status: "ok",
				message: `${agentName}.md (role ${role}) tools match the contract.`,
			});
		}
	}

	items.push({
		status: missingCount === 0 && extraCount === 0 ? "ok" : "info",
		message: `Agent tool contract summary: ${checked} checked, ${skipped} skipped (no template or file absent), ${missingCount} missing-tool error(s), ${extraCount} extra-tool warning(s).`,
	});

	return { title: "Agent tool contract", items };
}
