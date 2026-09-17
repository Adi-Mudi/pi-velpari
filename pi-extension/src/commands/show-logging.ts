import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showLoggingPlan } from "../view/show.js";

export function registerShowLoggingCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-show-logging", {
		description:
			"Real handler for /velpari-show-logging (v1.4.0). Prints the published logging plan at Doc/observability/logging-plan_<project>.md (or the legacy Doc/ root path when only that exists).",
		handler: async (_args, ctx) => {
			await showLoggingPlan(ctx as never);
		},
	});
}
