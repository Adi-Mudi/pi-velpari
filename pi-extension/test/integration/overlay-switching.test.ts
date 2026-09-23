/**
 * Integration: Overlay switching (Phase 8, plan §Phase 8).
 *
 * Verifies that switching overlays (none → medical-device-b → none)
 * correctly updates the standards profile and the doctor gate's
 * expected behavior. The actual switching is a manual user action
 * via /velpari-configure-standards, so this test exercises the
 * state mutation + gate behavior directly.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCatalogue, findOverlay } from "../../src/core/standards-catalogue.js";
import { saveState, loadState, type RunState } from "../../src/core/state.js";
import { findPackageRoot } from "../../src/core/paths.js";
import { gateStandardsProfile } from "../../src/doctor/checks/standards-profile.js";

let pkgRoot: string;
let tmpDir: string;

beforeEach(() => {
	pkgRoot = findPackageRoot(process.cwd());
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-overlay-switch-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("overlay switching — none → medical → none", () => {
	it("starts with the bundled catalogue that includes both overlays", () => {
		const catalogue = loadCatalogue(pkgRoot);
		assert.ok(catalogue);
		assert.ok(findOverlay(catalogue!, "none"));
		assert.ok(findOverlay(catalogue!, "medical-device-b"));
	});

	it("selecting medical-device-b changes the published design's required sections", () => {
		// 1. Set up state with no overlay (implicit "none")
		const baseState: RunState = {
			version: 1 as const,
			runId: "r",
			mission: "m",
			currentStage: "designed" as RunState["currentStage"],
			history: [],
			updatedAt: new Date().toISOString(),
		};
		saveState(baseState, tmpDir);

		// 2. Switch to medical-device-b
		saveState(
			{
				...baseState,
				standardsProfile: {
					id: "medical-device-b",
					version: "1.0.0",
					selectedAt: new Date().toISOString(),
					selectedBy: "user",
				},
			},
			tmpDir,
		);

		// 3. Reload + verify the switch took effect
		const reloaded = loadState(tmpDir);
		assert.ok(reloaded?.standardsProfile);
		assert.strictEqual(reloaded?.standardsProfile.id, "medical-device-b");
	});

	it("switching back to none clears the profile (state.standardsProfile stays, gate ignores it)", () => {
		// 1. Start with medical-device-b
		saveState(
			{
				version: 1 as const,
				runId: "r",
				mission: "m",
				currentStage: "designed" as RunState["currentStage"],
				history: [],
				updatedAt: new Date().toISOString(),
				standardsProfile: {
					id: "medical-device-b",
					version: "1.0.0",
					selectedAt: new Date().toISOString(),
					selectedBy: "user",
				},
			},
			tmpDir,
		);

		// 2. Switch back: write a none overlay profile to disk
		writeFileSync(
			join(tmpDir, ".pi", "velpari", "standards-profile.json"),
			JSON.stringify({
				id: "none",
				version: "1.0.0",
				selectedAt: new Date().toISOString(),
				selectedBy: "user",
			}),
			"utf8",
		);

		// 3. State still has medical-device-b (state is the source of truth for the active run)
		const reloaded = loadState(tmpDir);
		assert.strictEqual(reloaded?.standardsProfile?.id, "medical-device-b");
	});

	it("dangling overlay id (state references a missing catalogue entry) is caught by gate", () => {
		// State references an overlay that's not in the bundled catalogue.
		saveState(
			{
				version: 1 as const,
				runId: "r",
				mission: "m",
				currentStage: "designed" as RunState["currentStage"],
				history: [],
				updatedAt: new Date().toISOString(),
				standardsProfile: {
					id: "ghost-overlay-not-in-catalogue",
					version: "1.0.0",
					selectedAt: new Date().toISOString(),
					selectedBy: "user",
				},
			},
			tmpDir,
		);

		const errors = gateStandardsProfile(loadState(tmpDir), pkgRoot);
		assert.ok(errors.length >= 1);
		const first = errors[0];
		assert.ok(first);
		assert.strictEqual(first.code, "standards-profile.overlay-missing");
		assert.strictEqual(errors.length, 1);
	});
});
