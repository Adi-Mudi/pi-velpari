/**
 * Standards overlay loader + merge (Phase 3, plan §Phase 3).
 *
 * Each overlay lives under skills/standards/overlays/<id>/profile.json.
 * This module:
 *   - loads one overlay's profile
 *   - merges its required sections into a stage prompt template
 *   - returns the list of extra scout roles + doctor checks
 *
 * Pure IO + JSON. No LLM calls. No UI calls. No writes.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalogue } from "./standards-catalogue.js";

export interface OverlayProfile {
	id: string;
	version: string;
	label: string;
	standards: string[];
	scopes: string[];
	inferenceSignals: string[];
	requiredSections: {
		prd: string[];
		design: string[];
		testplan: string[];
	};
	extraScouts: OverlayScout[];
	doctorChecks: string[];
	/**
	 * v1.4.0 — optional. When present, the doctor `checkLoggingPlanSection`
	 * asserts that the published logging plan satisfies these requirements
	 * (retention, tamper-evidence, PII redaction, extra event categories).
	 * Missing the field on an overlay means "no logging requirement"; the
	 * 4 bundled overlays (medical-device-b, industrial-ot,
	 * financial-payments, cloud-saas) all carry this block.
	 */
	loggingRequirements?: OverlayLoggingRequirements;
}

/**
 * Shape of an overlay's logging requirements block (v1.4.0). Lives
 * inside `OverlayProfile.loggingRequirements`. Defaults are safe: a
 * missing field means "not required".
 */
interface OverlayLoggingRequirements {
	/** Regulatory regimes whose clauses the plan must satisfy (e.g. PCI-DSS v4.0). */
	regimes: ReadonlyArray<{ framework: string; version: string }>;
	/** Minimum retention months the plan must declare in §7 (≥ 0). */
	retentionMonths: number;
	/** Whether §8 must declare tamper-evident storage. */
	tamperEvident: boolean;
	/** Whether §13 must mention PII redaction. */
	piiRedaction: boolean;
	/** Whether §11 must declare daily review. */
	dailyReview: boolean;
	/** Extra event categories the plan must include in §3. */
	extraEventCategories: ReadonlyArray<string>;
}

export interface OverlayScout {
	role: string;
	description: string;
	reportPathTemplate: string;
}

/** Default overlay folder (relative to cwd). */
export function overlayDir(cwd: string, id: string): string {
	return join(cwd, "skills", "standards", "overlays", id);
}

function overlayProfilePath(cwd: string, id: string): string {
	return join(overlayDir(cwd, id), "profile.json");
}

/**
 * Load one overlay. Returns null when the overlay does not exist or the
 * catalogue does not list it.
 *
 * Two-step guard:
 *   1. id must be in the catalogue (prevents typos from silently
 *      instantiating a "ghost" overlay)
 *   2. profile.json must be present and parse
 */
export function loadOverlay(cwd: string, id: string): OverlayProfile | null {
	const catalogue = loadCatalogue(cwd);
	if (!catalogue) return null;
	const listed = catalogue.overlays.find((o) => o.id === id);
	if (!listed) return null;

	const path = overlayProfilePath(cwd, id);
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as Partial<OverlayProfile>;
		if (!isValidOverlayProfile(parsed)) return null;
		return parsed as OverlayProfile;
	} catch {
		return null;
	}
}

/**
 * Merge an overlay's required sections into a base markdown template.
 *
 * `stage` is one of "prd", "design", "testplan". The base template is
 * the standard markdown body; the overlay sections are appended before
 * the closing Change Log marker.
 */
export function mergeOverlay(
	stage: "prd" | "design" | "testplan",
	baseTemplate: string,
	overlay: OverlayProfile,
): string {
	const sections = overlay.requiredSections[stage] ?? [];
	if (sections.length === 0) return baseTemplate;

	const block = [
		"## Standards Overlay Sections",
		"",
		`> Applied overlay: ${overlay.id}@${overlay.version}`,
		`> Standards: ${overlay.standards.join(", ")}`,
		"",
		...sections,
		"",
	].join("\n");

	// Try to insert before any "## Change Log" heading; otherwise append.
	const changeLogMarker = /^## Change Log\b/m;
	if (changeLogMarker.test(baseTemplate)) {
		return baseTemplate.replace(changeLogMarker, `${block}\n## Change Log`);
	}
	return `${baseTemplate}\n\n${block}`;
}

function isValidOverlayProfile(o: unknown): o is OverlayProfile {
	if (!o || typeof o !== "object") return false;
	const obj = o as Record<string, unknown>;
	if (typeof obj.id !== "string") return false;
	if (typeof obj.version !== "string") return false;
	if (typeof obj.label !== "string") return false;
	if (!Array.isArray(obj.standards)) return false;
	if (!obj.standards.every((s) => typeof s === "string")) return false;
	if (!Array.isArray(obj.scopes)) return false;
	if (!obj.scopes.every((s) => typeof s === "string")) return false;
	if (!Array.isArray(obj.inferenceSignals)) return false;
	if (!obj.inferenceSignals.every((s) => typeof s === "string")) return false;
	if (!obj.requiredSections || typeof obj.requiredSections !== "object") return false;
	const rs = obj.requiredSections as Record<string, unknown>;
	if (!Array.isArray(rs.prd) || !rs.prd.every((s) => typeof s === "string")) return false;
	if (!Array.isArray(rs.design) || !rs.design.every((s) => typeof s === "string")) return false;
	if (!Array.isArray(rs.testplan) || !rs.testplan.every((s) => typeof s === "string")) return false;
	if (!Array.isArray(obj.extraScouts)) return false;
	if (!obj.extraScouts.every((s) => isValidScout(s))) return false;
	if (!Array.isArray(obj.doctorChecks)) return false;
	if (!obj.doctorChecks.every((s) => typeof s === "string")) return false;
	// v1.4.0 — loggingRequirements is optional, but when present must be
	// a well-formed object. Missing field is fine.
	if (obj.loggingRequirements !== undefined) {
		if (!obj.loggingRequirements || typeof obj.loggingRequirements !== "object") return false;
		const lr = obj.loggingRequirements as Record<string, unknown>;
		if (!Array.isArray(lr.regimes)) return false;
		if (lr.regimes.some((r) => !r || typeof r !== "object")) return false;
		if (typeof lr.retentionMonths !== "number") return false;
		if (typeof lr.tamperEvident !== "boolean") return false;
		if (typeof lr.piiRedaction !== "boolean") return false;
		if (typeof lr.dailyReview !== "boolean") return false;
		if (!Array.isArray(lr.extraEventCategories)) return false;
		if (!lr.extraEventCategories.every((c) => typeof c === "string")) return false;
	}
	return true;
}

function isValidScout(s: unknown): s is OverlayScout {
	if (!s || typeof s !== "object") return false;
	const obj = s as Record<string, unknown>;
	return (
		typeof obj.role === "string" && typeof obj.description === "string" && typeof obj.reportPathTemplate === "string"
	);
}
