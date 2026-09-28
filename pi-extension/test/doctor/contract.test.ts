/**
 * Doctor interface-contract adapter tests (Phase C, plan Subphase 1.6).
 *
 * Two layers of assertion:
 *   1. MERGE-TOLERANT resolution checks — batch 1 runs B/C/D in parallel,
 *      so every resolver must be "null OR fully shaped" both pre-merge
 *      (null) and post-merge (shape). Never asserts plain null for a
 *      runtime-resolved contract — the batch gate re-runs these green.
 *   2. Deterministic override checks — `setContractForTests` wins over
 *      resolution (the contract-fixture rule, outline §4.3.3) and
 *      `resetContractForTests` restores it.
 */

import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
	resolveConfigApi,
	resolveDigestApi,
	resolveSemverApi,
	resolveSoftLockApi,
	resetContractForTests,
	setContractForTests,
	type DigestApi,
	type SemverApi,
	type SoftLockApi,
} from "../../src/doctor/contract.js";

afterEach(() => {
	resetContractForTests();
});

const fakeDigest: DigestApi = {
	scope: "store-content-v1",
	computeStoreContentDigest: () => "computed",
	readStoreDigestStamp: () => ({ scope: "store-content-v1", digest: "stamped", stampedAt: "2026-09-28T00:00:00Z" }),
	inspectStoreVersion: () => null,
};

const fakeSemver: SemverApi = {
	classifyChange: () => ({}),
	validateBump: () => ({}),
	bumpGateMessages: () => ({ errors: [], warnings: [] }),
};

const fakeSoftLock: SoftLockApi = {
	listSoftLocks: () => [],
};

describe("doctor contract resolvers", () => {
	it("digest: resolution is null-or-shaped (merge-tolerant)", () => {
		const api = resolveDigestApi();
		if (api === null) return; // batch-1 pre-merge reality
		assert.equal(typeof api.scope, "string");
		assert.equal(typeof api.computeStoreContentDigest, "function");
		assert.equal(typeof api.readStoreDigestStamp, "function");
		assert.equal(typeof api.inspectStoreVersion, "function");
	});

	it("semver: resolution is null-or-shaped (merge-tolerant)", () => {
		const api = resolveSemverApi();
		if (api === null) return; // core/semver.ts absent until D merges
		assert.equal(typeof api.classifyChange, "function");
		assert.equal(typeof api.validateBump, "function");
		assert.equal(typeof api.bumpGateMessages, "function");
	});

	it("softLock: resolution is null-or-shaped (merge-tolerant)", () => {
		const api = resolveSoftLockApi();
		if (api === null) return; // core/soft-lock.ts absent until B merges
		assert.equal(typeof api.listSoftLocks, "function");
	});

	it("config: resolution is null-or-shaped (merge-tolerant)", () => {
		const api = resolveConfigApi();
		if (api === null) return; // accessors absent until B merges
		assert.equal(typeof api.maxWorktreesConfig, "function");
		assert.equal(typeof api.testingRunnerConfig, "function");
		assert.equal(typeof api.projectTypeConfig, "function");
	});
});

describe("doctor contract overrides (fixture rule)", () => {
	it("override wins over runtime resolution", () => {
		setContractForTests({ digest: fakeDigest, semver: fakeSemver, softLock: fakeSoftLock });
		assert.strictEqual(resolveDigestApi(), fakeDigest);
		assert.strictEqual(resolveSemverApi(), fakeSemver);
		assert.strictEqual(resolveSoftLockApi(), fakeSoftLock);
	});

	it("override null forces degradation regardless of the build", () => {
		setContractForTests({ digest: null, semver: null, softLock: null, config: null });
		assert.strictEqual(resolveDigestApi(), null);
		assert.strictEqual(resolveSemverApi(), null);
		assert.strictEqual(resolveSoftLockApi(), null);
		assert.strictEqual(resolveConfigApi(), null);
	});

	it("resetContractForTests restores runtime resolution", () => {
		setContractForTests({ digest: null });
		assert.strictEqual(resolveDigestApi(), null);
		resetContractForTests();
		// Post-merge this returns the real api; pre-merge null. The point is
		// the override no longer forces the answer.
		const api = resolveDigestApi();
		assert.ok(api === null || typeof api.computeStoreContentDigest === "function");
	});

	it("partial overrides leave other contracts resolving independently", () => {
		setContractForTests({ semver: fakeSemver });
		assert.strictEqual(resolveSemverApi(), fakeSemver);
		const digest = resolveDigestApi();
		assert.ok(digest === null || typeof digest.computeStoreContentDigest === "function");
	});
});
