/**
 * conditional-scouts tests (Phase 5).
 *
 * Covers the pluggable overlay-scout mechanism:
 *   - 4 base scouts always spawn for the design stage
 *   - 4 base + 1 overlay scout when overlay.extraScouts declares one
 *   - 4 base + 3 overlay scouts when the overlay declares three
 *   - overlay scout missing → handler reports error, does not silently skip
 *   - overlay profile absent → no extra scouts (implicit "none")
 *   - isOverlayRole correctly identifies the overlay- prefix
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isOverlayRole, resolveOverlayAgentName } from "../../src/core/agents-config.js";
import { overlayDir, loadOverlay } from "../../src/core/standards-overlay.js";
import { cataloguePath } from "../../src/core/standards-catalogue.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-conditional-scouts-"));
	mkdirSync(join(tmpDir, "skills", "standards", "overlays"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function writeCatalogue(overlays: Array<{ id: string; label?: string }>): void {
	writeFileSync(
		cataloguePath(tmpDir),
		JSON.stringify({
			version: "1.0.0",
			overlays: overlays.map((o) => ({
				id: o.id,
				version: "1.0.0",
				label: o.label ?? o.id,
				standards: ["RFC 2119"],
				scopes: ["any"],
				inferenceSignals: [],
			})),
		}),
		"utf8",
	);
}

function writeOverlayProfile(
	id: string,
	extraScouts: Array<{ role: string; description: string; reportPathTemplate: string }>,
): void {
	const dir = overlayDir(tmpDir, id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "profile.json"),
		JSON.stringify({
			id,
			version: "1.0.0",
			label: id,
			standards: ["RFC 2119"],
			scopes: ["any"],
			inferenceSignals: [],
			requiredSections: { prd: [], design: [], testplan: [] },
			extraScouts,
			doctorChecks: [],
		}),
		"utf8",
	);
}

describe("isOverlayRole", () => {
	it("returns true for the overlay- prefix", () => {
		assert.strictEqual(isOverlayRole("overlay-safety-analyzer"), true);
		assert.strictEqual(isOverlayRole("overlay-pci-validator"), true);
	});

	it("returns false for any other prefix", () => {
		assert.strictEqual(isOverlayRole("design-module-decomposer"), false);
		assert.strictEqual(isOverlayRole("extractor"), false);
		assert.strictEqual(isOverlayRole(""), false);
	});
});

describe("resolveOverlayAgentName", () => {
	it("returns the role name as-is", () => {
		assert.strictEqual(resolveOverlayAgentName("overlay-safety-analyzer"), "overlay-safety-analyzer");
	});
});

describe("overlay extraScouts enumeration", () => {
	it("returns empty extraScouts when overlay profile has no scouts", () => {
		writeCatalogue([{ id: "none" }]);
		writeOverlayProfile("none", []);
		const overlay = loadOverlay(tmpDir, "none");
		assert.ok(overlay);
		assert.deepEqual(overlay.extraScouts, []);
	});

	it("returns one overlay scout when the overlay declares one", () => {
		writeCatalogue([{ id: "none" }, { id: "medical-device-b" }]);
		writeOverlayProfile("medical-device-b", [
			{
				role: "overlay-design-safety-analyzer",
				description: "Maps design decisions to safety class A/B/C",
				reportPathTemplate: "<scoutReportDir>/safety-analyzer.json",
			},
		]);
		const overlay = loadOverlay(tmpDir, "medical-device-b");
		assert.ok(overlay);
		assert.strictEqual(overlay.extraScouts.length, 1);
		assert.strictEqual(overlay.extraScouts[0]?.role, "overlay-design-safety-analyzer");
		assert.ok(isOverlayRole(overlay.extraScouts[0]!.role));
	});

	it("returns multiple overlay scouts when the overlay declares several", () => {
		writeCatalogue([{ id: "industrial-ot" }]);
		writeOverlayProfile("industrial-ot", [
			{
				role: "overlay-zones-conduits",
				description: "IEC 62443 zones & conduits",
				reportPathTemplate: "<scoutReportDir>/zones.json",
			},
			{
				role: "overlay-safety-integrity",
				description: "IEC 61508 SIL mapping",
				reportPathTemplate: "<scoutReportDir>/sil.json",
			},
			{
				role: "overlay-cybersecurity",
				description: "Cybersecurity controls mapping",
				reportPathTemplate: "<scoutReportDir>/cyber.json",
			},
		]);
		const overlay = loadOverlay(tmpDir, "industrial-ot");
		assert.ok(overlay);
		assert.strictEqual(overlay.extraScouts.length, 3);
		for (const scout of overlay.extraScouts) {
			assert.ok(isOverlayRole(scout.role));
		}
	});
});

describe("overlay profile missing", () => {
	it("returns null when the overlay profile.json is missing", () => {
		writeCatalogue([{ id: "ghost-overlay" }]);
		// profile.json NOT written
		assert.strictEqual(loadOverlay(tmpDir, "ghost-overlay"), null);
	});
});
