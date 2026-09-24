import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { KIND_ORDER, type ArtifactKind } from "../io/store.js";
import { backfillFromExport, backfillKind } from "../ops/backfill.js";

/**
 * /velpari-backfill — the 43rd command (Phase 6 4.1, §14.5).
 *
 * One-step legacy import for a strict DB-primary project: parses the
 * published Doc/ markdown/sidecar for `<kind>` and writes the rows into the
 * project store (published). Store-only — no Doc/ write, no stage advance,
 * no git commit. Idempotent: an already-imported kind reports a no-op.
 * This is the recovery command every loud slice/pre-condition refuse names.
 *
 * Phase 9 (§15.4): `/velpari-backfill <kind> --from-export` rebuilds the
 * kind from the store's OWN export YAML beside the DB (D9 made real) —
 * the merge runbook's central recovery step. Same store-only contract.
 */
export function registerBackfillCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-backfill", {
		description:
			"Import a legacy published artifact into the project store (DB-primary recovery; 43rd command). `--from-export` rebuilds from the store YAML beside the DB.",
		handler: async (args, ctx) => {
			const cwd = process.cwd();
			const raw = (args ?? "").trim().toLowerCase();
			if (!raw) {
				ctx.ui.notify(
					`Usage: /velpari-backfill <kind> [--from-export] — kind is one of: ${KIND_ORDER.join(", ")}`,
					"error",
				);
				return;
			}
			// Phase 9: --from-export flips the source from legacy
			// markdown/sidecar to the store's own export YAML (D9).
			const fromExport = raw.includes("--from-export");
			const kindToken = raw.replace(/--from-export/g, "").trim();
			if (!kindToken) {
				ctx.ui.notify(
					`Usage: /velpari-backfill <kind> [--from-export] — kind is one of: ${KIND_ORDER.join(", ")}`,
					"error",
				);
				return;
			}
			const kind = KIND_ORDER.find((k) => k === kindToken);
			if (!kind) {
				ctx.ui.notify(`Unknown kind '${kindToken}' — expected one of: ${KIND_ORDER.join(", ")}`, "error");
				return;
			}
			const config = loadFilesConfig(cwd);
			if (!validateFilesConfig(config) || !config.projectName) {
				ctx.ui.notify("Project name not set. Run /velpari-configure-inputs first.", "error");
				return;
			}
			// Fixed run id (not timestamped): cross-kind FKs are run-scoped
			// (`fr(run_id, id)`, `atomic_function(run_id, id)`, …), so every
			// /velpari-backfill import shares one run — prd → rtm → design →
			// atomic-functions → pseudocode → development-order chain safely.
			// With --from-export the YAML's own runId wins anyway (this value
			// is only the fallback for hand-repaired YAML that omits it).
			const runId = "backfill";
			const result = fromExport
				? backfillFromExport(cwd, config.projectName, kind as ArtifactKind, runId)
				: backfillKind(cwd, config.projectName, kind as ArtifactKind, runId);
			ctx.ui.notify(result.note, result.ok ? "info" : "error");
		},
	});
}
