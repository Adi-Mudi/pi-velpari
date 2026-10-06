// ============================================================================
// core/semver.ts — document semver for artifacts (N27, Phase D) — Layer 0
// ============================================================================
// Semantic Versioning adapted for documents (discussion N27, instruction §3):
//   MAJOR — scope/structure change: ids removed/replaced or sections
//           reorganized — downstream must re-review.
//   MINOR — backward-compatible additions: new ids/sections, existing ones
//           untouched.
//   PATCH — wording fixes/clarifications only: no id or section changes.
//
// The declared bump lives in the WORKING copy's YAML frontmatter as
// `bump: major|minor|patch` (user decision 2026-09-28; read via the existing
// core/frontmatter.ts parser). validateBump compares the DECLARED intent
// against the ACTUAL change class:
//   declared < actual → blocking bump-violation (the publish is refused);
//   declared > actual → warning bump-over (allowed, over-bump);
//   missing/invalid   → blocking (the gate message names the exact fix).
//
// Layer 0 — imports only ./frontmatter.js, ./id-coverage.js (both L0).
// Surfacing happens in ops/approve.ts's gate phase; the doctor-side check
// (Phase C) consumes these exports (integration request).
// ============================================================================

import { extractIds } from "./id-coverage.js";
import { parseFrontmatterBlock } from "./frontmatter.js";

/** The three N27 bump levels, most severe first in rank order. */
export type BumpLevel = "major" | "minor" | "patch";

/**
 * Document-id prefixes handed to core/id-coverage.ts `extractIds` when
 * classifying a change. Kept as a superset of every artifact's id family
 * (PRD FR/NFR, AF, test-cases TC, dev-order DO, ADRs, wireframe screens);
 * extraction is symmetric over both documents, so an over-broad prefix can
 * only surface when its token actually disappears/appears.
 */
export const SEMVER_ID_PREFIXES: readonly string[] = ["NFR", "FR", "AF", "TC", "DO", "ADR", "WF", "HELPER"];

/** Result of comparing one published document against its working revision. */
export interface ChangeEvidence {
	/** The ACTUAL change class derived from the content diff. */
	actual: BumpLevel;
	/** Ids present in the published copy but gone from the working copy. */
	removedIds: string[];
	/** Ids present in the working copy but not in the published copy. */
	addedIds: string[];
	/** Headings (raw `## …` lines) removed/replaced by the revision. */
	removedHeadings: string[];
	/** Headings added by the revision. */
	addedHeadings: string[];
}

/** Outcome of reading the declared `bump:` frontmatter key. */
export type DeclaredBump =
	| { ok: true; bump: BumpLevel }
	| { ok: false; problem: "missing" }
	| { ok: false; problem: "invalid"; value: string };

/** Verdict of the declared-vs-actual bump gate (N27). */
export type BumpVerdict =
	| { ok: true; declared: BumpLevel; actual: BumpLevel; overBump: boolean; evidence: ChangeEvidence }
	| {
			ok: false;
			problem: string;
			declared: BumpLevel | null;
			actual: BumpLevel | null;
			evidence: ChangeEvidence | null;
	  };

const RANK: Record<BumpLevel, number> = { patch: 0, minor: 1, major: 2 };

/**
 * Strip frontmatter + fenced code blocks before comparing: neither carries
 * structure, and the declared bump itself lives in the frontmatter (a pure
 * `version:`/`bump:` rewrite must classify as PATCH, not a change).
 * @param {string} content - Raw markdown document.
 * @returns {string} The comparable body.
 */
function comparableBody(content: string): string {
	const body = parseFrontmatterBlock(content)?.body ?? content;
	// ``` fences (mermaid/ASCII wireframes/...) — a `## ` line inside a fence
	// is content, not a section heading.
	return body.replace(/```[\s\S]*?```/g, "");
}

/**
 * Unique trimmed heading lines (`#{2,6} …`) of a document body. Set-based:
 * adding one line under an existing `## Change Log` heading never changes the
 * set, so an ordinary revision's Change Log entry is not "structure".
 * @param {string} body - Frontmatter/fence-stripped markdown.
 * @returns {string[]} Sorted unique heading lines (raw, hashes included).
 */
function headingSet(body: string): string[] {
	const out = new Set<string>();
	for (const line of body.split("\n")) {
		const m = /^#{2,6}\s+.+/.exec(line.trim());
		if (m) out.add(m[0]);
	}
	return [...out].sort();
}

/**
 * Pure content comparison: published vs working markdown → change class.
 * Precedence (instruction §3): removed/replaced ids or sections → MAJOR;
 * else added ids/sections → MINOR; else (wording only) → PATCH.
 * @param {string} published - The previously published document.
 * @param {string} working - The working-copy revision being approved.
 * @returns {ChangeEvidence} Actual class + the ids/headings that decided it.
 */
export function classifyChange(published: string, working: string): ChangeEvidence {
	const publishedBody = comparableBody(published);
	const workingBody = comparableBody(working);

	const publishedIds = new Set(extractIds(publishedBody, [...SEMVER_ID_PREFIXES]));
	const workingIds = new Set(extractIds(workingBody, [...SEMVER_ID_PREFIXES]));
	const removedIds = [...publishedIds].filter((id) => !workingIds.has(id)).sort();
	const addedIds = [...workingIds].filter((id) => !publishedIds.has(id)).sort();

	const publishedHeadings = new Set(headingSet(publishedBody));
	const workingHeadings = new Set(headingSet(workingBody));
	const removedHeadings = [...publishedHeadings].filter((h) => !workingHeadings.has(h)).sort();
	const addedHeadings = [...workingHeadings].filter((h) => !publishedHeadings.has(h)).sort();

	const actual: BumpLevel =
		removedIds.length > 0 || removedHeadings.length > 0
			? "major"
			: addedIds.length > 0 || addedHeadings.length > 0
				? "minor"
				: "patch";
	return { actual, removedIds, addedIds, removedHeadings, addedHeadings };
}

/**
 * Read the declared `bump:` key from the working copy's frontmatter block.
 * Exact lowercase tokens; no frontmatter at all = missing (the gate message
 * tells the LLM exactly what to add).
 * @param {string} working - The working-copy markdown.
 * @returns {DeclaredBump} Parsed level, or the missing/invalid reason.
 */
export function parseDeclaredBump(working: string): DeclaredBump {
	const raw = parseFrontmatterBlock(working)?.fields.bump;
	if (raw === undefined || raw === "") return { ok: false, problem: "missing" };
	if (raw === "major" || raw === "minor" || raw === "patch") return { ok: true, bump: raw };
	return { ok: false, problem: "invalid", value: raw };
}

/**
 * One-line evidence summary naming what drove the ACTUAL class (quoted in
 * the bump-violation / bump-over messages so the fix is obvious).
 * @param {ChangeEvidence} evidence - The classification result.
 * @returns {string} Human-readable reason, e.g. "removed ids: FR-3".
 */
function evidenceReason(evidence: ChangeEvidence): string {
	const parts: string[] = [];
	if (evidence.removedIds.length > 0) parts.push(`removed ids: ${evidence.removedIds.join(", ")}`);
	if (evidence.removedHeadings.length > 0) parts.push(`removed sections: ${evidence.removedHeadings.join(", ")}`);
	if (evidence.addedIds.length > 0) parts.push(`added ids: ${evidence.addedIds.join(", ")}`);
	if (evidence.addedHeadings.length > 0) parts.push(`added sections: ${evidence.addedHeadings.join(", ")}`);
	if (parts.length === 0) parts.push("wording only");
	return parts.join("; ");
}

/**
 * Declared-vs-actual bump validation (N27 step 3). A violation is a
 * DECLARED bump below the actual class (under-declared change); over-bumps
 * are allowed and surface as warnings.
 * @param {string} published - The previously published document.
 * @param {string} working - The working-copy revision (frontmatter + body).
 * @returns {BumpVerdict} ok + declared/actual, or the blocking problem line.
 */
export function validateBump(published: string, working: string): BumpVerdict {
	const declared = parseDeclaredBump(working);
	const evidence = classifyChange(published, working);
	if (!declared.ok) {
		const problem =
			declared.problem === "missing"
				? "bump-missing: the working copy declares no `bump:` frontmatter key — add `bump: major|minor|patch` (declare the true change class: MAJOR = removed/replaced ids or reorganized sections, MINOR = backward-compatible additions, PATCH = wording only)."
				: `bump-invalid: \`bump: ${declared.value}\` must be one of major | minor | patch (lowercase).`;
		return { ok: false, problem, declared: null, actual: evidence.actual, evidence };
	}
	if (RANK[declared.bump] < RANK[evidence.actual]) {
		const problem =
			`bump-violation: declared \`bump: ${declared.bump}\` but the change requires ${evidence.actual.toUpperCase()} ` +
			`(${evidenceReason(evidence)}) — raise the declared bump (and the version) before approving.`;
		return { ok: false, problem, declared: declared.bump, actual: evidence.actual, evidence };
	}
	return {
		ok: true,
		declared: declared.bump,
		actual: evidence.actual,
		overBump: RANK[declared.bump] > RANK[evidence.actual],
		evidence,
	};
}

/**
 * Gate-ready message lines for a verdict: errors block the publish,
 * warnings are shown-but-allowed (v1.2.1 gate policy).
 * @param {BumpVerdict} verdict - Result of `validateBump`.
 * @returns {{ errors: string[]; warnings: string[] }} Message buckets.
 */
export function bumpGateMessages(verdict: BumpVerdict): { errors: string[]; warnings: string[] } {
	if (!verdict.ok) return { errors: [verdict.problem], warnings: [] };
	if (!verdict.overBump) return { errors: [], warnings: [] };
	const warning =
		`bump-over: declared \`bump: ${verdict.declared}\` but the change is ${verdict.actual.toUpperCase()}-level ` +
		`(${evidenceReason(verdict.evidence)}) — allowed (over-bump); consider lowering the declared bump.`;
	return { errors: [], warnings: [warning] };
}
