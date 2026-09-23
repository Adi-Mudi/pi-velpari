/**
 * buildPathCategoryItems tests (configure-inputs path step).
 *
 * Asserts:
 *   - per-category suggestion mapping (folders first, then files)
 *   - current values map to ✅-selected rows
 *   - conflict filtering: suggestion equal to a current value is excluded,
 *     folder/file prefix overlap (either direction) is excluded, and a path
 *     already selected in another category is excluded via otherPaths
 *   - excludedPaths yields no suggestions
 *   - empty discovery yields only the current selections
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { FileDiscoveryResult } from "../../src/core/files-discovery.js";
import { buildPathCategoryItems } from "../../src/ops/configure-inputs.js";

function emptyDiscovery(): FileDiscoveryResult {
	return {
		codeFolders: [],
		codeFiles: [],
		documentFolders: [],
		documentFiles: [],
		testFolders: [],
		testFiles: [],
	};
}

function fullDiscovery(): FileDiscoveryResult {
	return {
		codeFolders: [{ path: "src/", reason: "common code folder" }],
		codeFiles: ["main.ts"],
		documentFolders: [{ path: "docs/", reason: "document folder" }],
		documentFiles: ["README.md"],
		testFolders: [{ path: "tests/", reason: "test folder" }],
		testFiles: ["main.test.ts"],
	};
}

describe("buildPathCategoryItems", () => {
	it("maps code discovery into suggestion rows (folders first, then files)", () => {
		const items = buildPathCategoryItems("codePaths", [], fullDiscovery());
		assert.deepEqual(
			items.map((i) => i.value),
			["src/", "main.ts"],
		);
		assert.equal(items[0]?.kind, "suggestion");
		assert.equal(items[0]?.id, "suggest:src/");
		assert.equal(items[0]?.label, "⬜ Suggest: src/");
		assert.equal(items[0]?.description, "common code folder");
		assert.equal(items[1]?.description, undefined);
	});

	it("maps document discovery for inputDocuments", () => {
		const items = buildPathCategoryItems("inputDocuments", [], fullDiscovery());
		assert.deepEqual(
			items.map((i) => i.value),
			["docs/", "README.md"],
		);
	});

	it("maps test discovery for testPaths", () => {
		const items = buildPathCategoryItems("testPaths", [], fullDiscovery());
		assert.deepEqual(
			items.map((i) => i.value),
			["tests/", "main.test.ts"],
		);
	});

	it("yields no suggestions for excludedPaths", () => {
		const items = buildPathCategoryItems("excludedPaths", [], fullDiscovery());
		assert.deepEqual(items, []);
	});

	it("maps current values into selected rows after the suggestions", () => {
		const items = buildPathCategoryItems("codePaths", ["custom/"], fullDiscovery());
		const selected = items.filter((i) => i.kind === "selected");
		assert.deepEqual(
			selected.map((i) => ({ id: i.id, label: i.label, value: i.value })),
			[{ id: "selected:custom/", label: "✅ Remove: custom/", value: "custom/" }],
		);
		// suggestions still come first
		assert.equal(items[0]?.kind, "suggestion");
	});

	it("excludes a suggestion equal to a current value", () => {
		const items = buildPathCategoryItems("codePaths", ["src/"], fullDiscovery());
		assert.ok(!items.some((i) => i.kind === "suggestion" && i.value === "src/"));
		assert.ok(items.some((i) => i.kind === "selected" && i.value === "src/"));
	});

	it("excludes a file suggestion under a currently selected folder", () => {
		const discovery = emptyDiscovery();
		discovery.codeFiles.push("src/helper.ts");
		const items = buildPathCategoryItems("codePaths", ["src/"], discovery);
		assert.deepEqual(
			items.filter((i) => i.kind === "suggestion"),
			[],
		);
	});

	it("excludes a folder suggestion that contains a currently selected file", () => {
		const discovery = emptyDiscovery();
		discovery.codeFolders.push({ path: "src/", reason: "common code folder" });
		const items = buildPathCategoryItems("codePaths", ["src/helper.ts"], discovery);
		assert.deepEqual(
			items.filter((i) => i.kind === "suggestion"),
			[],
		);
	});

	it("excludes a suggestion already selected in another category", () => {
		const items = buildPathCategoryItems("codePaths", [], fullDiscovery(), ["src/"]);
		assert.ok(!items.some((i) => i.value === "src/"));
		// non-conflicting suggestions remain
		assert.ok(items.some((i) => i.value === "main.ts"));
	});

	it("empty discovery yields only the current selections", () => {
		const items = buildPathCategoryItems("inputDocuments", ["notes.md"], emptyDiscovery());
		assert.deepEqual(
			items.map((i) => i.kind),
			["selected"],
		);
		assert.equal(items[0]?.value, "notes.md");
	});
});
