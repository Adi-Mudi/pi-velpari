/**
 * Grouped vs legacy Doc/ artifact presence check.
 *
 * For each artifact in the documented list, print whether it lives at
 * the grouped layout (preferred), the legacy flat layout (Phase 7
 * compat), or is missing entirely.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildGroupedPath, buildOutputPath } from "../../../core/paths.js";

const ARTIFACTS: ReadonlyArray<string> = [
	"PRD",
	"RTM",
	"feasibility-study",
	"design",
	"pseudocode",
	"test-plan",
	"test-cases",
	"atomic-functions",
	"development-order",
];

export function checkGroupedLegacyPaths(cwd: string, projectName: string, lines: string[]): void {
	if (!projectName) {
		lines.push("### Grouped / legacy paths");
		lines.push("- Project name missing — skipping per-artifact scan.");
		lines.push("");
		return;
	}
	lines.push("### Grouped / legacy paths");
	for (const a of ARTIFACTS) {
		const grouped = join(cwd, buildGroupedPath(a, projectName));
		const legacy = join(cwd, buildOutputPath(a, projectName));
		const hasGrouped = existsSync(grouped);
		const hasLegacy = existsSync(legacy);
		const tag = hasGrouped ? "✓ grouped" : hasLegacy ? "✓ legacy" : "✗ missing";
		lines.push(`- ${a}: ${tag} | grouped=${grouped} | legacy=${legacy}`);
	}
	lines.push("");
}
