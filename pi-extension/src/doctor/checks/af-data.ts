/**
 * Atomic-functions sidecar check (B3 — D6/D7).
 *
 * The sidecar (`atomic-functions_<project>.yaml`) next to the published
 * markdown is the artifact's source of truth. This check verifies:
 *  1. the sidecar exists beside the published markdown (missing =
 *     warning only — D6: legacy published artifacts never block);
 *  2. it validates against the schema (core/af-data.ts), tier-aware
 *     via the configured atomic profile;
 *  3. the published markdown still matches the data — drift means the
 *     markdown was hand-edited after publish (error once the sidecar
 *     exists).
 */

import { readFileSync } from "node:fs";
import { renderAfMarkdown, resolveAfSidecar, validateAfData, type AfData } from "../../core/af-data.js";
import { deriveAtomicProfile } from "../../core/atomic-tier.js";
import { loadFilesConfig } from "../../core/config.js";
import { parseFrontmatterBlock } from "../../core/frontmatter.js";
import { resolveDocArtifact } from "../../core/paths.js";
import { parseYaml } from "../../core/yaml-data.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkAfDataSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "AF data check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "Atomic-functions data sidecar", items };
	}

	const md = resolveDocArtifact("atomic-functions", projectName, cwd);
	if (!md) {
		items.push({
			status: "info",
			message: "Atomic-functions doc not found — skipping data sidecar check.",
			suggestion: suggestionFor("artifact-missing"),
		});
		return { title: "Atomic-functions data sidecar", items };
	}

	const sidecar = resolveAfSidecar(md.path);
	if (!sidecar) {
		items.push({
			status: "warning",
			message: "Atomic-functions sidecar missing — the markdown is not backed by machine-readable data.",
			details: [`Expected: ${md.path.replace(/\.md$/, ".yaml")}`],
			suggestion: suggestionFor("af-data-missing"),
		});
		return { title: "Atomic-functions data sidecar", items };
	}

	const parsed = parseYaml(readFileSync(sidecar, "utf8"));
	if (!parsed.ok) {
		items.push({
			status: "error",
			message: "Atomic-functions sidecar is not valid YAML.",
			details: [`Path: ${sidecar}`, parsed.error],
			suggestion: suggestionFor("af-data-invalid"),
		});
		return { title: "Atomic-functions data sidecar", items };
	}

	const tier = deriveAtomicProfile(loadFilesConfig(cwd)).tier;
	const data = parsed.data as AfData;
	const validation = validateAfData(data, { tier: data.tier ?? tier });
	if (!validation.ok) {
		items.push({
			status: "error",
			message: `Atomic-functions sidecar failed validation (${validation.issues.length} issue(s)).`,
			details: validation.issues.slice(0, 20),
			suggestion: suggestionFor("af-data-invalid"),
		});
		return { title: "Atomic-functions data sidecar", items };
	}

	const renderedBody = parseFrontmatterBlock(renderAfMarkdown(data))?.body ?? "";
	const publishedText = readFileSync(md.path, "utf8");
	const publishedBody = parseFrontmatterBlock(publishedText)?.body ?? publishedText;
	if (renderedBody.trim() !== publishedBody.trim()) {
		items.push({
			status: "error",
			message: "Published atomic-functions markdown has drifted from its sidecar (hand-edited after publish?).",
			details: [`Markdown: ${md.path}`, `Sidecar: ${sidecar}`],
			suggestion: suggestionFor("af-data-drift"),
		});
		return { title: "Atomic-functions data sidecar", items };
	}

	items.push({
		status: "ok",
		message: `Atomic-functions sidecar valid — ${data.functions.length} function(s), markdown matches the data.`,
		details: [`Sidecar: ${sidecar}`],
	});
	return { title: "Atomic-functions data sidecar", items };
}
