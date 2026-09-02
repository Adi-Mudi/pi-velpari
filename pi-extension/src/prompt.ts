import type { Stage } from "./constants.js";

/**
 * Load a stage skill from skills/velpari-<stage>.md. Phase A stub.
 */
export function loadStageSkill(stage: Stage, _cwd: string = process.cwd()): string {
	void _cwd;
	void stage;
	return `[Phase A stub] Stage skill for ${stage} not loaded yet.`;
}

/**
 * Build the prompt for a given stage, with framework injection (FR-49).
 * Phase A stub.
 */
export function buildStagePrompt(
	stage: Stage,
	framework: string | undefined,
	context: string,
): string {
	const fwLine = framework ? `Framework: ${framework}\n` : "";
	return `[Phase A stub] Stage: ${stage}\n${fwLine}\n${context}`;
}
