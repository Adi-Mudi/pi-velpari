/**
 * Doctor registry integration tests (v1.2.2).
 *
 * Confirms that `runDoctor()` includes the ShapeCompatibility section
 * in its output. The check itself is unit-tested in
 * shape-compatibility.test.ts; this file focuses on the wiring.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runDoctor } from "../../src/doctor/index.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-shape-reg-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runDoctor includes ShapeCompatibility section", () => {
	it("includes the section even when no project name is set", () => {
		// No config, no project name — section should still appear with an
		// info item saying "Path: fresh (no prior designs published)."
		// (v1.3.0+ message — aggregated across projectNames, not
		// per-projectName).
		const report = runDoctor(tmpDir);
		const shape = report.sections.find((s) => s.title === "Shape compatibility");
		assert.ok(shape, "expected Shape compatibility section in runDoctor output");
		assert.equal(shape?.items.length, 1);
		assert.equal(shape?.items[0]?.status, "info");
		assert.match(shape?.items[0]?.message ?? "", /no prior designs/);
	});

	it("emits fresh info when no design is published", () => {
		fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: "TodoApp" }),
			"utf8",
		);
		const report = runDoctor(tmpDir);
		const shape = report.sections.find((s) => s.title === "Shape compatibility");
		assert.ok(shape);
		assert.equal(shape?.items[0]?.status, "info");
		assert.match(shape?.items[0]?.message ?? "", /Path: fresh/);
	});

	it("emits migration warning on a legacy-shape cwd (8 sections, v1.0.2)", () => {
		fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: "TodoApp" }),
			"utf8",
		);
		fs.mkdirSync(path.join(tmpDir, "Doc", "design"), { recursive: true });
		const md = "---\nversion: 1.0.2\n---\n\n" + Array.from({ length: 8 }, (_, i) => `## ${i}. S`).join("\n");
		fs.writeFileSync(path.join(tmpDir, "Doc", "design", "design_TodoApp.md"), md, "utf8");
		const report = runDoctor(tmpDir);
		const shape = report.sections.find((s) => s.title === "Shape compatibility");
		assert.ok(shape);
		assert.equal(shape?.items[0]?.status, "warning");
		assert.match(shape?.items[0]?.message ?? "", /Path: migration recommended/);
	});

	it("emits ok on a current-shape cwd (14 sections, v1.1.0)", () => {
		fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: "TodoApp" }),
			"utf8",
		);
		fs.mkdirSync(path.join(tmpDir, "Doc", "design"), { recursive: true });
		const md = "---\nversion: 1.1.0\n---\n\n" + Array.from({ length: 14 }, (_, i) => `## ${i}. S`).join("\n");
		fs.writeFileSync(path.join(tmpDir, "Doc", "design", "design_TodoApp.md"), md, "utf8");
		const report = runDoctor(tmpDir);
		const shape = report.sections.find((s) => s.title === "Shape compatibility");
		assert.ok(shape);
		assert.equal(shape?.items[0]?.status, "ok");
		assert.match(shape?.items[0]?.message ?? "", /Path: upgrade/);
	});
});
