/**
 * /velpari-configure-standards handler (Phase 3, plan §Phase 3).
 *
 * Lists overlays from the catalogue, lets the developer pick one, and
 * persists the choice to .pi/velpari/standards-profile.json + state.json.
 *
 * Behavior:
 *   - Reads the catalogue; refuses to run if the catalogue is missing.
 *   - Shows the current selection (if any) at the top.
 *   - Lets the user pick via ctx.ui.select with one entry per overlay.
 *   - Asks for web-research consent (FR-52 parity with the requirements
 *     profile). When the user consents, records the consent and an empty
 *     sources array; the parent LLM fills the sources during research.
 *   - Persists the new profile via saveStandardsProfile.
 *   - On cancellation, preserves the existing selection.
 *
 * Pure logic + IO. No LLM calls inside the handler. Research itself is
 * the parent's job (not the handler's) per the requirements-profile
 * pattern.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalogue, listOverlayIds, findOverlay } from "../core/standards-catalogue.js";
import { loadState, saveState, type RunState, type StandardsProfile } from "../core/state.js";

interface ConfigureStandardsContext {
	ui: {
		select?: (title: string, options: string[]) => Promise<string | null>;
		confirm?: (title: string, message: string) => Promise<boolean>;
		notify?: (message: string, level?: string) => void;
	};
	cwd: string;
}

interface ConfigureStandardsResult {
	outcome: "selected" | "cancelled" | "no-catalogue" | "no-ui";
	profile: StandardsProfile | null;
}

/**
 * Default location of the standards profile JSON.
 */
const STANDARDS_PROFILE_FILE = ".pi/velpari/standards-profile.json";

export function standardsProfilePath(cwd: string): string {
	return join(cwd, STANDARDS_PROFILE_FILE);
}

export function loadStandardsProfileFromDisk(cwd: string): StandardsProfile | null {
	const path = standardsProfilePath(cwd);
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as Partial<StandardsProfile>;
		if (
			typeof parsed.id !== "string" ||
			typeof parsed.version !== "string" ||
			typeof parsed.selectedAt !== "string" ||
			(parsed.selectedBy !== "user" && parsed.selectedBy !== "inference")
		) {
			return null;
		}
		return parsed as StandardsProfile;
	} catch {
		return null;
	}
}

function saveStandardsProfileToDisk(profile: StandardsProfile, cwd: string): void {
	const path = standardsProfilePath(cwd);
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(path, JSON.stringify(profile, null, 2), "utf8");
}

/**
 * Top-level entry point for /velpari-configure-standards.
 */
export async function handleConfigureStandards(ctx: ConfigureStandardsContext): Promise<ConfigureStandardsResult> {
	const catalogue = loadCatalogue(ctx.cwd);
	if (!catalogue) {
		ctx.ui.notify?.(
			"Standards catalogue is missing (skills/standards/catalogue.json). Cannot configure standards.",
			"error",
		);
		return { outcome: "no-catalogue", profile: loadStandardsProfileFromDisk(ctx.cwd) };
	}

	const overlayIds = listOverlayIds(catalogue);
	if (overlayIds.length === 0) {
		ctx.ui.notify?.("No overlays in the catalogue. Add one and try again.", "warn");
		return { outcome: "no-catalogue", profile: loadStandardsProfileFromDisk(ctx.cwd) };
	}

	const current = loadStandardsProfileFromDisk(ctx.cwd) ?? loadFromState(ctx.cwd);
	const labelMap = new Map<string, string>();
	for (const id of overlayIds) {
		const overlay = findOverlay(catalogue, id);
		if (overlay) labelMap.set(id, `${id} — ${overlay.label}`);
		else labelMap.set(id, id);
	}

	const labels = overlayIds.map((id) => labelMap.get(id) ?? id);

	const intro = current
		? `Current selection: ${current.id}@${current.version}\n\nPick a new overlay (Cancel keeps the current selection):`
		: "Pick a standards overlay (Cancel keeps the implicit 'none' overlay):";

	if (!ctx.ui.select) {
		ctx.ui.notify?.("No UI available; cannot pick an overlay.", "warn");
		return { outcome: "no-ui", profile: current };
	}

	const choice = await ctx.ui.select(intro, labels);
	if (choice === null) {
		return { outcome: "cancelled", profile: current };
	}

	// Reverse-lookup id from the chosen label.
	const chosenId = overlayIds.find((id) => labelMap.get(id) === choice);
	if (!chosenId) {
		ctx.ui.notify?.("Could not match selection to a known overlay.", "error");
		return { outcome: "cancelled", profile: current };
	}

	const overlay = findOverlay(catalogue, chosenId);
	if (!overlay) {
		ctx.ui.notify?.(`Overlay "${chosenId}" is not in the catalogue.`, "error");
		return { outcome: "cancelled", profile: current };
	}

	let consent = false;
	if (ctx.ui.confirm) {
		consent = await ctx.ui.confirm(
			"Web research consent",
			`Allow Velpari to fetch public references for ${overlay.standards.join(", ")}? Sources will be recorded in state.json. (Optional; say no to skip.)`,
		);
	}

	const profile: StandardsProfile = {
		id: overlay.id,
		version: overlay.version,
		selectedAt: new Date().toISOString(),
		selectedBy: "user",
		researchConsent: consent,
		researchSources: [],
	};

	saveStandardsProfileToDisk(profile, ctx.cwd);
	persistToState(ctx.cwd, profile);

	ctx.ui.notify?.(
		`Standards overlay set to ${profile.id}@${profile.version}.` + (consent ? " Research consent recorded." : ""),
		"info",
	);

	return { outcome: "selected", profile };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function loadFromState(cwd: string): StandardsProfile | null {
	const state = loadState(cwd);
	return state?.standardsProfile ?? null;
}

function persistToState(cwd: string, profile: StandardsProfile): void {
	const state: RunState | null = loadState(cwd);
	if (!state) return;
	saveState({ ...state, standardsProfile: profile, updatedAt: new Date().toISOString() }, cwd);
}
