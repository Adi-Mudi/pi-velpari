/**
 * /velpari-export command (Phase 5 — on-demand document export; L3).
 *
 * Read-only download from the DB store (D4): pick project (multi-design
 * only) → kind → REVISION (F10 — ordered by revision_number, head first,
 * superseded labeled) → format (md/yaml/html) → overwrite confirm →
 * `ops/export-revision.ts:runRevisionExport` (Phase 4).
 * N3: NO path prompt — the destination is the automatic grouped `Doc/`
 * path (head) or the `_rev<N>` export path (older revisions).
 * No DB writes, no state mutations, no publish/approve logic (Q3).
 *
 * The pickers live here (L3) because L1 cannot import L2 UI — the
 * reconfirm precedent (picker-in-L3).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadState } from "../core/state.js";
import { loadFilesConfig } from "../core/config.js";
import { buildStoreDbPath, buildGroupedPath } from "../core/paths.js";
import { listExportableKinds, type ArtifactKind } from "../io/store.js";
import { openStoreDb, closeStoreDb } from "../io/db.js";
import { KIND_LABELS, type ExportFormat } from "../ops/export-doc.js";
import { buildRevisionExportPath, listExportableRevisions, runRevisionExport } from "../ops/export-revision.js";
import { runSimpleConfirm, runSimplePicker } from "../ui/simple-picker.js";

/** N3 head-export destination: the grouped `Doc/<category>/<A>_<p>.<ext>` path.
 * Uses the shared `KIND_LABELS` map (ops/export-doc.ts) — the local
 * duplicate `KIND_TO_GROUPED` was removed in Phase I9 (one source of
 * truth for the kind → grouped-path label). Exported for the golden
 * path assertions in test/commands/export.test.ts. */
export function headExportPath(cwd: string, projectName: string, kind: ArtifactKind, format: ExportFormat): string {
	return join(cwd, buildGroupedPath(KIND_LABELS[kind], projectName)).replace(/\.md$/, `.${format}`);
}

/** Export format menu (user decision 1). */
const FORMAT_ITEMS: ReadonlyArray<{ id: ExportFormat; label: string; hint: string }> = [
	{ id: "md", label: "md", hint: "markdown render of the stored rows" },
	{ id: "yaml", label: "yaml", hint: "deterministic store export bytes" },
	{ id: "html", label: "html", hint: "HTML over the md subset" },
];

/**
 * Resolve the project to export from (approve.ts precedence + multi-design
 * picker): archSubCycle → files.json → mission → "Project". Multi-design
 * (2+ configured projectNames) shows a project picker first.
 * @param {ExtensionContext} ctx - UI context for the picker.
 * @param {string} cwd - Working directory root.
 * @returns {Promise<string | undefined>} projectName, or undefined on cancel.
 */
async function resolveProjectName(ctx: ExtensionContext, cwd: string): Promise<string | undefined> {
	const state = loadState(cwd);
	const config = loadFilesConfig(cwd);
	const configured = config.projectNames ?? (config.projectName ? [config.projectName] : []);
	const archProject = state.archSubCycle?.projectName;
	if (configured.length > 1) {
		const picked = await runSimplePicker(ctx, {
			title: "Export — pick project",
			subtitle: "Multi-design run — whose store should the export read from?",
			items: configured.map((name) => ({
				id: name,
				label: name,
				hint: name === archProject ? "active architecture cycle" : undefined,
			})),
		});
		return picked; // undefined on cancel
	}
	if (archProject) return archProject;
	// `||` (not `??`): empty-string mission must fall through to "Project".
	return configured[0] || state.mission || "Project";
}

/**
 * The full export picker flow. Exported for tests (mock ctx.ui); the
 * command handler just calls it with process.cwd().
 * @param {ExtensionContext} ctx - UI context (pickers + notifications).
 * @param {string} cwd - Working directory root.
 * @returns {Promise<void>} Notifies the outcome; never throws.
 */
export async function runExportFlow(ctx: ExtensionContext, cwd: string): Promise<void> {
	const projectName = await resolveProjectName(ctx, cwd);
	if (!projectName) {
		ctx.ui.notify("Export cancelled.", "info");
		return;
	}
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) {
		ctx.ui.notify(
			`No store DB for project "${projectName}" at ${dbPath}.\n` +
				"Publish an artifact first (approve commands write the store).",
			"error",
		);
		return;
	}

	// Kind + version pickers read the DB directly (read-only); runExport
	// re-opens it independently for the render/write.
	const db = openStoreDb(dbPath);
	let kind: ArtifactKind | undefined;
	let pickedRevision: ReturnType<typeof listExportableRevisions>[number] | undefined;
	try {
		const kinds = listExportableKinds(db);
		if (kinds.length === 0) {
			ctx.ui.notify("No published artifacts in the store yet — drafts are never exported.", "info");
			return;
		}
		const pickedKind = await runSimplePicker(ctx, {
			title: "Export — pick artifact kind",
			subtitle: "Only kinds with at least one published version are listed.",
			items: kinds.map((k) => ({ id: k, label: k })),
		});
		if (!pickedKind) {
			ctx.ui.notify("Export cancelled.", "info");
			return;
		}
		kind = pickedKind as ArtifactKind;

		// F10: the version picker lists REVISIONS ordered by revision_number,
		// newest (head) first — the wrapper returns ascending, so reverse for
		// display. Superseded revisions are clearly labeled.
		const revisions = listExportableRevisions(db, kind).slice().reverse();
		if (revisions.length === 0) {
			ctx.ui.notify("No published artifacts in the store yet — drafts are never exported.", "info");
			return;
		}
		const pickedId = await runSimplePicker(ctx, {
			title: "Export — pick version (revision)",
			subtitle: "Revisions of this artifact, newest (head) first.",
			items: revisions.map((r) => ({
				id: String(r.revisionId),
				label: `rev ${r.revisionNumber} — ${r.status} (v${r.version}, run ${r.runId})`,
				hint: `published ${r.publishedAt}${r.status === "published" ? " — head" : " — superseded"}`,
			})),
		});
		if (!pickedId) {
			ctx.ui.notify("Export cancelled.", "info");
			return;
		}
		pickedRevision = revisions.find((r) => String(r.revisionId) === pickedId);
		if (!pickedRevision) {
			ctx.ui.notify(`Export failed: revision ${pickedId} vanished between listing and pick.`, "error");
			return;
		}
	} finally {
		closeStoreDb(db);
	}

	const formatPick = await runSimplePicker(ctx, {
		title: "Export — pick format",
		items: FORMAT_ITEMS.map((f) => ({ id: f.id, label: f.label, hint: f.hint })),
	});
	if (!formatPick) {
		ctx.ui.notify("Export cancelled.", "info");
		return;
	}
	const format = formatPick as ExportFormat;

	// N3: no path prompt — head revisions land at the grouped Doc/ path,
	// older revisions at the _rev<N> export path (no filename collision).
	const outputPath =
		pickedRevision.status === "published"
			? headExportPath(cwd, projectName, kind, format)
			: buildRevisionExportPath(projectName, kind, pickedRevision.revisionNumber, format, cwd);

	let overwrite = false;
	if (existsSync(outputPath)) {
		overwrite = await runSimpleConfirm(ctx, "Overwrite existing file?", `${outputPath} already exists. Overwrite it?`);
		if (!overwrite) {
			ctx.ui.notify("Export cancelled — existing file left untouched.", "info");
			return;
		}
	}

	const result = runRevisionExport({ dbPath, revisionId: pickedRevision.revisionId, format, outputPath, overwrite });
	if (!result.ok) {
		ctx.ui.notify(`Export failed: ${result.problem}`, "error");
		return;
	}
	const counts = Object.entries(result.counts ?? {})
		.map(([key, n]) => `${key}=${n}`)
		.join(", ");
	const warningLine = result.warnings && result.warnings.length > 0 ? `\nWarnings: ${result.warnings.join(" ")}` : "";
	ctx.ui.notify(
		`Exported ${kind} rev ${result.revisionNumber ?? pickedRevision.revisionNumber} → ${result.path}` +
			(counts ? `\nRows: ${counts}` : "") +
			warningLine,
		"info",
	);
}

/**
 * Register /velpari-export (the 42nd command — view/ops group).
 * @param {ExtensionAPI} pi - The Pi extension API.
 * @returns {void}
 */
export function registerExportCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-export", {
		description:
			"Export a published artifact version from the DB store to a file (md/yaml/html). Read-only: no DB writes, no state changes, no publish.",
		handler: async (_args, ctx) => {
			await runExportFlow(ctx, process.cwd());
		},
	});
}
