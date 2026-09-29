/**
 * /velpari-revision-status command (v1.2 B6; L3).
 *
 * Flow: project → kind → revision → status view → (withdrawn only) reason →
 * confirm → `ops/revision-status.ts:applyRevisionStatus` (withdrawn →
 * published restore). Published/superseded revisions are VIEW-ONLY here:
 * withdraw through /velpari-tombstone; `superseded` is system-owned and set
 * only by a new publish (protection contract — confirmed 2026-09-29).
 *
 * Pickers live here (L3) because L1 cannot import L2 UI. No active run is
 * required: revision rows carry their own runId (tombstone precedent).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { buildStoreDbPath } from "../core/paths.js";
import type { ArtifactKind } from "../io/store.js";
import { applyRevisionStatus } from "../ops/revision-status.js";
import { revisionsByKind } from "../ops/protection.js";
import { runSimpleConfirm, runSimplePicker } from "../ui/simple-picker.js";
import { resolveProjectName } from "../ui/resolve-project-name.js";

/**
 * The full revision-status flow. Exported for tests (mock ctx.ui); the
 * command handler calls it with process.cwd().
 * @param {ExtensionContext} ctx - UI context (pickers, input, notifications).
 * @param {string} cwd - Working directory root.
 * @returns {Promise<void>} Notifies the outcome; never throws.
 */
export async function runRevisionStatusFlow(ctx: ExtensionContext, cwd: string): Promise<void> {
	const projectName = await resolveProjectName(ctx, cwd, {
		title: "Revision status — pick project",
		subtitle: "Multi-design run — which project's store holds the revision?",
	});
	if (!projectName) {
		ctx.ui.notify("Revision status cancelled.", "info");
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

	const groups = revisionsByKind(cwd, projectName);
	if (groups.length === 0) {
		ctx.ui.notify(`No published revisions in project "${projectName}" yet.`, "info");
		return;
	}
	const pickedKind = await runSimplePicker(ctx, {
		title: "Revision status — pick artifact kind",
		subtitle: "Only kinds with at least one revision are listed.",
		items: groups.map((group) => ({
			id: group.kind,
			label: group.kind,
			hint: `${group.revisions.length} revision${group.revisions.length === 1 ? "" : "s"}`,
		})),
	});
	if (!pickedKind) {
		ctx.ui.notify("Revision status cancelled.", "info");
		return;
	}
	const group = groups.find((candidate) => candidate.kind === pickedKind)!;

	const pickedRevision = await runSimplePicker(ctx, {
		title: `Revision status — pick revision of ${group.kind}`,
		subtitle: "Newest first.",
		items: group.revisions.map((revision) => ({
			id: String(revision.revisionId),
			label: `v${revision.revisionNumber}`,
			hint:
				`run ${revision.runId} · ${revision.status}` +
				(revision.tombstoneReason ? ` · tombstoned: ${revision.tombstoneReason}` : ""),
		})),
	});
	if (!pickedRevision) {
		ctx.ui.notify("Revision status cancelled.", "info");
		return;
	}
	const revision = group.revisions.find((candidate) => String(candidate.revisionId) === pickedRevision)!;

	if (revision.status !== "withdrawn") {
		ctx.ui.notify(
			`${group.kind} v${revision.revisionNumber} — status: ${revision.status} (view only). ` +
				"Published → withdraw via /velpari-tombstone; superseded is system-owned (a new publish sets it). " +
				"This command restores withdrawn revisions to published.",
			"info",
		);
		return;
	}

	const answer = await ctx.ui.input(`Restore reason for ${group.kind} v${revision.revisionNumber} (required)`);
	const reason = (answer ?? "").trim();
	if (reason === "") {
		ctx.ui.notify("A status change requires a typed reason — nothing changed.", "info");
		return;
	}

	const confirmed = await runSimpleConfirm(
		ctx,
		`Restore ${group.kind} v${revision.revisionNumber} to published?`,
		"withdrawn → published (audited with your reason). Refused when another revision is the head for this run+kind — " +
			"published content can never be truly deleted (F16); this only re-points status back.",
	);
	if (!confirmed) {
		ctx.ui.notify("Revision status cancelled — nothing changed.", "info");
		return;
	}

	const outcome = applyRevisionStatus({
		cwd,
		dbPath,
		projectName,
		kind: group.kind as ArtifactKind,
		revisionId: revision.revisionId,
		reason,
	});
	ctx.ui.notify(
		outcome.ok ? outcome.message : `Status change failed: ${outcome.message}`,
		outcome.ok ? "info" : "error",
	);
	for (const warning of outcome.warnings ?? []) ctx.ui.notify(warning, "warning");
}

/**
 * Register /velpari-revision-status (v1.2 B6).
 * @param {ExtensionAPI} pi - The Pi extension API.
 * @returns {void}
 */
export function registerRevisionStatusCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-revision-status", {
		description:
			"View a published revision's status (F16 vocabulary) and restore a withdrawn revision to published (audited + confirmed). Withdrawal stays on /velpari-tombstone; superseded is system-owned.",
		handler: async (_args, ctx) => {
			await runRevisionStatusFlow(ctx, process.cwd());
		},
	});
}
