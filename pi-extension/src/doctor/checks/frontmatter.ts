/**
 * Artifact frontmatter check (RTM traceability upgrade, Phase 1).
 *
 * Every published artifact must carry the uniform frontmatter block
 * (core/frontmatter.ts: ARTIFACT_FRONTMATTER_FIELDS). Approve injects it
 * automatically at publish time, so a missing field means the artifact
 * predates the upgrade or was written by hand.
 *
 * Grouped-layout artifacts missing fields → error.
 * Legacy flat-layout artifacts missing fields → warning (republish fixes).
 * Missing artifacts are skipped — the paths/PSRS/RTM checks report those.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { missingFrontmatterFields } from "../../core/frontmatter.js";
import { GROUPED_CATEGORIES, resolveDocArtifact } from "../../core/paths.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkFrontmatterSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "Frontmatter check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "Artifact frontmatter", items };
	}

	let checked = 0;
	for (const artifact of Object.keys(GROUPED_CATEGORIES)) {
		const resolved = resolveDocArtifact(artifact, projectName, cwd);
		if (!resolved) continue; // missing artifact — reported by other checks
		checked++;
		const missing = missingFrontmatterFields(readFileSync(resolved.path, "utf8"));
		if (missing.length === 0) continue;
		items.push({
			status: resolved.layout === "grouped" ? "error" : "warning",
			message: `${artifact} (${resolved.layout}) missing frontmatter field(s): ${missing.join(", ")}.`,
			details: [`Path: ${resolved.path}`],
			suggestion: suggestionFor("frontmatter-missing"),
		});
	}

	// Brainstorm notes: per-topic files, so scan the folders instead of
	// resolving a single artifact path.
	const brainstormDirs: Array<{ dir: string; layout: "grouped" | "legacy"; filter: (f: string) => boolean }> = [
		{ dir: join(cwd, "Doc", "brainstorm"), layout: "grouped", filter: (f) => f.endsWith(".md") },
		{ dir: join(cwd, "Doc"), layout: "legacy", filter: (f) => f.startsWith("brainstorm-") && f.endsWith(".md") },
	];
	for (const { dir, layout, filter } of brainstormDirs) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir).filter(filter)) {
			const path = join(dir, file);
			checked++;
			const missing = missingFrontmatterFields(readFileSync(path, "utf8"));
			if (missing.length === 0) continue;
			items.push({
				status: layout === "grouped" ? "error" : "warning",
				message: `${file} (${layout}) missing frontmatter field(s): ${missing.join(", ")}.`,
				details: [`Path: ${path}`],
				suggestion: suggestionFor("frontmatter-missing"),
			});
		}
	}

	if (items.length === 0) {
		items.push({
			status: "ok",
			message: checked > 0
				? `All ${checked} published artifact(s) carry the full frontmatter block.`
				: "No published artifacts yet — nothing to check.",
		});
	}
	return { title: "Artifact frontmatter", items };
}
