/**
 * Architecture Decision Record (ADR) module (Phase 4, plan §Phase 4).
 *
 * Captures, parses, renders, validates, and supersedes ADRs embedded
 * inside published artifacts. ADRs live in the artifact's
 * `## Architecture Decisions` section, formatted as a Markdown table or
 * per-decision sub-section.
 *
 * Pure functions. No IO. No LLM calls. No UI calls.
 */

type ADRStatus = "proposed" | "accepted" | "rejected" | "superseded";

interface ADROption {
	id: string;
	label: string;
	pros: string;
	cons: string;
	cost?: string;
	risk?: string;
	score?: string;
}

export interface ADR {
	id: string;
	title: string;
	status: ADRStatus;
	stage: string;
	date: string;
	runId: string;
	context: string;
	options: ADROption[];
	decision: string;
	rationale: string;
	consequences: string;
	reconsiderTriggers: string[];
	supersedes?: string;
	supersededBy?: string;
}

/** Required fields — every ADR must carry these. */
const REQUIRED_FIELDS: Array<keyof ADR> = [
	"id",
	"title",
	"status",
	"stage",
	"date",
	"runId",
	"context",
	"options",
	"decision",
	"rationale",
	"consequences",
	"reconsiderTriggers",
];

const ADR_HEADING = /^## Architecture Decisions\b/m;

/**
 * Parse the `## Architecture Decisions` section of an artifact. Returns an
 * empty array when the section is absent. ADR bodies are expected to be
 * YAML fenced blocks following the heading.
 *
 * The parser is intentionally simple — it accepts the standard shape that
 * `renderADRSection` produces. For free-form ADRs, the LLM should
 * normalize to that shape before publishing.
 */
export function parseADRSection(markdown: string): ADR[] {
	const match = markdown.match(ADR_HEADING);
	if (!match) return [];
	const idx = match.index ?? 0;
	const sectionStart = idx + match[0].length;
	const rest = markdown.slice(sectionStart);
	// Take everything up to the next ## heading or end of document.
	const nextHeading = rest.search(/^##\s+/m);
	const sectionBody = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

	const out: ADR[] = [];
	for (const block of sectionBody.split(/```yaml/)) {
		const yaml = block.split("```")[0]?.trim();
		if (!yaml) continue;
		try {
			const parsed = JSON.parse(yaml) as ADR;
			if (isValidADR(parsed)) out.push(parsed);
		} catch {
			// skip malformed block
		}
	}
	return out;
}

/**
 * Render a single ADR as a YAML fenced block (machine-readable) plus a
 * Markdown summary line (human-readable in the section index).
 */
export function renderADR(adr: ADR): string {
	return [
		`- ADR-${adr.id.replace(/^ADR-/, "")}: ${adr.title} | Status: ${adr.status} | Stage: ${adr.stage} | Date: ${adr.date}`,
		"```yaml",
		JSON.stringify(adr, null, 2),
		"```",
		"",
	].join("\n");
}

/**
 * Render the full `## Architecture Decisions` section. If `adrs` is empty,
 * returns an empty string (caller decides whether to omit the section).
 */
export function renderADRSection(adrs: ADR[]): string {
	if (adrs.length === 0) return "";
	const lines = ["## Architecture Decisions", ""];
	for (const adr of adrs) {
		lines.push(renderADR(adr));
	}
	return lines.join("\n");
}

/**
 * Validate one ADR. Returns the list of issues (empty = valid).
 */
export function validateADR(adr: Partial<ADR>): string[] {
	const issues: string[] = [];
	for (const f of REQUIRED_FIELDS) {
		if (adr[f] === undefined || adr[f] === null) {
			issues.push(`missing field: ${f}`);
		}
	}
	if (typeof adr.id !== "string" || !/^ADR-\d+$/.test(adr.id ?? "")) {
		issues.push("id must match pattern ADR-<digits>");
	}
	if (
		adr.status !== undefined &&
		!["proposed", "accepted", "rejected", "superseded"].includes(adr.status)
	) {
		issues.push("status must be one of proposed | accepted | rejected | superseded");
	}
	if (Array.isArray(adr.options) && adr.options.length > 0) {
		for (const opt of adr.options) {
			if (!opt.id || !opt.label) {
				issues.push("every option needs id and label");
				break;
			}
		}
	}
	return issues;
}

function isValidADR(adr: unknown): adr is ADR {
	return validateADR(adr as Partial<ADR>).length === 0;
}

/**
 * Supersede an old ADR with a new one. Returns a fresh array with the
 * old ADR's status flipped to "superseded" and the new ADR appended.
 * Throws when the new ADR is invalid or the ids don't match the call.
 */
export function supersedeADR(oldAdrs: ADR[], oldId: string, newAdr: ADR): ADR[] {
	const issues = validateADR(newAdr);
	if (issues.length > 0) {
		throw new Error(`new ADR is invalid: ${issues.join(", ")}`);
	}
	if (newAdr.supersedes !== oldId) {
		throw new Error(`new ADR must declare supersedes: "${oldId}"`);
	}
	const old = oldAdrs.find((a) => a.id === oldId);
	if (!old) {
		throw new Error(`old ADR "${oldId}" not found`);
	}
	const flippedOld: ADR = {
		...old,
		status: "superseded",
		supersededBy: newAdr.id,
	};
	return [...oldAdrs.filter((a) => a.id !== oldId), flippedOld, newAdr];
}

/**
 * Find any ADRs in a list that are referenced by supersedes/supersededBy
 * but whose counterpart is missing. Used by the doctor check.
 */
export function findOrphanADRs(adrs: ADR[]): ADR[] {
	const ids = new Set(adrs.map((a) => a.id));
	const orphans: ADR[] = [];
	for (const adr of adrs) {
		if (adr.supersedes && !ids.has(adr.supersedes)) {
			orphans.push(adr);
		}
		if (adr.supersededBy && !ids.has(adr.supersededBy)) {
			orphans.push(adr);
		}
	}
	return orphans;
}

/**
 * Validate that the **first** ADR exists, is accepted, and lists at
 * least 2 options (no rubber-stamp decision).
 *
 * Phase 4 of the architecture-generator upgrade plan requires every
 * design artifact to carry a recorded **style choice** (the
 * architectural decision). ADR-001 is the only place we routinely
 * commit that choice; this gate makes sure that choice exists, is
 * final, and considered alternatives.
 *
 * Returns a list of issue strings. Empty list = pass.
 *
 * Doesn't load or parse ADRs itself — callers use `parseADRSection`
 * first and pass the parsed array.
 */
export function validateFirstADR(adrs: ADR[]): string[] {
	const issues: string[] = [];
	if (adrs.length === 0) {
		issues.push(
			"At least one ADR is required. ADR-001 must record the architectural style choice (Layered / Modular Monolith / Microservices / …) and commit to the answer.",
		);
		return issues;
	}
	// The very first entry in the list must be ADR-001 (by id). ADR-001
	// may be superseded if the design was revised later; supersession
	// keeps ADR-001 in the archive while a successor ADR-00X takes over.
	const first = adrs[0];
	if (first?.id !== "ADR-001") {
		issues.push(
			`First ADR is "${first?.id ?? "(unknown)"}"; expected "ADR-001". The first ADR must be the architectural style choice.`,
		);
	}
	// Active (non-superseded) ADR must be accepted, ≥2 options, stage design.
	const active = adrs.find((a) => a.status !== "superseded");
	if (!active) {
		issues.push("All ADRs are superseded; a live style decision is required.");
		return issues;
	}
	if (active.status !== "accepted") {
		issues.push(
			`ADR ${active.id} status is "${active.status}"; expected "accepted". A pending style decision cannot be published.`,
		);
	}
	if (!Array.isArray(active.options) || active.options.length < 2) {
		issues.push(
			`ADR ${active.id} must list at least 2 options (no rubber-stamp). The style choice is the most consequential decision — alternatives must be visible.`,
		);
	}
	if (active.stage !== "design") {
		issues.push(
			`ADR ${active.id} stage is "${active.stage}"; expected "design". A non-design ADR cannot serve as the style decision.`,
		);
	}
	return issues;
}
