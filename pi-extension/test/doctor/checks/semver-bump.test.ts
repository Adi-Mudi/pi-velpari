/**
 * semver-bump doctor check tests (Phase C, plan Subphase 1.6 — D Integration request 1).
 *
 * Covers: degraded contract → no project → no run → no pair →
 * declared-vs-actual mismatch (error + suggestion) → clean pair (ok) →
 * throwing validator (renders a warning, never crashes).
 *
 * The D contract is injected via `setContractForTests` (fixture rule —
 * never D's internals). Fixtures mirror remediate.test.ts: hand-written
 * state.json + grouped Doc/ + working copy via buildWorkingGroupedPath.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkSemverBumpSection } from "../../../src/doctor/checks/semver-bump.js";
import { resetContractForTests, setContractForTests, type SemverApi } from "../../../src/doctor/contract.js";
import { buildWorkingGroupedPath } from "../../../src/core/paths.js";

const PROJECT = "BumpApp";
const RUN_ID = "2026-09-28-test";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-semver-bump-"));
});

afterEach(() => {
	resetContractForTests();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Contract fake: no mismatch by default; override per case. */
function fakeSemver(overrides: Partial<SemverApi> = {}): SemverApi {
	return {
		classifyChange: () => ({}),
		validateBump: () => ({}),
		bumpGateMessages: () => ({ errors: [], warnings: [] }),
		...overrides,
	};
}

/** Minimal run state (mirrors remediate.test.ts fixture). */
function writeRunState(): void {
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "state.json"),
		JSON.stringify({
			version: 1,
			runId: RUN_ID,
			mission: "bump mission",
			currentStage: "drafted-prd",
			history: [],
			updatedAt: new Date().toISOString(),
		}),
		"utf8",
	);
}

/** Create a published copy + a divergent working copy for one artifact. */
function makePair(artifact: string): void {
	const published = path.join(tmpDir, "Doc", "requirements", `${artifact}_${PROJECT}.md`);
	fs.mkdirSync(path.dirname(published), { recursive: true });
	fs.writeFileSync(published, `# ${artifact} published\n`, "utf8");
	const working = buildWorkingGroupedPath(tmpDir, RUN_ID, artifact, PROJECT);
	fs.mkdirSync(path.dirname(working), { recursive: true });
	fs.writeFileSync(working, `# ${artifact} working\n`, "utf8");
}

describe("checkSemverBumpSection", () => {
	it("contract absent → info semver-contract-unavailable (degraded, never blocks)", () => {
		setContractForTests({ semver: null });
		const section = checkSemverBumpSection(tmpDir, PROJECT);
		assert.equal(section.title, "Semver bump (N27)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /semver-contract-unavailable/);
	});

	it("no project configured → info, skipped", () => {
		setContractForTests({ semver: fakeSemver() });
		const section = checkSemverBumpSection(tmpDir, "");
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /No project configured/);
	});

	it("no active run → info (nothing to compare)", () => {
		setContractForTests({ semver: fakeSemver() });
		const section = checkSemverBumpSection(tmpDir, PROJECT);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /No active run/);
	});

	it("published only, no working copy → info (fresh publishes bump-exempt)", () => {
		setContractForTests({ semver: fakeSemver() });
		writeRunState();
		const published = path.join(tmpDir, "Doc", "requirements", `PRD_${PROJECT}.md`);
		fs.mkdirSync(path.dirname(published), { recursive: true });
		fs.writeFileSync(published, "# PRD published\n", "utf8");
		const section = checkSemverBumpSection(tmpDir, PROJECT);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /No published\+working pair yet/);
	});

	it("declared-vs-actual mismatch → error with semver-bump-mismatch suggestion", () => {
		setContractForTests({
			semver: fakeSemver({
				bumpGateMessages: () => ({
					errors: ["declared patch but FR ids changed (MAJOR required)"],
					warnings: [],
				}),
			}),
		});
		writeRunState();
		makePair("PRD");
		const section = checkSemverBumpSection(tmpDir, PROJECT);
		const err = section.items.find((i) => i.status === "error");
		assert.ok(err, "expected an error item");
		assert.match(err!.message, /PRD: declared patch but FR ids changed/);
		assert.match(err!.suggestion ?? "", /MAJOR = id\/structure change/);
	});

	it("clean pair → ok summary", () => {
		setContractForTests({ semver: fakeSemver() });
		writeRunState();
		makePair("PRD");
		const section = checkSemverBumpSection(tmpDir, PROJECT);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]!.message, /1 published\+working pair\(s\) checked/);
	});

	it("one bad pair among good ones does not kill the section (per-item isolation)", () => {
		setContractForTests({
			semver: fakeSemver({
				validateBump: () => {
					throw new Error("boom");
				},
			}),
		});
		writeRunState();
		makePair("PRD");
		const section = checkSemverBumpSection(tmpDir, PROJECT);
		const warn = section.items.find((i) => i.status === "warning");
		assert.ok(warn, "expected a warning item");
		assert.match(warn!.message, /PRD: bump validation skipped \(boom\)/);
	});

	it("degraded info never blocks the report verdict (info ≠ error)", () => {
		setContractForTests({ semver: null });
		const section = checkSemverBumpSection(tmpDir, PROJECT);
		assert.ok(section.items.every((i) => i.status !== "error"));
	});
});
