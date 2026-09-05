/**
 * PSRS structural check.
 *
 * Reads the published PSRS at the grouped Doc/requirements/PRD_<project>.md
 * path (falling back to the legacy flat Doc/PRD_<project>.md) and
 * validates the structural shape. Results are pushed into `lines`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildGroupedPath, buildOutputPath } from "../../../core/paths.js";
import { renderPsrsSummary, validatePsrs } from "../../../core/psrs.js";

export function checkPsrs(cwd: string, projectName: string, lines: string[]): void {
	const grouped = join(cwd, buildGroupedPath("PRD", projectName));
	const legacy = join(cwd, buildOutputPath("PRD", projectName));
	if (existsSync(grouped)) {
		const content = readFileSync(grouped, "utf8");
		const result = validatePsrs(content);
		lines.push("### PSRS validation (grouped)");
		lines.push(renderPsrsSummary(result));
		lines.push("");
		return;
	}
	if (existsSync(legacy)) {
		lines.push("### PSRS validation (legacy)");
		lines.push(
			`- Legacy PSRS found at ${legacy}. ` +
			"PSRS validation applies to new grouped documents; rerun the PRD stage to create a validated grouped copy.",
		);
		lines.push("");
	}
}
