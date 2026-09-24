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
import { renderAtomicFunctionsMarkdown as renderAfMarkdownFromRows } from "../../ops/export-doc.js";
import { readLatestPublishedRows } from "../../io/store.js";
import { deriveAtomicProfile } from "../../core/atomic-tier.js";
import { loadFilesConfig } from "../../core/config.js";
import { parseFrontmatterBlock } from "../../core/frontmatter.js";
import { markdownWritesEnabled } from "../../core/config.js";
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

	// Phase 7 (OQ3a) — DB-first: newest published atomic-functions rows.
	const fromDb = readLatestPublishedRows(cwd, projectName, "atomic-functions");
	if (fromDb) {
		const afRows = (fromDb.rows.atomicFunction as Array<Record<string, unknown>> | undefined) ?? [];
		if (afRows.length === 0) {
			items.push({
				status: "warning",
				message:
					"Atomic-functions store rows exist but the row-set is empty — run `/velpari-atomic-function` update mode and republish.",
				details: [
					`Store: Doc/store/${projectName}/index.db (run ${fromDb.envelope.runId} v${fromDb.envelope.version})`,
				],
				suggestion: suggestionFor("af-data-invalid"),
			});
			return { title: "Atomic-functions data sidecar", items };
		}
		const bad = afRows.filter(
			(r) => typeof r.id !== "string" || r.id === "" || typeof r.signature !== "string" || r.signature === "",
		);
		if (bad.length > 0) {
			items.push({
				status: "error",
				message: `Atomic-functions store rows failed validation (${bad.length} row(s) with an empty id or signature).`,
				details: bad.slice(0, 20).map((r) => `id=${String(r.id)} signature=${String(r.signature)}`),
				suggestion: suggestionFor("af-data-invalid"),
			});
			return { title: "Atomic-functions data sidecar", items };
		}
		const dbMd = resolveDocArtifact("atomic-functions", projectName, cwd);
		// Phase 12 Fix F7 — DB-only awareness: with markdown writes retired
		// (the default) the published markdown is a legacy VIEW the publish
		// chain never rewrites; comparing a re-render against it would error
		// on every republish of a migrated project.
		const viewMaintained = markdownWritesEnabled(cwd);
		if (dbMd && viewMaintained) {
			// View drift (DB-path): deterministic re-render of the DB rows
			// must match the published body (G5 renderers).
			const renderedBody = parseFrontmatterBlock(renderAfMarkdownFromRows(fromDb.rows))?.body ?? "";
			const publishedText = readFileSync(dbMd.path, "utf8");
			const publishedBody = parseFrontmatterBlock(publishedText)?.body ?? publishedText;
			if (renderedBody.trim() !== publishedBody.trim()) {
				items.push({
					status: "error",
					message: "Published atomic-functions markdown has drifted from the store (hand-edited after publish?).",
					details: [`Markdown: ${dbMd.path}`, `Store: Doc/store/${projectName}/index.db`],
					suggestion: suggestionFor("af-data-drift"),
				});
				return { title: "Atomic-functions data sidecar", items };
			}
		}
		items.push({
			status: "ok",
			message: `Atomic-functions store rows valid — ${afRows.length} function(s)${
				dbMd
					? viewMaintained
						? ", published view matches the store"
						: " (legacy published view — markdown writes retired, drift not checked)"
					: " (no published view yet)"
			}.`,
			details: [`Store: Doc/store/${projectName}/index.db (run ${fromDb.envelope.runId} v${fromDb.envelope.version})`],
		});
		return { title: "Atomic-functions data sidecar", items };
	}

	// Legacy fallback (OQ3a): no published DB rows — the exact Phase 2
	// sidecar semantics for pre-store projects; the backfill pointer
	// rides in the sidecar-missing warning.
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
			message:
				"Atomic-functions sidecar missing and no store rows published — the markdown is not backed by machine-readable data. " +
				"Run `/velpari-backfill atomic-functions` to import the legacy artifact into the store.",
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
