/**
 * Requirements profile check.
 *
 * Verifies `.pi/velpari/requirements-profile.json` exists and matches
 * the current schema version. Doctor is report-only — it never selects,
 * fixes, or mutates a profile. configure-requirements is the only
 * mutation entrypoint.
 */

import {
	REQUIREMENTS_PROFILE_VERSION,
	loadRequirementsProfile,
	validateRequirementsProfile,
} from "../../../core/profile.js";

export function checkRequirementsProfile(cwd: string, lines: string[]): void {
	const profile = loadRequirementsProfile(cwd);
	if (!profile) {
		lines.push("Profile: MISSING (run /velpari-configure-requirements)");
		return;
	}
	const ok = validateRequirementsProfile(profile);
	lines.push(
		`Profile: ${ok ? "VALID" : "INVALID"} mode=${profile.profileKind} id=${profile.profileId} version=${profile.version} (expected ${REQUIREMENTS_PROFILE_VERSION})`,
	);
	lines.push(
		`Application=${profile.applicationType} | Domain=${profile.domain} | Method=${profile.developmentMethod} | Regulated=${profile.regulated ? "yes" : "no"} | Security=${profile.securityLevel} | Variant=${profile.outputVariant}`,
	);
	lines.push(`Required sections: ${profile.requiredSections.join(", ") || "(none)"}`);
	lines.push(
		`Research consent: ${profile.researchConsent ? "yes" : "no"} | Research source count: ${profile.researchSources.length}`,
	);
	lines.push(
		`Doctor is report-only: it lists the active profile and research state but never selects, fixes, or mutates a profile.`,
	);
	if (profile.profileKind === "common-core") {
		lines.push(
			`Common PSRS core selected (id=${profile.profileId}); this is a real, valid choice and not a placeholder for a missing match.`,
		);
	}
}
