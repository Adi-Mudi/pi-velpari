/**
 * Integration: cloud-saas overlay (Phase 9, plan §Phase 3).
 *
 * Verifies that the bundled catalogue includes `cloud-saas`, the overlay
 * profile is loadable, and the loader returns the expected SOC 2 +
 * ISO 27001 standards + required sections + extra scouts + doctor checks.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { loadCatalogue, findOverlay } from "../../src/core/standards-catalogue.js";
import { loadOverlay, mergeOverlay } from "../../src/core/standards-overlay.js";
import { findPackageRoot } from "../../src/core/paths.js";

const pkgRoot = findPackageRoot(process.cwd());

describe("cloud-saas overlay — catalogue", () => {
	it("is listed in the bundled catalogue", () => {
		const catalogue = loadCatalogue(pkgRoot);
		assert.ok(catalogue);
		const entry = findOverlay(catalogue!, "cloud-saas");
		assert.ok(entry, "catalogue must list cloud-saas");
		assert.strictEqual(entry!.id, "cloud-saas");
		assert.strictEqual(entry!.version, "1.0.0");
		assert.deepStrictEqual(entry!.standards, [
			"SOC 2 Type II",
			"ISO 27001:2022",
			"NIST SP 800-53 Rev 5",
			"ISO 27017:2015",
			"ISO 27018:2019",
		]);
	});

	it("declares scopes relevant to multi-tenant SaaS", () => {
		const catalogue = loadCatalogue(pkgRoot);
		const entry = findOverlay(catalogue!, "cloud-saas")!;
		assert.ok(entry.scopes.includes("cloud-saas"));
		assert.ok(entry.scopes.includes("multi-tenant"));
		assert.ok(entry.scopes.includes("aws"));
		assert.ok(entry.scopes.includes("azure"));
		assert.ok(entry.scopes.includes("gcp"));
	});

	it("declares inference signals for SOC 2 / ISO 27001 detection", () => {
		const catalogue = loadCatalogue(pkgRoot);
		const entry = findOverlay(catalogue!, "cloud-saas")!;
		assert.ok(entry.inferenceSignals.includes("soc 2"));
		assert.ok(entry.inferenceSignals.includes("iso 27001"));
		assert.ok(entry.inferenceSignals.includes("trust services criteria"));
		assert.ok(entry.inferenceSignals.includes("multi-tenant"));
	});
});

describe("cloud-saas overlay — profile", () => {
	it("loads and parses the overlay profile", () => {
		const overlay = loadOverlay(pkgRoot, "cloud-saas");
		assert.ok(overlay, "loadOverlay must return the cloud-saas overlay");
		assert.strictEqual(overlay!.id, "cloud-saas");
	});

	it("declares 5 required PRD sections including TSC mapping", () => {
		const overlay = loadOverlay(pkgRoot, "cloud-saas")!;
		assert.strictEqual(overlay.requiredSections.prd.length, 5);
		assert.ok(overlay.requiredSections.prd.some((s) => s.includes("Trust Services Criteria")));
		assert.ok(overlay.requiredSections.prd.some((s) => s.includes("Data Classification")));
		assert.ok(overlay.requiredSections.prd.some((s) => s.includes("Multi-Tenancy")));
	});

	it("declares 5 required design sections including multi-tenancy", () => {
		const overlay = loadOverlay(pkgRoot, "cloud-saas")!;
		assert.strictEqual(overlay.requiredSections.design.length, 5);
		assert.ok(overlay.requiredSections.design.some((s) => s.includes("Multi-Tenancy")));
		assert.ok(overlay.requiredSections.design.some((s) => s.includes("Identity and Access Management")));
		assert.ok(overlay.requiredSections.design.some((s) => s.includes("Availability and Disaster Recovery")));
	});

	it("declares 5 required testplan sections", () => {
		const overlay = loadOverlay(pkgRoot, "cloud-saas")!;
		assert.strictEqual(overlay.requiredSections.testplan.length, 5);
		assert.ok(overlay.requiredSections.testplan.some((s) => s.includes("SOC 2 Control Tests")));
		assert.ok(overlay.requiredSections.testplan.some((s) => s.includes("Availability Tests")));
		assert.ok(overlay.requiredSections.testplan.some((s) => s.includes("Backup and Recovery")));
	});

	it("declares the design-trust-analyzer extra scout", () => {
		const overlay = loadOverlay(pkgRoot, "cloud-saas")!;
		assert.strictEqual(overlay.extraScouts.length, 1);
		const scout = overlay.extraScouts[0]!;
		assert.strictEqual(scout.role, "overlay-design-trust-analyzer");
		assert.ok(scout.reportPathTemplate.includes("design-trust-analyzer-report.json"));
	});

	it("declares 8 doctor checks", () => {
		const overlay = loadOverlay(pkgRoot, "cloud-saas")!;
		assert.strictEqual(overlay.doctorChecks.length, 8);
		assert.ok(overlay.doctorChecks.some((c) => c.includes("Trust Services Criteria") || c.includes("TSC")));
		assert.ok(overlay.doctorChecks.some((c) => c.includes("tenant-isolation") || c.includes("tenant isolation")));
	});
});

describe("cloud-saas overlay — mergeOverlay", () => {
	it("appends overlay sections to a design template", () => {
		const overlay = loadOverlay(pkgRoot, "cloud-saas")!;
		const merged = mergeOverlay("design", "# Existing design\n\n## Module Breakdown\n\n## Change Log\n", overlay);
		assert.ok(merged.includes("## Module Breakdown"));
		assert.ok(merged.includes("## Multi-Tenancy Architecture"));
		assert.ok(merged.includes("## Identity and Access Management"));
	});
});
