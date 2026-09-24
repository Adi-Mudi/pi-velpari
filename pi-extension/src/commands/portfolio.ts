import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildPortfolioDbPath } from "../core/paths.js";
import { listProjects, type PortfolioProject } from "../io/portfolio.js";
import { openPortfolioDb, closeStoreDb } from "../io/db.js";
import { repairPortfolioRegistry } from "../ops/portfolio.js";
import { existsSync } from "node:fs";

/**
 * The portfolio flow, split from the handler so tests can inject cwd
 * (same pattern as commands/export.ts:runExportFlow).
 * @param {ExtensionCommandContext} ctx - Pi command context (ui.notify).
 * @param {string} cwd - Project root.
 * @param {boolean} wantsRepair - Run the full resync before listing.
 */
export async function runPortfolioFlow(ctx: ExtensionCommandContext, cwd: string, wantsRepair: boolean): Promise<void> {
	if (wantsRepair) {
		const result = repairPortfolioRegistry(cwd);
		for (const change of result.changes) {
			ctx.ui.notify(
				`portfolio: ${change.kind} ${change.projectName} - ${change.detail}`,
				change.kind === "warning" ? "warning" : "info",
			);
		}
		if (result.changes.length === 0) {
			ctx.ui.notify("portfolio: registry already in sync (no changes).", "info");
		}
	}

	const registryPath = buildPortfolioDbPath(cwd);
	if (!existsSync(registryPath)) {
		if (!wantsRepair) {
			ctx.ui.notify(
				"No portfolio registry yet (Doc/store/portfolio.db). It is created by the next publish, or run /velpari-portfolio --repair to build it from the existing per-project DBs.",
				"info",
			);
		}
		return;
	}
	try {
		const db = openPortfolioDb(registryPath);
		try {
			const rows: PortfolioProject[] = listProjects(db);
			if (rows.length === 0) {
				ctx.ui.notify("portfolio: registry is empty (no project DBs under Doc/store/).", "info");
				return;
			}
			const lines = rows.map(
				(r) =>
					`- ${r.projectName}${r.displayName && r.displayName !== r.projectName ? ` (${r.displayName})` : ""}: ` +
					`${r.lastPublishedAt ? `published ${r.lastPublishedAt}` : "no published artifacts"}, ` +
					`run ${r.lastRunId ?? "-"}, stage ${r.lastStage ?? "-"}`,
			);
			ctx.ui.notify(`portfolio (${rows.length} project(s)):\n${lines.join("\n")}`, "info");
		} finally {
			closeStoreDb(db);
		}
	} catch (err) {
		ctx.ui.notify(
			`portfolio: cannot read the registry (${err instanceof Error ? err.message : String(err)}). Run /velpari-portfolio --repair to rebuild it.`,
			"error",
		);
	}
}

/**
 * /velpari-portfolio — the 44th command (Phase 10, D6 hub-and-spoke).
 *
 * Cross-project visibility through the metadata registry
 * (Doc/store/portfolio.db): lists every known project spoke with its last
 * publish/run/stage. `--repair` runs a full resync (adds missing spokes,
 * removes orphans, refreshes stale rows) and reports the change list.
 * Ungoverned by the transition lock (discipline/ops class, same as
 * /velpari-backfill). Read-only unless --repair; store-only - no Doc/
 * markdown writes, no stage advance, no git commit (the publish chain's
 * own commits carry the registry).
 */
export function registerPortfolioCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-portfolio", {
		description:
			"List projects in the portfolio registry (hub-and-spoke; 44th command). --repair resyncs from the per-project DBs.",
		handler: async (args, ctx) => {
			const cwd = process.cwd();
			const wantsRepair = (args ?? "").trim().toLowerCase().includes("--repair");
			await runPortfolioFlow(ctx, cwd, wantsRepair);
		},
	});
}
