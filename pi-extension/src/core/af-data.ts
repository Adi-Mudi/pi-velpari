/**
 * Atomic-functions data sidecar (B3 — YAML sidecars).
 *
 * The atomic-functions artifact's source of truth is a YAML document
 * (`atomic-functions_<project>.yaml`) living next to the markdown in
 * both the working copy and the published grouped layout. The parent
 * LLM authors the sidecar during the atomic-function stage; the publish
 * branch (`ops/approve.ts` via the sidecar registry) validates it and
 * RE-RENDERS the published markdown from it — the table a human reads
 * is always derived from the data, never hand-edited prose.
 *
 * Schema: one record per atomic function. The 8 base-core fields (plus
 * `filePath`, which every tier's table carries) are mandatory at every
 * tier; tier-added fields per `core/atomic-tier.ts:requiredFieldsFor`
 * are enforced when a tier is supplied (the publish branch derives it
 * from `.pi/velpari/files.json`). Net-new sidecar — `.yaml` only, no
 * legacy format (the dual-read of D4 is RTM-specific).
 *
 * Layer 0 — domain primitive. Imports L0 only.
 */

import { existsSync } from "node:fs";
import {
	BASE_CORE_FIELDS,
	isAtomicTier,
	requiredFieldsFor,
	type AtomicTier,
} from "./atomic-tier.js";
import { compareVersions, readYamlFile } from "./yaml-data.js";

const AF_STATUSES = [
	"proposed",
	"approved",
	"implemented",
	"verified",
	"deferred",
	"deprecated",
] as const;
type AfStatus = (typeof AF_STATUSES)[number];

interface AfRecord {
	/** Atomic-function id, e.g. "AF-1". */
	afId: string;
	name: string;
	/** Source file the function lives in (carried by every tier's table). */
	filePath: string;
	purpose: string;
	signature: string;
	source: string;
	cohesion: string;
	verification: string;
	testable: string;
	/** Optional lifecycle status; deprecated records MUST carry a reason. */
	status?: AfStatus;
	reason?: string;
	/** Tier-added fields (calledByFrIds, designRef, complexity, …). */
	[field: string]: unknown;
}

export interface AfData {
	project: string;
	/** Semver-ish version; bump rules match the living-documents rules. */
	version: string;
	/** Tier the document was authored at (drives the rendered columns). */
	tier?: AtomicTier;
	functions: AfRecord[];
	/** Revision entries, newest last. Rendered as the Change Log section. */
	changeLog?: string[];
}

interface AfValidation {
	ok: boolean;
	issues: string[];
}

const AF_ID_PATTERN = /^AF-\d+$/;

/** Tier fields that must be arrays of strings when present. */
const ARRAY_FIELDS = ["calledByFrIds", "inputs", "outputs", "errors", "dependencies"] as const;
/** Tier fields that must be numbers when present. */
const NUMBER_FIELDS = ["complexity", "argCount", "storyPoints"] as const;

// ---------------------------------------------------------------------------
// Sidecar resolution
// ---------------------------------------------------------------------------

/** Sidecar path next to an atomic-functions markdown path (`.yaml` only). */
function afSidecarPath(mdPath: string): string {
	return mdPath.replace(/\.md$/, ".yaml");
}

/** Resolve the existing sidecar for an AF markdown path, or null. */
export function resolveAfSidecar(mdPath: string): string | null {
	const path = afSidecarPath(mdPath);
	return existsSync(path) ? path : null;
}

/**
 * Loose load: parsed sidecar data when a sidecar exists and parses,
 * null otherwise. Validation/diagnostics paths read the file +
 * `parseYaml` themselves so malformed input produces line-numbered
 * errors for the user.
 */
export function loadAfSidecarData(mdPath: string): unknown | null {
	const resolved = resolveAfSidecar(mdPath);
	return resolved ? readYamlFile(resolved) : null;
}

/**
 * Loose AF-id extraction (D7): ids from the sidecar when one exists and
 * carries a `functions` array with string afIds, null otherwise (caller
 * falls back to markdown scraping). Never throws.
 */
export function extractAfIdsFromSidecar(mdPath: string): string[] | null {
	const data = loadAfSidecarData(mdPath);
	if (typeof data !== "object" || data === null) return null;
	const functions = (data as Record<string, unknown>).functions;
	if (!Array.isArray(functions)) return null;
	const ids = functions
		.map((f) => (typeof f === "object" && f !== null ? (f as Record<string, unknown>).afId : null))
		.filter((id): id is string => typeof id === "string" && AF_ID_PATTERN.test(id));
	return ids.length > 0 ? Array.from(new Set(ids)).sort() : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the sidecar shape. Pure — no I/O. When `opts.tier` is given,
 * the tier-required fields (atomic-tier.ts:requiredFieldsFor) must be
 * present and non-empty on every record — this is the deterministic
 * half of the tier rigor that used to be reviewer-only.
 */
export function validateAfData(value: unknown, opts?: { tier?: AtomicTier }): AfValidation {
	const issues: string[] = [];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, issues: ["AF sidecar must be an object."] };
	}
	const data = value as Record<string, unknown>;
	if (typeof data.project !== "string" || data.project.trim() === "") {
		issues.push("project: missing or not a string.");
	}
	if (typeof data.version !== "string" || data.version.trim() === "") {
		issues.push("version: missing or not a string.");
	}
	if (data.tier !== undefined && !isAtomicTier(data.tier)) {
		issues.push(`tier: must be one of entry | basic | intermediate | advanced, got "${String(data.tier)}".`);
	}
	if (!Array.isArray(data.functions)) {
		issues.push("functions: missing or not an array.");
		return { ok: false, issues };
	}

	const required: readonly string[] = opts?.tier
		? requiredFieldsFor(opts.tier)
		: BASE_CORE_FIELDS;
	const seen = new Set<string>();
	for (let i = 0; i < data.functions.length; i++) {
		const fn = data.functions[i] as Record<string, unknown>;
		const at = `functions[${i}]`;
		if (typeof fn !== "object" || fn === null) {
			issues.push(`${at}: not an object.`);
			continue;
		}
		if (typeof fn.afId !== "string" || !AF_ID_PATTERN.test(fn.afId)) {
			issues.push(`${at}.afId: must match AF-<n>, got "${String(fn.afId)}".`);
		} else if (seen.has(fn.afId)) {
			issues.push(`${at}.afId: duplicate id "${fn.afId}".`);
		} else {
			seen.add(fn.afId);
		}
		for (const field of required) {
			const v = fn[field];
			if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
				issues.push(`${at}.${field}: required at this tier but missing or empty.`);
			}
		}
		if (typeof fn.filePath !== "string" || fn.filePath.trim() === "") {
			issues.push(`${at}.filePath: missing or empty.`);
		}
		for (const field of ARRAY_FIELDS) {
			if (fn[field] !== undefined && (!Array.isArray(fn[field]) || (fn[field] as unknown[]).some((v) => typeof v !== "string"))) {
				issues.push(`${at}.${field}: must be an array of strings when present.`);
			}
		}
		for (const field of NUMBER_FIELDS) {
			if (fn[field] !== undefined && typeof fn[field] !== "number") {
				issues.push(`${at}.${field}: must be a number when present.`);
			}
		}
		if (fn.status !== undefined && !AF_STATUSES.includes(fn.status as AfStatus)) {
			issues.push(`${at}.status: must be one of ${AF_STATUSES.join(" | ")}, got "${String(fn.status)}".`);
		}
		if (fn.status === "deprecated" && (typeof fn.reason !== "string" || fn.reason.trim() === "")) {
			issues.push(`${at}.reason: deprecated functions must record a reason.`);
		}
	}
	if (data.changeLog !== undefined && (!Array.isArray(data.changeLog) || data.changeLog.some((e) => typeof e !== "string"))) {
		issues.push("changeLog: must be an array of strings when present.");
	}
	return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Revision rules (living documents)
// ---------------------------------------------------------------------------

/**
 * Living-documents revision rules applied to AF data:
 *  1. Append-only IDs — every baseline function must still be present
 *     (deprecate with a reason, never delete).
 *  2. New functions with an explicit status must start as `proposed`.
 *  3. Version must strictly increase.
 */
export function diffAfData(baseline: AfData, updated: AfData): AfValidation {
	const issues: string[] = [];
	const updatedIds = new Map(updated.functions.map((f) => [f.afId, f]));
	for (const fn of baseline.functions) {
		if (!updatedIds.has(fn.afId)) {
			issues.push(
				`append-only violation: baseline function "${fn.afId}" is missing from the revision. ` +
					`Keep it with status "deprecated" and a reason instead of deleting.`,
			);
		}
	}
	for (const fn of updated.functions) {
		const isNew = !baseline.functions.some((b) => b.afId === fn.afId);
		if (isNew && fn.status !== undefined && fn.status !== "proposed") {
			issues.push(`new function "${fn.afId}" must start with status "proposed", got "${fn.status}".`);
		}
	}
	if (compareVersions(updated.version, baseline.version) <= 0) {
		issues.push(
			`version must strictly increase (baseline ${baseline.version} → revision ${updated.version}). ` +
				`Additions bump minor; deprecations bump major.`,
		);
	}
	return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** Field name → markdown column header (skills/velpari-atomic-function.md). */
const AF_FIELD_HEADERS: Readonly<Record<string, string>> = {
	afId: "AF ID",
	name: "Name",
	filePath: "File Path",
	signature: "Signature",
	purpose: "Purpose",
	source: "Source",
	cohesion: "Cohesion",
	verification: "Verification",
	testable: "Testable",
	calledByFrIds: "Called by FRs",
	designRef: "Design ref",
	extractedFrom: "Extracted from HF",
	satisfactionFrId: "Satisfies FR",
	feasibilityRef: "Feasibility ref",
	earsPattern: "EARS Pattern",
	inputs: "Inputs",
	outputs: "Outputs",
	errors: "Errors",
	dependencies: "Dependencies",
	dbOrIo: "DB/IO",
	complexity: "Complexity",
	coupling: "Coupling",
	argCount: "ArgCount",
	oneLevelAbstr: "OneLevelAbstr",
	nameIntent: "NameIntent",
	owner: "Owner",
	priority: "Priority",
	securityClass: "SecurityClass",
	risk: "Risk",
	reusability: "Reusability",
	modifiabilityNote: "ModifiabilityNote",
	storyPoints: "StoryPoints",
	acceptanceRef: "AcceptanceRef",
	testRef: "TestRef",
	rationale: "Rationale",
	changeLog: "ChangeLog",
};

/** Column order: base fields in table order, then tier-required fields. */
const TABLE_BASE_ORDER = [
	"afId",
	"name",
	"filePath",
	"signature",
	"purpose",
	"source",
	"cohesion",
	"verification",
	"testable",
] as const;

function columnsFor(data: AfData): string[] {
	const cols: string[] = [...TABLE_BASE_ORDER];
	const tierFields = data.tier
		? requiredFieldsFor(data.tier).filter((f) => !(TABLE_BASE_ORDER as readonly string[]).includes(f))
		: [];
	const extras = new Set<string>(tierFields);
	// Records may carry fields beyond the tier list — keep them, in
	// first-appearance order, so no authored data is dropped.
	for (const fn of data.functions) {
		for (const key of Object.keys(fn)) {
			if (!cols.includes(key) && key !== "status" && key !== "reason") extras.add(key);
		}
	}
	return [...cols, ...extras];
}

function cellValue(v: unknown): string {
	if (v === undefined || v === null || v === "") return "(none)";
	if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : "(none)";
	return String(v);
}

/**
 * Render the published markdown from the data. Includes a minimal
 * frontmatter (artifact/project/version[/atomicTier]) — approve's
 * frontmatter stamping fills the remaining canonical fields at publish
 * time.
 */
export function renderAfMarkdown(data: AfData): string {
	const cols = columnsFor(data);
	const lines: string[] = [
		"---",
		`artifact: atomic-functions`,
		`project: ${data.project}`,
		`version: ${data.version}`,
		...(data.tier ? [`atomicTier: ${data.tier}`] : []),
		"---",
		"",
		`# Atomic Functions — ${data.project}`,
		"",
		"## Summary",
		...(data.tier ? [`- Tier: ${data.tier}`] : []),
		`- Total atomic functions: ${data.functions.length}`,
		"",
		"## Atomic Functions",
		"",
		`| ${cols.map((c) => AF_FIELD_HEADERS[c] ?? c).join(" | ")} |`,
		`|${cols.map(() => "---").join("|")}|`,
		...data.functions.map((fn) => {
			const row = cols.map((c) => cellValue(fn[c]));
			const status =
				fn.status === "deprecated" && typeof fn.reason === "string"
					? ` (deprecated: ${fn.reason})`
					: "";
			return `| ${row.join(" | ")}${status} |`;
		}),
		"",
	];

	if (data.changeLog && data.changeLog.length > 0) {
		lines.push("## Change Log", "", ...data.changeLog.map((e) => `- ${e}`), "");
	}
	return lines.join("\n");
}
