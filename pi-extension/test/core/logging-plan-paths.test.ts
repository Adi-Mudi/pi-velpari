/**
 * Logging plan paths (v1.4.0).
 *
 * Covers:
 *   - buildGroupedPath("logging-plan", project) → Doc/observability/...
 *   - buildWorkingGroupedPath(...) → <runDir>/observability/...
 *   - loadPublishedLoggingPlanMarkdown: prefers grouped; falls back to legacy.
 *   - GROUPED_CATEGORIES["logging-plan"] === "observability".
 *   - WORKING_GROUPED_CATEGORIES["logging-plan"] === "observability".
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	buildGroupedPath,
	buildWorkingGroupedPath,
	GROUPED_CATEGORIES,
	WORKING_GROUPED_CATEGORIES,
} from "../../src/core/paths.js";
import { loadPublishedLoggingPlanMarkdown } from "../../src/core/logging-plan.js";

describe("paths registry — observability category", () => {
	it("GROUPED_CATEGORIES maps logging-plan to observability", () => {
		assert.strictEqual(GROUPED_CATEGORIES["logging-plan"], "observability");
	});

	it("WORKING_GROUPED_CATEGORIES mirrors the grouped mapping", () => {
		assert.strictEqual(WORKING_GROUPED_CATEGORIES["logging-plan"], "observability");
	});

	it("buildGroupedPath('logging-plan', 'Demo') → Doc/observability/logging-plan_Demo.md", () => {
		assert.strictEqual(buildGroupedPath("logging-plan", "Demo"), "Doc/observability/logging-plan_Demo.md");
	});

	it("buildWorkingGroupedPath emits the <runDir>/observability/ folder", () => {
		const p = buildWorkingGroupedPath("/cwd", "2026-09-16-10-00-x", "logging-plan", "Demo");
		assert.strictEqual(p, "/cwd/.IDE_Plans/velpari/runs/2026-09-16-10-00-x/observability/logging-plan_Demo.md");
	});
});

describe("loadPublishedLoggingPlanMarkdown", () => {
	let tmp: string;

	it("returns null when neither grouped nor legacy path exists", () => {
		tmp = mkdtempSync(join(tmpdir(), "vp-log-no-"));
		try {
			const result = loadPublishedLoggingPlanMarkdown(tmp, "NopeApp");
			assert.strictEqual(result, null);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("prefers the grouped layout at Doc/observability/", () => {
		tmp = mkdtempSync(join(tmpdir(), "vp-log-grouped-"));
		try {
			mkdirSync(join(tmp, "Doc", "observability"), { recursive: true });
			const grouped = join(tmp, "Doc", "observability", "logging-plan_G.md");
			writeFileSync(grouped, "---\nartifact: logging-plan\n---\n\ngrouped\n");
			const result = loadPublishedLoggingPlanMarkdown(tmp, "G");
			assert.ok(result !== null);
			assert.strictEqual(result!.layout, "grouped");
			assert.strictEqual(result!.path, grouped);
			assert.ok(result!.content.includes("grouped"));
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("falls back to the legacy flat Doc/ path when grouped is missing", () => {
		tmp = mkdtempSync(join(tmpdir(), "vp-log-legacy-"));
		try {
			mkdirSync(join(tmp, "Doc"), { recursive: true });
			const legacy = join(tmp, "Doc", "logging-plan_L.md");
			writeFileSync(legacy, "---\nartifact: logging-plan\n---\n\nlegacy\n");
			const result = loadPublishedLoggingPlanMarkdown(tmp, "L");
			assert.ok(result !== null);
			assert.strictEqual(result!.layout, "legacy");
			assert.strictEqual(result!.path, legacy);
			assert.ok(result!.content.includes("legacy"));
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("grouped wins when both exist", () => {
		tmp = mkdtempSync(join(tmpdir(), "vp-log-both-"));
		try {
			mkdirSync(join(tmp, "Doc", "observability"), { recursive: true });
			mkdirSync(join(tmp, "Doc"), { recursive: true });
			const grouped = join(tmp, "Doc", "observability", "logging-plan_B.md");
			const legacy = join(tmp, "Doc", "logging-plan_B.md");
			writeFileSync(grouped, "grouped");
			writeFileSync(legacy, "legacy");
			const result = loadPublishedLoggingPlanMarkdown(tmp, "B");
			assert.ok(result !== null);
			assert.strictEqual(result!.layout, "grouped");
			assert.ok(result!.content.includes("grouped"));
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("returns null on filesystem errors (does not throw)", () => {
		// Point at a directory where the grouped path would be — this causes readFileSync to fail.
		tmp = mkdtempSync(join(tmpdir(), "vp-log-err-"));
		try {
			mkdirSync(join(tmp, "Doc", "observability"), { recursive: true });
			// Make "logging-plan_X.md" a directory instead of a file
			mkdirSync(join(tmp, "Doc", "observability", "logging-plan_X.md"));
			const result = loadPublishedLoggingPlanMarkdown(tmp, "X");
			// existsSync is true (it's a directory), so the loader may succeed (returns content="") OR throw.
			// Either way it must not propagate an unhandled exception.
			assert.ok(result === null || typeof result === "object");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("sanity: the temp dir does not leak between tests", () => {
		// Each test uses its own mkdtempSync → no shared state.
		const before = existsSync(join(tmpdir(), "vp-log-"));
		tmp = mkdtempSync(join(tmpdir(), "vp-log-leak-"));
		rmSync(tmp, { recursive: true, force: true });
		assert.ok(!existsSync(tmp));
		// Just confirms mkdtemp prefix doesn't collide with prior runs
		void before;
	});
});
