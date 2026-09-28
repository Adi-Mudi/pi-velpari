/**
 * Wireframe remediate tests (Phase C, plan Subphase 1.5/1.6 — D Integration request 2).
 *
 * Verifies the `wireframe` entry added to both baseline remediator sets:
 *   - working-published-drift: divergent wireframe pair is synced;
 *     a backend project WITHOUT a wireframe working copy is untouched.
 *   - frontmatter: published wireframe missing frontmatter is restamped;
 *     an absent wireframe file produces no error (presence-based).
 *
 * Fixture conventions mirror remediate.test.ts (hand-written files.json
 * + state.json + grouped paths from core/paths.ts).
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { remediate as frontmatter } from "../../src/doctor/checks/remediate/frontmatter.js";
import { remediate as workingPublishedDrift } from "../../src/doctor/checks/remediate/working-published-drift.js";
import { buildGroupedPath, buildWorkingGroupedPath, categoryFor } from "../../src/core/paths.js";

const PROJECT = "WireApp";
const RUN_ID = "2026-09-28-wire";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-wireframe-"));
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: PROJECT }),
		"utf8",
	);
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "state.json"),
		JSON.stringify({
			version: 1,
			runId: RUN_ID,
			mission: "wireframe mission",
			currentStage: "designed",
			history: [],
			updatedAt: new Date().toISOString(),
		}),
		"utf8",
	);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a file at an absolute path (creating parent dirs). */
function put(abs: string, content: string): void {
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf8");
}

describe("working-published-drift includes wireframe (D request 2)", () => {
	it("syncs a divergent wireframe pair once D's paths.ts map entry lands (merge-tolerant)", async () => {
		const publishedPath = path.join(tmpDir, buildGroupedPath("wireframe", PROJECT));
		put(publishedPath, "# OLD wireframe\n");
		const workingPath = buildWorkingGroupedPath(tmpDir, RUN_ID, "wireframe", PROJECT);
		put(workingPath, "# NEW wireframe\n");

		const result = await workingPublishedDrift({ cwd: tmpDir, projectName: PROJECT });
		if (categoryFor("wireframe") === null) {
			// D's plan Subphase 3.1 (core/paths.ts marked block: wireframe →
			// "design") not merged yet — drift must skip safely: no write, no
			// crash, no uncategorized misfire. C never edits D's file.
			assert.equal(result.changedFiles.length, 0, "skips safely pre-merge");
			assert.equal(fs.readFileSync(publishedPath, "utf8"), "# OLD wireframe\n");
			return;
		}
		// Post-merge: category present — D's contract is Doc/design/wireframe_<p>.
		assert.match(publishedPath, /Doc\/design\//, "D contract: wireframe lives under Doc/design/");
		assert.equal(result.changedFiles.length, 1, "one file overwritten");
		assert.equal(result.changedFiles[0], publishedPath);
		assert.equal(fs.readFileSync(publishedPath, "utf8"), "# NEW wireframe\n");

		// Idempotent on re-run.
		const again = await workingPublishedDrift({ cwd: tmpDir, projectName: PROJECT });
		assert.equal(again.changedFiles.length, 0);
	});

	it("backend project (no wireframe working copy) leaves a stray published wireframe alone", async () => {
		const publishedPath = path.join(tmpDir, buildGroupedPath("wireframe", PROJECT));
		put(publishedPath, "# published wireframe, no working copy\n");

		const result = await workingPublishedDrift({ cwd: tmpDir, projectName: PROJECT });
		assert.equal(result.changedFiles.length, 0, "presence-based — skipped without a working copy");
		assert.equal(fs.readFileSync(publishedPath, "utf8"), "# published wireframe, no working copy\n");
	});
});

describe("frontmatter includes wireframe (D request 2)", () => {
	it("restamps a published wireframe that is missing frontmatter", async () => {
		const publishedPath = path.join(tmpDir, buildGroupedPath("wireframe", PROJECT));
		put(publishedPath, "# Wireframe without frontmatter\n");
		// No working copy: frontmatter remediate operates on the published copy alone.
		const result = await frontmatter({ cwd: tmpDir, projectName: PROJECT });
		assert.ok(
			result.changedFiles.includes(publishedPath),
			"wireframe must be part of the frontmatter remediate set",
		);
		assert.match(fs.readFileSync(publishedPath, "utf8"), /^---\n/);
	});

	it("absent wireframe file produces no error (presence-based)", async () => {
		// No wireframe (or any artifact) on disk → never throws, never reports it.
		const result = await frontmatter({ cwd: tmpDir, projectName: PROJECT });
		assert.ok(Array.isArray(result.changedFiles));
		assert.ok(!result.changedFiles.some((f) => f.includes("wireframe")));
	});
});
