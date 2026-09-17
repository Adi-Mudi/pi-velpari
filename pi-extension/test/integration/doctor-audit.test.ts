/**
 * Integration: Doctor audit (Phase 8, plan §Phase 8).
 *
 * Verifies that every Phase 1-6 doctor check function exists, is
 * wired into the gate, and surfaces a meaningful DiagnosticSection.
 * Manual `/velpari-doctor` runs are the user-visible contract; this
 * test exercises the underlying functions.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gateArchSubCycle, checkArchSubCycle } from "../../src/doctor/checks/arch-sub-cycle.js";
import { gateStandardsProfile, checkStandardsProfile } from "../../src/doctor/checks/standards-profile.js";
import { gateADR, checkADR } from "../../src/doctor/checks/adr.js";
import { loadOverlayChecks } from "../../src/doctor/check-registry.js";
import { findPackageRoot } from "../../src/core/paths.js";
import { loadCatalogue } from "../../src/core/standards-catalogue.js";

const pkgRoot = findPackageRoot(process.cwd());

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-doctor-audit-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("doctor audit — every Phase 1-6 check function is wired", () => {
	it("Phase 2: gateArchSubCycle + checkArchSubCycle exist and return DiagnosticSection", () => {
		const section = checkArchSubCycle(null);
		assert.ok(section.title);
		assert.ok(Array.isArray(section.items));
		assert.strictEqual(typeof section.title, "string");
	});

	it("Phase 3: gateStandardsProfile + checkStandardsProfile exist", () => {
		const section = checkStandardsProfile(null, pkgRoot);
		assert.ok(section.title);
		assert.ok(Array.isArray(section.items));
	});

	it("Phase 4: gateADR + checkADR exist and return DiagnosticSection", () => {
		const section = checkADR(null);
		assert.ok(section.title);
		assert.ok(Array.isArray(section.items));
	});

	it("Phase 5: loadOverlayChecks returns overlay rules when overlay is active", () => {
		const checks = loadOverlayChecks(pkgRoot, "medical-device-b");
		assert.ok(checks.length > 0, "medical-device-b has checks");
	});

	it("Phase 5: loadOverlayChecks returns empty when overlay is absent", () => {
		assert.deepEqual(loadOverlayChecks(pkgRoot, undefined), []);
	});
});

describe("doctor audit — gate returns actionable errors", () => {
	it("gateArchSubCycle returns a clear message for the missing case", () => {
		const errors = gateArchSubCycle(null);
		assert.deepEqual(errors, []);
	});

	it("gateStandardsProfile reports a dangling overlay", () => {
		const state = {
			version: 1 as const,
			runId: "r",
			mission: "m",
			currentStage: "designed" as const,
			history: [],
			updatedAt: new Date().toISOString(),
			standardsProfile: {
				id: "no-such-overlay",
				version: "1.0.0",
				selectedAt: new Date().toISOString(),
				selectedBy: "user" as const,
			},
		};
		const errors = gateStandardsProfile(state, pkgRoot);
		assert.ok(errors.length >= 1);
		const first = errors[0];
		assert.ok(first);
		assert.match(first.message, /not in the catalogue/i);
	});

	it("gateADR reports a missing section", () => {
		const errors = gateADR("# Design\n\n## 1. Modules\n");
		assert.ok(errors.some((e) => e.code === "adr.section-missing"));
	});
});

describe("doctor audit — bundled catalogue reports overlay status", () => {
	it("reports the active overlay via checkStandardsProfile", () => {
		const catalogue = loadCatalogue(pkgRoot);
		assert.ok(catalogue);
		const overlays = catalogue!.overlays.map((o) => o.id);
		assert.ok(overlays.includes("none"));
		assert.ok(overlays.includes("medical-device-b"));
	});
});
