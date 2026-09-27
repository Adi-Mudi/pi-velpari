/**
 * /velpari-rollback command (F21; L3, Phase 2).
 *
 * Flow: project → kind (2+ live revisions) → target revision → typed reason →
 * confirm → `ops/rollback.ts:applyRollback`. History is NEVER rewritten: the
 * chosen revision's exact bytes are published as a NEW revision (the git-revert
 * pattern), so the old revisions keep their content and statuses.
 *
 * Pickers live here (L3) because L1 cannot import L2 UI. No active run is
 * required — the run is read from the target revision row (design rule 11).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { loadFilesConfig } from "../core/config.js";
import { buildStoreDbPath } from "../core/paths.js";
import { loadState } from "../core/state.js";
import type { ArtifactKind } from "../io/store.js";
import { revisionsByKind } from "../ops/protection.js";
import { applyRollback } from "../ops/rollback.js";
import { runSimpleConfirm, runSimplePicker } from "../ui/simple-picker.js";

/**
 * Resolve the project to act on (approve.ts precedence + multi-design picker,
 * re-implemented locally — commands/export.ts is Phase 4-owned).
 * @returns {Promise<string | undefined>} projectName, or undefined on cancel.
 */
async function resolveProjectName(ctx: ExtensionContext, cwd: string): Promise<string | undefined> {
	const state = loadState(cwd);
	const config = loadFilesConfig(cwd);
	const configured = config.projectNames ?? (config.projectName ? [config.projectName] : []);
	const archProject = state.archSubCycle?.projectName;
	if (configured.length > 1) {
		return await runSimplePicker(ctx, {
			title: "Rollback — pick project",
			subtitle: "Multi-design run — which project's store should be rolled back?",
			items: configured.map((name) => ({
				id: name,
				label: name,
				hint: name === archProject ? "active architecture cycle" : undefined,
			})),
		});
	}
	if (archProject) return archProject;
	// `||` (not `??`): an empty-string mission must fall through to "Project".
	return configured[0] || state.mission || "Project";
}

/**
 * The full rollback flow. Exported for tests (mock ctx.ui); the command handler
 * calls it with process.cwd().
 * @param {ExtensionContext} ctx - UI context (pickers, input, notifications).
 * @param {string} cwd - Working directory root.
 * @returns {Promise<void>} Notifies the outcome; never throws.
 */
export async function runRollbackFlow(ctx: ExtensionContext, cwd: string): Promise<void> {
	const projectName = await resolveProjectName(ctx, cwd);
	if (!projectName) {
		ctx.ui.notify("Rollback cancelled.", "info");
		return;
	}
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) {
		ctx.ui.notify(
			`No store DB for project "${projectName}" at ${dbPath}.\nPublish an artifact first (approve commands write the store).`,
			"error",
		);
		return;
	}

	const groups = revisionsByKind(cwd, projectName).filter((group) => group.revisions.length > 1);
	if (groups.length === 0) {
		ctx.ui.notify(`Only one revision exists — nothing to roll back to in project "${projectName}".`, "info");
		return;
	}
	const pickedKind = await runSimplePicker(ctx, {
		title: "Rollback — pick artifact kind",
		subtitle: "Only kinds with two or more revisions are listed.",
		items: groups.map((group) => ({
			id: group.kind,
			label: group.kind,
			hint: `${group.revisions.length} revisions`,
		})),
	});
	if (!pickedKind) {
		ctx.ui.notify("Rollback cancelled.", "info");
		return;
	}
	const group = groups.find((candidate) => candidate.kind === pickedKind)!;

	const pickedRevision = await runSimplePicker(ctx, {
		title: `Rollback — pick the revision to restore (${group.kind})`,
		subtitle: "Newest first. The chosen content is re-published as a NEW revision; history is never rewritten.",
		items: group.revisions.map((revision) => ({
			id: String(revision.revisionId),
			label: `v${revision.revisionNumber}`,
			hint:
				`run ${revision.runId} · ${revision.status}` +
				(revision.status === "published" ? " · current head" : "") +
				(revision.tombstoneReason ? ` · tombstoned: ${revision.tombstoneReason}` : ""),
		})),
	});
	if (!pickedRevision) {
		ctx.ui.notify("Rollback cancelled.", "info");
		return;
	}
	const revision = group.revisions.find((candidate) => String(candidate.revisionId) === pickedRevision)!;

	const answer = await ctx.ui.input("Rollback reason (required)");
	const reason = (answer ?? "").trim();
	if (reason === "") {
		ctx.ui.notify("Rollback requires a typed reason (F17) — nothing changed.", "info");
		return;
	}

	const confirmed = await runSimpleConfirm(
		ctx,
		`Roll back ${group.kind} to v${revision.revisionNumber}?`,
		`Run ${revision.runId}. History is never rewritten: a NEW revision carrying v${revision.revisionNumber}'s exact ` +
			"content is published as the head (F21, the git-revert pattern).",
	);
	if (!confirmed) {
		ctx.ui.notify("Rollback cancelled — nothing changed.", "info");
		return;
	}

	const outcome = applyRollback({
		cwd,
		dbPath,
		projectName,
		kind: group.kind as ArtifactKind,
		targetRevisionId: revision.revisionId,
		reason,
	});
	ctx.ui.notify(outcome.ok ? outcome.message : `Rollback failed: ${outcome.message}`, outcome.ok ? "info" : "error");
	for (const warning of outcome.warnings ?? []) ctx.ui.notify(warning, "warning");
}

/**
 * Register /velpari-rollback (F21).
 * @param {ExtensionAPI} pi - The Pi extension API.
 * @returns {void}
 */
export function registerRollbackCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-rollback", {
		description:
			"Roll one artifact back by publishing a NEW revision carrying an older revision's exact content (F21). History is never rewritten; requires a typed reason.",
		handler: async (_args, ctx) => {
			await runRollbackFlow(ctx, process.cwd());
		},
	});
}
