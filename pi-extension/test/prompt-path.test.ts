/**
 * Phase A regression — resolveSkillPath layout probe.
 *
 * Phase A moved prompt.ts from pi-extension/src/ to pi-extension/src/core/.
 * resolveSkillPath uses __dirname + relative probes to walk back to
 * <repo>/skills/velpari-<name>.md. This test pins the probe chain.
 *
 * Layouts the resolver must support (any one resolving successfully is fine):
 *   1. dist/pi-extension/src/core/ → repo root (Phase A, 4 levels up)
 *   2. dist/pi-extension/src/     → repo root (legacy, 3 levels up)
 *   3. pi-extension/src/core/     → repo root (source layout, 2 levels up)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolveSkillPath } from "../src/core/prompt.js";

test("resolveSkillPath returns a path inside skills/velpari-<name>.md", () => {
	const resolved = resolveSkillPath("discuss");
	assert.ok(
		resolved.endsWith("skills/velpari-discuss.md"),
		`resolveSkillPath('discuss') should end with skills/velpari-discuss.md, got ${resolved}`,
	);
});

test("resolveSkillPath resolves to a file that exists on disk", () => {
	const resolved = resolveSkillPath("prd");
	assert.ok(
		existsSync(resolved),
		`resolveSkillPath('prd') must point at a real file, got ${resolved}`,
	);
});
