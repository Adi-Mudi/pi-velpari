/**
 * /velpari-tombstone command (F16 + F12; L3, Phase 2).
 *
 * Flow: project → kind → revision → typed reason (mandatory) → confirm #1 →
 * confirm #2 → `ops/tombstone.ts:applyTombstone`. A tombstone is a TRACKED
 * MODIFICATION: the revision flips to `withdrawn`, its bytes stay in the store
 * forever, and the audit ledger records who/why. Nothing is deleted.
 *
 * Pickers live here (L3) because L1 cannot import L2 UI. No active run is
 * required: the run is read from the revision row (design rule 11), so
 * `migrated`-run projects and runs already cleared by `/velpari-reset` work.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { loadFilesConfig } from "../core/config.js";
import { buildStoreDbPath } from "../core/paths.js";
import { loadState } from "../core/state.js";
import type { ArtifactKind } from "../io/store.js";
import { applyTombstone } from "../ops/tombstone.js";
import { revisionsByKind } from "../ops/protection.js";
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
			title: "Tombstone — pick project",
			subtitle: "Multi-design run — which project's store holds the revision?",
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
 * The full tombstone flow. Exported for tests (mock ctx.ui); the command
 * handler calls it with process.cwd().
 * @param {ExtensionContext} ctx - UI context (pickers, input, notifications).
 * @param {string} cwd - Working directory root.
 * @returns {Promise<void>} Notifies the outcome; never throws.
 */
export async function runTombstoneFlow(ctx: ExtensionContext, cwd: string): Promise<void> {
	const projectName = await resolveProjectName(ctx, cwd);
	if (!projectName) {
		ctx.ui.notify("Tombstone cancelled.", "info");
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
		title: "Tombstone — pick artifact kind",
		subtitle: "Only kinds with at least one revision are listed.",
		items: groups.map((group) => ({
			id: group.kind,
			label: group.kind,
			hint: `${group.revisions.length} revision${group.revisions.length === 1 ? "" : "s"}`,
		})),
	});
	if (!pickedKind) {
		ctx.ui.notify("Tombstone cancelled.", "info");
		return;
	}
	const group = groups.find((candidate) => candidate.kind === pickedKind)!;

	const pickedRevision = await runSimplePicker(ctx, {
		title: `Tombstone — pick revision of ${group.kind}`,
		subtitle: "Newest first. A tombstoned revision keeps its bytes (F16).",
		items: group.revisions.map((revision) => ({
			id: String(revision.revisionId),
			label: `v${revision.revisionNumber}`,
			hint:
				`run ${revision.runId} · ${revision.status}` +
				(revision.tombstoneReason ? ` · tombstoned: ${revision.tombstoneReason}` : ""),
		})),
	});
	if (!pickedRevision) {
		ctx.ui.notify("Tombstone cancelled.", "info");
		return;
	}
	const revision = group.revisions.find((candidate) => String(candidate.revisionId) === pickedRevision)!;

	const answer = await ctx.ui.input("Tombstone reason (required)");
	const reason = (answer ?? "").trim();
	if (reason === "") {
		ctx.ui.notify("Tombstone requires a typed reason (F16) — nothing changed.", "info");
		return;
	}

	const first = await runSimpleConfirm(
		ctx,
		`Tombstone ${group.kind} v${revision.revisionNumber}?`,
		`Run ${revision.runId}. Published content can never be truly deleted (F16): the revision is marked withdrawn, ` +
			"its bytes stay in the store, and an audit entry records this action with your reason.",
	);
	if (!first) {
		ctx.ui.notify("Tombstone cancelled — nothing changed.", "info");
		return;
	}
	const second = await runSimpleConfirm(
		ctx,
		"Confirm again",
		`Second confirmation — ${group.kind} v${revision.revisionNumber} is withdrawn immediately after this.`,
	);
	if (!second) {
		ctx.ui.notify("Tombstone cancelled — nothing changed.", "info");
		return;
	}

	const outcome = applyTombstone({
		cwd,
		dbPath,
		projectName,
		kind: group.kind as ArtifactKind,
		revisionId: revision.revisionId,
		reason,
	});
	ctx.ui.notify(outcome.ok ? outcome.message : `Tombstone failed: ${outcome.message}`, outcome.ok ? "info" : "error");
	for (const warning of outcome.warnings ?? []) ctx.ui.notify(warning, "warning");
}

/**
 * Register /velpari-tombstone (F16 + F12).
 * @param {ExtensionAPI} pi - The Pi extension API.
 * @returns {void}
 */
export function registerTombstoneCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-tombstone", {
		description:
			"Retract one published revision as a tracked modification (F16): status becomes withdrawn, bytes stay, the reason is audited. Requires a typed reason and two confirmations.",
		handler: async (_args, ctx) => {
			await runTombstoneFlow(ctx, process.cwd());
		},
	});
}
