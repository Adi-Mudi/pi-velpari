/**
 * /velpari-retention-prune command (Phase 4 — N7 retention cleanup; L3).
 *
 * Explicit, confirmed, never automatic: resolve project → precheck git
 * (Fix 2 — no DB write before git is sane) → scanRetention → informational
 * exits (keep-forever / nothing beyond keep-last-N) → prune report →
 * double confirm (tombstone precedent) → ops/retention.ts:pruneRetentions
 * (audited per revision + explicit git commit) → outcome notify.
 * No path prompt, no state change, no publish logic.
 *
 * The pickers live here (L3) because L1 cannot import L2 UI — the
 * reconfirm precedent (picker-in-L3).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { loadState } from "../core/state.js";
import { loadFilesConfig } from "../core/config.js";
import { buildStoreDbPath } from "../core/paths.js";
import { scanRetention, pruneRetentions, type RetentionScan } from "../ops/retention.js";
import { precheckGitForPublish } from "../ops/db-publish.js";
import { runSimpleConfirm, runSimplePicker } from "../ui/simple-picker.js";

/**
 * Resolve the project to prune (tombstone.ts precedence + multi-design
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
		return runSimplePicker(ctx, {
			title: "Retention prune — pick project",
			subtitle: "Whose store should the prune read from?",
			items: configured.map((name) => ({
				id: name,
				label: name,
				hint: name === archProject ? "active architecture cycle" : undefined,
			})),
		});
	}
	if (archProject) return archProject;
	// `||` (not `??`): empty-string mission must fall through to "Project".
	return configured[0] || state.mission || "Project";
}

/**
 * Human-readable prune report (per kind: total/prunable/protected + the
 * exact revision numbers to be deleted).
 * @param {RetentionScan} scan - The scan result to render.
 * @returns {string} The report text (also shown in the confirm dialogs).
 */
function pruneReport(scan: RetentionScan): string {
	const lines: string[] = [`Retention prune report (keep-last-${scan.config.revisions}):`];
	for (const entry of scan.perKind) {
		if (entry.prunable.length === 0) continue;
		const revs = entry.prunable.map((c) => `rev ${c.revisionNumber}`).join(", ");
		lines.push(
			`- ${entry.kind}: ${entry.total} revision(s), ` +
				`${entry.prunable.length} to delete (${revs}), ` +
				`${entry.protectedCount} protected (head/baselined)`,
		);
	}
	return lines.join("\n");
}

/**
 * The full retention-prune flow. Exported for tests (mock ctx.ui); the
 * command handler just calls it with process.cwd().
 * @param {ExtensionContext} ctx - UI context (pickers + notifications).
 * @param {string} cwd - Working directory root.
 * @returns {Promise<void>} Notifies the outcome; never throws.
 */
export async function runRetentionPruneFlow(ctx: ExtensionContext, cwd: string): Promise<void> {
	const projectName = await resolveProjectName(ctx, cwd);
	if (!projectName) {
		ctx.ui.notify("Retention prune cancelled.", "info");
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

	// Fix 2: git precheck BEFORE any DB mutation — the prune commits the
	// store immediately, so git must be sane first (precheckGitForPublish
	// does not fail on a dirty tree, only on repo/identity problems).
	const precheck = precheckGitForPublish(cwd);
	if (!precheck.ok) {
		ctx.ui.notify(
			"Retention prune blocked — git is not ready:\n" +
				precheck.problems.map((p) => `- ${p}`).join("\n") +
				"\nFix git, then re-run /velpari-retention-prune.",
			"error",
		);
		return;
	}

	const scan = scanRetention(cwd, projectName);
	if (scan.config.revisions === "all") {
		ctx.ui.notify(
			'Retention is keep-forever (velpari.retention.revisions: "all").\n' +
				"Nothing to prune — configure keep-last-N in files.json to enable pruning.",
			"info",
		);
		return;
	}
	if (scan.prunableCount === 0) {
		ctx.ui.notify(
			`Nothing beyond keep-last-${scan.config.revisions} — every revision is inside the window or protected (head / baselined).`,
			"info",
		);
		return;
	}

	ctx.ui.notify(pruneReport(scan), "info");

	const confirmed = await runSimpleConfirm(
		ctx,
		`Prune ${scan.prunableCount} revision(s) beyond keep-last-${scan.config.revisions}?`,
		"This DELETES the listed revisions' snapshot rows permanently (status → withdrawn + row removal). " +
			"Head and baselined revisions are never pruned. An audit entry records each prune.",
	);
	if (!confirmed) {
		ctx.ui.notify("Retention prune cancelled — nothing changed.", "info");
		return;
	}
	const second = await runSimpleConfirm(
		ctx,
		"Confirm again",
		`Second confirmation — ${scan.prunableCount} revision row(s) are deleted immediately after this.`,
	);
	if (!second) {
		ctx.ui.notify("Retention prune cancelled — nothing changed.", "info");
		return;
	}

	const result = pruneRetentions(cwd, projectName, "velpari-retention-prune");
	const lines: string[] = [];
	if (result.pruned > 0) {
		lines.push(`Pruned ${result.pruned} revision(s) beyond keep-last-${scan.config.revisions}.`);
	}
	for (const problem of result.problems) lines.push(`- ${problem}`);
	for (const warning of result.warnings) lines.push(`- ${warning}`);
	if (lines.length === 0) {
		lines.push("Nothing was pruned — every candidate raced or vanished before its transaction.");
	}
	ctx.ui.notify(lines.join("\n"), result.ok ? "info" : "warning");
}

/**
 * Register /velpari-retention-prune (the Phase-4 retention command).
 * @param {ExtensionAPI} pi - The Pi extension API.
 * @returns {void}
 */
export function registerRetentionPruneCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-retention-prune", {
		description:
			"Retention cleanup (N7): delete superseded revisions beyond keep-last-N (velpari.retention.revisions). Confirmed + audited; head and baselined revisions are never pruned.",
		handler: async (_args, ctx) => {
			await runRetentionPruneFlow(ctx, process.cwd());
		},
	});
}
