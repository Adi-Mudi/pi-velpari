/**
 * medical-device-b overlay integration test (Phase 6, plan §Phase 6).
 *
 * Verifies the bundled overlay is wired correctly end-to-end:
 *   - profile.json is parseable and validates
 *   - catalogue lists the overlay
 *   - extraScouts enumerate correctly with overlay-* prefix
 *   - doctorChecks load from check-overlay.md (preferred) and from the
 *     inline list (fallback)
 *   - the design safety analyzer scout markdown has valid frontmatter
 *   - section templates exist and contain the required headings
 *
 * This is a unit-level integration test, not a full Pi-RPC e2e test
 * (the latter would require a real `pi` on PATH; the existing
 * test/e2e/README.md documents the full e2e harness if needed).
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageRoot } from "../../src/core/paths.js";
import { loadCatalogue, findOverlay } from "../../src/core/standards-catalogue.js";
import { loadOverlay, overlayDir } from "../../src/core/standards-overlay.js";
import { loadOverlayChecks } from "../../src/doctor/check-registry.js";
import { isOverlayRole, resolveOverlayAgentName } from "../../src/core/agents-config.js";

let pkgRoot: string;
let cwd: string;

before(() => {
	pkgRoot = findPackageRoot(process.cwd());
	cwd = pkgRoot;
});

after(() => {
	// No-op (no temp dirs to clean up).
});

describe("medical-device-b overlay — bundled artefacts present", () => {
	it("profile.json, sections, scout, doctor check all exist on disk", () => {
		const overlayPath = overlayDir(cwd, "medical-device-b");
		assert.ok(existsSync(join(overlayPath, "profile.json")), "profile.json exists");
		assert.ok(existsSync(join(overlayPath, "sections", "prd-extra.md")), "prd-extra.md exists");
		assert.ok(existsSync(join(overlayPath, "sections", "design-extra.md")), "design-extra.md exists");
		assert.ok(existsSync(join(overlayPath, "sections", "testplan-extra.md")), "testplan-extra.md exists");
		assert.ok(existsSync(join(overlayPath, "scouts", "design-safety-analyzer.md")), "design-safety-analyzer.md exists");
		assert.ok(existsSync(join(overlayPath, "doctor", "check-overlay.md")), "check-overlay.md exists");
		assert.ok(existsSync(join(overlayPath, "NOTES.md")), "NOTES.md exists");
	});
});

describe("medical-device-b overlay — catalogue registration", () => {
	it("is listed in the bundled catalogue", () => {
		const catalogue = loadCatalogue(cwd);
		assert.ok(catalogue);
		const entry = findOverlay(catalogue!, "medical-device-b");
		assert.ok(entry);
		assert.strictEqual(entry!.id, "medical-device-b");
		assert.deepEqual(entry!.standards, ["IEC 62304:2006", "ISO 14971:2019", "ISO 13485:2016"]);
	});
});

describe("medical-device-b overlay — profile validation", () => {
	it("loads the full profile via loadOverlay", () => {
		const overlay = loadOverlay(cwd, "medical-device-b");
		assert.ok(overlay);
		assert.strictEqual(overlay!.id, "medical-device-b");
		assert.strictEqual(overlay!.version, "1.0.0");
		assert.strictEqual(overlay!.requiredSections.prd.length, 5);
		assert.strictEqual(overlay!.requiredSections.design.length, 4);
		assert.strictEqual(overlay!.requiredSections.testplan.length, 6);
		assert.strictEqual(overlay!.extraScouts.length, 1);
		assert.strictEqual(overlay!.doctorChecks.length, 10);
	});

	it("uses the overlay- prefix for the safety analyzer scout", () => {
		const overlay = loadOverlay(cwd, "medical-device-b");
		assert.ok(overlay);
		const scout = overlay!.extraScouts[0];
		assert.ok(scout);
		assert.strictEqual(scout!.role, "overlay-design-safety-analyzer");
		assert.strictEqual(scout!.reportPathTemplate, "<scoutReportDir>/design-safety-analyzer-report.json");
		assert.ok(isOverlayRole(scout!.role));
		assert.strictEqual(resolveOverlayAgentName(scout!.role), "overlay-design-safety-analyzer");
	});
});

describe("medical-device-b overlay — required sections contain IEC 62304 anchors", () => {
	it("prd-extra.md contains all 5 mandatory headings", () => {
		const content = readFileSync(join(overlayDir(cwd, "medical-device-b"), "sections", "prd-extra.md"), "utf8");
		assert.match(content, /## Software Development Plan/);
		assert.match(content, /## Software Safety Classification/);
		assert.match(content, /## Risk Management Summary/);
		assert.match(content, /## SOUP Inventory/);
		assert.match(content, /## Acceptance Criteria — IEC 62304 Specific/);
	});

	it("design-extra.md contains all 4 mandatory headings", () => {
		const content = readFileSync(join(overlayDir(cwd, "medical-device-b"), "sections", "design-extra.md"), "utf8");
		assert.match(content, /## Software Architectural Design \(IEC 62304 §5\.3\)/);
		assert.match(content, /## Risk Control Measures/);
		assert.match(content, /## Software Detailed Design/);
		assert.match(content, /## SOUP Risk Control/);
	});

	it("testplan-extra.md contains all 6 mandatory headings", () => {
		const content = readFileSync(join(overlayDir(cwd, "medical-device-b"), "sections", "testplan-extra.md"), "utf8");
		assert.match(content, /## Verification per IEC 62304 §5\.7/);
		assert.match(content, /## Integration Test Coverage \(IEC 62304 §5\.6\)/);
		assert.match(content, /## System Test Coverage \(IEC 62304 §5\.7\)/);
		assert.match(content, /## Risk Control Verification/);
		assert.match(content, /## SOUP Verification/);
		assert.match(content, /## Acceptance Test Report \(IEC 62304 §5\.8\)/);
	});
});

describe("medical-device-b overlay — doctor checks", () => {
	it("loads all 10 rules from check-overlay.md", () => {
		const checks = loadOverlayChecks(cwd, "medical-device-b");
		assert.strictEqual(checks.length, 10);
		assert.match(checks[0] ?? "", /Safety Classification/);
		assert.match(checks[1] ?? "", /risk control measure/);
		assert.match(checks[2] ?? "", /hazard ID/);
	});

	it("includes the IEC 62304 §5.6 integration test coverage rule", () => {
		const checks = loadOverlayChecks(cwd, "medical-device-b");
		assert.ok(
			checks.some((c) => /Integration test coverage/.test(c) && /95%/.test(c)),
			"rule about 95% integration coverage is present",
		);
	});
});

describe("medical-device-b overlay — scout markdown frontmatter", () => {
	it("design-safety-analyzer.md has a valid frontmatter name + description", () => {
		const content = readFileSync(
			join(overlayDir(cwd, "medical-device-b"), "scouts", "design-safety-analyzer.md"),
			"utf8",
		);
		assert.match(content, /^---$/m, "opens with frontmatter");
		assert.match(content, /name: overlay-design-safety-analyzer/);
		assert.match(content, /description:.*IEC 62304.*safety class/m);
	});
});

describe("medical-device-b overlay — round-trip via mergeOverlay", () => {
	it("injects every PRD section heading into a base template", async () => {
		const { mergeOverlay } = await import("../../src/core/standards-overlay.js");
		const overlay = loadOverlay(cwd, "medical-device-b");
		assert.ok(overlay);
		const base = "# Design\n\n## Change Log\n";
		const merged = mergeOverlay("prd", base, overlay!);
		assert.match(merged, /## Software Development Plan/);
		assert.match(merged, /## Software Safety Classification/);
		assert.match(merged, /## Risk Management Summary/);
		assert.match(merged, /## SOUP Inventory/);
		assert.match(merged, /## Acceptance Criteria — IEC 62304 Specific/);
		assert.match(merged, /Applied overlay: medical-device-b@1\.0\.0/);
	});
});
