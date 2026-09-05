import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	runHandoff,
	validateSenaiSchema,
	readApprovedArtifacts,
	type ArchitectInputs,
} from "../src/discipline/handoff.js";
import { saveFilesConfig } from "../src/core/config.js";
import { createRun, clearRun, loadState, saveState } from "../src/core/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-handoff-"));
}

function makeUI(notifies: Array<{ msg: string; level: string }>, confirmResult = true) {
	return {
		notifies,
		async confirm(_t: string, _m: string) {
			return confirmResult;
		},
		notify(msg: string, level: string) {
			notifies.push({ msg, level });
		},
	};
}

/**
 * Set up a temp dir with all 7 required Doc/ artifacts present, plus
 * optionally the 2 optional ones.
 */
function setupProjectWithDocs(
	dir: string,
	projectName: string,
	includeOptional: { atomic?: boolean; development?: boolean } = {},
): void {
	mkdirSync(join(dir, "Doc"), { recursive: true });
	const required = [
		"PRD",
		"RTM",
		"feasibility-study",
		"design",
		"pseudocode",
		"test-plan",
		"test-cases",
	];
	for (const a of required) {
		writeFileSync(join(dir, "Doc", `${a}_${projectName}.md`), `# ${a}\n`, "utf8");
	}
	if (includeOptional.atomic) {
		writeFileSync(join(dir, "Doc", `atomic-functions_${projectName}.md`), "# Atomic\n", "utf8");
	}
	if (includeOptional.development) {
		writeFileSync(join(dir, "Doc", `development-order_${projectName}.md`), "# Order\n", "utf8");
	}
}

function patchStateTo(currentStage: string, dir: string): void {
	const state = loadState(dir);
	state.currentStage = currentStage as never;
	saveState(state, dir);
}

test("runHandoff errors when state is 'none'", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		const state = loadState(dir);
		await runHandoff(state, ctx, dir);
		const errored = notifies.some((n) => n.level === "error" && /no active run/i.test(n.msg));
		assert.ok(errored, "expected 'no active run' error");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runHandoff errors when state is 'discussing' (not at handoff stage)", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir); // sets state to 'discussing'
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		const state = loadState(dir);
		await runHandoff(state, ctx, dir);
		const errored = notifies.some(
			(n) => n.level === "error" && /Cannot handoff/i.test(n.msg),
		);
		assert.ok(errored, "expected 'cannot handoff' error");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runHandoff errors when a required Doc/ artifact is missing", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		patchStateTo("planned-tests", dir);
		// Only create PRD; missing 6 others
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "PRD_TestApp.md"), "# PRD\n", "utf8");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		const state = loadState(dir);
		await runHandoff(state, ctx, dir);
		const errored = notifies.some(
			(n) => n.level === "error" && /missing required/i.test(n.msg),
		);
		assert.ok(errored, "expected 'missing required artifacts' error");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runHandoff succeeds with all 7 required artifacts; produces valid JSON", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		patchStateTo("planned-tests", dir);
		setupProjectWithDocs(dir, "TestApp");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies, true) } as never;
		const state = loadState(dir);
		await runHandoff(state, ctx, dir);

		const targetPath = join(dir, ".pi", "senai", "architect-inputs.json");
		assert.ok(existsSync(targetPath), "architect-inputs.json not written");

		const raw = readFileSync(targetPath, "utf8");
		const parsed = JSON.parse(raw) as ArchitectInputs;
		assert.equal(parsed.version, 1);
		assert.equal(parsed.projectName, "TestApp");
		assert.equal(parsed.mission, "Mission");
		assert.equal(parsed.documents.length, 7, "expected 7 required docs");

		const types = parsed.documents.map((d) => d.type).sort();
		assert.deepEqual(types, [
			"Design",
			"Feasibility Study",
			"PRD",
			"Pseudocode",
			"RTM",
			"Test Cases",
			"Test Plan",
		]);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runHandoff includes optional artifacts when present", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		patchStateTo("ordered-development", dir);
		setupProjectWithDocs(dir, "TestApp", { atomic: true, development: true });

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies, true) } as never;
		const state = loadState(dir);
		await runHandoff(state, ctx, dir);

		const targetPath = join(dir, ".pi", "senai", "architect-inputs.json");
		const parsed = JSON.parse(readFileSync(targetPath, "utf8")) as ArchitectInputs;
		assert.equal(parsed.documents.length, 9, "expected 7 required + 2 optional = 9 docs");
		assert.ok(parsed.documents.some((d) => d.type === "Atomic Functions"));
		assert.ok(parsed.documents.some((d) => d.type === "Development Order"));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runHandoff skips optional artifacts when absent (no error)", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		patchStateTo("planned-tests", dir);
		setupProjectWithDocs(dir, "TestApp"); // no optional files

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies, true) } as never;
		const state = loadState(dir);
		await runHandoff(state, ctx, dir);

		const targetPath = join(dir, ".pi", "senai", "architect-inputs.json");
		const parsed = JSON.parse(readFileSync(targetPath, "utf8")) as ArchitectInputs;
		assert.equal(parsed.documents.length, 7, "no optional docs means 7 total");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runHandoff does NOT write when preview gate is declined", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		patchStateTo("planned-tests", dir);
		setupProjectWithDocs(dir, "TestApp");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies, false) } as never; // decline
		const state = loadState(dir);
		await runHandoff(state, ctx, dir);

		const targetPath = join(dir, ".pi", "senai", "architect-inputs.json");
		assert.ok(!existsSync(targetPath), "architect-inputs.json should not exist when declined");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("validateSenaiSchema accepts valid schema and rejects malformed", () => {
	const valid: ArchitectInputs = {
		version: 1,
		projectName: "TestApp",
		createdAt: "2026-09-03T00:00:00Z",
		mission: "test",
		documents: [{ type: "PRD", path: "Doc/PRD_TestApp.md" }],
	};
	assert.equal(validateSenaiSchema(valid), true);

	// Wrong version
	assert.throws(() => validateSenaiSchema({ ...valid, version: 2 }), /version/);
	// Empty projectName
	assert.throws(() => validateSenaiSchema({ ...valid, projectName: "" }), /projectName/);
	// documents not an array
	assert.throws(() => validateSenaiSchema({ ...valid, documents: "x" }), /documents/);
	// Document with empty path
	assert.throws(
		() => validateSenaiSchema({ ...valid, documents: [{ type: "PRD", path: "" }] }),
		/path/,
	);
});

test("readApprovedArtifacts returns the correct document types", () => {
	const dir = tempDir();
	try {
		setupProjectWithDocs(dir, "TestApp");
		const docs = readApprovedArtifacts("TestApp", dir);
		assert.equal(docs.length, 7);
		const types = docs.map((d) => d.type).sort();
		assert.deepEqual(types, [
			"Design",
			"Feasibility Study",
			"PRD",
			"Pseudocode",
			"RTM",
			"Test Cases",
			"Test Plan",
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
