/**
 * Lifecycle hooks composer (L2 presentation layer).
 *
 * One file per Pi lifecycle event, mirroring the official orchestrator
 * rule "one lifecycle event per side effect; one file per event under
 * hooks/". This index only wires the per-event registrars together.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSessionStartHook } from "./session-start.js";
import { registerSessionBeforeCompactHook } from "./session-before-compact.js";
import { registerResourcesDiscoverHook } from "./resources-discover.js";
import { registerSessionShutdownHook } from "./session-shutdown.js";
import { registerToolCallHook } from "./tool-call.js";
import { registerBeforeAgentStartHook } from "./before-agent-start.js";

export function registerHooks(pi: ExtensionAPI): void {
	registerSessionStartHook(pi);
	registerSessionBeforeCompactHook(pi);
	registerResourcesDiscoverHook(pi);
	registerSessionShutdownHook(pi);
	registerToolCallHook(pi);
	registerBeforeAgentStartHook(pi);
}
