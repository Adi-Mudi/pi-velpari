/**
 * Integration: industrial-ot overlay (Phase 9, plan §Phase 1).
 *
 * Verifies that the bundled catalogue includes `industrial-ot`, the
 * overlay profile is loadable, and the loader returns the expected
 * standards + required sections + extra scouts + doctor checks.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { loadCatalogue, findOverlay } from "../../src/core/standards-catalogue.js";
import { loadOverlay, mergeOverlay } from "../../src/core/standards-overlay.js";
import { findPackageRoot } from "../../src/core/paths.js";

const pkgRoot = findPackageRoot(process.cwd());

describe("industrial-ot overlay — catalogue", () => {
	it("is listed in the bundled catalogue", () => {
		const catalogue = loadCatalogue(pkgRoot);
		assert.ok(catalogue);
		const entry = findOverlay(catalogue!, "industrial-ot");
		assert.ok(entry, "catalogue must list industrial-ot");
		assert.strictEqual(entry!.id, "industrial-ot");
		assert.strictEqual(entry!.version, "1.0.0");
		assert.deepStrictEqual(entry!.standards, ["IEC 61508:2010", "IEC 62443-3-3:2013", "IEC 61131-3:2013"]);
	});

	it("declares scopes relevant to industrial / process control", () => {
		const catalogue = loadCatalogue(pkgRoot);
		const entry = findOverlay(catalogue!, "industrial-ot")!;
		assert.ok(entry.scopes.includes("industrial-ot"));
		assert.ok(entry.scopes.includes("plc"));
		assert.ok(entry.scopes.includes("scada"));
	});

	it("declares inference signals for SIL detection", () => {
		const catalogue = loadCatalogue(pkgRoot);
		const entry = findOverlay(catalogue!, "industrial-ot")!;
		assert.ok(entry.inferenceSignals.includes("iec 61508"));
		assert.ok(entry.inferenceSignals.includes("sil"));
		assert.ok(entry.inferenceSignals.includes("functional safety"));
	});
});

describe("industrial-ot overlay — profile", () => {
	it("loads and parses the overlay profile", () => {
		const overlay = loadOverlay(pkgRoot, "industrial-ot");
		assert.ok(overlay, "loadOverlay must return the industrial-ot overlay");
		assert.strictEqual(overlay!.id, "industrial-ot");
	});

	it("declares 5 required PRD sections", () => {
		const overlay = loadOverlay(pkgRoot, "industrial-ot")!;
		assert.strictEqual(overlay.requiredSections.prd.length, 5);
		assert.ok(overlay.requiredSections.prd.some((s) => s.includes("Safety Integrity Level")));
		assert.ok(overlay.requiredSections.prd.some((s) => s.includes("Hazard")));
	});

	it("declares 5 required design sections", () => {
		const overlay = loadOverlay(pkgRoot, "industrial-ot")!;
		assert.strictEqual(overlay.requiredSections.design.length, 5);
		assert.ok(overlay.requiredSections.design.some((s) => s.includes("Safety Instrumented System")));
		assert.ok(overlay.requiredSections.design.some((s) => s.includes("SIL Decomposition")));
	});

	it("declares 5 required testplan sections", () => {
		const overlay = loadOverlay(pkgRoot, "industrial-ot")!;
		assert.strictEqual(overlay.requiredSections.testplan.length, 5);
		assert.ok(overlay.requiredSections.testplan.some((s) => s.includes("SIL Verification")));
		assert.ok(overlay.requiredSections.testplan.some((s) => s.includes("Proof Test")));
	});

	it("declares the design-sil-analyzer extra scout", () => {
		const overlay = loadOverlay(pkgRoot, "industrial-ot")!;
		assert.strictEqual(overlay.extraScouts.length, 1);
		const scout = overlay.extraScouts[0]!;
		assert.strictEqual(scout.role, "overlay-design-sil-analyzer");
		assert.ok(scout.reportPathTemplate.includes("design-sil-analyzer-report.json"));
	});

	it("declares 7 doctor checks", () => {
		const overlay = loadOverlay(pkgRoot, "industrial-ot")!;
		assert.strictEqual(overlay.doctorChecks.length, 7);
		assert.ok(overlay.doctorChecks.some((c) => c.includes("Safety Integrity Level")));
		assert.ok(overlay.doctorChecks.some((c) => c.includes("proof test")));
	});
});

describe("industrial-ot overlay — mergeOverlay", () => {
	it("appends overlay sections to a design template", () => {
		const overlay = loadOverlay(pkgRoot, "industrial-ot")!;
		const merged = mergeOverlay("design", "# Existing design\n\n## Module Breakdown\n\n## Change Log\n", overlay);
		assert.ok(merged.includes("## Module Breakdown"));
		assert.ok(merged.includes("## Safety Instrumented System"));
		assert.ok(merged.includes("## SIL Decomposition"));
	});
});
