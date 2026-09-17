/**
 * ShapeCompatibility doctor-check tests (v1.2.2).
 *
 * Covers the 6 plan-listed cases plus the helper-layer
 * (parseSemVerMajor, countTopLevelSections, isSunsetPast).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { computeShapeVerdict, checkShapeCompatibility, shapeStatusLine } from "../../src/doctor/checks/shape-compatibility.js";
import {
	parseSemVerMajor,
	countTopLevelSections,
	isSunsetPast,
	REQUIRED_SECTION_COUNT,
	CURRENT_SHAPE_MAJOR,
} from "../../src/core/shape.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-shape-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseSemVerMajor", () => {
	it("parses standard semver", () => {
		assert.equal(parseSemVerMajor("1.0.2"), 1);
		assert.equal(parseSemVerMajor("2.5.10"), 2);
	});
	it("parses v-prefixed", () => {
		assert.equal(parseSemVerMajor("v1.2"), 1);
	});
	it("returns 0 for null/undefined/garbage", () => {
		assert.equal(parseSemVerMajor(""), 0);
		assert.equal(parseSemVerMajor("garbage"), 0);
		assert.equal(parseSemVerMajor("abc"), 0);
	});
});

describe("countTopLevelSections", () => {
	it("counts only `## N.` headings, not `### N.N` or `## X`", () => {
		const md = [
			"## 0. Foo",
			"### 0.1 Sub",
			"## 1. Bar",
			"## 9. Baz",
			"## Not a section", // skipped
			"### 1.1 Sub",
		].join("\n");
		assert.equal(countTopLevelSections(md), 3);
	});
	it("returns 0 for empty content", () => {
		assert.equal(countTopLevelSections(""), 0);
	});
});

describe("isSunsetPast", () => {
	it("returns false when no sunset", () => {
		assert.equal(isSunsetPast(undefined, "2026-09-14T00:00:00.000Z"), false);
	});
	it("returns false when sunset is in the future", () => {
		assert.equal(isSunsetPast("2027-01-01", "2026-09-14T00:00:00.000Z"), false);
	});
	it("returns true when sunset is in the past", () => {
		assert.equal(isSunsetPast("2025-01-01", "2026-09-14T00:00:00.000Z"), true);
	});
	it("returns false for malformed sunset", () => {
		assert.equal(isSunsetPast("not-a-date", "2026-09-14T00:00:00.000Z"), false);
	});
});

describe("computeShapeVerdict", () => {
	it("no version → fresh", () => {
		const v = computeShapeVerdict({ publishedVersion: undefined, sectionCountPublished: 0, sunsetDate: undefined });
		assert.equal(v.path, "fresh");
		assert.equal(v.currentMajor, CURRENT_SHAPE_MAJOR);
		assert.equal(v.sectionCountCurrent, REQUIRED_SECTION_COUNT);
		assert.match(v.reason, /No prior design/);
	});

	it("current shape → upgrade", () => {
		const v = computeShapeVerdict({
			publishedVersion: "1.1.0",
			sectionCountPublished: 14,
			sunsetDate: undefined,
		});
		assert.equal(v.path, "upgrade");
		assert.equal(v.publishedMajor, 1);
		assert.equal(v.currentMajor, 1);
		assert.match(v.reason, /SemVer 2.0.0/);
	});

	it("older shape + missing sections → migration", () => {
		const v = computeShapeVerdict({
			publishedVersion: "1.0.2",
			sectionCountPublished: 8,
			sunsetDate: undefined,
		});
		assert.equal(v.path, "migration");
		assert.equal(v.publishedMajor, 1);
		assert.equal(v.sectionCountPublished, 8);
		// v1.0.2 has same major as current 1.1.0, so the section-count
		// reason is what fires here. We assert /arc42/ (always present in
		// the migration branch) and check the structure.
		assert.match(v.reason, /arc42/);
	});

	it("section count alone forces migration when shape is current", () => {
		// Hypothetical: a published design on the current major but with
		// too few sections (e.g., custom fork). Still migration.
		const v = computeShapeVerdict({
			publishedVersion: "1.1.0",
			sectionCountPublished: 5,
			sunsetDate: undefined,
		});
		assert.equal(v.path, "migration");
		assert.match(v.reason, /Section count/);
	});

	it("major alone forces migration when section count is current", () => {
		// Hypothetical: a published design on a future major (e.g., 2.0.0)
		// but with the right section count. Still migration (rule may
		// have changed in v2).
		const v = computeShapeVerdict({
			publishedVersion: "2.0.0",
			sectionCountPublished: 14,
			sunsetDate: undefined,
		});
		assert.equal(v.path, "migration");
		assert.equal(v.publishedMajor, 2);
		assert.match(v.reason, /SemVer MAJOR/);
	});
});

describe("checkShapeCompatibility", () => {
	function writePublished(content: string): void {
		fs.mkdirSync(path.join(tmpDir, "Doc", "design"), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "Doc", "design", "design_TodoApp.md"), content, "utf8");
	}

	it("no published design → fresh info", () => {
		const section = checkShapeCompatibility(tmpDir, "TodoApp");
		assert.equal(section.title, "Shape compatibility");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /Path: fresh/);
	});

	it("published v1.0.2 with 8 sections → migration warning", () => {
		const md = [
			"---",
			"version: 1.0.2",
			"---",
			"",
			"## 0. Foo",
			"## 1. Bar",
			"## 2. Baz",
			"## 3. Qux",
			"## 4. Quux",
			"## 5. Quuux",
			"## 6. X",
			"## 7. Y",
		].join("\n");
		writePublished(md);
		const section = checkShapeCompatibility(tmpDir, "TodoApp");
		assert.equal(section.items[0]?.status, "warning");
		const msg = section.items[0]?.message ?? "";
		assert.match(msg, /Path: migration recommended/);
		// v1.0.2 has same major as current 1.1.0, so section count is
		// the only trigger; arc42 reason appears.
		assert.match(msg, /arc42/);
	});

	it("published v1.1.0 with 14 sections → upgrade ok", () => {
		const md =
			"---\nversion: 1.1.0\n---\n\n" +
			Array.from({ length: 14 }, (_, i) => `## ${i}. Section ${i}`).join("\n");
		writePublished(md);
		const section = checkShapeCompatibility(tmpDir, "TodoApp");
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /Path: upgrade/);
	});

	it("sunset date in the past → error on top of path verdict", () => {
		const md = [
			"---",
			"version: 1.0.2",
			"sunset: 2024-01-01",
			"---",
			"",
			"## 0. Foo",
		].join("\n");
		writePublished(md);
		const section = checkShapeCompatibility(tmpDir, "TodoApp");
		// Expect migration warning AND sunset error.
		const hasError = section.items.some((i) => i.status === "error");
		assert.ok(hasError, "expected an error item for the past sunset");
		const sunsetError = section.items.find((i) => /Sunset/.test(i.message));
		assert.match(sunsetError?.message ?? "", /RFC 8594/);
	});

	it("sunset date in the future → info, no error", () => {
		const md = [
			"---",
			"version: 1.0.2",
			"sunset: 2099-01-01",
			"---",
			"",
			"## 0. Foo",
		].join("\n");
		writePublished(md);
		const section = checkShapeCompatibility(tmpDir, "TodoApp");
		const hasError = section.items.some((i) => i.status === "error");
		assert.equal(hasError, false);
	});
});

describe("shapeStatusLine", () => {
	function writePublished(content: string): void {
		fs.mkdirSync(path.join(tmpDir, "Doc", "design"), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "Doc", "design", "design_TodoApp.md"), content, "utf8");
	}

	it("returns a one-line string for each path", () => {
		assert.match(shapeStatusLine(tmpDir, "TodoApp"), /Path: fresh/);

		const md =
			"---\nversion: 1.0.2\n---\n\n" +
			Array.from({ length: 8 }, (_, i) => `## ${i}. S`).join("\n");
		writePublished(md);
		assert.match(shapeStatusLine(tmpDir, "TodoApp"), /Path: migration/);

		const md2 =
			"---\nversion: 1.1.0\n---\n\n" +
			Array.from({ length: 14 }, (_, i) => `## ${i}. S`).join("\n");
		fs.writeFileSync(path.join(tmpDir, "Doc", "design", "design_TodoApp.md"), md2, "utf8");
		assert.match(shapeStatusLine(tmpDir, "TodoApp"), /Path: upgrade/);
	});
});
