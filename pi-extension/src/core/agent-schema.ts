/**
 * Shared agent-frontmatter schema (DSI P0, decision D12).
 *
 * Single source of truth for the agent field / tool / thinking-level /
 * session-mode sets consumed by BOTH the doctor
 * (`doctor/checks/agents.ts`) and the sub-agent generator
 * (`core/agents-generator.ts`). Before P0 these lived as three separate
 * literals and had already diverged once (the PH `thinking` bug).
 *
 * `roleToolContract(role)` derives a role's expected `tools:` list from
 * its bundled `skills/agents/<role>.md` template — the template is the
 * source of truth (DSI-2). P1's doctor tool-contract check consumes it.
 *
 * Layer 0 (domain primitive) — imports only `node:*` and the same-layer
 * `./paths.js` helper.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "./paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The 7 mandatory agent frontmatter keys. */
export const REQUIRED_AGENT_FIELDS: readonly string[] = [
	"name",
	"description",
	"tools",
	"thinking",
	"session-mode",
	"auto-exit",
	"spawning",
];

/**
 * Known pi tool names. Mirrors Senai's `_types.ts`. Anything outside
 * this set in an agent's `tools:` is a typo that blocks scout startup.
 */
export const KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set([
	"read",
	"write",
	"edit",
	"bash",
	"grep",
	"find",
	"ls",
	"askuserquestion",
	"intercom",
	"subagent",
	"taskcreate",
	"taskexecute",
	"taskget",
	"tasklist",
	"taskoutput",
	"taskstop",
	"taskupdate",
	"websearch",
	"fetchurl",
]);

/** Valid pi thinking levels. */
export const THINKING_LEVELS: ReadonlySet<string> = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

/** Valid `session-mode:` values per pi's agent frontmatter spec. */
export const SESSION_MODES: ReadonlySet<string> = new Set(["standalone", "lineage-only"]);

/**
 * Parse a `tools:` frontmatter value into a tool-name list. Accepts the
 * comma string (`read, write, bash`) and the YAML bracket list
 * (`[read, write]`) — brackets are stripped and the value splits on
 * commas/whitespace, matching the doctor's `checkAgentFileIntegrity`
 * tool parsing. Exported so both the contract resolver and the P1 doctor
 * check share one parser.
 *
 * @param value - Raw `tools:` scalar value (or `undefined`).
 * @returns The parsed tool names (empty when the value is blank).
 */
export function parseToolsValue(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(/[\s,[\]]+/)
		.map((t) => t.trim())
		.filter(Boolean);
}

/**
 * Role → expected tools, derived from the bundled
 * `skills/agents/<role>.md` template frontmatter (the source of truth —
 * DSI-2). Returns the parsed `tools:` list, or `null` when the template
 * is absent, unreadable, or carries no `tools:` line.
 *
 * Accepts both frontmatter spellings: the comma string
 * (`tools: read, write, bash`) and the YAML bracket list
 * (`tools: [read, write]`).
 *
 * @param role - The Velpari scout role id (the template basename).
 * @returns The template's tool names, or `null` when unavailable.
 */
export function roleToolContract(role: string): string[] | null {
	let templatePath: string;
	try {
		templatePath = join(findPackageRoot(__dirname), "skills", "agents", `${role}.md`);
	} catch {
		return null;
	}
	if (!existsSync(templatePath)) return null;
	let raw: string;
	try {
		raw = readFileSync(templatePath, "utf8");
	} catch {
		return null;
	}
	const block = raw.match(/^---\n([\s\S]*?)\n---/);
	if (!block || block[1] === undefined) return null;
	const toolsMatch = block[1].match(/^tools:\s*(.+)$/m);
	if (!toolsMatch || toolsMatch[1] === undefined) return null;
	const tools = parseToolsValue(toolsMatch[1]);
	return tools.length > 0 ? tools : null;
}
