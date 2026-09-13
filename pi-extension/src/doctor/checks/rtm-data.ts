/**
 * RTM JSON sidecar check (RTM traceability upgrade, Phase 2).
 *
 * The JSON sidecar (`RTM_<project>.json` next to `RTM_<project>.md`) is
 * the RTM's source of truth. This check verifies:
 *  1. the sidecar exists beside the published markdown;
 *  2. it validates against the schema (core/rtm-data.ts);
 *  3. the published markdown still matches the data — drift means the
 *     markdown was hand-edited after publish.
 */

import { existsSync, readFileSync } from "node:fs";
import { parseFrontmatterBlock } from "../../core/frontmatter.js";
import { resolveDocArtifact } from "../../core/paths.js";
import {
	renderRtmMarkdown,
	validateRtmData,
	type RtmData,
} from "../../core/rtm-data.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkRtmDataSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "RTM data check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "RTM data sidecar", items };
	}

	const md = resolveDocArtifact("RTM", projectName, cwd);
	if (!md) {
		items.push({
			status: "info",
			message: "RTM not found — skipping data sidecar check.",
			suggestion: suggestionFor("rtm-missing"),
		});
		return { title: "RTM data sidecar", items };
	}

	const jsonPath = md.path.replace(/\.md$/, ".json");
	if (!existsSync(jsonPath)) {
		items.push({
			status: "warning",
			message: "RTM JSON sidecar missing — the markdown is not backed by machine-readable data.",
			details: [`Expected: ${jsonPath}`],
			suggestion: suggestionFor("rtm-json-missing"),
		});
		return { title: "RTM data sidecar", items };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
	} catch {
		items.push({
			status: "error",
			message: "RTM JSON sidecar is not valid JSON.",
			details: [`Path: ${jsonPath}`],
			suggestion: suggestionFor("rtm-json-invalid"),
		});
		return { title: "RTM data sidecar", items };
	}

	const validation = validateRtmData(parsed);
	if (!validation.ok) {
		items.push({
			status: "error",
			message: `RTM JSON sidecar failed validation (${validation.issues.length} issue(s)).`,
			details: validation.issues.slice(0, 20),
			suggestion: suggestionFor("rtm-json-invalid"),
		});
		return { title: "RTM data sidecar", items };
	}

	const data = parsed as RtmData;
	const renderedBody = parseFrontmatterBlock(renderRtmMarkdown(data))?.body ?? "";
	const publishedBody = parseFrontmatterBlock(readFileSync(md.path, "utf8"))?.body
		?? readFileSync(md.path, "utf8");
	if (renderedBody.trim() !== publishedBody.trim()) {
		items.push({
			status: "error",
			message: "Published RTM markdown has drifted from its JSON sidecar (hand-edited after publish?).",
			details: [`Markdown: ${md.path}`, `JSON: ${jsonPath}`],
			suggestion: suggestionFor("rtm-json-drift"),
		});
		return { title: "RTM data sidecar", items };
	}

	items.push({
		status: "ok",
		message: `RTM data sidecar valid — ${data.rows.length} row(s), markdown matches the data.`,
		details: [`JSON: ${jsonPath}`],
	});
	return { title: "RTM data sidecar", items };
}
