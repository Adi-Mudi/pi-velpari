/**
 * overlay-authoring tests (Phase 5).
 *
 * Covers the end-to-end community overlay creation flow:
 *   - copy `_template` → adjust → register in catalogue → use end-to-end
 *   - validate profile.json after authoring
 *   - the resulting overlay is loadable
 *   - extraScouts enumerate correctly
 *   - doctorChecks surface via check-registry
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
	copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCatalogue } from "../../src/core/standards-catalogue.js";
import {
	loadOverlay,
	overlayDir,
} from "../../src/core/standards-overlay.js";
import { loadOverlayChecks } from "../../src/doctor/check-registry.js";
import { bootstrapOverlayScouts } from "../../src/io/agents-install.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-overlay-author-"));
	mkdirSync(join(tmpDir, "skills", "standards"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function seedTemplate(): void {
	// Simulate the bundled `_template/` folder by writing the same shape in
	// the project workspace (template itself is read-only in the package).
	const templateDir = join(tmpDir, "skills", "standards", "overlays", "_template");
	mkdirSync(templateDir, { recursive: true });
	writeFileSync(
		join(templateDir, "profile.template.json"),
		JSON.stringify(
			{
				id: "<your-id>",
				version: "1.0.0",
				label: "<label>",
				standards: [],
				scopes: [],
				inferenceSignals: [],
				requiredSections: { prd: [], design: [], testplan: [] },
				extraScouts: [],
				doctorChecks: [],
			},
			null,
			2,
		),
		"utf8",
	);
}

function copyTemplateToOverlay(overlayId: string): string {
	const overlayDirPath = join(tmpDir, "skills", "standards", "overlays", overlayId);
	mkdirSync(overlayDirPath, { recursive: true });
	copyFileSync(
		join(tmpDir, "skills", "standards", "overlays", "_template", "profile.template.json"),
		join(overlayDirPath, "profile.json"),
	);
	return overlayDirPath;
}

function registerInCatalogue(overlayId: string, label: string): void {
	const cataloguePath = join(tmpDir, "skills", "standards", "catalogue.json");
	writeFileSync(
		cataloguePath,
		JSON.stringify({
			version: "1.0.0",
			overlays: [
				{
					id: overlayId,
					version: "1.0.0",
					label,
					standards: ["IEC 62304"],
					scopes: ["medical-device"],
					inferenceSignals: ["fda"],
				},
			],
		}),
		"utf8",
	);
}

function customizeOverlayProfile(
	overlayId: string,
	patch: Record<string, unknown>,
): void {
	const profilePath = join(overlayDir(tmpDir, overlayId), "profile.json");
	const raw = JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, unknown>;
	const merged = { ...raw, ...patch };
	writeFileSync(profilePath, JSON.stringify(merged, null, 2), "utf8");
}

describe("overlay authoring — end-to-end", () => {
	it("copy template → adjust → register → load → use", () => {
		// 1. Seed template
		seedTemplate();

		// 2. Author copies template to a new overlay folder
		const overlayId = "medical-device-b";
		copyTemplateToOverlay(overlayId);

		// 3. Author customizes the profile
		customizeOverlayProfile(overlayId, {
			id: overlayId,
			label: "Medical Device Class B",
			standards: ["IEC 62304:2006", "ISO 14971:2019"],
			requiredSections: {
				prd: ["## Software Safety Classification"],
				design: ["## Software Architectural Design (IEC 62304 §5.3)"],
				testplan: ["## Verification per IEC 62304 §5.7"],
			},
			extraScouts: [
				{
					role: "overlay-design-safety-analyzer",
					description: "Maps design decisions to safety class A/B/C",
					reportPathTemplate: "<scoutReportDir>/safety-analyzer.json",
				},
			],
			doctorChecks: [
				"Every FR has a Software Safety Classification (A/B/C).",
				"Every risk control measure traces to a design decision.",
			],
		});

		// 4. Register in catalogue
		registerInCatalogue(overlayId, "Medical Device Class B");

		// 5. Loadable from catalogue
		const catalogue = loadCatalogue(tmpDir);
		assert.ok(catalogue);
		assert.strictEqual(catalogue?.overlays.length, 1);

		// 6. Loadable as full overlay
		const overlay = loadOverlay(tmpDir, overlayId);
		assert.ok(overlay);
		assert.strictEqual(overlay?.id, overlayId);
		assert.deepEqual(overlay?.standards, ["IEC 62304:2006", "ISO 14971:2019"]);
		assert.strictEqual(overlay?.extraScouts.length, 1);
		assert.strictEqual(overlay?.extraScouts[0]?.role, "overlay-design-safety-analyzer");
		assert.strictEqual(overlay?.doctorChecks.length, 2);

		// 7. doctor registry surfaces the checks
		const checks = loadOverlayChecks(tmpDir, overlayId);
		assert.strictEqual(checks.length, 2);
		assert.match(checks[0] ?? "", /Safety Classification/);
		assert.match(checks[1] ?? "", /risk control/);
	});
});

describe("overlay authoring — bootstrapOverlayScouts", () => {
	it("copies overlay scout files into .pi/agents/ and reports the result", () => {
		// Seed an overlay with one scout file
		const overlayId = "medical-device-b";
		const overlayScoutsDir = join(
			tmpDir,
			"skills",
			"standards",
			"overlays",
			overlayId,
			"scouts",
		);
		mkdirSync(overlayScoutsDir, { recursive: true });
		writeFileSync(
			join(overlayScoutsDir, "overlay-design-safety-analyzer.md"),
			"---\nname: overlay-design-safety-analyzer\ndescription: Safety mapper\n---\n",
			"utf8",
		);

		// Run the bootstrap helper
		const result = bootstrapOverlayScouts(
			overlayId,
			["overlay-design-safety-analyzer"],
			tmpDir,
		);

		assert.deepEqual(result.installed, ["overlay-design-safety-analyzer"]);
		assert.deepEqual(result.alreadyPresent, []);
		assert.deepEqual(result.missing, []);
	});

	it("reports already-present scouts without re-copying", () => {
		const overlayId = "medical-device-b";
		const agentsDir = join(tmpDir, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "overlay-design-safety-analyzer.md"),
			"# pre-existing",
			"utf8",
		);

		const result = bootstrapOverlayScouts(
			overlayId,
			["overlay-design-safety-analyzer"],
			tmpDir,
		);

		assert.deepEqual(result.installed, []);
		assert.deepEqual(result.alreadyPresent, ["overlay-design-safety-analyzer"]);
	});

	it("reports missing scout files gracefully (no throw)", () => {
		const result = bootstrapOverlayScouts(
			"no-such-overlay",
			["overlay-ghost-scout"],
			tmpDir,
		);

		assert.deepEqual(result.installed, []);
		assert.deepEqual(result.alreadyPresent, []);
		assert.deepEqual(result.missing, ["overlay-ghost-scout"]);
	});
});
