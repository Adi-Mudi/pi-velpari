/**
 * Logging plan doctor section (v1.4.0).
 *
 * Audits `Doc/observability/logging-plan_<projectName>.md` (grouped)
 * or `Doc/logging-plan_<projectName>.md` (legacy fallback).
 *
 * Checks (in order):
 *   1. Existence — error when an active overlay requires logging;
 *      info when overlay is "none".
 *   2. Section coverage — every heading in
 *      `core/logging-plan.ts:LOGGING_PLAN_REQUIRED_SECTIONS` must be
 *      present. Each missing heading is a warning.
 *   3. Frontmatter — must parse + carry the `artifact`, `project`,
 *      `version`, and `created` fields. Errors when missing.
 *   4. Retention compliance — when the active overlay has a
 *      `loggingRequirements.retentionMonths` minimum, the plan's
 *      retention table (§7) must show a tier whose months >= that
 *      minimum. Errors when violated.
 *   5. Tamper-evidence compliance — when the overlay declares
 *      `tamperEvident: true`, the plan's §8 must declare tamper-
 *      evident storage. Errors when missing.
 *   6. PII redaction — when the overlay declares `piiRedaction: true`,
 *      the plan's §13 must mention PII redaction. Errors when missing.
 *
 * v1.4.0 — cross-cutting discipline command /velpari-design-logging.
 */

import {
	LOGGING_PLAN_REQUIRED_SECTIONS,
	loadPublishedLoggingPlanMarkdown,
} from "../../core/logging-plan.js";
import { loadOverlay } from "../../core/standards-overlay.js";
import { loadState } from "../../core/state.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

const OVERLAYS_REQUIRING_LOGGING = new Set([
	"medical-device-b",
	"industrial-ot",
	"financial-payments",
	"cloud-saas",
]);

/**
 * Compute the maximum retention months declared in §7 by summing
 * every row in the retention tier table. Naive but sufficient for a
 * doctor check; the structured validator (validateLoggingPlan)
 * handles the rigorous check.
 */
function maxRetentionMonthsFromMarkdown(content: string): number {
	const tiers: number[] = [];
	// Match "| <tier> | <months> | ..." inside the §7 table.
	const tierRe = /\|\s*(hot|warm|cold|archive)\s*\|\s*(\d+)\s*\|/gi;
	let m: RegExpExecArray | null;
	while ((m = tierRe.exec(content)) !== null) {
		tiers.push(Number.parseInt(m[2]!, 10));
	}
	if (tiers.length === 0) return 0;
	return Math.max(...tiers);
}

/**
 * Extract a tiny subset of the frontmatter as key/value strings.
 * Sufficient for the doctor check (4 fields). A full parser lives in
 * `core/frontmatter.ts` for the published-artifact format; we don't
 * need that here.
 */
function readFrontmatter(
	content: string,
): Record<string, string> {
	const match = content.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match) return {};
	const block = match[1]!;
	const out: Record<string, string> = {};
	for (const line of block.split("\n")) {
		const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
		if (kv) {
			out[kv[1]!] = kv[2]!.trim();
		}
	}
	return out;
}

export function checkLoggingPlanSection(
	cwd: string,
	projectName: string,
): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const title = "Logging plan (Doc/observability/logging-plan_<project>.md)";

	// Resolve the active overlay's logging requirements (if any).
	let overlayRequires = false;
	let requiredRetentionMonths = 0;
	let requiresTamperEvident = false;
	let requiresPiiRedaction = false;
	try {
		const state = loadState(cwd);
		if (state.standardsProfile && OVERLAYS_REQUIRING_LOGGING.has(state.standardsProfile.id)) {
			const overlay = loadOverlay(cwd, state.standardsProfile.id);
			if (overlay && overlay.loggingRequirements) {
				overlayRequires = true;
				requiredRetentionMonths = overlay.loggingRequirements.retentionMonths;
				requiresTamperEvident = overlay.loggingRequirements.tamperEvident;
				requiresPiiRedaction = overlay.loggingRequirements.piiRedaction;
			}
		}
	} catch {
		// ignore — overlay resolution is best-effort here
	}

	// 1. Existence.
	const published = loadPublishedLoggingPlanMarkdown(cwd, projectName);
	if (!published) {
		items.push({
			status: overlayRequires ? "error" : "info",
			message: overlayRequires
				? `Logging plan MISSING — the active standards overlay requires it (retention ≥ ${requiredRetentionMonths} months${requiresTamperEvident ? ", tamper-evident" : ""}${requiresPiiRedaction ? ", PII redaction" : ""}).`
				: "Logging plan: MISSING (optional — no compliance overlay active).",
			suggestion: suggestionFor(
				overlayRequires ? "logging-plan-overlay-required" : "logging-plan-missing",
			),
		});
		return { title, items };
	}

	items.push({
		status: "ok",
		message: `Logging plan: ${published.layout} layout at ${published.path}`,
	});

	// 2. Section coverage.
	const missingSections: string[] = [];
	for (const heading of LOGGING_PLAN_REQUIRED_SECTIONS) {
		if (!published.content.includes(heading)) {
			missingSections.push(heading);
		}
	}
	if (missingSections.length > 0) {
		items.push({
			status: "warning",
			message: `Missing section heading(s): ${missingSections.length}`,
			details: missingSections.map((s) => `- ${s}`),
			suggestion: suggestionFor("logging-plan-sections-missing"),
		});
	} else {
		items.push({
			status: "ok",
			message: `All ${LOGGING_PLAN_REQUIRED_SECTIONS.length} required sections present.`,
		});
	}

	// 3. Frontmatter.
	const fm = readFrontmatter(published.content);
	const requiredFmFields: Array<keyof typeof fm | string> = [
		"artifact",
		"project",
		"version",
		"created",
	];
	const missingFm = requiredFmFields.filter((k) => !fm[k as string]);
	if (missingFm.length > 0) {
		items.push({
			status: "error",
			message: `Frontmatter missing field(s): ${missingFm.join(", ")}`,
			suggestion: suggestionFor("logging-plan-frontmatter-missing"),
		});
	} else {
		items.push({
			status: "ok",
			message: `Frontmatter: artifact=${fm.artifact} project=${fm.project} version=${fm.version} created=${fm.created}`,
		});
	}
	if (fm.artifact && fm.artifact !== "logging-plan") {
		items.push({
			status: "error",
			message: `Frontmatter artifact must be "logging-plan" (got "${fm.artifact}").`,
		});
	}

	// 4. Retention compliance (overlay-driven).
	if (overlayRequires && requiredRetentionMonths > 0) {
		const maxMonths = maxRetentionMonthsFromMarkdown(published.content);
		if (maxMonths === 0) {
			items.push({
				status: "warning",
				message:
					"Could not parse retention tiers from §7. Ensure the table has rows like `| hot | 12 | ...`.",
			});
		} else if (maxMonths < requiredRetentionMonths) {
			items.push({
				status: "error",
				message: `Retention shortfall: plan's longest tier is ${maxMonths} months, overlay requires ≥ ${requiredRetentionMonths} months.`,
				suggestion: suggestionFor("logging-plan-retention-short"),
			});
		} else {
			items.push({
				status: "ok",
				message: `Retention ${maxMonths} months ≥ overlay minimum ${requiredRetentionMonths} months.`,
			});
		}
	}

	// 5. Tamper-evidence compliance.
	if (overlayRequires && requiresTamperEvident) {
		const section8 = extractSection(published.content, "## 8. Protection");
		const mentionsTamperEvident = /tamper[- ]evident|append[- ]only|worm|write[- ]once/i.test(
			section8,
		);
		if (!mentionsTamperEvident) {
			items.push({
				status: "error",
				message:
					"Tamper-evident storage is required by the active overlay but §8 does not mention it.",
				suggestion: suggestionFor("logging-plan-tamper-evident-missing"),
			});
		}
	}

	// 6. PII redaction.
	if (overlayRequires && requiresPiiRedaction) {
		const section13 = extractSection(published.content, "## 13. Privacy Considerations");
		const mentionsRedaction = /redact|sanitiz|pii|mask/i.test(section13);
		if (!mentionsRedaction) {
			items.push({
				status: "warning",
				message:
					"PII redaction is recommended by the active overlay but §13 does not mention it explicitly.",
			});
		}
	}

	return { title, items };
}

/**
 * Extract the body of a markdown section by heading. Returns "" when
 * the heading is absent. The returned text includes only the section
 * body up to the next `## ` heading.
 */
function extractSection(content: string, heading: string): string {
	const idx = content.indexOf(heading);
	if (idx < 0) return "";
	const afterHeading = content.slice(idx + heading.length);
	const nextHeadingMatch = afterHeading.match(/\n##\s/);
	if (!nextHeadingMatch || nextHeadingMatch.index === undefined) {
		return afterHeading;
	}
	return afterHeading.slice(0, nextHeadingMatch.index);
}
