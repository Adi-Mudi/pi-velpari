/**
 * /velpari-freeze command (N4 — freeze / unfreeze; L3, Phase 2).
 *
 * Flow: action (freeze|unfreeze) → project → artifact kind → run → reason →
 * confirm → `ops/protection.ts:applySingleKindFreeze` (freeze) or Phase 1's
 * canonical `ops/freeze.ts:unfreezeArtifact` + `finalizeUnfreeze` (unfreeze).
 * Frozen artifacts refuse publish (publishArtifactCas), supersession and the
 * F16 tombstone; unfreezing always needs a typed reason (N4).
 *
 * The pickers live here (L3) because L1 cannot import L2 UI — the
 * reconfirm/export precedent. The run is resolved from the STORE (design
 * rule 11): a handoff-frozen artifact stays unfreezable after the run ended,
 * on a `migrated` run, and after `/velpari-reset` — an active run is only the
 * default candidate.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { loadFilesConfig } from "../core/config.js";
import { buildStoreDbPath } from "../core/paths.js";
import { loadState } from "../core/state.js";
import type { ArtifactKind } from "../io/store.js";
import { unfreezeArtifact } from "../ops/freeze.js";
import { applySingleKindFreeze, finalizeUnfreeze, freezeStateOf, runsForKind, storeKinds } from "../ops/protection.js";
import { runSimpleConfirm, runSimplePicker } from "../ui/simple-picker.js";

/** Freeze action menu (N4). */
const ACTION_ITEMS = [
	{ id: "freeze", label: "freeze", hint: "lock the artifact — no publish, no supersession, no tombstone" },
	{ id: "unfreeze", label: "unfreeze", hint: "lift the lock — requires a typed reason" },
];

/**
 * Resolve the project to act on (approve.ts precedence + multi-design picker,
 * re-implemented locally — commands/export.ts is Phase 4-owned).
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
		return await runSimplePicker(ctx, {
			title: "Freeze — pick project",
			subtitle: "Multi-design run — whose store should be locked or unlocked?",
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
 * The full freeze/unfreeze flow. Exported for tests (mock ctx.ui); the command
 * handler calls it with process.cwd().
 * @param {ExtensionContext} ctx - UI context (pickers, input, notifications).
 * @param {string} cwd - Working directory root.
 * @returns {Promise<void>} Notifies the outcome; never throws.
 */
export async function runFreezeFlow(ctx: ExtensionContext, cwd: string): Promise<void> {
	const action = await runSimplePicker(ctx, {
		title: "Freeze — pick action",
		subtitle: "N4: freeze at handoff; unfreezing needs a typed reason.",
		items: ACTION_ITEMS,
	});
	if (!action) {
		ctx.ui.notify("Freeze cancelled.", "info");
		return;
	}
	const frozen = action === "freeze";

	const projectName = await resolveProjectName(ctx, cwd);
	if (!projectName) {
		ctx.ui.notify("Freeze cancelled.", "info");
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

	const kinds = storeKinds(cwd, projectName);
	if (kinds.length === 0) {
		ctx.ui.notify(`No store artifacts for project "${projectName}" yet.`, "info");
		return;
	}
	const pickedKind = await runSimplePicker(ctx, {
		title: `Freeze — pick artifact (${frozen ? "freeze" : "unfreeze"})`,
		subtitle: "Kinds present in this project's store.",
		items: kinds.map((kind) => ({ id: kind, label: kind })),
	});
	if (!pickedKind) {
		ctx.ui.notify("Freeze cancelled.", "info");
		return;
	}
	const kind = pickedKind as ArtifactKind;

	// Rule 11 — the run comes from the store; state.json is only a default.
	const state = loadState(cwd);
	const candidates = runsForKind(cwd, projectName, kind);
	if (candidates.length === 0) {
		ctx.ui.notify(`No store rows for "${kind}" in project "${projectName}".`, "info");
		return;
	}
	let runId = state.runId && candidates.includes(state.runId) ? state.runId : undefined;
	if (!runId) {
		const pickedRun = await runSimplePicker(ctx, {
			title: "Freeze — pick run",
			subtitle: "The artifact's owning run (read from the store — an active run is not required).",
			items: candidates.map((candidate) => {
				const current = freezeStateOf(cwd, projectName, candidate, kind);
				return {
					id: candidate,
					label: candidate,
					hint: current?.frozen === true ? `frozen${current.reason ? `: ${current.reason}` : ""}` : "not frozen",
				};
			}),
		});
		if (!pickedRun) {
			ctx.ui.notify("Freeze cancelled.", "info");
			return;
		}
		runId = pickedRun;
	}

	const answer = await ctx.ui.input(frozen ? "Freeze reason (optional)" : "Unfreeze reason (required)");
	const reason = (answer ?? "").trim();
	if (!frozen && reason === "") {
		ctx.ui.notify("Unfreeze requires a typed reason (N4) — nothing changed.", "info");
		return;
	}

	const current = freezeStateOf(cwd, projectName, runId, kind);
	const confirmed = await runSimpleConfirm(
		ctx,
		frozen ? `Freeze ${kind}?` : `Unfreeze ${kind}?`,
		frozen
			? `Run ${runId}. A frozen artifact refuses publish, supersession and tombstone until an explicit unfreeze.`
			: `Run ${runId}. Current lock${current?.reason ? `: ${current.reason}` : " (no reason recorded)"}. This lifts the lock.`,
	);
	if (!confirmed) {
		ctx.ui.notify("Freeze cancelled — nothing changed.", "info");
		return;
	}

	const outcome = frozen
		? applySingleKindFreeze({ cwd, dbPath, projectName, runId, kind, reason })
		: unfreezeViaPhase1({ cwd, dbPath, projectName, runId, kind, reason });
	ctx.ui.notify(outcome.ok ? outcome.message : `Freeze failed: ${outcome.message}`, outcome.ok ? "info" : "error");
	for (const warning of outcome.warnings ?? []) ctx.ui.notify(warning, "warning");
}

/**
 * Unfreeze one kind through Phase 1's canonical N4 executor
 * (`ops/freeze.ts:unfreezeArtifact` — audit row included), then finish the
 * Phase-2 side: F18 tx entry + WAL checkpoint + a local explicit-path commit.
 * @returns {{ok: boolean; message: string; warnings?: string[]}}
 */
function unfreezeViaPhase1(params: {
	cwd: string;
	dbPath: string;
	projectName: string;
	runId: string;
	kind: ArtifactKind;
	reason: string;
}): { ok: boolean; message: string; warnings?: string[] } {
	const result = unfreezeArtifact(params.cwd, params.projectName, params.runId, params.kind, params.reason);
	if (!result.ok) {
		return { ok: false, message: result.problems.join(" ") || "unfreeze refused (N4)" };
	}
	const warnings = finalizeUnfreeze({
		cwd: params.cwd,
		dbPath: params.dbPath,
		projectName: params.projectName,
		runId: params.runId,
		kind: params.kind,
		reason: params.reason,
	});
	return {
		ok: true,
		message: `Unfrozen ${params.kind} (run ${params.runId}) — ${params.reason}`,
		warnings: warnings.length > 0 ? warnings : undefined,
	};
}

/**
 * Register /velpari-freeze (N4).
 * @param {ExtensionAPI} pi - The Pi extension API.
 * @returns {void}
 */
export function registerFreezeCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-freeze", {
		description:
			"Freeze or unfreeze a published artifact (N4): a frozen artifact refuses publish, supersession and tombstone. Unfreezing requires a typed reason; every action is audited.",
		handler: async (_args, ctx) => {
			await runFreezeFlow(ctx, process.cwd());
		},
	});
}
