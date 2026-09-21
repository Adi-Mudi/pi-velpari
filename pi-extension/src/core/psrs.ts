/**
 * PSRS (Product and Software Requirements Specification) validator.
 *
 * Pure, deterministic. Operates on raw markdown text. Used by Doctor
 * and by the PRD skill to confirm a generated document has the
 * required structure before approval.
 *
 * The shape matches `Doc/velpari-requirements-orchestration-design.md`
 * §5 (PSRS) and §14 (document structure). This is the canonical
 * structural definition used by every check that follows.
 */

const PLACEHOLDER_HINTS = [
	"todo",
	"tbd",
	"tba",
	"fill in",
	"placeholder",
	"<placeholder>",
	"xxx",
	"lorem ipsum",
	"??",
];

interface PsrsMetadata {
	documentType: string;
	version: string;
	status: string;
	profile: string;
	profileVersion: string;
	mission: string;
	projectName: string;
}

interface PsrsRequirementEntry {
	id: string;
	title: string;
}

interface PsrsRequirementSection {
	heading: string;
	entries: PsrsRequirementEntry[];
	/** Unique ids detected in this section. */
	uniqueIds: string[];
	/** Ids that appear more than once. */
	duplicateIds: string[];
}

interface PsrsValidationIssue {
	severity: "error" | "warning";
	code: string;
	message: string;
	section?: string;
}

interface PsrsValidationResult {
	ok: boolean;
	metadata: PsrsMetadata | null;
	sections: Record<string, PsrsRequirementSection>;
	presentSections: string[];
	missingRequiredSections: string[];
	acceptanceIds: string[];
	verificationIds: string[];
	openQuestions: PsrsRequirementEntry[];
	helperCandidates: Array<{
		id: string;
		title: string;
		sourceRequirements: string[];
	}>;
	issues: PsrsValidationIssue[];
	errorCount: number;
	warningCount: number;
	summary: string;
}

const REQUIRED_SECTIONS = [
	"Objective",
	"Problem",
	"System Actors",
	"User Stories",
	"Scope",
	"MVP",
	"Success Metrics",
	"Phases",
	"Functional Requirements",
	"Non-Functional Requirements",
	"Data and Interfaces",
	"Errors and Edge Cases",
	"Constraints",
	"Dependencies and Risks",
	"Out of Scope",
	"Open Questions",
	"Acceptance Criteria",
	"Helper Function Candidates",
	"Glossary",
	"Change Log",
] as const;

/** Requirement status lifecycle (Jama/Wiegers; ISO/IEC/IEEE 29148 §6.5). */
const REQUIREMENT_STATUSES = [
	"proposed",
	"approved",
	"implemented",
	"verified",
	"deferred",
	"deprecated",
] as const;

/**
 * Parse a markdown section by its `## Heading` marker and return
 * the body text. Returns empty string when not found.
 */
export function readSectionBody(markdown: string, heading: string): string {
	const re = new RegExp(`^##\\s+(?:\\d+\\.\\s+)?${escapeRegExp(heading)}\\s*$`, "m");
	const match = re.exec(markdown);
	if (!match) return "";
	const start = match.index + match[0].length;
	const rest = markdown.slice(start);
	// stop at next "## " heading (or end of doc)
	const nextHeading = rest.match(/^##\s+/m);
	const end = nextHeading?.index ?? rest.length;
	return rest.slice(0, end).trim();
}

/**
 * Read all `## Heading` markers in order. The first H1 is skipped.
 */
function listHeadings(markdown: string): string[] {
	const out: string[] = [];
	const lines = markdown.split("\n");
	let inFrontmatter = false;
	let frontmatterDone = false;
	for (const line of lines) {
		if (!frontmatterDone) {
			if (!inFrontmatter && line.trim() === "---") {
				inFrontmatter = true;
				continue;
			}
			if (inFrontmatter) {
				if (line.trim() === "---") {
					inFrontmatter = false;
					frontmatterDone = true;
				}
				continue;
			}
			frontmatterDone = true;
		}
		const m = /^##\s+(.+?)\s*$/.exec(line);
		if (m && m[1]) out.push(m[1].replace(/^\d+\.\s+/, ""));
	}
	return out;
}

/**
 * Parse the frontmatter block at the top of the markdown. Returns
 * empty object when no frontmatter is present.
 */
export function readFrontmatter(markdown: string): Record<string, string> {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) return {};
	const out: Record<string, string> = {};
	for (const line of match[1]!.split("\n")) {
		const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
		if (m) {
			out[m[1]!] = m[2]!.trim();
		}
	}
	return out;
}

/**
 * Find all rows in a markdown table section whose first column matches
 * one of the supplied ID prefixes. Returns the ID and the title (second
 * column) for each row.
 */
export function extractIdsFromTable(
	body: string,
	idPrefixes: string[],
): Array<{ id: string; title: string; fullRow: string }> {
	const out: Array<{ id: string; title: string; fullRow: string }> = [];
	const lines = body.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("|")) continue;
		const cells = trimmed.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
		if (cells.length < 2) continue;
		const first = cells[0]!;
		const matched = idPrefixes.find((p) => first.startsWith(p));
		if (matched) {
			out.push({ id: first, title: cells[1] ?? "", fullRow: trimmed });
		}
	}
	return out;
}

/**
 * Find rows of a 2-column markdown table whose first column matches
 * one of the supplied ID prefixes.
 */
export function extractIdRows(
	body: string,
	idPrefixes: string[],
): Array<{ id: string; rest: string[]; fullRow: string }> {
	const out: Array<{ id: string; rest: string[]; fullRow: string }> = [];
	const lines = body.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("|")) continue;
		const cells = trimmed.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
		if (cells.length < 1) continue;
		const first = cells[0]!;
		const matched = idPrefixes.find((p) => first.startsWith(p));
		if (matched) {
			out.push({ id: first, rest: cells.slice(1), fullRow: trimmed });
		}
	}
	return out;
}

/**
 * Detect duplicate ids within a section's rows. Returns the duplicate
 * id list.
 */
function findDuplicateIds(ids: string[]): string[] {
	const seen = new Set<string>();
	const dups = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) dups.add(id);
		seen.add(id);
	}
	return Array.from(dups).sort();
}

/**
 * Return ids referenced inside a string. Accepts comma-separated
 * lists, square-bracket lists, and bare tokens.
 */
export function referencedIds(text: string): string[] {
	const out = new Set<string>();
	const tokens = text.match(/\b(?:FR|NFR|HF|ERR|DATA|IF|Q|US|SM)-\d+\b/g) ?? [];
	for (const t of tokens) out.add(t);
	return Array.from(out);
}

/**
 * RFC 2119 keywords recognised in requirement text (case-insensitive —
 * templates historically used lowercase "must" in the Priority column).
 */
const RFC2119_KEYWORDS = /\b(?:must|shall|should|may)\b/i;

/**
 * RTM traceability upgrade (Phase 4): return the FR ids whose Requirement
 * cell carries no RFC 2119 keyword. Doctor reports these as warnings.
 * Reads the "Functional Requirements" section only.
 */
export function findFrRowsMissingKeywords(markdown: string): string[] {
	const body = readSectionBody(markdown, "Functional Requirements");
	const out: string[] = [];
	for (const row of extractIdRows(body, ["FR-"])) {
		const requirementCell = row.rest[0] ?? "";
		if (!RFC2119_KEYWORDS.test(requirementCell)) out.push(row.id);
	}
	return out;
}

/**
 * Quick heuristic for placeholder text inside a body string.
 * Returns true if any placeholder hint is present.
 */
function bodyHasPlaceholder(body: string): boolean {
	const lower = body.toLowerCase();
	return PLACEHOLDER_HINTS.some((hint) => lower.includes(hint));
}

/** Sections whose ID tables must carry a Status lifecycle column. */
const STATUS_CHECK_SECTIONS: ReadonlyArray<readonly [string, string, string]> = [
	["User Stories", "US-", "us"],
	["Success Metrics", "SM-", "sm"],
	["Functional Requirements", "FR-", "fr"],
	["Non-Functional Requirements", "NFR-", "nfr"],
];

/**
 * Enforce the Status lifecycle column on an ID table. The header must
 * contain a `Status` column and every ID row must carry one of
 * REQUIREMENT_STATUSES in it. Errors only — the lifecycle is mandatory.
 */
function checkStatusColumn(
	markdown: string,
	heading: string,
	idPrefix: string,
	codePrefix: string,
	issues: PsrsValidationIssue[],
): void {
	const body = readSectionBody(markdown, heading);
	if (!body) return; // missing-section error is already recorded elsewhere
	const lines = body
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("|"));
	if (lines.length === 0) return;
	const headerCells = lines[0]!
		.split("|")
		.map((c) => c.trim().toLowerCase())
		.filter((c) => c.length > 0);
	const statusIdx = headerCells.indexOf("status");
	if (statusIdx === -1) {
		issues.push({
			severity: "error",
			code: `psrs-${codePrefix}-status-column-missing`,
			message: `${heading} table must have a Status column (lifecycle: ${REQUIREMENT_STATUSES.join(" / ")}).`,
			section: heading,
		});
		return;
	}
	for (const line of lines.slice(2)) {
		const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
		if (cells.length < 2) continue;
		const first = cells[0]!;
		if (!first.startsWith(idPrefix)) continue;
		const status = (cells[statusIdx] ?? "").toLowerCase();
		if (!(REQUIREMENT_STATUSES as readonly string[]).includes(status)) {
			issues.push({
				severity: "error",
				code: `psrs-${codePrefix}-status-invalid`,
				message: `${first} has missing/invalid Status "${cells[statusIdx] ?? ""}" — must be one of: ${REQUIREMENT_STATUSES.join(", ")}.`,
				section: heading,
			});
		}
	}
}

/**
 * Enforce the Phase column on a requirement ID table. The header must
 * contain a `Phase` column and every ID row must carry a positive
 * integer in it. Phase 1 = MVP. Errors only — the phase is mandatory
 * (community standard: priority/phase is a required requirement
 * attribute, ISO/IEC/IEEE 29148).
 */
function checkPhaseColumn(
	markdown: string,
	heading: string,
	idPrefix: string,
	codePrefix: string,
	issues: PsrsValidationIssue[],
): void {
	const body = readSectionBody(markdown, heading);
	if (!body) return; // missing-section error is already recorded elsewhere
	const lines = body
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("|"));
	if (lines.length === 0) return;
	const headerCells = lines[0]!
		.split("|")
		.map((c) => c.trim().toLowerCase())
		.filter((c) => c.length > 0);
	const phaseIdx = headerCells.indexOf("phase");
	if (phaseIdx === -1) {
		issues.push({
			severity: "error",
			code: `psrs-${codePrefix}-phase-column-missing`,
			message: `${heading} table must have a Phase column (positive integer; 1 = MVP).`,
			section: heading,
		});
		return;
	}
	for (const line of lines.slice(2)) {
		const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
		if (cells.length < 2) continue;
		const first = cells[0]!;
		if (!first.startsWith(idPrefix)) continue;
		const phase = cells[phaseIdx] ?? "";
		if (!/^[1-9]\d*$/.test(phase)) {
			issues.push({
				severity: "error",
				code: `psrs-${codePrefix}-phase-invalid`,
				message: `${first} has missing/invalid Phase "${phase}" — must be a positive integer (1 = MVP).`,
				section: heading,
			});
		}
	}
}

/** Requirement tables that carry phases: heading + id prefix. */
const PHASE_CHECK_SECTIONS: ReadonlyArray<readonly [string, string, string]> = [
	["Functional Requirements", "FR-", "fr"],
	["Non-Functional Requirements", "NFR-", "nfr"],
];

/**
 * Extract the phase of every FR/NFR row. Returns a map id → phase.
 * Rows with a missing/invalid Phase cell are skipped (the validator
 * reports them separately).
 */
export function extractRequirementPhases(markdown: string): Map<string, number> {
	const out = new Map<string, number>();
	for (const [heading, idPrefix] of PHASE_CHECK_SECTIONS) {
		const body = readSectionBody(markdown, heading);
		if (!body) continue;
		const lines = body
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.startsWith("|"));
		if (lines.length === 0) continue;
		const headerCells = lines[0]!
			.split("|")
			.map((c) => c.trim().toLowerCase())
			.filter((c) => c.length > 0);
		const phaseIdx = headerCells.indexOf("phase");
		if (phaseIdx === -1) continue;
		for (const line of lines.slice(2)) {
			const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
			if (cells.length < 2) continue;
			const first = cells[0]!;
			if (!first.startsWith(idPrefix)) continue;
			const phase = Number(cells[phaseIdx]);
			if (Number.isInteger(phase) && phase > 0) out.set(first, phase);
		}
	}
	return out;
}

/**
 * FR/NFR ids listed under `### MVP Requirements` inside the MVP section.
 * Only that subsection is read — "Explicitly Not in MVP" may also name
 * FR ids and must not be counted.
 */
export function extractMvpRequirementIds(markdown: string): string[] {
	const mvpBody = readSectionBody(markdown, "MVP");
	if (!mvpBody) return [];
	const match = /^###\s+MVP Requirements\s*$/m.exec(mvpBody);
	if (!match) return [];
	const rest = mvpBody.slice(match.index + match[0].length);
	const nextSub = rest.match(/^###\s+/m);
	const sub = rest.slice(0, nextSub?.index ?? rest.length);
	return referencedIds(sub).filter((id) => /^(?:FR|NFR)-\d+$/.test(id));
}

/**
 * Validate a PSRS markdown document. Returns a structured result.
 * Pure; never throws on missing sections, just records issues.
 */
export function validatePsrs(markdown: string): PsrsValidationResult {
	const issues: PsrsValidationIssue[] = [];
	const presentSections: string[] = [];
	const sections: Record<string, PsrsRequirementSection> = {};

	// 1. Metadata (frontmatter).
	const frontmatter = readFrontmatter(markdown);
	let metadata: PsrsMetadata | null = null;
	if (
		typeof frontmatter.documentType === "string" &&
		typeof frontmatter.version === "string" &&
		typeof frontmatter.status === "string" &&
		typeof frontmatter.profile === "string" &&
		typeof frontmatter.profileVersion === "string" &&
		typeof frontmatter.mission === "string" &&
		typeof frontmatter.projectName === "string"
	) {
		metadata = {
			documentType: frontmatter.documentType,
			version: frontmatter.version,
			status: frontmatter.status,
			profile: frontmatter.profile,
			profileVersion: frontmatter.profileVersion,
			mission: frontmatter.mission,
			projectName: frontmatter.projectName,
		};
	} else {
		issues.push({
			severity: "error",
			code: "psrs-metadata-missing",
			message:
				"PSRS frontmatter missing one of: documentType, version, status, profile, profileVersion, mission, projectName.",
		});
	}

	const headings = listHeadings(markdown);

	// 2. Required sections.
	for (const required of REQUIRED_SECTIONS) {
		if (headings.includes(required)) {
			presentSections.push(required);
		} else {
			issues.push({
				severity: "error",
				code: "psrs-section-missing",
				message: `Required PSRS section "${required}" is missing.`,
				section: required,
			});
		}
	}

	// 3. FR section: ids + duplicates + acceptance/verification + placeholders.
	const frBody = readSectionBody(markdown, "Functional Requirements");
	const frRows = extractIdsFromTable(frBody, ["FR-"]);
	const frIds = frRows.map((r) => r.id);
	const frDups = findDuplicateIds(frIds);
	sections["Functional Requirements"] = {
		heading: "Functional Requirements",
		entries: frRows.map((r) => ({ id: r.id, title: r.title })),
		uniqueIds: frIds,
		duplicateIds: frDups,
	};
	if (frDups.length > 0) {
		issues.push({
			severity: "error",
			code: "psrs-fr-duplicate",
			message: `Duplicate FR ids: ${frDups.join(", ")}.`,
			section: "Functional Requirements",
		});
	}
	if (frRows.length === 0 && presentSections.includes("Functional Requirements")) {
		issues.push({
			severity: "warning",
			code: "psrs-fr-empty",
			message: "Functional Requirements section is present but contains no FR-NN rows.",
			section: "Functional Requirements",
		});
	}
	if (bodyHasPlaceholder(frBody)) {
		issues.push({
			severity: "warning",
			code: "psrs-fr-placeholder",
			message: "Functional Requirements body contains placeholder text (TBD/TODO/etc).",
			section: "Functional Requirements",
		});
	}

	// 4. NFR section: ids + duplicates + verification + placeholders.
	const nfrBody = readSectionBody(markdown, "Non-Functional Requirements");
	const nfrRows = extractIdsFromTable(nfrBody, ["NFR-"]);
	const nfrIds = nfrRows.map((r) => r.id);
	const nfrDups = findDuplicateIds(nfrIds);
	sections["Non-Functional Requirements"] = {
		heading: "Non-Functional Requirements",
		entries: nfrRows.map((r) => ({ id: r.id, title: r.title })),
		uniqueIds: nfrIds,
		duplicateIds: nfrDups,
	};
	if (nfrDups.length > 0) {
		issues.push({
			severity: "error",
			code: "psrs-nfr-duplicate",
			message: `Duplicate NFR ids: ${nfrDups.join(", ")}.`,
			section: "Non-Functional Requirements",
		});
	}
	if (nfrRows.length === 0 && presentSections.includes("Non-Functional Requirements")) {
		issues.push({
			severity: "warning",
			code: "psrs-nfr-empty",
			message: "Non-Functional Requirements section is present but contains no NFR-NN rows.",
			section: "Non-Functional Requirements",
		});
	}

	// 5. Helper Function Candidates: ids + source requirement traceability.
	const hfBody = readSectionBody(markdown, "Helper Function Candidates");
	const hfRows = extractIdsFromTable(hfBody, ["HF-"]);
	const helperCandidates: Array<{ id: string; title: string; sourceRequirements: string[] }> = [];
	for (const r of hfRows) {
		const fullRefs = referencedIds(r.fullRow);
		// Strip the helper's own id so we don't count it as a self-reference.
		const sourceRefs = fullRefs.filter((x) => x !== r.id);
		helperCandidates.push({ id: r.id, title: r.title, sourceRequirements: sourceRefs });
		if (sourceRefs.length === 0) {
			issues.push({
				severity: "warning",
				code: "psrs-helper-no-source",
				message: `Helper candidate ${r.id} does not reference any source requirement.`,
				section: "Helper Function Candidates",
			});
		}
	}
	const hfDups = findDuplicateIds(hfRows.map((r) => r.id));
	sections["Helper Function Candidates"] = {
		heading: "Helper Function Candidates",
		entries: hfRows.map((r) => ({ id: r.id, title: r.title })),
		uniqueIds: hfRows.map((r) => r.id),
		duplicateIds: hfDups,
	};
	if (hfDups.length > 0) {
		issues.push({
			severity: "error",
			code: "psrs-hf-duplicate",
			message: `Duplicate HF ids: ${hfDups.join(", ")}.`,
			section: "Helper Function Candidates",
		});
	}

	// 6. Open Questions section: extract Q-ids.
	const oqBody = readSectionBody(markdown, "Open Questions");
	const oqRows = extractIdsFromTable(oqBody, ["Q-"]);
	const openQuestions = oqRows.map((r) => ({ id: r.id, title: r.title }));
	sections["Open Questions"] = {
		heading: "Open Questions",
		entries: openQuestions,
		uniqueIds: openQuestions.map((q) => q.id),
		duplicateIds: findDuplicateIds(openQuestions.map((q) => q.id)),
	};

	// 6b. User Stories + Success Metrics: ids + duplicates.
	for (const [heading, prefix] of [["User Stories", "US-"], ["Success Metrics", "SM-"]] as const) {
		const body = readSectionBody(markdown, heading);
		const rows = extractIdsFromTable(body, [prefix]);
		const ids = rows.map((r) => r.id);
		const dups = findDuplicateIds(ids);
		sections[heading] = {
			heading,
			entries: rows.map((r) => ({ id: r.id, title: r.title })),
			uniqueIds: ids,
			duplicateIds: dups,
		};
		if (dups.length > 0) {
			issues.push({
				severity: "error",
				code: `psrs-${prefix === "US-" ? "us" : "sm"}-duplicate`,
				message: `Duplicate ${prefix.replace("-", "")} ids: ${dups.join(", ")}.`,
				section: heading,
			});
		}
	}

	// 6c. Status lifecycle columns on all requirement ID tables.
	for (const [heading, idPrefix, codePrefix] of STATUS_CHECK_SECTIONS) {
		checkStatusColumn(markdown, heading, idPrefix, codePrefix, issues);
	}

	// 6d. Phase columns on the FR/NFR tables (1 = MVP).
	for (const [heading, idPrefix, codePrefix] of PHASE_CHECK_SECTIONS) {
		checkPhaseColumn(markdown, heading, idPrefix, codePrefix, issues);
	}

	// 6e. MVP consistency: ids listed under "### MVP Requirements" must
	// be Phase 1 in the FR/NFR tables.
	const phases = extractRequirementPhases(markdown);
	for (const id of extractMvpRequirementIds(markdown)) {
		const phase = phases.get(id);
		if (phase !== undefined && phase !== 1) {
			issues.push({
				severity: "error",
				code: "psrs-mvp-phase-mismatch",
				message: `${id} is listed in MVP Requirements but has Phase ${phase} — MVP requirements must be Phase 1.`,
				section: "MVP",
			});
		}
	}

	// 7. MVP + Phases presence.
	const mvpBody = readSectionBody(markdown, "MVP");
	if (presentSections.includes("MVP") && mvpBody.length < 30) {
		issues.push({
			severity: "warning",
			code: "psrs-mvp-thin",
			message: "MVP section is present but very short; capture MVP goal/users/requirements/exit criteria.",
			section: "MVP",
		});
	}
	const phasesBody = readSectionBody(markdown, "Phases");
	if (presentSections.includes("Phases") && phasesBody.length < 20) {
		issues.push({
			severity: "warning",
			code: "psrs-phases-thin",
			message: "Phases section is present but very short; list each phase with goal/requirements/acceptance.",
			section: "Phases",
		});
	}

	// 8. Acceptance and Verification aggregation (any section that references FR/NFR).
	const acceptanceIds = new Set<string>();
	const verificationIds = new Set<string>();
	const acBody = readSectionBody(markdown, "Acceptance Criteria");
	for (const ref of referencedIds(acBody)) acceptanceIds.add(ref);
	for (const ref of referencedIds(phasesBody)) {
		acceptanceIds.add(ref);
		verificationIds.add(ref);
	}
	for (const ref of referencedIds(frBody)) verificationIds.add(ref);
	for (const ref of referencedIds(nfrBody)) verificationIds.add(ref);

	// 9. Placeholders anywhere.
	if (bodyHasPlaceholder(phasesBody)) {
		issues.push({
			severity: "warning",
			code: "psrs-phases-placeholder",
			message: "Phases section contains placeholder text.",
			section: "Phases",
		});
	}
	if (bodyHasPlaceholder(oqBody) && oqRows.length === 0) {
		issues.push({
			severity: "warning",
			code: "psrs-oq-placeholder",
			message: "Open Questions section is present but contains placeholder text and no Q-NN rows.",
			section: "Open Questions",
		});
	}

	// 10. Missing required sections list.
	const missingRequiredSections = REQUIRED_SECTIONS.filter((s) => !presentSections.includes(s));

	const errorCount = issues.filter((i) => i.severity === "error").length;
	const warningCount = issues.filter((i) => i.severity === "warning").length;

	const summary = [
		`PSRS validation: ${errorCount} error(s), ${warningCount} warning(s).`,
		`Sections present: ${presentSections.length}/${REQUIRED_SECTIONS.length}.`,
		`FRs: ${frRows.length} | NFRs: ${nfrRows.length} | Helpers: ${hfRows.length} | Open questions: ${oqRows.length}.`,
	].join(" ");

	return {
		ok: errorCount === 0,
		metadata,
		sections,
		presentSections,
		missingRequiredSections,
		acceptanceIds: Array.from(acceptanceIds).sort(),
		verificationIds: Array.from(verificationIds).sort(),
		openQuestions,
		helperCandidates,
		issues,
		errorCount,
		warningCount,
		summary,
	};
}

/** Result of comparing a published baseline PSRS against a revision. */
interface PsrsCompareResult {
	ok: boolean;
	removedIds: string[];
	versionFrom: string | null;
	versionTo: string | null;
	issues: PsrsValidationIssue[];
}

const COMPARE_ID_PREFIXES = ["FR-", "NFR-", "US-", "SM-", "HF-", "ERR-", "DATA-", "Q-"];

/** All table-row IDs anywhere in the document. */
function collectTableIds(markdown: string): Set<string> {
	const ids = new Set<string>();
	for (const line of markdown.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("|")) continue;
		const first = trimmed.split("|").map((c) => c.trim()).filter((c) => c.length > 0)[0];
		if (first && COMPARE_ID_PREFIXES.some((p) => first.startsWith(p))) {
			ids.add(first);
		}
	}
	return ids;
}

/** Compare two semver-ish versions. Returns >0 when a > b, 0 equal, <0 when a < b. */
function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
	const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/**
 * Compare a published baseline PSRS against a proposed revision.
 * Enforces the living-document rules (ISO/IEC/IEEE 29148 §6.5):
 *  1. The revision itself must validate clean.
 *  2. Append-only IDs: any baseline ID missing from the revision is an
 *     error — deprecate (Status column), never delete.
 *  3. The version must strictly increase.
 *  4. The Change Log must gain at least one new line.
 * Pure; never throws.
 */
export function comparePsrs(baseline: string, updated: string): PsrsCompareResult {
	const issues: PsrsValidationIssue[] = [];

	const updatedValidation = validatePsrs(updated);
	if (!updatedValidation.ok) {
		issues.push({
			severity: "error",
			code: "psrs-compare-invalid",
			message: `Revision does not validate clean (${updatedValidation.errorCount} error(s)); fix structure first.`,
		});
	}

	const baselineIds = collectTableIds(baseline);
	const updatedIds = collectTableIds(updated);
	const removedIds = Array.from(baselineIds).filter((id) => !updatedIds.has(id)).sort();
	for (const id of removedIds) {
		issues.push({
			severity: "error",
			code: "psrs-compare-id-removed",
			message: `Baseline id ${id} is missing from the revision. Deprecate it (Status: deprecated + reason), never delete.`,
		});
	}

	const versionFrom = readFrontmatter(baseline).version ?? null;
	const versionTo = readFrontmatter(updated).version ?? null;
	if (versionFrom && versionTo && compareVersions(versionTo, versionFrom) <= 0) {
		issues.push({
			severity: "error",
			code: "psrs-compare-version-not-bumped",
			message: `Revision version must be greater than the baseline (${versionFrom} → ${versionTo}). Additions bump minor; deprecations or changed acceptance criteria bump major.`,
		});
	}

	const baselineLog = new Set(
		readSectionBody(baseline, "Change Log").split("\n").map((l) => l.trim()).filter((l) => l.length > 0),
	);
	const updatedLogLines = readSectionBody(updated, "Change Log").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
	const hasNewEntry = updatedLogLines.some((l) => !baselineLog.has(l));
	if (!hasNewEntry) {
		issues.push({
			severity: "error",
			code: "psrs-compare-changelog-missing",
			message: "Revision adds no new Change Log entry. Every published revision must record what changed and why.",
		});
	}

	return {
		ok: issues.filter((i) => i.severity === "error").length === 0,
		removedIds,
		versionFrom,
		versionTo,
		issues,
	};
}

/**
 * Render a readable summary of the validation result. Used by Doctor
 * and tests. Pure; no side effects.
 */
export function renderPsrsSummary(result: PsrsValidationResult): string {
	const lines: string[] = [];
	lines.push(result.summary);
	if (result.metadata) {
		lines.push(
			`Document type: ${result.metadata.documentType} | Version: ${result.metadata.version} | Status: ${result.metadata.status}`,
		);
		lines.push(
			`Profile: ${result.metadata.profile}@${result.metadata.profileVersion} | Mission: ${result.metadata.mission} | Project: ${result.metadata.projectName}`,
		);
	} else {
		lines.push("Metadata: MISSING");
	}
	if (result.missingRequiredSections.length > 0) {
		lines.push(`Missing required sections: ${result.missingRequiredSections.join(", ")}`);
	}
	for (const issue of result.issues) {
		lines.push(`[${issue.severity}] ${issue.code}: ${issue.message}`);
	}
	return lines.join("\n");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}