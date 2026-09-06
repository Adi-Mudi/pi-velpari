/**
 * Requirements profile check.
 *
 * Verifies `.pi/velpari/requirements-profile.json` exists and matches
 * the current schema version. Doctor is report-only — it never selects,
 * fixes, or mutates a profile. configure-requirements is the only
 * mutation entrypoint.
 *
 * Phase 1: returns a DiagnosticSection instead of mutating a shared
 * `lines` array.
 */

import {
	REQUIREMENTS_PROFILE_VERSION,
	loadRequirementsProfile,
	validateRequirementsProfile,
} from "../../../core/profile.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";

export function checkRequirementsProfileSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const profile = loadRequirementsProfile(cwd);

	if (!profile) {
		items.push({
			status: "info",
			message: "Profile: MISSING (run /velpari-configure-requirements)",
			suggestion: "Run `/velpari-configure-requirements` to capture the requirements profile.",
		});
		return { title: "Requirements profile", items };
	}

	const ok = validateRequirementsProfile(profile);
	items.push({
		status: ok ? "ok" : "error",
		message: `Profile: ${ok ? "VALID" : "INVALID"} mode=${profile.profileKind} id=${profile.profileId} version=${profile.version} (expected ${REQUIREMENTS_PROFILE_VERSION})`,
		details: [
			`Application=${profile.applicationType} | Domain=${profile.domain} | Method=${profile.developmentMethod} | Regulated=${profile.regulated ? "yes" : "no"} | Security=${profile.securityLevel} | Variant=${profile.outputVariant}`,
			`Required sections: ${profile.requiredSections.join(", ") || "(none)"}`,
			`Research consent: ${profile.researchConsent ? "yes" : "no"} | Research source count: ${profile.researchSources.length}`,
			"Doctor is report-only: it lists the active profile and research state but never selects, fixes, or mutates a profile.",
		],
	});

	if (profile.profileKind === "common-core") {
		items.push({
			status: "info",
			message: `Common PSRS core selected (id=${profile.profileId}); this is a real, valid choice and not a placeholder for a missing match.`,
		});
	}

	return { title: "Requirements profile", items };
}
