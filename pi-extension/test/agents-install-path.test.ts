/**
 * Phase A regression — bundledAgentPath layout probe.
 *
 * Phase A moved agents-install.ts from pi-extension/src/ to pi-extension/src/core/.
 * The bundled-file resolver uses __dirname + relative probes to walk back to
 * <repo>/skills/agents/<id>.md. This test pins the probe chain so a future
 * move does not silently break it.
 *
 * Layouts the resolver must support (any one resolving successfully is fine):
 *   1. dist/pi-extension/src/core/  → repo root (Phase A, 4 levels up)
 *   2. dist/pi-extension/src/      → repo root (legacy, 3 levels up)
 *   3. pi-extension/src/core/      → repo root (source layout, 2 levels up)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { bundledAgentPath } from "../src/core/agents-install.js";

test("bundledAgentPath returns a path inside skills/agents/", () => {
	const resolved = bundledAgentPath("extractor");
	assert.ok(
		resolved.endsWith("skills/agents/extractor.md"),
		`bundledAgentPath('extractor') should end with skills/agents/extractor.md, got ${resolved}`,
	);
});

test("bundledAgentPath resolves to a file that exists on disk", () => {
	// Whichever candidate wins, the bundled skill file must be on disk.
	// Otherwise users get a silent skip in ensureStageAgents.
	const resolved = bundledAgentPath("prd-checker");
	assert.ok(
		existsSync(resolved),
		`bundledAgentPath('prd-checker') must point at a real file, got ${resolved}`,
	);
});
