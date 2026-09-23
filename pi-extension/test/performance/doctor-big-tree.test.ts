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

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDoctor } from "../../src/doctor/index.js";
import { PSRS_FM } from "../helpers/full-cwd.js";

const PERF_ENABLED = process.env.RUN_PERF === "1";

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
