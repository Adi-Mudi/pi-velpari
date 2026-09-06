/**
 * Grouped vs legacy Doc/ artifact presence check.
 *
 * For each artifact in the documented list, print whether it lives at
 * the grouped layout (preferred), the legacy flat layout (Phase 7
 * compat), or is missing entirely.
 *
 * Phase 1: returns a DiagnosticSection.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildGroupedPath, buildOutputPath } from "../../../core/paths.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";

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

export function checkGroupedLegacyPathsSection(
	cwd: string,
	projectName: string,
): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "Grouped / legacy paths skipped — project name missing.",
			suggestion: "Run `/velpari-configure-inputs` to set the project name.",
		});
		return { title: "Grouped / legacy paths", items };
	}

	for (const a of ARTIFACTS) {
		const grouped = join(cwd, buildGroupedPath(a, projectName));
		const legacy = join(cwd, buildOutputPath(a, projectName));
		const hasGrouped = existsSync(grouped);
		const hasLegacy = existsSync(legacy);

		if (hasGrouped) {
			items.push({
				status: "ok",
				message: `${a}: grouped (preferred layout)`,
				details: [`path=${grouped}`],
			});
		} else if (hasLegacy) {
			items.push({
				status: "info",
				message: `${a}: legacy only — rerun the stage to produce the grouped copy.`,
				details: [`path=${legacy}`],
				suggestion: `Rerun the corresponding stage command (e.g. /velpari-${kebabStage(a)}) to regenerate in the grouped layout.`,
			});
		} else {
			items.push({
				status: "info",
				message: `${a}: missing (not yet produced by this run).`,
				suggestion: `Run the matching stage command to generate ${a}.`,
			});
		}
	}

	return { title: "Grouped / legacy paths", items };
}

function kebabStage(artifact: string): string {
	return artifact.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
