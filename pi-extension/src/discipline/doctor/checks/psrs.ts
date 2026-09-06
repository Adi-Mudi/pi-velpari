/**
 * PSRS structural check.
 *
 * Reads the published PSRS at the grouped Doc/requirements/PRD_<project>.md
 * path (falling back to the legacy flat Doc/PRD_<project>.md) and
 * validates the structural shape.
 *
 * Phase 1: returns a DiagnosticSection.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildGroupedPath, buildOutputPath } from "../../../core/paths.js";
import { renderPsrsSummary, validatePsrs } from "../../../core/psrs.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkPsrsSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "PSRS validation skipped — project name missing. Run `/velpari-configure-inputs` first.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "PSRS validation", items };
	}

	const grouped = join(cwd, buildGroupedPath("PRD", projectName));
	const legacy = join(cwd, buildOutputPath("PRD", projectName));

	if (existsSync(grouped)) {
		const content = readFileSync(grouped, "utf8");
		const result = validatePsrs(content);
		items.push({
			status: result.ok ? "ok" : "error",
			message: result.ok ? "PSRS validation (grouped): OK" : "PSRS validation (grouped): FAILED",
			details: [renderPsrsSummary(result)],
		});
		return { title: "PSRS validation", items };
	}

	if (existsSync(legacy)) {
		items.push({
			status: "info",
			message: `Legacy PSRS found at ${legacy}. PSRS validation applies to new grouped documents; rerun the PRD stage to create a validated grouped copy.`,
			suggestion: suggestionFor("psrs-legacy-only"),
		});
		return { title: "PSRS validation", items };
	}

	items.push({
		status: "info",
		message: "PSRS not found yet. It will be created when you run `/velpari-prd` after `/velpari-discuss`.",
		suggestion: suggestionFor("psrs-missing"),
	});
	return { title: "PSRS validation", items };
}
