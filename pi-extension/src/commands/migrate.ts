// ============================================================================
// commands/migrate.ts — /velpari-migrate-store (45th command, Phase 11 §15.6)
// ============================================================================
// RES-3 one-time migration: every legacy-published document under Doc/
// imports into its project's store DB once; the markdown-as-source publish
// path is retired (Q3) in the same phase. Surface (OQ-P11a, user-locked):
//   no args     → usage + precondition status (G7/git) + discovered projects
//   --dry-run   → full per-project report; writes NOTHING
//   --execute   → confirm gate with the same summary FIRST, then migrate +
//                 verify + per-project commit (`velpari(migrate): <project>
//                 (run migrated)`). No auto-migrate ever.
// Thin handler — all logic lives in ops/migrate.ts (L1); the flow function
// is exported for tests (the portfolio-command pattern). A cancelled
// confirm writes nothing.
// ============================================================================

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runSimpleConfirm } from "../ui/simple-picker.js";
import {
	discoverLegacyProjects,
	migrateDryRun,
	migrateExecute,
	migratePrecheck,
	renderMigrateReport,
} from "../ops/migrate.js";

/** Parsed argv mode. */
export type MigrateMode = "usage" | "dry-run" | "execute";

/** Parse the command args → mode. Both flags is a parse error (null). */
export function parseMigrateArgs(args: string | undefined): MigrateMode | null {
	const raw = (args ?? "").trim().toLowerCase();
	const dryRun = raw.includes("--dry-run");
	const execute = raw.includes("--execute");
	if (dryRun && execute) return null;
	if (dryRun) return "dry-run";
	if (execute) return "execute";
	return "usage";
}

/**
 * The command flow (portfolio-command pattern): driven directly by tests
 * with a mock ctx; the registration below is a thin wrapper.
 *
 * @param {ExtensionCommandContext} ctx - Pi command context (ui surface).
 * @param {string} cwd - Project root.
 * @param {MigrateMode} mode - Parsed argv mode.
 */
export async function runMigrateFlow(ctx: ExtensionCommandContext, cwd: string, mode: MigrateMode): Promise<void> {
	if (mode === "usage") {
		const pre = migratePrecheck(cwd);
		const projects = discoverLegacyProjects(cwd);
		const names = projects.length === 0 ? "none" : projects.map((p) => p.projectName).join(", ");
		const lines = [
			"Usage: /velpari-migrate-store --dry-run | --execute",
			"  --dry-run  — full per-project report; writes NOTHING.",
			"  --execute  — confirms with the same summary first, then migrates, re-exports YAML, and commits per project.",
			`Precheck: ${pre.ok ? "ok" : "BLOCKED"}`,
			...pre.problems.map((p) => `  - ${p}`),
			`Legacy projects discovered: ${names}`,
		];
		ctx.ui.notify(lines.join("\n"), pre.ok ? "info" : "error");
		return;
	}
	if (mode === "dry-run") {
		const report = migrateDryRun(cwd);
		ctx.ui.notify(renderMigrateReport(report, true), report.ok ? "info" : "error");
		return;
	}
	// execute: OQ-P11a confirm gate — the dry summary IS the gate summary
	// (the same per-project/per-kind report, marked as a dry run).
	const dry = migrateDryRun(cwd);
	if (!dry.ok) {
		ctx.ui.notify(renderMigrateReport(dry, true), "error");
		return;
	}
	const confirmed = await runSimpleConfirm(
		ctx,
		"Migrate legacy documents into the store?",
		renderMigrateReport(dry, true),
	);
	if (!confirmed) {
		ctx.ui.notify("Migration cancelled — nothing written.", "info");
		return;
	}
	// migrateExecute re-runs the precheck itself (R3: re-check at execute
	// time — a run opened between confirm and execute still blocks).
	const report = migrateExecute(cwd);
	ctx.ui.notify(renderMigrateReport(report, false), report.ok ? "info" : "error");
}

export function registerMigrateCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-migrate-store", {
		description:
			"One-time legacy migration: import every published Doc/ artifact into its project store, re-export YAML, and commit (dry-run + confirm execute; 45th command).",
		handler: async (args, ctx) => {
			const mode = parseMigrateArgs(args);
			if (mode === null) {
				ctx.ui.notify("Usage: /velpari-migrate-store --dry-run | --execute — choose ONE mode.", "error");
				return;
			}
			await runMigrateFlow(ctx, process.cwd(), mode);
		},
	});
}
