/**
 * RTM sidecar check (RTM traceability upgrade, Phase 2; B3 dual-read).
 *
 * The sidecar (`RTM_<project>.yaml`, legacy `.json` fallback — D4) next to
 * the published markdown is the RTM's source of truth. This check verifies:
 *  1. the sidecar exists beside the published markdown;
 *  2. it validates against the schema (core/rtm-data.ts);
 *  3. the published markdown still matches the data — drift means the
 *     markdown was hand-edited after publish.
 */

import { readFileSync } from "node:fs";
import { parseFrontmatterBlock } from "../../core/frontmatter.js";
import { resolveDocArtifact } from "../../core/paths.js";
import {
	renderRtmMarkdown,
	resolveRtmSidecar,
	validateRtmData,
	type RtmData,
} from "../../core/rtm-data.js";
import { parseYaml } from "../../core/yaml-data.js";
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

	const sidecar = resolveRtmSidecar(md.path);
	if (!sidecar) {
		items.push({
			status: "warning",
			message: "RTM sidecar missing — the markdown is not backed by machine-readable data.",
			details: [`Expected: ${md.path.replace(/\.md$/, ".yaml")}`],
			suggestion: suggestionFor("rtm-json-missing"),
		});
		return { title: "RTM data sidecar", items };
	}

	const parsed = parseYaml(readFileSync(sidecar.path, "utf8"));
	if (!parsed.ok) {
		items.push({
			status: "error",
			message: `RTM sidecar (${sidecar.format}) is not valid YAML.`,
			details: [`Path: ${sidecar.path}`, parsed.error],
			suggestion: suggestionFor("rtm-json-invalid"),
		});
		return { title: "RTM data sidecar", items };
	}

	const validation = validateRtmData(parsed.data);
	if (!validation.ok) {
		items.push({
			status: "error",
			message: `RTM sidecar failed validation (${validation.issues.length} issue(s)).`,
			details: validation.issues.slice(0, 20),
			suggestion: suggestionFor("rtm-json-invalid"),
		});
		return { title: "RTM data sidecar", items };
	}

	const data = parsed.data as RtmData;
	const renderedBody = parseFrontmatterBlock(renderRtmMarkdown(data))?.body ?? "";
	const publishedBody = parseFrontmatterBlock(readFileSync(md.path, "utf8"))?.body
		?? readFileSync(md.path, "utf8");
	if (renderedBody.trim() !== publishedBody.trim()) {
		items.push({
			status: "error",
			message: "Published RTM markdown has drifted from its sidecar (hand-edited after publish?).",
			details: [`Markdown: ${md.path}`, `Sidecar: ${sidecar.path}`],
			suggestion: suggestionFor("rtm-json-drift"),
		});
		return { title: "RTM data sidecar", items };
	}

	items.push({
		status: "ok",
		message: `RTM sidecar valid — ${data.rows.length} row(s), markdown matches the data.`,
		details: [`Sidecar: ${sidecar.path}`],
	});
	return { title: "RTM data sidecar", items };
}
