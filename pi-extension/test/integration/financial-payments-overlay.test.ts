/**
 * Integration: financial-payments overlay (Phase 9, plan §Phase 2).
 *
 * Verifies that the bundled catalogue includes `financial-payments`,
 * the overlay profile is loadable, and the loader returns the expected
 * PCI-DSS standards + required sections + extra scouts + doctor checks.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	loadCatalogue,
	findOverlay,
} from "../../src/core/standards-catalogue.js";
import {
	loadOverlay,
	mergeOverlay,
} from "../../src/core/standards-overlay.js";
import { findPackageRoot } from "../../src/core/paths.js";

const pkgRoot = findPackageRoot(process.cwd());

describe("financial-payments overlay — catalogue", () => {
	it("is listed in the bundled catalogue", () => {
		const catalogue = loadCatalogue(pkgRoot);
		assert.ok(catalogue);
		const entry = findOverlay(catalogue!, "financial-payments");
		assert.ok(entry, "catalogue must list financial-payments");
		assert.strictEqual(entry!.id, "financial-payments");
		assert.strictEqual(entry!.version, "1.0.0");
		assert.deepStrictEqual(entry!.standards, [
			"PCI-DSS v4.0",
			"SOX §404",
			"FFIEC CAT v1.0",
			"ISO 27001:2022",
		]);
	});

	it("declares scopes relevant to card payments + banking", () => {
		const catalogue = loadCatalogue(pkgRoot);
		const entry = findOverlay(catalogue!, "financial-payments")!;
		assert.ok(entry.scopes.includes("financial-payments"));
		assert.ok(entry.scopes.includes("pci-dss"));
		assert.ok(entry.scopes.includes("card-payments"));
		assert.ok(entry.scopes.includes("banking"));
	});

	it("declares inference signals for PCI / SOX detection", () => {
		const catalogue = loadCatalogue(pkgRoot);
		const entry = findOverlay(catalogue!, "financial-payments")!;
		assert.ok(entry.inferenceSignals.includes("pci"));
		assert.ok(entry.inferenceSignals.includes("cardholder data"));
		assert.ok(entry.inferenceSignals.includes("cde"));
		assert.ok(entry.inferenceSignals.includes("pan"));
	});
});

describe("financial-payments overlay — profile", () => {
	it("loads and parses the overlay profile", () => {
		const overlay = loadOverlay(pkgRoot, "financial-payments");
		assert.ok(overlay, "loadOverlay must return the financial-payments overlay");
		assert.strictEqual(overlay!.id, "financial-payments");
	});

	it("declares 5 required PRD sections including CDE scope", () => {
		const overlay = loadOverlay(pkgRoot, "financial-payments")!;
		assert.strictEqual(overlay.requiredSections.prd.length, 5);
		assert.ok(overlay.requiredSections.prd.some((s) => s.includes("Cardholder Data Environment")));
		assert.ok(overlay.requiredSections.prd.some((s) => s.includes("Segregation of Duties")));
		assert.ok(overlay.requiredSections.prd.some((s) => s.includes("PCI Compliance Matrix")));
	});

	it("declares 5 required design sections including CDE isolation", () => {
		const overlay = loadOverlay(pkgRoot, "financial-payments")!;
		assert.strictEqual(overlay.requiredSections.design.length, 5);
		assert.ok(overlay.requiredSections.design.some((s) => s.includes("Network Segmentation")));
		assert.ok(overlay.requiredSections.design.some((s) => s.includes("Key Management")));
		assert.ok(overlay.requiredSections.design.some((s) => s.includes("Audit Log")));
	});

	it("declares 5 required testplan sections", () => {
		const overlay = loadOverlay(pkgRoot, "financial-payments")!;
		assert.strictEqual(overlay.requiredSections.testplan.length, 5);
		assert.ok(overlay.requiredSections.testplan.some((s) => s.includes("Penetration Test")));
		assert.ok(overlay.requiredSections.testplan.some((s) => s.includes("Key Rotation")));
	});

	it("declares the design-pci-analyzer extra scout", () => {
		const overlay = loadOverlay(pkgRoot, "financial-payments")!;
		assert.strictEqual(overlay.extraScouts.length, 1);
		const scout = overlay.extraScouts[0]!;
		assert.strictEqual(scout.role, "overlay-design-pci-analyzer");
		assert.ok(scout.reportPathTemplate.includes("design-pci-analyzer-report.json"));
	});

	it("declares 8 doctor checks", () => {
		const overlay = loadOverlay(pkgRoot, "financial-payments")!;
		assert.strictEqual(overlay.doctorChecks.length, 8);
		assert.ok(
			overlay.doctorChecks.some((c) => c.includes("Cardholder Data Environment") || c.includes("CDE")),
		);
		assert.ok(
			overlay.doctorChecks.some((c) => c.toLowerCase().includes("segregation of duties")),
		);
	});
});

describe("financial-payments overlay — mergeOverlay", () => {
	it("appends overlay sections to a design template", () => {
		const overlay = loadOverlay(pkgRoot, "financial-payments")!;
		const merged = mergeOverlay(
			"design",
			"# Existing design\n\n## Module Breakdown\n\n## Change Log\n",
			overlay,
		);
		assert.ok(merged.includes("## Module Breakdown"));
		assert.ok(merged.includes("## Network Segmentation"));
		assert.ok(merged.includes("## Key Management"));
	});
});
