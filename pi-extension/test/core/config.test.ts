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

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_EXCLUDED_PATHS,
	loadFilesConfig,
	saveFilesConfig,
	validateFilesConfig,
	type FilesConfig,
} from "../../src/core/config.js";
import { getEffectiveProjectNames, isMultiProject } from "../../src/core/projectnames.js";
import { buildFilesConfig } from "../../src/ops/configure-inputs.js";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-config-"));
}

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
		assert.deepEqual(loadFilesConfig(cwd), VALID_V4);
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
