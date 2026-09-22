/**
 * /velpari-export command (Phase 5 — on-demand document export; L3).
 *
 * Read-only download from the DB store (D4): pick project (multi-design
 * only) → kind → published version (newest first) → format (md/yaml/html)
 * → output path → overwrite confirm → `ops/export-doc.ts:runExport`.
 * No DB writes, no state mutations, no publish/approve logic (Q3).
 *
 * The pickers live here (L3) because L1 cannot import L2 UI — the
 * reconfirm precedent (picker-in-L3).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { loadState } from "../core/state.js";
import { loadFilesConfig } from "../core/config.js";
import { buildStoreDbPath } from "../core/paths.js";
import {
	listExportableKinds,
	listPublishedVersions,
	type ArtifactKind,
} from "../io/store.js";
import { openStoreDb, closeStoreDb } from "../io/db.js";
import {
	buildExportDefaultPath,
	runExport,
	type ExportFormat,
} from "../ops/export-doc.js";
import { runSimpleConfirm, runSimplePicker } from "../ui/simple-picker.js";

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
async function resolveProjectName(
	ctx: ExtensionContext,
	cwd: string,
): Promise<string | undefined> {
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
	let runId: string | undefined;
	let version: number | undefined;
	try {
		const kinds = listExportableKinds(db);
		if (kinds.length === 0) {
			ctx.ui.notify(
				"No published artifacts in the store yet — drafts are never exported.",
				"info",
			);
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

		const versions = listPublishedVersions(db, kind);
		const pickedVersion = await runSimplePicker(ctx, {
			title: "Export — pick version",
			subtitle: "Published versions, newest first.",
			items: versions.map((v) => ({
				id: `${v.runId}:${v.version}`,
				label: `v${v.version} — run ${v.runId}`,
				hint: `${v.generatedAt} (${v.stage})`,
			})),
		});
		if (!pickedVersion) {
			ctx.ui.notify("Export cancelled.", "info");
			return;
		}
		const [pickedRun, pickedVersionNo] = pickedVersion.split(":");
		runId = pickedRun;
		version = Number(pickedVersionNo);
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

	const defaultPath = buildExportDefaultPath(projectName, kind, format, cwd);
	const answer = await ctx.ui.input(`Output path (Enter = ${defaultPath})`);
	const outputPath = answer && answer.trim() !== "" ? answer.trim() : defaultPath;

	let overwrite = false;
	if (existsSync(outputPath)) {
		overwrite = await runSimpleConfirm(
			ctx,
			"Overwrite existing file?",
			`${outputPath} already exists. Overwrite it?`,
		);
		if (!overwrite) {
			ctx.ui.notify("Export cancelled — existing file left untouched.", "info");
			return;
		}
	}

	const result = runExport({ dbPath, runId: runId!, kind, version: version!, format, outputPath, overwrite });
	if (!result.ok) {
		ctx.ui.notify(`Export failed: ${result.problem}`, "error");
		return;
	}
	const counts = Object.entries(result.counts ?? {})
		.map(([key, n]) => `${key}=${n}`)
		.join(", ");
	ctx.ui.notify(
		`Exported ${kind} v${version} (run ${runId}) → ${result.path}` +
			(counts ? `\nRows: ${counts}` : ""),
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
