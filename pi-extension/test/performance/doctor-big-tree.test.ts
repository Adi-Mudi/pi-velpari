/**
 * Performance budget — doctor on a big Doc/ tree (Phase 6.2 + Phase 6 budget expansion).
 *
 * Three budgets, all gated by RUN_PERF=1:
 *   - 200 PRD-shaped files under 5s (original budget)
 *   - 500 PRD-shaped files under 10s (Phase 6 expansion)
 *   - 500 RTM JSON sidecars under 12s (validates fingerprinting path under load)
 *
 * Skipped by default — set RUN_PERF=1 to enable.
 */

import { after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync as realMkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDoctor } from "../../src/doctor/index.js";
import { PSRS_FM } from "../helpers/full-cwd.js";

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

const PERF_ENABLED = process.env.RUN_PERF === "1";

/**
 * Write a minimal files.json v4 config under cwd.
 * @param {string} cwd - Project root to write into.
 * @param {string} projectName - Project name for the config.
 * @returns {void}
 */
function seedFilesConfig(cwd: string, projectName = "TestApp") {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "velpari", "files.json"),
		JSON.stringify({
			version: 4,
			projectName,
			framework: { language: "typescript" },
			codePaths: ["src"],
			testPaths: ["test"],
			docPaths: ["Doc"],
			excludedPaths: ["node_modules"],
		}),
	);
}

/**
 * Seed n PRD fixture files under Doc/requirements.
 * @param {string} cwd - Project root to write into.
 * @param {number} n - Number of PRD files to create.
 * @returns {void}
 */
function seedNPRDFiles(cwd: string, n: number) {
	const docDir = join(cwd, "Doc", "requirements");
	mkdirSync(docDir, { recursive: true });
	for (let i = 0; i < n; i++) {
		writeFileSync(join(docDir, `PRD_App${i}.md`), PSRS_FM, "utf8");
	}
}

describe("performance — doctor on a big Doc/ tree", () => {
	it("handles 200 PRD-shaped files under 5s", { skip: !PERF_ENABLED }, () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-perf-200-"));
		seedFilesConfig(cwd);
		seedNPRDFiles(cwd, 200);
		const start = Date.now();
		runDoctor(cwd);
		const elapsed = Date.now() - start;
		assert.ok(elapsed < 5000, `runDoctor(200 PRDs) took ${elapsed}ms (budget 5000ms)`);
	});

	it("handles 500 PRD-shaped files under 10s", { skip: !PERF_ENABLED }, () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-perf-500-"));
		seedFilesConfig(cwd);
		seedNPRDFiles(cwd, 500);
		const start = Date.now();
		runDoctor(cwd);
		const elapsed = Date.now() - start;
		assert.ok(elapsed < 10000, `runDoctor(500 PRDs) took ${elapsed}ms (budget 10000ms)`);
	});

	it("handles 500 RTM JSON sidecars under 12s (Phase 6 expansion)", { skip: !PERF_ENABLED }, () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-perf-rtm-"));
		seedFilesConfig(cwd, "RTMApp");
		// Seed 500 RTM files + 500 RTM JSON sidecars.
		const docDir = join(cwd, "Doc", "requirements");
		mkdirSync(docDir, { recursive: true });
		const rtmJson = JSON.stringify({
			project: "RTMApp",
			version: "1.0.0",
			rows: [
				{
					id: "FR-01",
					title: "FR-01",
					phase: 1,
					design: "",
					implementation: "",
					tests: [],
					status: "proposed",
				},
			],
		});
		for (let i = 0; i < 500; i++) {
			writeFileSync(join(docDir, `RTM_App${i}.md`), `# RTM\n`, "utf8");
			writeFileSync(join(docDir, `RTM_App${i}.json`), rtmJson, "utf8");
		}
		const start = Date.now();
		runDoctor(cwd);
		const elapsed = Date.now() - start;
		assert.ok(elapsed < 12000, `runDoctor(500 RTMs) took ${elapsed}ms (budget 12000ms)`);
	});
});
