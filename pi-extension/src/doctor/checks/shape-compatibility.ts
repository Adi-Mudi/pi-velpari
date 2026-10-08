/**
 * Doctor check — Architecture-doc shape compatibility (v1.2.2).
 *
 * Verifies that the published `Doc/design_<project>.md` matches the
 * current shape (mandatory sections + SemVer MAJOR tag). Emits one
 * of three paths:
 *   - `fresh`     — no prior design; first generation.
 *   - `upgrade`  — current shape; minor additions only.
 *   - `migration` — old shape; re-run in update mode to fill the
 *     missing sections per the 5 update-mode rules.
 *
 * Standards cited in the verdict reason (defensible end-to-end):
 *   - SemVer 2.0.0 (semver.org)
 *   - arc42 section catalogue (arc42.org/overview)
 *   - RFC 8594 (deprecation header) — sunset frontmatter
 *
 * Wired into:
 *   - /velpari-doctor (full audit) — adds one section to the report
 *   - /velpari-status (banner)
 *   - architecture-generator prelude (one-line summary)
 *
 * Pure IO + parse. No LLM calls. No UI calls.
 */

import { readFileSync } from "node:fs";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { parseFrontmatterBlock } from "../../core/frontmatter.js";
import { resolveDocArtifact } from "../../core/paths.js";
import { computeShapeVerdict, computeShapeVerdictsAll, countTopLevelSections, isSunsetPast } from "../../core/shape.js";
import { resolveDocArtifactAll } from "../../core/paths.js";

// Re-exported for callers that already import these from the doctor
// namespace (L1+ layers can import from L0 = core/).
export { computeShapeVerdict, shapeStatusLine } from "../../core/shape.js";
export type { ShapeVerdict, ShapePath } from "../../core/shape.js";

/**
 * Audit check — returns a DiagnosticSection for `/velpari-doctor`. Pure
 * function: reads the published design (if any), computes the verdict,
 * and emits a section.
 */
export function checkShapeCompatibility(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "Project name missing — cannot audit shape compatibility.",
		});
		return { title: "Shape compatibility", items };
	}

	const resolved = resolveDocArtifact("design", projectName, cwd);
	if (!resolved) {
		// No prior design — fresh path.
		items.push({
			status: "info",
			message: "Path: fresh (no prior design published).",
		});
		return { title: "Shape compatibility", items };
	}

	let markdown = "";
	try {
		markdown = readFileSync(resolved.path, "utf8");
	} catch {
		items.push({
			status: "warning",
			message: `Path: unknown (Doc/design_${projectName}.md exists but is unreadable).`,
		});
		return { title: "Shape compatibility", items };
	}

	const parsed = parseFrontmatterBlock(markdown);
	const publishedVersion = typeof parsed?.fields.version === "string" ? parsed.fields.version : undefined;
	const sunsetDate = typeof parsed?.fields.sunset === "string" ? parsed.fields.sunset : undefined;
	const sectionCount = countTopLevelSections(markdown);

	const verdict = computeShapeVerdict({ publishedVersion, sectionCountPublished: sectionCount, sunsetDate });

	const headline =
		verdict.path === "upgrade"
			? "Path: upgrade."
			: verdict.path === "fresh"
				? "Path: fresh."
				: "Path: migration recommended.";

	if (verdict.path === "upgrade") {
		items.push({
			status: "ok",
			message: `${headline} ${verdict.reason}`,
			details: [
				`Published: ${verdict.publishedVersion}`,
				`Section count: ${verdict.sectionCountPublished} / ${verdict.sectionCountCurrent}`,
			],
		});
	} else if (verdict.path === "fresh") {
		items.push({
			status: "info",
			message: headline,
		});
	} else {
		// migration
		items.push({
			status: "warning",
			message: `${headline} ${verdict.reason}`,
			details: [
				`Published: ${verdict.publishedVersion} (current major: ${verdict.currentMajor})`,
				`Section count: ${verdict.sectionCountPublished} / ${verdict.sectionCountCurrent}`,
				"How to fix: re-run /velpari-architecture-generator in update mode.",
				"  The LLM fills only missing sections per the 5 update-mode rules.",
				"  Doctor will re-audit on the next approve and the path will switch to upgrade.",
			],
		});
	}

	// Sunset check — independent of the path verdict.
	// v1.3.0: past-sunset is `error` only when the design is still
	// `published` (the auto-archive has not run). When the design's
	// `status` is `deprecated` (already auto-archived), the finding
	// is downgraded to `info` so the auto-doctor does not block
	// every approve after the archive.
	if (sunsetDate) {
		const statusField = typeof parsed?.fields.status === "string" ? parsed.fields.status : undefined;
		const alreadyArchived = statusField === "deprecated";
		if (isSunsetPast(sunsetDate)) {
			items.push({
				status: alreadyArchived ? "info" : "error",
				message: alreadyArchived
					? `Sunset date ${sunsetDate} has passed; design was auto-archived (status: deprecated) on a prior publish. No action needed.`
					: `Sunset date ${sunsetDate} has passed — published design is formally deprecated (RFC 8594).`,
				details: alreadyArchived
					? [`deprecatedAt: ${parsed?.fields.deprecatedAt ?? "(unknown)"}`]
					: ["Re-run /velpari-architecture-generator to refresh the design under the current shape."],
			});
		} else {
			items.push({
				status: "info",
				message: `Sunset date set: ${sunsetDate} (RFC 8594). Doctor will emit an error after this date.`,
			});
		}
	}

	return { title: "Shape compatibility", items };
}

/**
 * v1.3.0+ multi-design: aggregate the shape verdict across ALL
 * designs in the cwd (one per `resolveDocArtifactAll` hit). Emits one
 * sub-item per design, prefixed with `project: <name>`. When no
 * design is published, the section shows a single fresh-path item
 * for the cwd.
 */
export function checkShapeCompatibilityAll(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const all = resolveDocArtifactAll(cwd, "design");
	if (all.length === 0) {
		items.push({
			status: "info",
			message: "Path: fresh (no prior designs published).",
		});
		return { title: "Shape compatibility", items };
	}

	const contents = all.map((d) => {
		let body = "";
		try {
			body = readFileSync(d.path, "utf8");
		} catch {
			body = "";
		}
		return { projectName: d.projectName, content: body };
	});
	const verdicts = computeShapeVerdictsAll(contents);

	for (const v of verdicts) {
		const headline =
			v.path === "upgrade" ? "Path: upgrade." : v.path === "fresh" ? "Path: fresh." : "Path: migration recommended.";
		if (v.path === "upgrade") {
			items.push({
				status: "ok",
				message: `project: ${v.projectName} — ${headline} ${v.reason}`,
				details: [
					`Published: ${v.publishedVersion}`,
					`Section count: ${v.sectionCountPublished} / ${v.sectionCountCurrent}`,
				],
			});
		} else if (v.path === "fresh") {
			items.push({
				status: "info",
				message: `project: ${v.projectName} — ${headline}`,
			});
		} else {
			items.push({
				status: "warning",
				message: `project: ${v.projectName} — ${headline} ${v.reason}`,
				details: [
					`Published: ${v.publishedVersion} (current major: ${v.currentMajor})`,
					`Section count: ${v.sectionCountPublished} / ${v.sectionCountCurrent}`,
					"How to fix: re-run /velpari-architecture-generator in update mode.",
					"  The LLM fills only missing sections per the 5 update-mode rules.",
					"  Doctor will re-audit on the next approve and the path will switch to upgrade.",
				],
			});
		}
	}

	return {
		title: "Shape compatibility",
		items,
	};
}
