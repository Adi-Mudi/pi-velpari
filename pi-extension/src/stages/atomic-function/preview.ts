/**
 * PHASE 6 — preview helper for /velpari-atomic-function (dedicated layer).
 *
 * Owns the AskUserQuestion text the parent LLM surfaces after writing
 * the working-copy `atomic-functions_<projectName>.md`. The three
 * options are:
 *
 *   yes — the working copy is ready, the parent LLM calls the publish tool
 *   no   — I'll add changes first
 *   edit — let me specify which atomic functions to revise
 *
 * The preview gate is the LAST step the parent LLM runs before the
 * user takes over. Publish (Phase 7 / publish.ts) is the future home
 * of the actual write-to-Doc/ — today it still lives in publish.
 *
 * Layer 1 — imports core/ only.
 */

import { buildWorkingGroupedPath } from "../../core/paths.js";

/** Inputs to `formatPreviewQuestion`. */
interface PreviewQuestionDeps {
	cwd: string;
	runId: string;
	projectName: string;
}

/** The three preview options. Re-exported for tests + parent-LLM matchers. */
export const PREVIEW_OPTIONS = ["yes", "no", "edit"] as const;
export type PreviewOption = (typeof PREVIEW_OPTIONS)[number];

/**
 * Build the AskUserQuestion text the parent LLM shows at the preview
 * gate. Includes the working-copy path so the user can review it
 * before saying "yes".
 */
export function formatPreviewQuestion(deps: PreviewQuestionDeps): string {
	const workingCopyPath = buildWorkingGroupedPath(
		deps.cwd,
		deps.runId,
		"atomic-functions",
		deps.projectName,
	);
	return [
		`Publish preview?`,
		`Working copy: ${workingCopyPath}`,
		`  - yes — the working copy is ready, the parent LLM calls the publish tool`,
		`  - no   — I'll add changes first`,
		`  - edit — let me specify which atomic functions to revise`,
		``,
		`On 'yes': state advances to analyzed-atomic-functions and the`,
		`published copy lands at Doc/atomic-functions/${getDocFileName(deps.projectName)}.md.`,
		`On 'no' / 'edit': the parent LLM re-opens the working copy and`,
		`the user can request changes before re-previewing.`,
	].join("\n");
}

/** Build the published Doc/ file name for a projectName (grouped layout). */
function getDocFileName(projectName: string): string {
	return `atomic-functions_${projectName}.md`;
}