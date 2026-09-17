/**
 * Architecture sub-life cycle — Step 3: Confirm with developer.
 *
 * After loading the project context, the parent LLM shows a one-paragraph
 * summary of what it understood and asks the developer to proceed, adjust
 * the scope, or pick a different standards profile. This is the discipline
 * gate that prevents "write first, ask later".
 *
 * Three outcomes:
 *  - "proceed"  → mark `developerConfirmed: true` in state, continue
 *  - "adjust"   → mark `developerConfirmed: false`, ask the developer to
 *                 edit the active standards profile / scope manually
 *  - "profile"  → mark `developerConfirmed: false`, recommend
 *                 `/velpari-configure-standards` and stop
 *
 * No UI? (RPC / print mode) → returns "proceed" with a warning; the gate
 * later refuses to publish without `developerConfirmed: true`.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { summarizeArchContext, type ArchContext } from "./arch-context.js";
import { computeShapeStatusLinesForConfig } from "./shape.js";

export type ConfirmOutcome = "proceed" | "adjust" | "profile" | "no-ui";

export interface ConfirmResult {
	outcome: ConfirmOutcome;
	confirmed: boolean;
	summaryShown: string;
}

/**
 * Show the summary + ask the developer. Returns the outcome.
 *
 * The function never throws on missing UI — it returns ConfirmOutcome
 * `"no-ui"` with `confirmed: false` so callers can fall back.
 */
export async function confirmWithDeveloper(
	ctx: Pick<ExtensionCommandContext, "ui">,
	ctx_data: ArchContext,
	cwd: string = process.cwd(),
): Promise<ConfirmResult> {
	const summary =
		summarizeArchContext(ctx_data) +
		"\n\n" +
		// v1.3.0+ multi-design: show the shape verdict line(s) for the
		// federation (one per projectName). Falls back to the legacy
		// single-line shapeStatusLine when projectNames is not a list.
		computeShapeStatusLinesForConfig(cwd, ctx_data.projectName, ctx_data.projectNames);

	const ui = ctx.ui;
	if (!ui || !isCallable(ui.select)) {
		return { outcome: "no-ui", confirmed: false, summaryShown: summary };
	}

	const choice = await ui.select(summary, [
		"Proceed — generate the architecture",
		"Adjust scope — I'll edit the context first",
		"Pick a different profile — run /velpari-configure-standards",
	]);

	if (choice === null || choice === undefined) {
		return { outcome: "no-ui", confirmed: false, summaryShown: summary };
	}

	if (choice.startsWith("Proceed")) {
		return { outcome: "proceed", confirmed: true, summaryShown: summary };
	}
	if (choice.startsWith("Adjust")) {
		return { outcome: "adjust", confirmed: false, summaryShown: summary };
	}
	return { outcome: "profile", confirmed: false, summaryShown: summary };
}

/**
 * Build the prompt the parent LLM reads to surface the summary in a
 * chat-friendly form. The handler can append this to its system message
 * so the developer sees the same text in the TUI even if `ui.select`
 * is unavailable.
 */
export function renderConfirmPrompt(summary: string): string {
	return [
		"## Architecture sub-life cycle — confirm",
		"",
		"```",
		summary,
		"```",
		"",
		"Proceed, adjust scope, or pick a different profile?",
	].join("\n");
}

function isCallable(fn: unknown): fn is (...args: unknown[]) => unknown {
	return typeof fn === "function";
}
