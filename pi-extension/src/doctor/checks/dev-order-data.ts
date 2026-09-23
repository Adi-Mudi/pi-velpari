/**
 * Development-order sidecar check (B3 — D6/D7/D8).
 *
 * The sidecar (`development-order_<project>.yaml`) next to the published
 * markdown is the artifact's source of truth. This check verifies:
 *  1. the sidecar exists beside the published markdown (missing =
 *     warning only — D6: legacy published artifacts never block);
 *  2. it validates against the D8 schema (core/dev-order-data.ts) —
 *     including dependsOn resolution and dependency-cycle detection;
 *  3. the published markdown still matches the data — drift means the
 *     markdown was hand-edited after publish (error once the sidecar
 *     exists).
 */

import { readFileSync } from "node:fs";
import {
	renderDevOrderMarkdown,
	resolveDevOrderSidecar,
	validateDevOrderData,
	type DevOrderData,
} from "../../core/dev-order-data.js";
import { renderDevelopmentOrderMarkdown as renderDevOrderMarkdownFromRows } from "../../ops/export-doc.js";
import { readLatestPublishedRows } from "../../io/store.js";
import { parseFrontmatterBlock } from "../../core/frontmatter.js";
import { resolveDocArtifact } from "../../core/paths.js";
import { parseYaml } from "../../core/yaml-data.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkDevOrderDataSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "Development-order data check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "Development-order data sidecar", items };
	}

	// Phase 7 (OQ3a) — DB-first: newest published development-order rows.
	const fromDb = readLatestPublishedRows(cwd, projectName, "development-order");
	if (fromDb) {
		const doRows = (fromDb.rows.devStep as Array<Record<string, unknown>> | undefined) ?? [];
		if (doRows.length === 0) {
			items.push({
				status: "warning",
				message: "Development-order store rows exist but the row-set is empty — run `/velpari-development-order` update mode and republish.",
				details: [`Store: Doc/store/${projectName}/index.db (run ${fromDb.envelope.runId} v${fromDb.envelope.version})`],
				suggestion: suggestionFor("do-data-invalid"),
			});
			return { title: "Development-order data sidecar", items };
		}
		const bad = doRows.filter((r) => typeof r.id !== "string" || r.id === "" || typeof r.module !== "string");
		if (bad.length > 0) {
			items.push({
				status: "error",
				message: `Development-order store rows failed validation (${bad.length} row(s) with an empty id or module).`,
				details: bad.slice(0, 20).map((r) => `id=${String(r.id)} module=${String(r.module)}`),
				suggestion: suggestionFor("do-data-invalid"),
			});
			return { title: "Development-order data sidecar", items };
		}
		const dbMd = resolveDocArtifact("development-order", projectName, cwd);
		if (dbMd) {
			const renderedBody = parseFrontmatterBlock(renderDevOrderMarkdownFromRows(fromDb.rows))?.body ?? "";
			const publishedText = readFileSync(dbMd.path, "utf8");
			const publishedBody = parseFrontmatterBlock(publishedText)?.body ?? publishedText;
			if (renderedBody.trim() !== publishedBody.trim()) {
				items.push({
					status: "error",
					message: "Published development-order markdown has drifted from the store (hand-edited after publish?).",
					details: [`Markdown: ${dbMd.path}`, `Store: Doc/store/${projectName}/index.db`],
					suggestion: suggestionFor("do-data-drift"),
				});
				return { title: "Development-order data sidecar", items };
			}
		}
		items.push({
			status: "ok",
			message: `Development-order store rows valid — ${doRows.length} step(s)${dbMd ? ", published view matches the store" : " (no published view yet)"}.`,
			details: [`Store: Doc/store/${projectName}/index.db (run ${fromDb.envelope.runId} v${fromDb.envelope.version})`],
		});
		return { title: "Development-order data sidecar", items };
	}

	// Legacy fallback (OQ3a): the exact Phase 2 sidecar semantics for
	// pre-store projects; the backfill pointer rides in the warning.
	const md = resolveDocArtifact("development-order", projectName, cwd);
	if (!md) {
		items.push({
			status: "info",
			message: "Development-order doc not found — skipping data sidecar check.",
			suggestion: suggestionFor("artifact-missing"),
		});
		return { title: "Development-order data sidecar", items };
	}

	const sidecar = resolveDevOrderSidecar(md.path);
	if (!sidecar) {
		items.push({
			status: "warning",
			message:
				"Development-order sidecar missing and no store rows published — the markdown is not backed by machine-readable data. " +
				"Run `/velpari-backfill development-order` to import the legacy artifact into the store.",
			details: [`Expected: ${md.path.replace(/\.md$/, ".yaml")}`],
			suggestion: suggestionFor("do-data-missing"),
		});
		return { title: "Development-order data sidecar", items };
	}

	const parsed = parseYaml(readFileSync(sidecar, "utf8"));
	if (!parsed.ok) {
		items.push({
			status: "error",
			message: "Development-order sidecar is not valid YAML.",
			details: [`Path: ${sidecar}`, parsed.error],
			suggestion: suggestionFor("do-data-invalid"),
		});
		return { title: "Development-order data sidecar", items };
	}

	const validation = validateDevOrderData(parsed.data);
	if (!validation.ok) {
		items.push({
			status: "error",
			message: `Development-order sidecar failed validation (${validation.issues.length} issue(s)).`,
			details: validation.issues.slice(0, 20),
			suggestion: suggestionFor("do-data-invalid"),
		});
		return { title: "Development-order data sidecar", items };
	}

	const data = parsed.data as DevOrderData;
	const renderedBody = parseFrontmatterBlock(renderDevOrderMarkdown(data))?.body ?? "";
	const publishedText = readFileSync(md.path, "utf8");
	const publishedBody = parseFrontmatterBlock(publishedText)?.body ?? publishedText;
	if (renderedBody.trim() !== publishedBody.trim()) {
		items.push({
			status: "error",
			message: "Published development-order markdown has drifted from its sidecar (hand-edited after publish?).",
			details: [`Markdown: ${md.path}`, `Sidecar: ${sidecar}`],
			suggestion: suggestionFor("do-data-drift"),
		});
		return { title: "Development-order data sidecar", items };
	}

	items.push({
		status: "ok",
		message: `Development-order sidecar valid — ${data.steps.length} step(s), acyclic, markdown matches the data.`,
		details: [`Sidecar: ${sidecar}`],
	});
	return { title: "Development-order data sidecar", items };
}
