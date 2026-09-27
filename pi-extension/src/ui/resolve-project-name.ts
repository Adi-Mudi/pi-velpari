/**
 * Shared project resolver for the store commands (Phase I10.4).
 *
 * Placement note (recorded deviation): the phase instruction said L1, but the
 * helper drives `ctx.ui` pickers and L1 may not import `ui/` — enforced by
 * `test/architecture-alignment.test.ts` — so it lives here in L2 (`ui/`).
 *
 * Not widened (recorded note): `commands/export.ts:62` and
 * `commands/retention-prune.ts:32` carry the same family copy of this body.
 * They were found during verification and deliberately left alone (Phase 4
 * owns export; retention-prune is out of the review's scope) — recorded here
 * rather than silently refactored.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../core/config.js";
import { loadState } from "../core/state.js";
import { runSimplePicker } from "./simple-picker.js";

/** Picker copy for one command's prompt. */
export interface ResolveProjectNameOptions {
	/** Picker title (command-specific, e.g. "Freeze — pick project"). */
	title: string;
	/** Optional subtitle shown under the title. */
	subtitle?: string;
	/** Hint shown next to the active arch-cycle project (default "active architecture cycle"). */
	activeLabel?: string;
}

/**
 * Resolve the project a store command acts on: approve.ts precedence —
 * several configured `projectNames` open the multi-design picker (with the
 * active architecture cycle hinted), a single configured project or the
 * active cycle wins directly, else fall back to the run mission, then
 * "Project". Returns undefined only when the picker is cancelled.
 * @param {ExtensionContext} ctx - UI context for the picker.
 * @param {string} cwd - Working directory root.
 * @param {ResolveProjectNameOptions} opts - Picker title/subtitle + active-cycle hint label.
 * @returns {Promise<string | undefined>} projectName, or undefined on cancel.
 */
export async function resolveProjectName(
	ctx: ExtensionContext,
	cwd: string,
	opts: ResolveProjectNameOptions,
): Promise<string | undefined> {
	const state = loadState(cwd);
	const config = loadFilesConfig(cwd);
	const configured = config.projectNames ?? (config.projectName ? [config.projectName] : []);
	const archProject = state.archSubCycle?.projectName;
	if (configured.length > 1) {
		return await runSimplePicker(ctx, {
			title: opts.title,
			subtitle: opts.subtitle,
			items: configured.map((name) => ({
				id: name,
				label: name,
				hint: name === archProject ? (opts.activeLabel ?? "active architecture cycle") : undefined,
			})),
		});
	}
	if (archProject) return archProject;
	// `||` (not `??`): an empty-string mission must fall through to "Project".
	return configured[0] || state.mission || "Project";
}
