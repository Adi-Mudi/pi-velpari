/**
 * files.json config tests (v4 schema + v3→v4 migration).
 *
 * Covers:
 *   - v4 defaults when files.json is missing (fresh arrays, default excludes)
 *   - v3 → v4 migration on load (values kept, new arrays added,
 *     excludedPaths backfilled only when absent/empty)
 *   - validateFilesConfig accepts v4, rejects v3 and missing new arrays
 *   - save → load round-trip
 */

import { after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync as realMkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_EXCLUDED_PATHS,
	devLaneConfig,
	loadFilesConfig,
	retentionConfig,
	saveFilesConfig,
	validateFilesConfig,
	type FilesConfig,
} from "../../src/core/config.js";
import { getEffectiveProjectNames, isMultiProject } from "../../src/core/projectnames.js";
import { buildFilesConfig } from "../../src/ops/configure-inputs.js";

/** Temp dirs created in this file; removed at module teardown (I12.1 sweep). */
const tempDirs: string[] = [];

/**
 * Tracked mkdtempSync: creates a temp dir and registers it for teardown removal.
 * @param {string} prefix - Directory path/prefix passed to fs.mkdtempSync.
 * @returns {string} The created directory path.
 */
const mkdtempSync = (prefix: string): string => {
	const dir = realMkdtempSync(prefix);
	tempDirs.push(dir);
	return dir;
};

after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Create a fresh temp working directory for this test file.
 * @returns {string} Absolute path of the tracked temp dir.
 */
function tmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-config-"));
}

/**
 * Write a raw JSON value to files.json (bypassing saveFilesConfig).
 * @param {string} cwd - Project root to write into.
 * @param {unknown} value - JSON-serializable value to write.
 * @returns {void}
 */
function writeRaw(cwd: string, value: unknown): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "velpari", "files.json"), JSON.stringify(value), "utf8");
}

const VALID_V4: FilesConfig = {
	version: 4,
	projectName: "TestApp",
	framework: { language: "TypeScript", libraries: ["react"], runtime: "Node 20+" },
	codePaths: ["src/"],
	inputDocuments: ["Doc/PRD_TestApp.md"],
	testPaths: ["test/"],
	outputPaths: { prd: "Doc/requirements" },
	excludedPaths: ["node_modules/"],
};

describe("loadFilesConfig defaults", () => {
	it("returns v4 defaults when files.json is missing", () => {
		const cfg = loadFilesConfig(tmp());
		assert.equal(cfg.version, 4);
		assert.equal(cfg.projectName, "");
		assert.deepEqual(cfg.codePaths, []);
		assert.deepEqual(cfg.testPaths, []);
		assert.deepEqual(cfg.excludedPaths, [...DEFAULT_EXCLUDED_PATHS]);
	});

	it("does not share array references between calls", () => {
		const a = loadFilesConfig(tmp());
		a.codePaths.push("mutated/");
		const b = loadFilesConfig(tmp());
		assert.deepEqual(b.codePaths, []);
	});
});

describe("v3 → v4 migration", () => {
	const V3 = {
		version: 3,
		projectName: "OldApp",
		framework: { language: "Python" },
		inputDocuments: ["Doc/PRD_OldApp.md"],
		outputPaths: { prd: "Doc/requirements" },
		excludedPaths: ["custom-exclude/"],
	};

	it("keeps existing values and adds the new arrays", () => {
		const cwd = tmp();
		writeRaw(cwd, V3);
		const cfg = loadFilesConfig(cwd);
		assert.equal(cfg.version, 4);
		assert.equal(cfg.projectName, "OldApp");
		assert.equal(cfg.framework?.language, "Python");
		assert.deepEqual(cfg.inputDocuments, ["Doc/PRD_OldApp.md"]);
		assert.deepEqual(cfg.codePaths, []);
		assert.deepEqual(cfg.testPaths, []);
	});

	it("keeps a non-empty v3 excludedPaths", () => {
		const cwd = tmp();
		writeRaw(cwd, V3);
		assert.deepEqual(loadFilesConfig(cwd).excludedPaths, ["custom-exclude/"]);
	});

	it("backfills default excludes when v3 excludedPaths is empty", () => {
		const cwd = tmp();
		writeRaw(cwd, { ...V3, excludedPaths: [] });
		assert.deepEqual(loadFilesConfig(cwd).excludedPaths, [...DEFAULT_EXCLUDED_PATHS]);
	});
});

describe("validateFilesConfig", () => {
	it("accepts a full v4 config", () => {
		assert.ok(validateFilesConfig(VALID_V4));
	});

	it("rejects v3", () => {
		assert.equal(
			validateFilesConfig({
				version: 3,
				projectName: "OldApp",
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			} as unknown as Partial<FilesConfig>),
			false,
		);
	});

	it("rejects a v4 config missing codePaths or testPaths", () => {
		const { codePaths: _c, ...noCode } = VALID_V4;
		assert.equal(validateFilesConfig(noCode), false);
		const { testPaths: _t, ...noTest } = VALID_V4;
		assert.equal(validateFilesConfig(noTest), false);
	});

	it("v1.3.0+ accepts projectNames only (multi-design)", () => {
		const multi = { ...VALID_V4, projectName: "", projectNames: ["alpha", "beta"] };
		assert.ok(validateFilesConfig(multi));
	});

	it("v1.3.0+ rejects when both projectName and projectNames are set", () => {
		const both = { ...VALID_V4, projectNames: ["alpha", "beta"] };
		assert.equal(validateFilesConfig(both), false);
	});

	it("v1.3.0+ rejects when neither projectName nor projectNames is set", () => {
		const neither = { ...VALID_V4, projectName: "" };
		assert.equal(validateFilesConfig(neither), false);
	});
});

describe("getEffectiveProjectNames (v1.3.0+)", () => {
	it("returns the single projectName when only projectName is set", () => {
		assert.deepEqual(getEffectiveProjectNames(VALID_V4), ["TestApp"]);
	});

	it("returns projectNames when only projectNames is set", () => {
		assert.deepEqual(getEffectiveProjectNames({ ...VALID_V4, projectName: "", projectNames: ["alpha", "beta"] }), [
			"alpha",
			"beta",
		]);
	});

	it("de-duplicates projectNames while preserving order", () => {
		assert.deepEqual(getEffectiveProjectNames({ ...VALID_V4, projectName: "", projectNames: ["x", "x", "y", "x"] }), [
			"x",
			"y",
		]);
	});

	it("isMultiProject returns true for ≥ 2 names, false for 1", () => {
		assert.equal(isMultiProject(VALID_V4), false);
		assert.equal(isMultiProject({ ...VALID_V4, projectName: "", projectNames: ["a", "b"] }), true);
	});

	it("throws when both fields are set", () => {
		assert.throws(() => getEffectiveProjectNames({ ...VALID_V4, projectNames: ["x"] }), /sets both/);
	});

	it("throws when neither is set", () => {
		assert.throws(() => getEffectiveProjectNames({ ...VALID_V4, projectName: "" }), /must set either/);
	});
});

describe("saveFilesConfig", () => {
	it("round-trips through load", () => {
		const cwd = tmp();
		saveFilesConfig(VALID_V4, cwd);
		// loadFilesConfig merges defaultConfig() over the file, so defaulted
		// keys come back too. Phase 11 (§15.6) pins `velpari.markdownWrites`
		// OFF — publish writes DB only; write-alongside is the explicit
		// opt-IN rollback hatch.
		assert.deepEqual(loadFilesConfig(cwd), { ...VALID_V4, velpari: { markdownWrites: false } });
	});
});

describe("buildFilesConfig", () => {
	it("emits v4 and carries path fields forward from existing", () => {
		const out = buildFilesConfig(VALID_V4, {
			projectName: "NewName",
			language: "",
			libraries: [],
			runtime: "",
		});
		assert.equal(out.version, 4);
		assert.equal(out.projectName, "NewName");
		assert.equal(out.framework?.language, "TypeScript");
		assert.deepEqual(out.codePaths, ["src/"]);
		assert.deepEqual(out.testPaths, ["test/"]);
		assert.deepEqual(out.inputDocuments, ["Doc/PRD_TestApp.md"]);
		assert.deepEqual(out.excludedPaths, ["node_modules/"]);
	});

	it("v1.3.0+ multi-design: takes projectNames and clears projectName", () => {
		const out = buildFilesConfig(VALID_V4, {
			projectName: "",
			projectNames: ["alpha", "beta"],
			language: "",
			libraries: [],
			runtime: "",
		});
		assert.equal(out.projectName, "");
		assert.deepEqual(out.projectNames, ["alpha", "beta"]);
	});
});

/**
 * N7/N10 retention block (Foundation 2026-09-27): defaults when absent,
 * "all" or positive-int revisions, positive-int backups; malformed values
 * throw (a typo must surface, not silently default).
 */
describe("retentionConfig (N7/N10)", () => {
	it("defaults when files.json is missing", () => {
		assert.deepEqual(retentionConfig(tmp()), { revisions: "all", backups: 10 });
	});

	it("defaults when the velpari block has no retention key", () => {
		const cwd = tmp();
		writeRaw(cwd, { ...VALID_V4, velpari: { markdownWrites: true } });
		assert.deepEqual(retentionConfig(cwd), { revisions: "all", backups: 10 });
	});

	it("accepts 'all' and positive integers", () => {
		const cwd = tmp();
		writeRaw(cwd, { ...VALID_V4, velpari: { retention: { revisions: "all", backups: 5 } } });
		assert.deepEqual(retentionConfig(cwd), { revisions: "all", backups: 5 });
		const cwd2 = tmp();
		writeRaw(cwd2, { ...VALID_V4, velpari: { retention: { revisions: 10 } } });
		assert.deepEqual(retentionConfig(cwd2), { revisions: 10, backups: 10 }, "backups defaults to 10 when omitted");
	});

	it("rejects 0 / negative / wrong types", () => {
		for (const bad of [
			{ revisions: 0 },
			{ revisions: -3 },
			{ revisions: "everything" },
			{ backups: 0 },
			{ backups: -1 },
			{ backups: "ten" },
		]) {
			const cwd = tmp();
			writeRaw(cwd, { ...VALID_V4, velpari: { retention: bad } });
			assert.throws(() => retentionConfig(cwd), /retention is invalid/, JSON.stringify(bad));
		}
	});
});

/**
 * Phase 7 / N16 — `velpari.maxLanes` lane cap. Same contract as retention:
 * default when absent, round-trip an override, throw on a malformed value
 * (a typo'd cap must surface, not silently default).
 */
describe("devLaneConfig (Phase 7 / N16)", () => {
	it("defaults to 4 when files.json is missing", () => {
		assert.deepEqual(devLaneConfig(tmp()), { maxLanes: 4 });
	});

	it("defaults to 4 when the velpari block has no maxLanes key", () => {
		const cwd = tmp();
		writeRaw(cwd, { ...VALID_V4, velpari: { markdownWrites: true } });
		assert.deepEqual(devLaneConfig(cwd), { maxLanes: 4 });
	});

	it("round-trips a positive-integer override", () => {
		for (const maxLanes of [1, 2, 8]) {
			const cwd = tmp();
			writeRaw(cwd, { ...VALID_V4, velpari: { maxLanes } });
			assert.deepEqual(devLaneConfig(cwd), { maxLanes }, JSON.stringify(maxLanes));
		}
	});

	it("rejects 0 / negative / non-integer / wrong types", () => {
		for (const bad of [0, -1, 2.5, "eight", null]) {
			const cwd = tmp();
			writeRaw(cwd, { ...VALID_V4, velpari: { maxLanes: bad } });
			assert.throws(() => devLaneConfig(cwd), /maxLanes is invalid/, JSON.stringify(bad));
		}
	});
});
