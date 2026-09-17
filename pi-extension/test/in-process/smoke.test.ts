/**
 * L3 in-process harness — compatibility smoke test.
 *
 * PROBE: Does `pi-coding-agent-test@0.1.1` work with the installed
 * Pi version? If yes, L3 tests can use this harness. If no, the L3
 * story falls back to extending the existing RPC e2e harness (Tier 1).
 *
 * Why this is gated behind `RUN_L3_E2E=1`:
 *   - The harness spawns a real Pi subprocess (~1-3s overhead per test).
 *   - The harness uses internal Pi APIs that drift between versions.
 *   - The smoke test is intended to be run periodically (Phase 7 CI
 *     workflow_dispatch), not on every PR.
 *
 * History:
 *   - 2026-09-15: `pi-coding-agent-test@0.1.1` references
 *     `@earendil-works/pi-coding-agent/dist/bundle/modes/interactive/components/tool-execution.js`
 *     which does NOT exist in pi@0.85.1 (the globally installed binary).
 *     Result: `ERR_MODULE_NOT_FOUND`. The L3 layer is INCOMPATIBLE with
 *     the current pi version and is currently SKIPPED.
 *   - Plan: revisit when pi-coding-agent-test ships a release that targets
 *     pi 0.85.x, OR when the project pins pi to a version the harness supports.
 *   - Until then, L3-equivalent coverage comes from extending the Tier-1
 *     RPC e2e harness (test/e2e/).
 */

import { describe, it } from "node:test";
import { existsSync } from "node:fs";
import { text } from "pi-coding-agent-test";
import { EXTENSION_ENTRY, makeTest } from "./harness.js";

const hasPi = existsSync(EXTENSION_ENTRY);
const isEnabled = process.env.RUN_L3_E2E === "1";

describe("L3 in-process harness — compatibility smoke", () => {
	it.skip("would load the compiled Velpari extension into a real Pi subprocess", {
		skip: !hasPi
			? "compiled extension not found at " + EXTENSION_ENTRY
			: !isEnabled
				? "L3 tests gated by RUN_L3_E2E=1 (see compatibility note in this file's header)"
				: false,
	}, async () => {
		// Compatibility probe. If this fails with ERR_MODULE_NOT_FOUND
		// referencing pi-coding-agent internals, mark L3 as deferred.
		const t = makeTest("smoke-load-extension", {
			conversation: [
				{ blocks: [text("Velpari extension loaded successfully.")] },
			],
		});

		const result = await t.run("Confirm the extension is loaded");
		if (!Array.isArray(result.messages) || result.messages.length === 0) {
			throw new Error("expected at least one recorded message");
		}
	});
});
