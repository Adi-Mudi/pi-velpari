/**
 * Real-format frontmatter field check (DSI P2b, decision D16).
 *
 * `checkAgentFileIntegrity` validates the *required* agent fields (name,
 * tools, thinking, session-mode, auto-exit, spawning). The real pi agent
 * format also carries optional keys — `model`, `interactive`,
 * `disallowed_tools`, `allowed_subagents` — that the doctor never
 * validated, so a typo'd `model:` or an unknown `disallowed_tools:`
 * token passed clean and then failed at scout startup.
 *
 * This check validates only the value/type of those four keys **when
 * present** (absent fields are fine) and never flags an unknown-but-valid
 * forward-compat key:
 *   - `model:` must be `provider/model-id` (an optional legacy
 *     `:thinking` suffix is tolerated) → else `error`;
 *   - `interactive:` must be `true`/`false` → else `warning`;
 *   - `disallowed_tools:` tokens must be known tool names → else `error`;
 *   - `allowed_subagents:` must parse to non-empty names → else `warning`.
 *
 * Layer 1 (stage logic) — imports `node:*`, `core/` (L0) and a doctor
 * sibling.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { KNOWN_TOOL_NAMES, parseToolsValue } from "../../core/agent-schema.js";
import { parseFrontmatter } from "./agents.js";

/** Section title (stable — tests key on it). */
export const AGENT_FORMAT_FIELDS_TITLE = "Agent format fields";

/** Valid boolean spellings for `interactive:`. */
const BOOLEAN_STRINGS: ReadonlySet<string> = new Set(["true", "false"]);

/**
 * True when `value` looks like `provider/model-id`. An optional legacy
 * `:<thinking>` suffix is tolerated (e.g. `anthropic/claude-x:high`).
 *
 * @param value - Raw `model:` scalar value.
 * @returns `true` when the value is a well-formed model reference.
 */
function isValidModelValue(value: string): boolean {
	// Strip a trailing `:<suffix>` — the legacy thinking-level suffix.
	const model = value.replace(/:[^/:]+$/, "").trim();
	if (/\s/.test(model)) return false;
	const slash = model.indexOf("/");
	return slash > 0 && slash < model.length - 1;
}

/**
 * Validate the optional real-format frontmatter fields of every
 * `.pi/agents/*.md` file. Absent fields are skipped; unknown keys are
 * tolerated (forward-compat).
 *
 * @param cwd - Project root (holds `.pi/agents/`).
 * @returns The `"Agent format fields"` diagnostic section.
 */
export function checkAgentFormatFields(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const agentsDir = join(cwd, ".pi", "agents");

	if (!existsSync(agentsDir)) {
		items.push({
			status: "ok",
			message: "No .pi/agents/ directory — nothing to check.",
		});
		return { title: AGENT_FORMAT_FIELDS_TITLE, items };
	}

	const files = readdirSync(agentsDir, { encoding: "utf8" }).filter(
		(name) => typeof name === "string" && name.endsWith(".md"),
	);

	for (const filename of files) {
		const content = readFileSync(join(agentsDir, filename), "utf8");
		const fm = parseFrontmatter(content);

		// 1. model: provider/model-id (an optional legacy :thinking suffix is tolerated).
		if (fm.model !== undefined && !isValidModelValue(fm.model)) {
			items.push({
				status: "error",
				message: `${filename}: \`model:\` value "${fm.model}" is not \`provider/model-id\`.`,
				details: ["Expected a provider and a model id separated by a slash, e.g. `anthropic/claude-sonnet-4`."],
				suggestion: "Set `model:` to `provider/model-id` (a legacy `:thinking` suffix is allowed).",
			});
		}

		// 2. interactive: true | false.
		if (fm.interactive !== undefined && !BOOLEAN_STRINGS.has(fm.interactive)) {
			items.push({
				status: "warning",
				message: `${filename}: \`interactive:\` value "${fm.interactive}" is not a boolean.`,
				suggestion: "Set `interactive: true` or `interactive: false`.",
			});
		}

		// 3. disallowed_tools: every token must be a known tool name.
		if (fm.disallowed_tools !== undefined) {
			const unknown = parseToolsValue(fm.disallowed_tools).filter((t) => !KNOWN_TOOL_NAMES.has(t));
			if (unknown.length > 0) {
				items.push({
					status: "error",
					message: `${filename}: unknown tool(s) in \`disallowed_tools:\`: ${unknown.join(", ")}`,
					details: [`Known tools: ${Array.from(KNOWN_TOOL_NAMES).sort().join(", ")}`],
					suggestion: "Fix the typo or remove the unknown tool from `disallowed_tools:`.",
				});
			}
		}

		// 4. allowed_subagents: a comma/list of non-empty names.
		if (fm.allowed_subagents !== undefined && parseToolsValue(fm.allowed_subagents).length === 0) {
			items.push({
				status: "warning",
				message: `${filename}: \`allowed_subagents:\` is present but parses to no names.`,
				suggestion: "List one or more sub-agent names (comma- or YAML-list-separated), or remove the field.",
			});
		}
	}

	return { title: AGENT_FORMAT_FIELDS_TITLE, items };
}
