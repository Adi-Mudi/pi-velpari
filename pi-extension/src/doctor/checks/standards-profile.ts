/**
 * Doctor check — Standards profile (Phase 3, plan §Phase 3).
 *
 * Verifies that the run's standardsProfile (when present) references an
 * overlay that actually exists in the catalogue. Catches stale references
 * after a community overlay is removed from the catalogue.
 */

import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import type { RunState } from "../../core/state.js";
import { loadCatalogue, findOverlay } from "../../core/standards-catalogue.js";

interface StandardsProfileGateError {
	code: string;
	message: string;
}

/**
 * Strict gate check — returns 0 or 1 error. Used by the publish gate.
 */
export function gateStandardsProfile(state: RunState | null, cwd: string): StandardsProfileGateError[] {
	const errors: StandardsProfileGateError[] = [];
	if (!state) return errors;
	const profile = state.standardsProfile;
	if (!profile) return errors; // absence is OK — implicit "none"

	const catalogue = loadCatalogue(cwd);
	if (!catalogue) {
		errors.push({
			code: "standards-profile.catalogue-missing",
			message:
				`Standards catalogue is missing at skills/standards/catalogue.json but the run ` +
				`references overlay "${profile.id}". Re-install Velpari or remove the standards profile.`,
		});
		return errors;
	}

	const overlay = findOverlay(catalogue, profile.id);
	if (!overlay) {
		errors.push({
			code: "standards-profile.overlay-missing",
			message:
				`Run references overlay "${profile.id}" which is not in the catalogue. ` +
				`Available overlays: ${catalogue.overlays.map((o) => o.id).join(", ")}. ` +
				`Run /velpari-configure-standards to pick a valid overlay.`,
		});
		return errors;
	}

	if (overlay.version !== profile.version) {
		// The overlay exists but the version drifted. Warn (not block).
		// Returning no error here — version mismatch is informational only.
	}

	return errors;
}

/**
 * Audit check — returns a DiagnosticSection for /velpari-doctor output.
 */
export function checkStandardsProfile(state: RunState | null, cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const errors = gateStandardsProfile(state, cwd);

	if (state?.standardsProfile) {
		const profile = state.standardsProfile;
		const catalogue = loadCatalogue(cwd);
		const overlay = catalogue ? findOverlay(catalogue, profile.id) : null;

		if (errors.length === 0) {
			items.push({
				status: "ok",
				message:
					`Standards overlay: ${profile.id}@${profile.version}` +
					(profile.researchConsent ? " (research consent recorded)" : "") +
					(overlay && overlay.version !== profile.version
						? ` — note: catalogue has ${overlay.id}@${overlay.version}`
						: ""),
			});
		} else {
			for (const e of errors) {
				items.push({ status: "error", message: e.message });
			}
		}
	} else {
		items.push({
			status: "ok",
			message: "No standards overlay selected (implicit 'none').",
		});
	}

	return { title: "Standards profile (Phase 3)", items };
}
