/**
 * Test-cases sidecar check (B3 — D6/D7).
 *
 * The sidecar (`test-cases_<project>.yaml`) next to the published
 * markdown is the artifact's source of truth. This check verifies:
 *  1. the sidecar exists beside the published markdown (missing =
 *     warning only — D6: legacy published artifacts never block);
 *  2. it validates against the schema (core/test-cases-data.ts);
 *  3. the published markdown still matches the data — drift means the
 *     markdown was hand-edited after publish (error once the sidecar
 *     exists).
 */

import { readFileSync } from "node:fs";
import { parseFrontmatterBlock } from "../../core/frontmatter.js";
import { resolveDocArtifact } from "../../core/paths.js";
import {
	renderTestCasesMarkdown,
	resolveTestCasesSidecar,
	validateTestCasesData,
	type TestCasesData,
} from "../../core/test-cases-data.js";
import { parseYaml } from "../../core/yaml-data.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkTestCasesDataSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "Test-cases data check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "Test-cases data sidecar", items };
	}

	const md = resolveDocArtifact("test-cases", projectName, cwd);
	if (!md) {
		items.push({
			status: "info",
			message: "Test-cases doc not found — skipping data sidecar check.",
			suggestion: suggestionFor("artifact-missing"),
		});
		return { title: "Test-cases data sidecar", items };
	}

	const sidecar = resolveTestCasesSidecar(md.path);
	if (!sidecar) {
		items.push({
			status: "warning",
			message: "Test-cases sidecar missing — the markdown is not backed by machine-readable data.",
			details: [`Expected: ${md.path.replace(/\.md$/, ".yaml")}`],
			suggestion: suggestionFor("tc-data-missing"),
		});
		return { title: "Test-cases data sidecar", items };
	}

	const parsed = parseYaml(readFileSync(sidecar, "utf8"));
	if (!parsed.ok) {
		items.push({
			status: "error",
			message: "Test-cases sidecar is not valid YAML.",
			details: [`Path: ${sidecar}`, parsed.error],
			suggestion: suggestionFor("tc-data-invalid"),
		});
		return { title: "Test-cases data sidecar", items };
	}

	const validation = validateTestCasesData(parsed.data);
	if (!validation.ok) {
		items.push({
			status: "error",
			message: `Test-cases sidecar failed validation (${validation.issues.length} issue(s)).`,
			details: validation.issues.slice(0, 20),
			suggestion: suggestionFor("tc-data-invalid"),
		});
		return { title: "Test-cases data sidecar", items };
	}

	const data = parsed.data as TestCasesData;
	const renderedBody = parseFrontmatterBlock(renderTestCasesMarkdown(data))?.body ?? "";
	const publishedText = readFileSync(md.path, "utf8");
	const publishedBody = parseFrontmatterBlock(publishedText)?.body ?? publishedText;
	if (renderedBody.trim() !== publishedBody.trim()) {
		items.push({
			status: "error",
			message: "Published test-cases markdown has drifted from its sidecar (hand-edited after publish?).",
			details: [`Markdown: ${md.path}`, `Sidecar: ${sidecar}`],
			suggestion: suggestionFor("tc-data-drift"),
		});
		return { title: "Test-cases data sidecar", items };
	}

	items.push({
		status: "ok",
		message: `Test-cases sidecar valid — ${data.unitTests.length} unit + ${data.integrationTests.length} integration test(s), markdown matches the data.`,
		details: [`Sidecar: ${sidecar}`],
	});
	return { title: "Test-cases data sidecar", items };
}
