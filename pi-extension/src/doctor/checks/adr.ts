/**
 * Doctor check — Architecture Decision Records (Phase 4, plan §Phase 4).
 *
 * Verifies that every design artifact carries a valid `## Architecture
 * Decisions` section:
 *   - section exists OR the doc contains a single "no conflicts" ADR
 *   - every ADR passes validateADR
 *   - no orphan ADRs (supersedes / supersededBy must resolve)
 *   - no accepted ADR with empty options table (single-option rubber-stamp)
 */

import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import {
	findOrphanADRs,
	parseADRSection,
	validateADR,
	validateFirstADR,
} from "../../core/adr.js";

export interface AdrGateError {
	code: string;
	message: string;
}

const ADR_HEADING = /^## Architecture Decisions\b/m;

/**
 * Strict gate check — returns 0 or N errors. Used by the publish gate.
 */
export function gateADR(workingContent: string): AdrGateError[] {
	const errors: AdrGateError[] = [];

	if (!ADR_HEADING.test(workingContent)) {
		errors.push({
			code: "adr.section-missing",
			message:
				"Design artifact is missing the `## Architecture Decisions` section. " +
				"Add the section (or include a single ADR-000 'no conflicts surfaced' ADR).",
		});
		return errors;
	}

	const adrs = parseADRSection(workingContent);
	if (adrs.length === 0) {
		errors.push({
			code: "adr.no-records",
			message:
				"`## Architecture Decisions` section is present but contains no parseable ADRs. " +
				"Either include at least one ADR in the JSON shape or remove the section.",
		});
		return errors;
	}

	const orphan = findOrphanADRs(adrs);
	for (const o of orphan) {
		errors.push({
			code: "adr.orphan",
			message: `ADR ${o.id} has a dangling supersedes/supersededBy link.`,
		});
	}

	// Phase 4 of the architecture-generator upgrade plan: the **first** ADR
	// is the architectural style choice and is mandatory. Force it.
	for (const issue of validateFirstADR(adrs)) {
		errors.push({ code: "adr.first-invalid", message: issue });
	}

	for (const adr of adrs) {
		const issues = validateADR(adr);
		for (const issue of issues) {
			errors.push({
				code: "adr.invalid",
				message: `ADR ${adr.id}: ${issue}`,
			});
		}
		// Rubber-stamp check: an accepted ADR with one or zero options is suspicious.
		if (adr.status === "accepted" && adr.options.length < 2) {
			errors.push({
				code: "adr.single-option",
				message:
					`ADR ${adr.id} is accepted but lists ${adr.options.length} option(s). ` +
					`At least 2 options must be compared for an accepted decision.`,
			});
		}
	}

	return errors;
}

/**
 * Audit check — returns a DiagnosticSection for /velpari-doctor output.
 */
export function checkADR(workingContent: string | null): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	if (workingContent === null) {
		items.push({
			status: "ok",
			message: "No design artifact yet (ADR check skipped).",
		});
		return { title: "Architecture Decision Records (Phase 4)", items };
	}

	const errors = gateADR(workingContent);
	if (errors.length === 0) {
		const adrs = parseADRSection(workingContent);
		items.push({
			status: "ok",
			message: `${adrs.length} ADR(s) recorded, all valid.`,
		});
	} else {
		for (const e of errors) {
			items.push({ status: "error", message: `${e.code}: ${e.message}` });
		}
	}

	return { title: "Architecture Decision Records (Phase 4)", items };
}
