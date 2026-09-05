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

export interface PsrsMetadata {
	documentType: string;
	version: string;
	status: string;
	profile: string;
	profileVersion: string;
	mission: string;
	projectName: string;
}

export interface PsrsRequirementEntry {
	id: string;
	title: string;
}

export interface PsrsRequirementSection {
	heading: string;
	entries: PsrsRequirementEntry[];
	/** Unique ids detected in this section. */
	uniqueIds: string[];
	/** Ids that appear more than once. */
	duplicateIds: string[];
}

export interface PsrsValidationIssue {
	severity: "error" | "warning";
	code: string;
	message: string;
	section?: string;
}

export interface PsrsValidationResult {
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
	"Scope",
	"MVP",
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
	"Change Log",
] as const;

/**
 * Parse a markdown section by its `## Heading` marker and return
 * the body text. Returns empty string when not found.
 */
export function readSectionBody(markdown: string, heading: string): string {
	const re = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m");
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
export function listHeadings(markdown: string): string[] {
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
		if (m && m[1]) out.push(m[1]);
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
export function findDuplicateIds(ids: string[]): string[] {
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
	const tokens = text.match(/\b(?:FR|NFR|HF|ERR|DATA|IF|Q)-\d+\b/g) ?? [];
	for (const t of tokens) out.add(t);
	return Array.from(out);
}

/**
 * Quick heuristic for placeholder text inside a body string.
 * Returns true if any placeholder hint is present.
 */
export function bodyHasPlaceholder(body: string): boolean {
	const lower = body.toLowerCase();
	return PLACEHOLDER_HINTS.some((hint) => lower.includes(hint));
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