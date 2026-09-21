/**
 * Remediate orchestrator tests (Phase 2 / Level B).
 *
 * Covers:
 *   - SAFE_WHITELIST check (refuses non-whitelisted fingerprints)
 *   - Missing-fn defensive check (whitelisted but no RemediateFn)
 *   - Each of the 3 RemediateFns: synthetic bad state → good state,
 *     idempotent re-run.
 *   - `runAllSafeRemediates` returns N results matching whitelist size.
 *   - Bad state (file missing) does not throw — returns `ok: false`.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runRemediate, runAllSafeRemediates } from "../../src/doctor/remediate.js";
import { SAFE_WHITELIST } from "../../src/doctor/checks/fix-suggestions.js";
import { remediate as frontmatter } from "../../src/doctor/checks/remediate/frontmatter.js";
import { remediate as fingerprintUntracked } from "../../src/doctor/checks/remediate/fingerprint-untracked.js";
import { remediate as workingPublishedDrift } from "../../src/doctor/checks/remediate/working-published-drift.js";
import { REMEDIATE_FNS } from "../../src/doctor/checks/remediate/index.js";
import { readYamlFile } from "../../src/core/yaml-data.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-remediate-"));
	// Provide a minimal files.json so loadFilesConfig() resolves cleanly
	// when remediate fns look up the project name.
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TestApp" }),
		"utf8",
	);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// runRemediate: defense in depth
// ---------------------------------------------------------------------------

describe("runRemediate whitelist + registry checks", () => {
	it("refuses a fingerprint NOT in SAFE_WHITELIST", async () => {
		await assert.rejects(
			runRemediate({
				cwd: tmpDir,
				projectName: "TestApp",
				fingerprint: "rtm-unknown-id",
			}),
			/not in SAFE_WHITELIST/,
		);
	});

	it("refuses a fingerprint outside the whitelist (random string)", async () => {
		await assert.rejects(
			runRemediate({
				cwd: tmpDir,
				projectName: "TestApp",
				fingerprint: "totally-made-up-fingerprint",
			}),
			/not in SAFE_WHITELIST/,
		);
	});

	it("returns ok=true with empty changedFiles when nothing is broken (frontmatter)", async () => {
		// Nothing published — remediate should be a no-op.
		const result = await runRemediate({
			cwd: tmpDir,
			projectName: "TestApp",
			fingerprint: "frontmatter-missing",
		});
		assert.equal(result.ok, true);
		assert.deepEqual(result.changedFiles, []);
	});

	it("returns ok=true with empty changedFiles when nothing is broken (fingerprint-untracked)", async () => {
		const result = await runRemediate({
			cwd: tmpDir,
			projectName: "TestApp",
			fingerprint: "fingerprint-untracked",
		});
		assert.equal(result.ok, true);
		assert.deepEqual(result.changedFiles, []);
	});

	it("returns ok=true with empty changedFiles when no state file (working-published-drift)", async () => {
		const result = await runRemediate({
			cwd: tmpDir,
			projectName: "TestApp",
			fingerprint: "working-published-drift",
		});
		assert.equal(result.ok, true);
		assert.deepEqual(result.changedFiles, []);
	});
});

// ---------------------------------------------------------------------------
// Frontmatter remediate: restamps a published artifact
// ---------------------------------------------------------------------------

describe("frontmatter remediate", () => {
	it("restamps frontmatter on a published artifact and is idempotent", async () => {
		// Publish a PRD with no frontmatter block.
		fs.mkdirSync(path.join(tmpDir, "Doc", "requirements"), { recursive: true });
		const prdPath = path.join(tmpDir, "Doc", "requirements", "PRD_TestApp.md");
		const original = "# PRD TestApp\n\n## Objective\n\nA todo app.\n";
		fs.writeFileSync(prdPath, original, "utf8");

		// First run: should restamp.
		const first = await frontmatter({ cwd: tmpDir, projectName: "TestApp" });
		assert.ok(first.changedFiles.length === 1, "first run must change 1 file");
		const after1 = fs.readFileSync(prdPath, "utf8");
		assert.match(after1, /^---\n/);
		assert.match(after1, /artifact: PRD/);
		assert.match(after1, /project: TestApp/);

		// Second run: should be idempotent (no further changes).
		const second = await frontmatter({ cwd: tmpDir, projectName: "TestApp" });
		assert.equal(
			second.changedFiles.length,
			0,
			"second run must be a no-op (already stamped)",
		);
	});
});

// ---------------------------------------------------------------------------
// Fingerprint-untracked remediate
// ---------------------------------------------------------------------------

describe("fingerprint-untracked remediate", () => {
	it("stamps fingerprints on RTM JSON rows that lack them, idempotently", async () => {
		// Publish a minimal PRD with at least 3 columns per row
		// (ID + content + Status) — extractRequirementFingerprints
		// requires cells.length >= 3 to recognize a row.
		fs.mkdirSync(path.join(tmpDir, "Doc", "requirements"), { recursive: true });
		const prdPath = path.join(tmpDir, "Doc", "requirements", "PRD_TestApp.md");
		const psrsMd = [
			"---",
			"artifact: PRD",
			"project: TestApp",
			"---",
			"",
			"## Functional Requirements",
			"",
			"| ID | Description | Status |",
			"|----|-------------|--------|",
			"| FR-01 | When a user opens the app, the system shall show today's todos. | proposed |",
			"| FR-02 | When a user taps a todo, the system shall mark it done. | proposed |",
			"",
		].join("\n");
		fs.writeFileSync(prdPath, psrsMd, "utf8");

		// Publish an RTM JSON sidecar with rows that have NO fingerprint.
		// All RtmRow required fields are populated so renderRtmMarkdown
		// can re-render the published markdown without crashing.
		fs.mkdirSync(path.join(tmpDir, "Doc", "requirements"), { recursive: true });
		const rtmMdPath = path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.md");
		const rtmJsonPath = path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.json");
		const rtmJson = {
			project: "TestApp",
			version: "1.0.0",
			rows: [
				{
					id: "FR-01",
					design: "DOC §2",
					implementation: "atomic-functions.md §3",
					tests: ["TC-01"],
					status: "approved",
					coverage: "covered",
				},
				{
					id: "FR-02",
					design: "DOC §3",
					implementation: "atomic-functions.md §5",
					tests: [],
					status: "approved",
					coverage: "missing",
				},
			],
		};
		fs.writeFileSync(rtmMdPath, "placeholder", "utf8");
		fs.writeFileSync(rtmJsonPath, JSON.stringify(rtmJson), "utf8");

		const first = await fingerprintUntracked({
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.equal(first.changedFiles.length, 2, "stamps both sidecar and MD");
		// B3/D4: the legacy .json is read but the write lands in .yaml; the
		// .json is left untouched (no deletion).
		const rtmYamlPath = path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.yaml");
		assert.ok(fs.existsSync(rtmYamlPath), "remediate writes the .yaml sidecar");
		assert.deepEqual(
			JSON.parse(fs.readFileSync(rtmJsonPath, "utf8")),
			rtmJson,
			"legacy .json stays untouched",
		);
		const after = readYamlFile(rtmYamlPath) as typeof rtmJson & {
			rows: { id: string; fingerprint?: string }[];
		};
		for (const row of after.rows) {
			// hashRequirementText returns raw hex (no "sha256:" prefix).
			assert.match(
				String(row.fingerprint ?? ""),
				/^[0-9a-f]{64}$/,
				`row ${row.id} must carry a fingerprint`,
			);
		}

		// Idempotent
		const second = await fingerprintUntracked({
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.equal(second.changedFiles.length, 0, "no further changes on re-run");
	});
});

// ---------------------------------------------------------------------------
// Working-vs-published drift remediate
// ---------------------------------------------------------------------------

describe("working-published-drift remediate", () => {
	it("copies working copy over published copy when divergent", async () => {
		// Create state.json so loadState succeeds.
		fs.mkdirSync(path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "2026-09-19-test"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "velpari", "state.json"),
			JSON.stringify({
				version: 1,
				runId: "2026-09-19-test",
				mission: "test mission",
				currentStage: "drafted-prd",
				history: [],
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);

		// Working copy differs from published. Note: the actual working
		// layout uses lowercase category names ("prd"), per
		// WORKING_GROUPED_CATEGORIES in core/paths.ts. The test mirrors
		// the exact layout buildWorkingGroupedPath("PRD", ...) returns.
		const workingPath = path.join(
			tmpDir,
			".IDE_Plans",
			"velpari",
			"runs",
			"2026-09-19-test",
			"prd",
			"PRD_TestApp.md",
		);
		fs.mkdirSync(path.dirname(workingPath), { recursive: true });
		fs.writeFileSync(workingPath, "# Working PRD with NEW content\n", "utf8");

		fs.mkdirSync(path.join(tmpDir, "Doc", "requirements"), { recursive: true });
		const pubPath = path.join(tmpDir, "Doc", "requirements", "PRD_TestApp.md");
		fs.writeFileSync(pubPath, "# OLD PRD content\n", "utf8");

		const result = await workingPublishedDrift({
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.equal(result.changedFiles.length, 1, "one file overwritten");
		assert.equal(result.changedFiles[0], pubPath);
		assert.equal(
			fs.readFileSync(pubPath, "utf8"),
			"# Working PRD with NEW content\n",
		);

		// Idempotent.
		const again = await workingPublishedDrift({
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.equal(again.changedFiles.length, 0);
	});
});

// ---------------------------------------------------------------------------
// runAllSafeRemediates
// ---------------------------------------------------------------------------

describe("runAllSafeRemediates", () => {
	it("returns one result per SAFE_WHITELIST entry", async () => {
		const results = await runAllSafeRemediates({
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.equal(results.length, SAFE_WHITELIST.size);
		for (const r of results) {
			assert.equal(typeof r.ok, "boolean");
			assert.equal(typeof r.message, "string");
		}
	});

	it("does not throw when state is missing", async () => {
		// No state file at all; remediates should still resolve to ok=true.
		const results = await runAllSafeRemediates({
			cwd: tmpDir,
			projectName: "TestApp",
		});
		for (const r of results) {
			assert.equal(r.ok, true, `remediate ${r.message} should be ok`);
		}
	});

	it("REMEDIATE_FNS exposes a function for every SAFE_WHITELIST entry", () => {
		for (const fp of SAFE_WHITELIST) {
			assert.ok(
				typeof REMEDIATE_FNS[fp] === "function",
				`Missing RemediateFn for "${fp}"`,
			);
		}
	});
});
