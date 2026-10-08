/**
 * Semver bump check — Phase C (D Integration request 1), N27.
 *
 * Anytime doctor-side validation of the declared `bump:` frontmatter
 * against what actually changed between the published artifact and the
 * current working copy. Consumes Phase D's `core/semver.ts` through the
 * contract adapter (`../contract.ts`) — never D's internals — so this
 * check degrades to a single `info` line until batch gate 1 merges
 * Phase D.
 *
 * Approve-side surfacing stays in D's marked block in `ops/approve.ts`
 * (D plan decision 4); this section is the read-only anytime view
 * (registration point: `doctor/index.ts:runDoctor()` — see the plan's
 * integration-request note about `check-registry.ts` being the
 * standards-overlay loader, not a registry table).
 *
 * Every artifact loop is per-item wrapped — one broken pair never kills
 * the section (doctor ALWAYS renders).
 */

import { existsSync, readFileSync } from "node:fs";
import { loadState } from "../../core/state.js";
import { buildWorkingGroupedPath, resolveDocArtifact } from "../../core/paths.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { resolveSemverApi } from "../contract.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Semver bump (N27)";

/**
 * Artifacts that can have both a published copy and a working copy.
 * Mirrors the working-published-drift set (+ `wireframe`, Phase D pairing).
 */
const ARTIFACT_KEYS: readonly string[] = [
	"PRD",
	"RTM",
	"feasibility-study",
	"design",
	"wireframe",
	"pseudocode",
	"test-plan",
	"test-cases",
	"atomic-functions",
	"development-order",
];

/**
 * Build the "Semver bump" section (read-only).
 * @param {string} cwd - Project root.
 * @param {string} projectName - Configured project name ("" = not configured).
 * @returns {DiagnosticSection} Degraded contract → single `info`; declared-vs-actual mismatch → `error`.
 */
export function checkSemverBumpSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		const api = resolveSemverApi();
		if (!api) {
			items.push({
				status: "info",
				message:
					"semver-contract-unavailable: Phase D core/semver.ts not present in this build — bump validation degraded.",
				suggestion: suggestionFor("semver-contract-unavailable"),
			});
			return { title: SECTION_TITLE, items };
		}
		if (projectName === "") {
			items.push({
				status: "info",
				message: "No project configured — bump check skipped.",
				suggestion: suggestionFor("project-name-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		const runId = loadState(cwd).runId;
		if (!runId) {
			items.push({
				status: "info",
				message: "No active run — no working copy to compare against the published pair.",
			});
			return { title: SECTION_TITLE, items };
		}

		let compared = 0;
		let mismatches = 0;
		for (const artifact of ARTIFACT_KEYS) {
			try {
				const published = resolveDocArtifact(artifact, projectName, cwd);
				if (!published) continue;
				const workingPath = buildWorkingGroupedPath(cwd, runId, artifact, projectName);
				if (!existsSync(workingPath)) continue;

				const publishedContent = readFileSafe(published.path);
				const workingContent = readFileSafe(workingPath);
				if (publishedContent === null || workingContent === null) continue;
				compared++;

				const verdict = api.validateBump(publishedContent, workingContent);
				const { errors, warnings } = api.bumpGateMessages(verdict);
				if (errors.length > 0 || warnings.length > 0) mismatches++;
				for (const e of errors) {
					items.push({
						status: "error",
						message: `${artifact}: ${e}`,
						suggestion: suggestionFor("semver-bump-mismatch"),
					});
				}
				for (const w of warnings) {
					items.push({
						status: "warning",
						message: `${artifact}: ${w}`,
						suggestion: suggestionFor("semver-bump-mismatch"),
					});
				}
			} catch (err) {
				items.push({
					status: "warning",
					message: `${artifact}: bump validation skipped (${(err as Error)?.message ?? String(err)})`,
				});
			}
		}

		if (compared === 0) {
			items.push({
				status: "info",
				message: "No published+working pair yet — nothing to validate (fresh publishes are bump-exempt, D decision 3).",
			});
		} else if (mismatches === 0) {
			items.push({
				status: "ok",
				message: `${compared} published+working pair(s) checked — declared bump matches the actual change.`,
			});
		}
	} catch (err) {
		items.push({
			status: "warning",
			message: `semver check skipped (${(err as Error)?.message ?? String(err)})`,
		});
	}
	return { title: SECTION_TITLE, items };
}

/**
 * Read a file as UTF-8, returning `null` on any failure (fail-soft).
 * @param {string} path - Absolute file path.
 * @returns {string | null} File content, or `null` when unreadable.
 */
function readFileSafe(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}
