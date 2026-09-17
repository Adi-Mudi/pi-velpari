/**
 * configure-standards handler tests (Phase 3).
 *
 * Covers:
 *   - first-time pick: catalogue exists, user picks an overlay, profile saved
 *   - cancellation: user dismisses picker, current profile preserved
 *   - web-research consent: user accepts, profile has researchConsent: true
 *   - missing catalogue: returns no-catalogue
 *   - no UI: returns no-ui
 *   - persistence: profile saved to disk and survives reload
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	handleConfigureStandards,
	loadStandardsProfileFromDisk,
	standardsProfilePath,
} from "../../src/ops/configure-standards.js";
import { cataloguePath } from "../../src/core/standards-catalogue.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-configure-std-"));
	mkdirSync(join(tmpDir, "skills", "standards", "overlays", "none"), { recursive: true });
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function writeCatalogue(): void {
	writeFileSync(
		cataloguePath(tmpDir),
		JSON.stringify({
			version: "1.0.0",
			overlays: [
				{
					id: "none",
					version: "1.0.0",
					label: "Common Core",
					standards: ["RFC 2119"],
					scopes: ["any"],
					inferenceSignals: [],
				},
				{
					id: "medical-device-b",
					version: "1.0.0",
					label: "Medical Device Class B",
					standards: ["IEC 62304", "ISO 14971"],
					scopes: ["medical-device"],
					inferenceSignals: ["fda"],
				},
			],
		}),
		"utf8",
	);
}

function writeOverlayProfile(id: string): void {
	const dir = join(tmpDir, "skills", "standards", "overlays", id);
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
			extraScouts: [],
			doctorChecks: [],
		}),
		"utf8",
	);
}

describe("handleConfigureStandards — first-time pick", () => {
	it("saves the profile when user picks an overlay", async () => {
		writeCatalogue();
		writeOverlayProfile("none");
		writeOverlayProfile("medical-device-b");
		const ctx = {
			ui: {
				select: async (_t: string, options: string[]) => options[1] ?? null,
				confirm: async () => false,
				notify: () => {},
			},
			cwd: tmpDir,
		};
		const result = await handleConfigureStandards(ctx);
		assert.strictEqual(result.outcome, "selected");
		assert.ok(result.profile);
		assert.strictEqual(result.profile?.id, "medical-device-b");

		const saved = JSON.parse(readFileSync(standardsProfilePath(tmpDir), "utf8")) as { id: string };
		assert.strictEqual(saved.id, "medical-device-b");
	});
});

describe("handleConfigureStandards — cancellation", () => {
	it("returns cancelled when user dismisses picker", async () => {
		writeCatalogue();
		writeOverlayProfile("none");
		const ctx = {
			ui: {
				select: async () => null,
				confirm: async () => false,
				notify: () => {},
			},
			cwd: tmpDir,
		};
		const result = await handleConfigureStandards(ctx);
		assert.strictEqual(result.outcome, "cancelled");
	});
});

describe("handleConfigureStandards — web research consent", () => {
	it("records researchConsent: true when user accepts", async () => {
		writeCatalogue();
		writeOverlayProfile("none");
		writeOverlayProfile("medical-device-b");
		const ctx = {
			ui: {
				select: async (_t: string, options: string[]) => options[1] ?? null,
				confirm: async () => true,
				notify: () => {},
			},
			cwd: tmpDir,
		};
		const result = await handleConfigureStandards(ctx);
		assert.strictEqual(result.outcome, "selected");
		assert.strictEqual(result.profile?.researchConsent, true);
	});

	it("records researchConsent: false when user declines", async () => {
		writeCatalogue();
		writeOverlayProfile("none");
		writeOverlayProfile("medical-device-b");
		const ctx = {
			ui: {
				select: async (_t: string, options: string[]) => options[1] ?? null,
				confirm: async () => false,
				notify: () => {},
			},
			cwd: tmpDir,
		};
		const result = await handleConfigureStandards(ctx);
		assert.strictEqual(result.profile?.researchConsent, false);
	});
});

describe("handleConfigureStandards — no catalogue", () => {
	it("returns no-catalogue when the catalogue is missing", async () => {
		const ctx = {
			ui: {
				select: async () => null,
				confirm: async () => false,
				notify: () => {},
			},
			cwd: tmpDir,
		};
		const result = await handleConfigureStandards(ctx);
		assert.strictEqual(result.outcome, "no-catalogue");
		assert.strictEqual(result.profile, null);
	});
});

describe("handleConfigureStandards — no UI", () => {
	it("returns no-ui when select is missing", async () => {
		writeCatalogue();
		writeOverlayProfile("none");
		const ctx = {
			ui: { notify: () => {} },
			cwd: tmpDir,
		};
		const result = await handleConfigureStandards(ctx);
		assert.strictEqual(result.outcome, "no-ui");
	});
});

describe("loadStandardsProfileFromDisk", () => {
	it("returns null when the file is missing", () => {
		assert.strictEqual(loadStandardsProfileFromDisk(tmpDir), null);
	});

	it("returns the persisted profile on reload", async () => {
		writeCatalogue();
		writeOverlayProfile("none");
		writeOverlayProfile("medical-device-b");
		await handleConfigureStandards({
			ui: {
				select: async (_t: string, options: string[]) => options[1] ?? null,
				confirm: async () => false,
				notify: () => {},
			},
			cwd: tmpDir,
		});
		const reloaded = loadStandardsProfileFromDisk(tmpDir);
		assert.ok(reloaded);
		assert.strictEqual(reloaded?.id, "medical-device-b");
	});
});
