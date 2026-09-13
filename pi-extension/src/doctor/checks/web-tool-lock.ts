/**
 * Web-tool lock check (Phase 4c).
 *
 * Walks `.pi/agents/*.md` and flags any agent whose frontmatter
 * declares `websearch` or `fetchurl` unless its name is
 * `web-search-agent` (the only scout allowed to reach the web).
 *
 * Strict policy mirroring Senai: two agents with web tools create
 * ambiguity about who owns external knowledge. Error status; not a
 * suggestion.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { parseFrontmatter } from "./agents.js";

const WEB_TOOLS = new Set(["websearch", "fetchurl"]);
const ALLOWED_AGENT = "web-search-agent";

export function checkWebToolLock(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const agentsDir = join(cwd, ".pi", "agents");

	if (!existsSync(agentsDir)) {
		items.push({
			status: "ok",
			message: "No .pi/agents/ directory — nothing to lock.",
		});
		return { title: "Web-tool lock", items };
	}

	const agents = readdirSync(agentsDir, { encoding: "utf8" }).filter(
		(name) => typeof name === "string" && name.endsWith(".md"),
	);

	if (agents.length === 0) {
		items.push({
			status: "ok",
			message: "No scout agents present — nothing to lock.",
		});
		return { title: "Web-tool lock", items };
	}

	let violations = 0;
	let compliant = 0;

	for (const filename of agents) {
		const target = join(agentsDir, filename);
		const content = readFileSync(target, "utf8");
		const fm = parseFrontmatter(content);
		const agentName = fm.name ?? filename.replace(/\.md$/, "");
		const toolsRaw = fm.tools ?? "";
		const tools = toolsRaw
			.split(/[\s,[\]]+/)
			.map((t) => t.trim())
			.filter(Boolean);

		const webTools = tools.filter((t) => WEB_TOOLS.has(t));
		if (webTools.length === 0) continue;

		if (agentName === ALLOWED_AGENT) {
			compliant++;
			continue;
		}

		violations++;
		items.push({
			status: "error",
			message: `${agentName} (${filename}) carries web tool(s): ${webTools.join(", ")}. Only the \`${ALLOWED_AGENT}\` agent may reach the web.`,
			details: [
				"Having two agents reach the web confuses the orchestra about who owns external knowledge.",
				`Remove \`${webTools.join("\`, \`")}\` from the agent's \`tools:\` list, or rename the agent to \`${ALLOWED_AGENT}\`.`,
			],
		});
	}

	if (violations === 0 && compliant === 0) {
		items.push({
			status: "ok",
			message: `Scanned ${agents.length} agent file(s) — no web tools declared anywhere.`,
		});
	} else if (violations === 0) {
		items.push({
			status: "ok",
			message: `Web-tool lock OK: ${compliant} compliant agent(s), 0 violations across ${agents.length} file(s).`,
		});
	} else {
		items.push({
			status: "error",
			message: `Web-tool lock: ${violations} violation(s) across ${agents.length} agent file(s).`,
		});
	}

	return { title: "Web-tool lock", items };
}
