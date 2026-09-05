/**
 * /velpari-prd-rtm wrapper.
 *
 * Calls `handlePrd` followed by `handleRtm`. The wrapper does NOT
 * duplicate stage logic and does NOT auto-approve. If either stage
 * fails the wrapper surfaces the error and stops. The wrapper exists
 * for users who want to produce a PSRS + RTM in a single command;
 * the underlying stages are independently upgradeable.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handlePrd } from "./prd.js";
import { handleRtm } from "./rtm.js";

export async function handlePrdRtm(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	ctx.ui.notify(
		"Starting combined /velpari-prd → /velpari-rtm run. " +
			"This wrapper does not auto-approve either stage.",
		"info",
	);
	await handlePrd(ctx, pi, cwd);
	await handleRtm(ctx, pi, cwd);
	ctx.ui.notify(
		"/velpari-prd-rtm finished both hand-offs. " +
			"Run /velpari-approve after each working copy is ready.",
		"info",
	);
}