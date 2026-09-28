/**
 * core/project-type.ts tests — N26 contract accessor.
 * Covers the user decision (2026-09-28): top-level `projectType` first,
 * then `velpari.projectType`, default "backend", never redefine the key.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DEFAULT_PROJECT_TYPE,
	keepWireframeForProjectType,
	projectTypeForCwd,
	projectTypeOf,
	wireframePairingMissingMessage,
} from "../../src/core/project-type.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-project-type-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Write a files.json fixture under <dir>/.pi/velpari/. */
function writeConfig(config: Record<string, unknown>): void {
	mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(dir, ".pi", "velpari", "files.json"), JSON.stringify(config, null, 2), "utf8");
}

describe("projectTypeOf — dual-location read", () => {
	test("(a) empty config → backend default", () => {
		assert.equal(projectTypeOf({}), "backend");
	});

	test("null / non-object config → backend default (never throws)", () => {
		assert.equal(projectTypeOf(null), "backend");
		assert.equal(projectTypeOf(undefined), "backend");
		assert.equal(projectTypeOf("full-app"), "backend");
	});

	test("(b) top-level projectType: full-app → full-app", () => {
		assert.equal(projectTypeOf({ projectType: "full-app" }), "full-app");
	});

	test("(b') top-level projectType: backend → backend", () => {
		assert.equal(projectTypeOf({ projectType: "backend" }), "backend");
	});

	test("(c) only nested velpari.projectType → used", () => {
		assert.equal(projectTypeOf({ velpari: { projectType: "full-app" } }), "full-app");
	});

	test("(d) both set → TOP-LEVEL wins", () => {
		assert.equal(projectTypeOf({ projectType: "backend", velpari: { projectType: "full-app" } }), "backend");
		assert.equal(projectTypeOf({ projectType: "full-app", velpari: { projectType: "backend" } }), "full-app");
	});

	test("velpari block without projectType → backend default", () => {
		assert.equal(projectTypeOf({ velpari: { markdownWrites: true } }), "backend");
	});

	test("(e) invalid value throws, naming the legal values", () => {
		assert.throws(() => projectTypeOf({ projectType: "weird" }), /"backend" \| "full-app"/);
		assert.throws(() => projectTypeOf({ projectType: "weird" }), /weird/);
		assert.throws(() => projectTypeOf({ velpari: { projectType: "desktop" } }), /velpari\.projectType/);
	});
});

describe("projectTypeForCwd — files.json fixtures", () => {
	test("(f) missing files.json → backend", () => {
		assert.equal(projectTypeForCwd(dir), "backend");
	});

	test("(f) top-level key in files.json → respected", () => {
		writeConfig({ version: 4, projectName: "TodoApp", projectType: "full-app" });
		assert.equal(projectTypeForCwd(dir), "full-app");
	});

	test("(f) nested key in files.json → respected", () => {
		writeConfig({ version: 4, projectName: "TodoApp", velpari: { projectType: "full-app" } });
		assert.equal(projectTypeForCwd(dir), "full-app");
	});

	test("invalid value in files.json throws at read time", () => {
		writeConfig({ version: 4, projectName: "TodoApp", projectType: "serverless" });
		assert.throws(() => projectTypeForCwd(dir), /projectType is invalid/);
	});
});

describe("keepWireframeForProjectType — prompt filter", () => {
	const wireframe = "/tmp/run/design/wireframe_TodoApp.md";
	const design = "/tmp/run/design/design_TodoApp.md";

	test("backend drops wireframe paths, keeps everything else", () => {
		assert.deepEqual(keepWireframeForProjectType([design, wireframe], "backend"), [design]);
		assert.deepEqual(keepWireframeForProjectType([wireframe], "backend"), []);
	});

	test("full-app keeps every path", () => {
		assert.deepEqual(keepWireframeForProjectType([design, wireframe], "full-app"), [design, wireframe]);
	});

	test("empty array passes through for both types", () => {
		assert.deepEqual(keepWireframeForProjectType([], "backend"), []);
		assert.deepEqual(keepWireframeForProjectType([], "full-app"), []);
	});
});

describe("wireframePairingMissingMessage", () => {
	test("names the expected path and the skill section (self-healing)", () => {
		const msg = wireframePairingMissingMessage("/x/.IDE_Plans/velpari/runs/r1/design/wireframe_TodoApp.md");
		assert.ok(msg.includes("/x/.IDE_Plans/velpari/runs/r1/design/wireframe_TodoApp.md"));
		assert.ok(msg.includes("velpari-architecture-generator.md"));
		assert.ok(msg.includes("full-app"));
	});
});

describe("defaults", () => {
	test("default project type is backend", () => {
		assert.equal(DEFAULT_PROJECT_TYPE, "backend");
	});
});
