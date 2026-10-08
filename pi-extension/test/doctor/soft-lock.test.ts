// Unit tests — doctor/checks/soft-lock.ts (Phase B, G1/G2 gate enforcement).
// Covers: (a) fresh project provisioning (AGENTS.md + commit-msg hook) with a
// clean result, (b) SURFACE warning for a locked published revision, (c) D8
// detection gate (no marking when gateErrorsSoFar > 0; marking at 0),
// (d) provisioning failure → warning only, (e) unmapped/self upstream keys
// skipped, (f) fail-open catch (enforcement skipped warning, errors empty).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gateStoreEnforcement } from "../../src/doctor/checks/soft-lock.js";
import { openStoreDb, closeStoreDb, readRevisionLock } from "../../src/io/db.js";
import { writeArtifact, publishArtifactCas, type ArtifactPayload } from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { markConsumedUpstreams, listSoftLocks } from "../../src/core/soft-lock.js";
import type { ArtifactEnvelopeInput } from "../../src/io/store.js";

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-soft-lock-gate-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Current fixture dir (last created by beforeEach). */
function cwd(): string {
	return dirs[dirs.length - 1]!;
}

/** Envelope input with deterministic defaults. */
function env(overrides: Partial<ArtifactEnvelopeInput> = {}): ArtifactEnvelopeInput {
	return {
		version: 1,
		stage: "drafting-prd",
		generatedAt: "2026-09-28T00:00:00Z",
		inputs: "{}",
		reviewerVerdict: null,
		changeLog: "[]",
		...overrides,
	};
}

/** Publish one PRD revision (run r1) and return its revision id. */
function publishPrd(cwdPath: string): number {
	const db = openStoreDb(buildStoreDbPath("proj", cwdPath));
	try {
		writeArtifact(db, "prd", "r1", env(), {
			fr: [{ id: "FR-1", phase: 1, textHash: "a1b2", text: "x" }],
		} as ArtifactPayload);
		return publishArtifactCas(db, "r1", "prd", null).revisionId;
	} finally {
		closeStoreDb(db);
	}
}

describe("doctor/checks/soft-lock — gateStoreEnforcement", () => {
	test("(a) fresh project → provisioning runs, no lock warnings, errors empty", () => {
		const dir = cwd();
		execFileSync("git", ["init", "-q"], { cwd: dir }); // hook provisioning target
		// Fixture hygiene (D13a): pin hooksPath in-repo so the global redirect
		// (present on some machines) does not turn provisioning into a warning.
		execFileSync("git", ["config", "core.hooksPath", ".git/hooks"], { cwd: dir });
		const result = gateStoreEnforcement({
			artifact: "PRD",
			cwd: dir,
			projectName: "proj",
			declaredInputIds: [],
			coverageUpstreamKeys: [],
			gateErrorsSoFar: 0,
		});
		assert.deepEqual(result.errors, [], "this check never errors (D2)");
		assert.deepEqual(result.warnings, [], "clean fresh project has nothing to warn");
		assert.ok(existsSync(join(dir, "AGENTS.md")), "L2 section provisioned");
		assert.ok(existsSync(join(dir, ".git", "hooks", "commit-msg")), "L3 hook provisioned");
	});

	test("(b) locked published revision → SURFACE warning names consumer + timestamps", () => {
		const dir = cwd();
		const revisionId = publishPrd(dir);
		markConsumedUpstreams(dir, "proj", "rtm:proj", ["prd"]); // consumer lock
		const result = gateStoreEnforcement({
			artifact: "PRD",
			cwd: dir,
			projectName: "proj",
			declaredInputIds: [],
			coverageUpstreamKeys: [],
			gateErrorsSoFar: 0,
		});
		assert.deepEqual(result.errors, []);
		const surface = result.warnings.find((w) => w.startsWith("soft-lock: PRD v1 is locked"));
		assert.ok(surface, `expected the surface warning; got ${JSON.stringify(result.warnings)}`);
		assert.match(
			surface,
			/\(consumed by rtm:proj at 20\d\d-/,
			"names locked_by + timestamp",
		);
		assert.match(surface, /content is immutable; this publish creates a NEW version/, "immutable + N19 path");
		assert.ok(revisionId > 0, "fixture published");
	});

	test("(c) D8 gate: gateErrorsSoFar>0 → no marking; provisioning + surface still run; 0 → marks", () => {
		const dir = cwd();
		publishPrd(dir);

		const blocked = gateStoreEnforcement({
			artifact: "RTM",
			cwd: dir,
			projectName: "proj",
			declaredInputIds: ["prd:proj"],
			coverageUpstreamKeys: [],
			gateErrorsSoFar: 1,
		});
		assert.deepEqual(blocked.errors, []);
		assert.equal(listSoftLocks(dir, "proj", "prd").length, 0, "no marking happened while other checks had errors");
		assert.ok(existsSync(join(dir, "AGENTS.md")), "provisioning still ran");

		const allowed = gateStoreEnforcement({
			artifact: "RTM",
			cwd: dir,
			projectName: "proj",
			declaredInputIds: ["prd:proj"],
			coverageUpstreamKeys: [],
			gateErrorsSoFar: 0,
		});
		assert.deepEqual(allowed.errors, []);
		assert.ok(
			allowed.warnings.some((w) => /soft-lock: locked prd:proj revision v1 — consumed by this publish\./.test(w)),
			`expected the mark warning; got ${JSON.stringify(allowed.warnings)}`,
		);
		assert.equal(listSoftLocks(dir, "proj", "prd").length, 1, "PRD head now locked");
	});

	test("(d) provision failure (AGENTS.md unwritable) → warning only, never an error", () => {
		const dir = cwd();
		mkdirSync(join(dir, "AGENTS.md")); // corrupt target: a directory
		const result = gateStoreEnforcement({
			artifact: "PRD",
			cwd: dir,
			projectName: "proj",
			declaredInputIds: [],
			coverageUpstreamKeys: [],
			gateErrorsSoFar: 0,
		});
		assert.deepEqual(result.errors, [], "provisioning can never block a publish (D2)");
		assert.ok(
			result.warnings.some((w) => w.startsWith("store-enforcement: AGENTS.md section not written (")),
			`expected the provision warning; got ${JSON.stringify(result.warnings)}`,
		);
	});

	test("(e) upstream keys: brainstorm/self skipped, only mapped kinds lock", () => {
		const dir = cwd();
		publishPrd(dir);
		const db = openStoreDb(buildStoreDbPath("proj", dir));
		let rtmRevisionId: number;
		try {
			writeArtifact(db, "rtm", "r1", env({ stage: "building-rtm" }), {
				rtmRow: [{ id: "T-1", frRef: "FR-1", phase: 1, targetSha256: "x" }],
			} as ArtifactPayload);
			rtmRevisionId = publishArtifactCas(db, "r1", "rtm", null).revisionId;
		} finally {
			closeStoreDb(db);
		}

		const result = gateStoreEnforcement({
			artifact: "RTM",
			cwd: dir,
			projectName: "proj",
			declaredInputIds: ["brainstorm:some-slug", "rtm:proj", "prd:proj"],
			coverageUpstreamKeys: [],
			gateErrorsSoFar: 0,
		});
		assert.deepEqual(result.errors, []);
		assert.equal(listSoftLocks(dir, "proj", "prd").length, 1, "PRD locked");
		assert.equal(listSoftLocks(dir, "proj", "rtm").length, 0, "self never locked");
		const db2 = openStoreDb(buildStoreDbPath("proj", dir));
		try {
			assert.equal(readRevisionLock(db2, rtmRevisionId), null, "RTM revision unlocked");
		} finally {
			closeStoreDb(db2);
		}
		assert.equal(
			result.warnings.filter((w) => w.includes("consumed by this publish")).length,
			1,
			"exactly one mark warning (PRD only)",
		);
	});

	test("(f) fail-open: an internal throw → 'enforcement skipped' warning, errors empty", () => {
		const dir = cwd();
		// Defensive-catch probe: `artifact` reaching the mapper as undefined
		// throws a TypeError inside the guarded body (type-cast on purpose —
		// the contract under test is the outer fail-open, D10/§7.3).
		const result = gateStoreEnforcement({
			artifact: undefined as unknown as string,
			cwd: dir,
			projectName: "proj",
			declaredInputIds: [],
			coverageUpstreamKeys: [],
			gateErrorsSoFar: 0,
		});
		assert.deepEqual(result.errors, [], "fail-open never errors");
		assert.ok(
			result.warnings.some((w) => /^soft-lock: enforcement skipped \(/.test(w)),
			`expected enforcement-skipped warning; got ${JSON.stringify(result.warnings)}`,
		);
	});
});
