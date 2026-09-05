import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadFilesConfig,
	saveFilesConfig,
	validateFilesConfig,
	runFilesDiscovery,
	type FilesConfig,
} from "../src/core/config.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-config-"));
}

test("loadFilesConfig returns defaults when file is missing", () => {
	const dir = tempDir();
	try {
		const config = loadFilesConfig(dir);
		assert.equal(config.version, 3);
		assert.equal(config.projectName, "");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("saveFilesConfig + loadFilesConfig round-trip", () => {
	const dir = tempDir();
	try {
		const config: FilesConfig = {
			version: 3,
			projectName: "TestApp",
			framework: { language: "TypeScript" },
			inputDocuments: ["doc/a.md"],
			outputPaths: { prd: "Doc/PRD_TestApp.md" },
			excludedPaths: ["node_modules"],
		};
		saveFilesConfig(config, dir);
		const loaded = loadFilesConfig(dir);
		assert.equal(loaded.projectName, "TestApp");
		assert.equal(loaded.framework?.language, "TypeScript");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("validateFilesConfig accepts a valid config", () => {
	const ok: FilesConfig = {
		version: 3,
		projectName: "X",
		inputDocuments: [],
		outputPaths: {},
		excludedPaths: [],
	};
	assert.ok(validateFilesConfig(ok));
});

test("validateFilesConfig rejects wrong version", () => {
	assert.equal(
		validateFilesConfig({ version: 2 as unknown as 3, projectName: "X" }),
		false,
	);
});

test("validateFilesConfig rejects missing projectName", () => {
	assert.equal(validateFilesConfig({ version: 3 }), false);
});

test("runFilesDiscovery returns an array (Phase A stub)", () => {
	const items = runFilesDiscovery();
	assert.ok(Array.isArray(items));
});
