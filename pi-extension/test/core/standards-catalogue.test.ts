/**
 * standards-catalogue.ts tests (Phase 3).
 *
 * Covers:
 *   - load valid catalogue
 *   - load missing catalogue returns null
 *   - load malformed catalogue returns null
 *   - load catalogue with one invalid overlay returns null
 *   - findOverlay by id
 *   - listOverlayIds
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCatalogue, findOverlay, listOverlayIds, cataloguePath } from "../../src/core/standards-catalogue.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-catalogue-"));
	mkdirSync(join(tmpDir, "skills", "standards"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function writeCatalogue(json: unknown): void {
	writeFileSync(cataloguePath(tmpDir), JSON.stringify(json), "utf8");
}

function validCatalogue(): unknown {
	return {
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
				inferenceSignals: ["fda", "iec 62304"],
			},
		],
	};
}

describe("loadCatalogue — happy path", () => {
	it("returns a parsed catalogue", () => {
		writeCatalogue(validCatalogue());
		const cat = loadCatalogue(tmpDir);
		assert.ok(cat);
		assert.strictEqual(cat?.version, "1.0.0");
		assert.strictEqual(cat?.overlays.length, 2);
	});
});

describe("loadCatalogue — failure cases", () => {
	it("returns null when the file is missing", () => {
		assert.strictEqual(loadCatalogue(tmpDir), null);
	});

	it("returns null when the JSON is malformed", () => {
		writeFileSync(cataloguePath(tmpDir), "{not-json", "utf8");
		assert.strictEqual(loadCatalogue(tmpDir), null);
	});

	it("returns null when overlays is not an array", () => {
		writeCatalogue({ version: "1.0.0", overlays: "nope" });
		assert.strictEqual(loadCatalogue(tmpDir), null);
	});

	it("returns null when an overlay id is missing", () => {
		writeCatalogue({
			version: "1.0.0",
			overlays: [{ version: "1.0.0", label: "x", standards: [], scopes: [], inferenceSignals: [] }],
		});
		assert.strictEqual(loadCatalogue(tmpDir), null);
	});

	it("returns null when an overlay's standards is not all strings", () => {
		writeCatalogue({
			version: "1.0.0",
			overlays: [
				{
					id: "x",
					version: "1.0.0",
					label: "x",
					standards: ["RFC 2119", 42],
					scopes: [],
					inferenceSignals: [],
				},
			],
		});
		assert.strictEqual(loadCatalogue(tmpDir), null);
	});
});

describe("findOverlay", () => {
	it("returns the overlay matching the id", () => {
		writeCatalogue(validCatalogue());
		const cat = loadCatalogue(tmpDir);
		assert.ok(cat);
		const overlay = findOverlay(cat, "medical-device-b");
		assert.ok(overlay);
		assert.strictEqual(overlay.id, "medical-device-b");
		assert.deepEqual(overlay.standards, ["IEC 62304", "ISO 14971"]);
	});

	it("returns null when the id is not in the catalogue", () => {
		writeCatalogue(validCatalogue());
		const cat = loadCatalogue(tmpDir);
		assert.ok(cat);
		assert.strictEqual(findOverlay(cat, "does-not-exist"), null);
	});
});

describe("listOverlayIds", () => {
	it("returns every overlay id", () => {
		writeCatalogue(validCatalogue());
		const cat = loadCatalogue(tmpDir);
		assert.ok(cat);
		assert.deepEqual(listOverlayIds(cat), ["none", "medical-device-b"]);
	});

	it("returns an empty array when the catalogue is null", () => {
		assert.deepEqual(listOverlayIds(null), []);
	});
});
