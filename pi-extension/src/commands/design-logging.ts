import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleDesignLogging } from "../ops/design-logging.js";

export function registerDesignLoggingCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-design-logging", {
		description:
			"Real handler for /velpari-design-logging (v1.4.0). Cross-cutting discipline command — orchestrates 3 visible subagents (logging-standards-researcher, logging-architecture-designer, logging-compliance-mapper) that produce a 17-section logging architecture plan at Doc/observability/logging-plan_<project>.md. Self-publishes when doctor passes.",
		handler: async (_args, ctx) => {
			await handleDesignLogging(ctx as never, pi as never);
		},
	});
}
