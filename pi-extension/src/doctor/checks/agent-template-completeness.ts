/**
 * Bundled agent-template completeness check (DSI P4, decision D18).
 *
 * The `skills/agents/*.md` templates ship with the extension package and
 * are the source of truth for every scout role's frontmatter (DSI-2:
 * `core/agent-schema.ts:roleToolContract` derives a role's expected
 * `tools:` list from its template). A template that silently drops
 * `tools:` or `thinking:` makes the generated agent incomplete and the
 * derived contract `null` — yet nothing checked the bundled corpus.
 *
 * This check walks the bundled template directory and asserts that
 * every file carries the four load-bearing frontmatter keys:
 *   - `name` (identity; must match the file stem),
 *   - `description` (spawn-time prompt),
 *   - `tools` (the role's tool contract — consumed by the P1 check),
 *   - `thinking` (the DSI PH bug class: a missing level silently
 *     defaults).
 *
 * A missing key is an **error** naming the file + field. A clean corpus
 * is `ok`. This is the regression pin that would have caught the
 * malformed `design-conflict-detector.md` template.
 *
 * Layer 1 (stage logic) — imports `node:*`, `core/` (L0) and a doctor
 * sibling (`parseFrontmatter`).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { findPackageRoot } from "../../core/paths.js";
import { parseFrontmatter } from "./agents.js";

/** Section title (stable — tests key on it). */
export const AGENT_TEMPLATE_COMPLETENESS_TITLE = "Agent template completeness";

/**
 * The four load-bearing keys every bundled agent template must carry.
 * (`session-mode`/`auto-exit`/`spawning` are validated per-installed-agent
 * by `checkAgentFileIntegrity`; this check pins the template source.)
 */
export const REQUIRED_TEMPLATE_FIELDS: readonly string[] = ["name", "description", "tools", "thinking"];

/**
 * Resolve the bundled `skills/agents` directory from the package root
 * (import.meta.url → findPackageRoot, the same pattern as
 * `checks/agents.ts:resolveSkillsDir`). Falls back to `<cwd>/skills/agents`
 * when package-root resolution fails.
 *
 * @param cwd - Project root (legacy fallback location).
 * @returns The bundled template directory path.
 */
function resolveAgentTemplatesDir(cwd: string): string {
	try {
		const start = dirname(fileURLToPath(import.meta.url));
		const root = findPackageRoot(start);
		const dir = join(root, "skills", "agents");
		if (existsSync(dir)) return dir;
	} catch {
		/* fall through to the cwd legacy path */
	}
	return join(cwd, "skills", "agents");
}

/** Options for {@link checkAgentTemplateCompleteness}. */
export interface AgentTemplateCompletenessOptions {
	/** Override the template directory (tests inject a temp fixture dir). */
	dir?: string;
}

/**
 * Audit every bundled agent template for the four load-bearing
 * frontmatter keys. A missing key is an error naming the file + field;
 * a clean corpus is `ok`.
 *
 * @param cwd - Project root (used only for the fallback template path).
 * @param opts - Optional `dir` override (tests).
 * @returns The `"Agent template completeness"` diagnostic section.
 */
export function checkAgentTemplateCompleteness(
	cwd: string = process.cwd(),
	opts: AgentTemplateCompletenessOptions = {},
): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const templatesDir = opts.dir ?? resolveAgentTemplatesDir(cwd);

	if (!existsSync(templatesDir)) {
		items.push({
			status: "info",
			message: `Bundled agent templates directory not found (looked in ${templatesDir}) — nothing to check.`,
		});
		return { title: AGENT_TEMPLATE_COMPLETENESS_TITLE, items };
	}

	const files = readdirSync(templatesDir, { encoding: "utf8" })
		.filter((name) => typeof name === "string" && name.endsWith(".md"))
		.sort();

	let totalErrors = 0;
	for (const filename of files) {
		const content = readFileSync(join(templatesDir, filename), "utf8");
		const fm = parseFrontmatter(content);
		const missing = REQUIRED_TEMPLATE_FIELDS.filter((field) => !fm[field]);
		if (missing.length > 0) {
			totalErrors += missing.length;
			items.push({
				status: "error",
				message: `skills/agents/${filename}: template frontmatter missing field(s): ${missing.join(", ")}.`,
				details: [
					"Bundled templates are the source of truth for the role's tool contract (core/agent-schema.ts:roleToolContract).",
				],
				suggestion: `Add the missing field(s) to skills/agents/${filename} (match a sibling template in the same stage).`,
			});
		}
	}

	if (files.length === 0) {
		items.push({
			status: "info",
			message: "No bundled agent templates found — nothing to check.",
		});
	} else if (totalErrors === 0) {
		items.push({
			status: "ok",
			message: `Agent template completeness OK: ${files.length} template(s) checked, 0 missing fields.`,
		});
	} else {
		// One defect, one severity (D5): the per-file items carry the error;
		// this summary is a pointer, never a second error for the same defect.
		items.push({
			status: "info",
			message: `Agent template completeness: ${totalErrors} missing field(s) across ${files.length} template(s).`,
		});
	}

	return { title: AGENT_TEMPLATE_COMPLETENESS_TITLE, items };
}
