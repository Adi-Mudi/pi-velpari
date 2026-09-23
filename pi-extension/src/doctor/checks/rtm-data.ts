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
import { renderRtmMarkdown, resolveRtmSidecar, validateRtmData, type RtmData } from "../../core/rtm-data.js";
import { renderRtmMarkdown as renderRtmMarkdownFromRows } from "../../ops/export-doc.js";
import { readLatestPublishedRows } from "../../io/store.js";
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

	// Phase 7 (OQ3a) — DB-first: newest published RTM rows from the store.
	const fromDb = readLatestPublishedRows(cwd, projectName, "rtm");
	if (fromDb) {
		const rtmRows = (fromDb.rows.rtmRow as Array<Record<string, unknown>> | undefined) ?? [];
		if (rtmRows.length === 0) {
			items.push({
				status: "warning",
				message: "RTM store rows exist but the row-set is empty — run `/velpari-rtm` update mode and republish.",
				details: [
					`Store: Doc/store/${projectName}/index.db (run ${fromDb.envelope.runId} v${fromDb.envelope.version})`,
				],
				suggestion: suggestionFor("rtm-json-invalid"),
			});
			return { title: "RTM data sidecar", items };
		}
		const bad = rtmRows.filter((r) => typeof r.frRef !== "string" || r.frRef === "" || !(Number(r.phase) >= 1));
		if (bad.length > 0) {
			items.push({
				status: "error",
				message: `RTM store rows failed validation (${bad.length} row(s) with an empty frRef or phase < 1).`,
				details: bad.slice(0, 20).map((r) => `id=${String(r.id)} frRef=${String(r.frRef)} phase=${String(r.phase)}`),
				suggestion: suggestionFor("rtm-json-invalid"),
			});
			return { title: "RTM data sidecar", items };
		}
		const dbMd = resolveDocArtifact("RTM", projectName, cwd);
		if (dbMd) {
			// View drift (DB-path): the publish chain rendered the published
			// view from the same rows the store holds, so a deterministic
			// re-render of the DB rows must match the published body (G5).
			const renderedBody = parseFrontmatterBlock(renderRtmMarkdownFromRows(fromDb.rows))?.body ?? "";
			const publishedText = readFileSync(dbMd.path, "utf8");
			const publishedBody = parseFrontmatterBlock(publishedText)?.body ?? publishedText;
			if (renderedBody.trim() !== publishedBody.trim()) {
				items.push({
					status: "error",
					message: "Published RTM markdown has drifted from the store (hand-edited after publish?).",
					details: [`Markdown: ${dbMd.path}`, `Store: Doc/store/${projectName}/index.db`],
					suggestion: suggestionFor("rtm-json-drift"),
				});
				return { title: "RTM data sidecar", items };
			}
		}
		items.push({
			status: "ok",
			message: `RTM store rows valid — ${rtmRows.length} row(s)${dbMd ? ", published view matches the store" : " (no published view yet)"}.`,
			details: [`Store: Doc/store/${projectName}/index.db (run ${fromDb.envelope.runId} v${fromDb.envelope.version})`],
		});
		return { title: "RTM data sidecar", items };
	}

	// Legacy fallback (OQ3a): no published DB rows — keep the exact Phase 2
	// sidecar semantics for pre-store projects. Item counts/statuses are
	// unchanged; the backfill pointer rides in the message/details.
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
			message:
				"RTM sidecar missing and no store rows published — the markdown is not backed by machine-readable data. " +
				"Run `/velpari-backfill rtm` to import the legacy artifact into the store.",
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
	const publishedBody = parseFrontmatterBlock(readFileSync(md.path, "utf8"))?.body ?? readFileSync(md.path, "utf8");
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
