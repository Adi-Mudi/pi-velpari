/**
 * scan-options tests (v2.1 lifecycle upgrade).
 *
 * Covers:
 *   - getAvailableScanTypes with full config (code + doc both configured
 *     and exist on disk) → both available
 *   - getAvailableScanTypes with no codePaths → code unavailable, reason set
 *   - getAvailableScanTypes with codePaths but dir missing → code unavailable
 *   - getAvailableScanTypes with no inputDocuments → doc unavailable
 *   - Community is always available (no filesystem dependency)
 *   - availableScanList orders code → doc → community
 *   - isScanAvailable works for each scan type
 *   - Doc-only project (inputDocuments only) → only doc + community available
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	availableScanList,
	getAvailableScanTypes,
	isScanAvailable,
	type AvailableScans,
} from "../../src/core/scan-options.js";
import type { FilesConfig } from "../../src/core/config.js";

function baseConfig(): FilesConfig {
	return {
		version: 4,
		projectName: "TestApp",
		framework: {},
		codePaths: [],
		inputDocuments: [],
		testPaths: [],
		outputPaths: {},
		excludedPaths: [],
	};
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-scan-options-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("getAvailableScanTypes", () => {
	it("both code and doc available when config + disk match", () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};
		const available = getAvailableScanTypes(config, tmpDir);
		assert.equal(available.code, true);
		assert.equal(available.doc, true);
		assert.equal(available.community, true);
		assert.equal(available.reasons.code, undefined);
		assert.equal(available.reasons.doc, undefined);
	});

	it("code unavailable when no codePaths configured", () => {
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			inputDocuments: ["Doc"],
		};
		const available = getAvailableScanTypes(config, tmpDir);
		assert.equal(available.code, false);
		assert.equal(available.doc, true);
		assert.match(available.reasons.code ?? "", /no codePaths configured/);
	});

	it("code unavailable when codePaths configured but directory does not exist on disk", () => {
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["missing-dir"],
		};
		const available = getAvailableScanTypes(config, tmpDir);
		assert.equal(available.code, false);
		assert.match(available.reasons.code ?? "", /no configured codePath exists/);
	});

	it("doc unavailable when no inputDocuments configured", () => {
		mkdirSync(join(tmpDir, "src"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
		};
		const available = getAvailableScanTypes(config, tmpDir);
		assert.equal(available.doc, false);
		assert.equal(available.code, true);
		assert.match(available.reasons.doc ?? "", /no inputDocuments configured/);
	});

	it("doc unavailable when inputDocuments configured but path missing on disk", () => {
		const config: FilesConfig = {
			...baseConfig(),
			inputDocuments: ["Doc/missing"],
		};
		const available = getAvailableScanTypes(config, tmpDir);
		assert.equal(available.doc, false);
		assert.match(available.reasons.doc ?? "", /no configured inputDocument path exists/);
	});

	it("community is always available regardless of filesystem", () => {
		const config = baseConfig();
		const available = getAvailableScanTypes(config, tmpDir);
		assert.equal(available.community, true);
	});

	it("DOC-ONLY project: only doc + community available", () => {
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			inputDocuments: ["Doc"],
		};
		const available = getAvailableScanTypes(config, tmpDir);
		assert.equal(available.code, false, "code must be off");
		assert.equal(available.doc, true, "doc must be on");
		assert.equal(available.community, true, "community must be on");
	});

	it("CODE-ONLY project: only code + community available", () => {
		mkdirSync(join(tmpDir, "src"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
		};
		const available = getAvailableScanTypes(config, tmpDir);
		assert.equal(available.code, true);
		assert.equal(available.doc, false, "doc must be off");
		assert.equal(available.community, true);
	});

	it("EMPTY project: only community available", () => {
		const available = getAvailableScanTypes(baseConfig(), tmpDir);
		assert.equal(available.code, false);
		assert.equal(available.doc, false);
		assert.equal(available.community, true);
	});

	it("returns reasons for both unavailable scans when empty project", () => {
		const available = getAvailableScanTypes(baseConfig(), tmpDir);
		assert.ok(available.reasons.code);
		assert.ok(available.reasons.doc);
	});
});

describe("availableScanList", () => {
	it("orders code → doc → community", () => {
		const available: AvailableScans = {
			code: true,
			doc: true,
			community: true,
			reasons: {},
		};
		assert.deepEqual(availableScanList(available), ["code", "doc", "community"]);
	});

	it("omits unavailable scans in the same order", () => {
		const available: AvailableScans = {
			code: false,
			doc: true,
			community: true,
			reasons: {},
		};
		assert.deepEqual(availableScanList(available), ["doc", "community"]);
	});

	it("returns only community when project is empty", () => {
		const available: AvailableScans = {
			code: false,
			doc: false,
			community: true,
			reasons: {},
		};
		assert.deepEqual(availableScanList(available), ["community"]);
	});

	it("returns [] when community is off (future-proof — currently unreachable)", () => {
		const available: AvailableScans = {
			code: false,
			doc: false,
			community: false,
			reasons: {},
		};
		assert.deepEqual(availableScanList(available), []);
	});
});

describe("isScanAvailable", () => {
	const available: AvailableScans = {
		code: true,
		doc: false,
		community: true,
		reasons: { doc: "no inputDocuments configured" },
	};

	it("returns true for an available scan", () => {
		assert.equal(isScanAvailable("code", available), true);
		assert.equal(isScanAvailable("community", available), true);
	});

	it("returns false for an unavailable scan", () => {
		assert.equal(isScanAvailable("doc", available), false);
	});

	it("returns false for an unknown scan type (defensive)", () => {
		// Cast to ScanType for the test
		assert.equal(isScanAvailable("bogus" as never, available), false);
	});
});