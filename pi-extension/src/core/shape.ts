/**
 * Architecture-doc shape catalog (v1.2.2, plan §Phase 1).
 *
 * Single source of truth for "what shape is current". Used by the
 * ShapeCompatibility doctor check, the /velpari-status banner, and
 * the architecture-generator prelude.
 *
 * Standards referenced (cited verbatim in the doctor verdict):
 *   - SemVer 2.0.0 (semver.org) — MAJOR-tag semantics for shape changes
 *   - arc42 section catalogue (arc42.org/overview) — required section count
 *   - RFC 8594 (datatracker.ietf.org/doc/html/rfc8594) — sunset frontmatter
 *
 * Pure data + small helpers. Cross-module handles use top-level
 * ESM imports (CommonJS `require` is unavailable in ESM).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDocArtifact, resolveDocArtifactAll } from "./paths.js";
import { parseFrontmatterBlock } from "./frontmatter.js";

export type ShapePath = "fresh" | "upgrade" | "migration";

export interface ShapeVerdict {
	publishedVersion: string;
	currentMajor: number;
	publishedMajor: number;
	sectionCountPublished: number;
	sectionCountCurrent: number;
	path: ShapePath;
	reason: string;
	sunsetDate?: string;
	sunsetReadable?: string;
}

/**
 * Current architecture-doc shape MAJOR. Bump when the template changes
 * its mandatory sections (e.g., v1.0.x → v1.1.0 added 14-section shape).
 * After bumping, the ShapeCompatibility check will flag older
 * published designs as `migration`.
 */
export const CURRENT_SHAPE_MAJOR = 1;

/**
 * Number of `## N.` headings a current-shape design must contain.
 * Source: arc42 catalogue + the v1.1.0 v0 of this project.
 */
export const REQUIRED_SECTION_COUNT = 14;

/** ISO 8601 calendar date (YYYY-MM-DD). */
const RFC3339_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a SemVer `MAJOR.MINOR.PATCH[-prerelease][+build]` string and
 * return the integer MAJOR, or 0 if the string is not parseable.
 * Permissive: "1.0.2" → 1, "v1.2" → 1, "2" → 2, "garbage" → 0.
 */
export function parseSemVerMajor(version: string | undefined | null): number {
	if (!version) return 0;
	const m = version.trim().match(/^\s*v?(\d+)(?:\.\d+)?/);
	if (!m) return 0;
	const n = Number.parseInt(m[1] ?? "0", 10);
	return Number.isFinite(n) ? n : 0;
}

/** Count `## N.` (top-level) headings in markdown content. */
export function countTopLevelSections(markdown: string): number {
	if (!markdown) return 0;
	const matches = markdown.match(/^##\s+\d+\.\s/gm);
	return matches ? matches.length : 0;
}

/** Is a `sunset` value a past date (or null when none / unparseable)? */
export function isSunsetPast(sunset: string | undefined, nowIso: string = new Date().toISOString()): boolean {
	if (!sunset) return false;
	if (!RFC3339_DATE_RE.test(sunset)) return false;
	// Compare ISO date strings lexicographically — works because YYYY-MM-DD
	// format is the same as string sort order.
	return sunset < nowIso.slice(0, 10);
}

/**
 * Compute the shape verdict for a project. Pure; given the published
 * `version:`, `sunset:`, and `## N.` section count, return the path +
 * reason. Lives in core/ so arch-confirm.ts (also L0) can call it
 * without violating the 4-layer rule.
 */
export function computeShapeVerdict(input: {
	publishedVersion: string | undefined;
	sectionCountPublished: number;
	sunsetDate: string | undefined;
}): ShapeVerdict {
	const currentMajor = CURRENT_SHAPE_MAJOR;
	const publishedMajor = parseSemVerMajor(input.publishedVersion);
	const reasonParts: string[] = [];
	let path: ShapePath;

	if (input.publishedVersion === undefined) {
		path = "fresh";
		reasonParts.push("No prior design published — fresh generation.");
	} else if (publishedMajor === currentMajor && input.sectionCountPublished >= REQUIRED_SECTION_COUNT) {
		path = "upgrade";
		reasonParts.push(
			`Published version ${input.publishedVersion} matches current shape (SemVer 2.0.0 MAJOR ${currentMajor}). ` +
				`Section count ${input.sectionCountPublished} ≥ ${REQUIRED_SECTION_COUNT} (arc42 catalogue).`,
		);
	} else {
		path = "migration";
		const reasons: string[] = [];
		if (publishedMajor < currentMajor) {
			reasons.push(`SemVer MAJOR ${publishedMajor} < current ${currentMajor} — breaking shape change (SemVer 2.0.0).`);
		} else if (publishedMajor > currentMajor) {
			reasons.push(
				`SemVer MAJOR ${publishedMajor} > current ${currentMajor} — future shape, cannot downgrade (SemVer 2.0.0).`,
			);
		}
		if (input.sectionCountPublished < REQUIRED_SECTION_COUNT) {
			reasons.push(
				`Section count ${input.sectionCountPublished} < required ${REQUIRED_SECTION_COUNT} (arc42 catalogue).`,
			);
		}
		reasonParts.push(reasons.join(" "));
	}

	const verdict: ShapeVerdict = {
		publishedVersion: input.publishedVersion ?? "(none)",
		currentMajor,
		publishedMajor,
		sectionCountPublished: input.sectionCountPublished,
		sectionCountCurrent: REQUIRED_SECTION_COUNT,
		path,
		reason: reasonParts.join(" "),
	};
	if (input.sunsetDate) {
		verdict.sunsetDate = input.sunsetDate;
		verdict.sunsetReadable = input.sunsetDate;
	}
	return verdict;
}

/**
 * One-line human-friendly status string for /velpari-status and the
 * architecture-generator prelude. Lives in core/ so L1+ layers can
 * call it without violating the 4-layer rule (L0 may not import
 * from doctor/).
 */
export function shapeStatusLine(
	cwd: string,
	projectName: string,
	frontmatterReader: (markdown: string) => { version?: string; sunset?: string } = defaultFrontmatterReader,
	resolveFn: (cwd: string, projectName: string) => { path: string } | null = defaultResolve,
	fsRead: (absPath: string) => string = defaultRead,
	joinFn: (...parts: string[]) => string = defaultJoin,
): string {
	if (!projectName) return "Path: unknown (no project name).";
	const resolved = resolveFn(cwd, projectName);
	if (!resolved) return "Path: fresh (no prior design).";
	const absPath = resolved.path.startsWith(cwd + "/") ? resolved.path : joinFn(cwd, resolved.path);
	let markdown: string;
	try {
		markdown = fsRead(absPath);
	} catch {
		return "Path: unknown (Doc unreadable).";
	}
	const fm = frontmatterReader(markdown);
	const publishedVersion = typeof fm.version === "string" ? fm.version : undefined;
	const sunsetDate = typeof fm.sunset === "string" ? fm.sunset : undefined;
	const sectionCount = countTopLevelSections(markdown);
	const verdict = computeShapeVerdict({ publishedVersion, sectionCountPublished: sectionCount, sunsetDate });
	if (verdict.path === "upgrade") {
		return `Path: upgrade. (v${verdict.currentMajor}.x; ${verdict.sectionCountPublished}/${verdict.sectionCountCurrent} sections)`;
	}
	if (verdict.path === "fresh") return "Path: fresh (no prior design).";
	return `Path: migration recommended. (published ${verdict.publishedVersion}; ${verdict.sectionCountPublished}/${verdict.sectionCountCurrent} sections; re-run /velpari-architecture-generator)`;
}

// Default IO bridges — used when no override is passed.

function defaultResolve(cwd: string, projectName: string): { path: string } | null {
	return resolveDocArtifact("design", projectName, cwd);
}

function defaultFrontmatterReader(markdown: string): { version?: string; sunset?: string } {
	const parsed = parseFrontmatterBlock(markdown);
	return {
		version: typeof parsed?.fields.version === "string" ? parsed.fields.version : undefined,
		sunset: typeof parsed?.fields.sunset === "string" ? parsed.fields.sunset : undefined,
	};
}

function defaultRead(absPath: string): string {
	return readFileSync(absPath, "utf8");
}

function defaultJoin(...parts: string[]): string {
	return join(...parts);
}

/**
 * v1.3.0+ multi-design: aggregate the shape verdict across all
 * `resolveDocArtifactAll` hits. Returns one line per design. The
 * single-design path returns a single-element array. Designed to be
 * consumed by the doctor (one sub-item per design), the status
 * banner (one line per design), and the architecture prelude
 * (grouped lines).
 */
export function computeShapeVerdictsAll(
	resolved: Array<{ projectName: string; content: string }>,
): Array<ShapeVerdict & { projectName: string }> {
	const out: Array<ShapeVerdict & { projectName: string }> = [];
	for (const { projectName, content } of resolved) {
		const parsed = parseFrontmatterBlock(content);
		const version = typeof parsed?.fields.version === "string" ? parsed.fields.version : undefined;
		const sectionCount = countTopLevelSections(content);
		const v = computeShapeVerdict({
			publishedVersion: version,
			sectionCountPublished: sectionCount,
			sunsetDate: undefined,
		});
		out.push({ projectName, ...v });
	}
	return out;
}

/**
 * v1.3.0+ multi-design: produce the per-projectName shape line(s) for
 * the architecture-generator prelude. Single-design cwds (legacy
 * `projectName: string` field) use the original `shapeStatusLine`
 * helper. Multi-design cwds (`projectNames: string[]`) get one
 * line per project.
 */
export function computeShapeStatusLinesForConfig(
	cwd: string,
	projectName: string,
	projectNames: string[] | undefined,
): string {
	if (Array.isArray(projectNames) && projectNames.length > 0) {
		const all = resolveDocArtifactAll(cwd, "design");
		return all
			.filter((d) => projectNames.includes(d.projectName))
			.map((d) => shapeStatusLine(cwd, d.projectName))
			.join("\n");
	}
	return shapeStatusLine(cwd, projectName);
}
