/**
 * resources_discover hook (extracted from src/index.ts in Phase 0 reorg).
 *
 * Phase F: contribute the project's `skills/` directory as an additional
 * Pi resource path. Pi's auto-discovery may already find this, but the
 * explicit registration documents the contract.
 */

import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerResourcesDiscoverHook(pi: ExtensionAPI): void {
	pi.on("resources_discover", async () => ({
		skillPaths: [join(process.cwd(), "skills")],
	}));
}
