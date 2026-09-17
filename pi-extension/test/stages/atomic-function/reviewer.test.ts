/**
 * PHASE 4 — reviewer helpers tests (Phase 5 of atomic-function-layer plan).
 *
 * Verifies `stages/atomic-function/reviewer.ts`:
 *
 *   - isReviewerVerdict — accepts well-formed verdict JSON
 *   - isReviewerVerdict — rejects malformed (missing verdict / issues / etc.)
 *   - verdictToDoctorIssues — maps approve verdict to 0 issues
 *   - verdictToDoctorIssues — maps needs-fix verdict with errors/warnings
 *     to the right DiagnosticItem statuses
 *   - re-export loadReviewerVerdict — function is callable (smoke)
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
	isReviewerVerdict,
	verdictToDoctorIssues,
	loadReviewerVerdict,
	type ReviewerVerdict,
} from "../../../src/stages/atomic-function/reviewer.js";

const baseVerdict: ReviewerVerdict = {
	verdict: "approve",
	issues: [],
	summary: "Reviewed N scout reports; 0 errors — verdict=approve.",
	timestamp: "2026-09-17T12:00:00.000Z",
};

describe("isReviewerVerdict — schema guard", () => {
	it("accepts a well-formed verdict JSON", () => {
		assert.equal(isReviewerVerdict(baseVerdict), true);
	});

	it("accepts a verdict with mixed-severity issues", () => {
		const v: ReviewerVerdict = {
			verdict: "needs-fix",
			issues: [
				{ severity: "error", rule: "base-core-missing", message: "AF-1 missing purpose" },
				{ severity: "warning", rule: "arg-count-high", message: "AF-2 argCount=4" },
				{ severity: "info", rule: "standards-mapping-missing", message: "RFC 5322 not cited" },
			],
			summary: "1 error, 1 warning, 1 info",
			timestamp: "2026-09-17T12:00:00.000Z",
		};
		assert.equal(isReviewerVerdict(v), true);
	});

	it("rejects a verdict with missing `verdict` field", () => {
		const bad = { issues: [], summary: "x", timestamp: "2026-09-17" };
		assert.equal(isReviewerVerdict(bad), false);
	});

	it("rejects a verdict with invalid verdict enum", () => {
		const bad = { ...baseVerdict, verdict: "unknown" };
		assert.equal(isReviewerVerdict(bad), false);
	});

	it("rejects a verdict with non-array issues", () => {
		const bad = { ...baseVerdict, issues: "not an array" };
		assert.equal(isReviewerVerdict(bad), false);
	});

	it("rejects a verdict with invalid issue severity", () => {
		const bad = {
			...baseVerdict,
			issues: [{ severity: "fatal", rule: "x", message: "y" }],
		};
		assert.equal(isReviewerVerdict(bad), false);
	});

	it("rejects null / undefined / non-object inputs", () => {
		assert.equal(isReviewerVerdict(null), false);
		assert.equal(isReviewerVerdict(undefined), false);
		assert.equal(isReviewerVerdict("string"), false);
		assert.equal(isReviewerVerdict(42), false);
		assert.equal(isReviewerVerdict([]), false);
	});
});

describe("verdictToDoctorIssues — mapping", () => {
	it("approve verdict (0 issues) → empty array", () => {
		const items = verdictToDoctorIssues(baseVerdict);
		assert.equal(items.length, 0);
	});

	it("needs-fix verdict with errors + warnings → matches severities", () => {
		const v: ReviewerVerdict = {
			verdict: "needs-fix",
			issues: [
				{
					severity: "error",
					rule: "base-core-missing",
					location: "AF-3",
					message: "missing purpose",
				},
				{
					severity: "warning",
					rule: "arg-count-high",
					location: "AF-5",
					message: "argCount=3",
				},
			],
			summary: "1 error, 1 warning",
			timestamp: "2026-09-17T12:00:00.000Z",
		};
		const items = verdictToDoctorIssues(v);
		assert.equal(items.length, 2);
		assert.equal(items[0]?.status, "error");
		assert.equal(items[0]?.message, "[base-core-missing] AF-3: missing purpose");
		assert.equal(items[1]?.status, "warning");
		assert.equal(items[1]?.message, "[arg-count-high] AF-5: argCount=3");
	});

	it("passes through suggestion when present", () => {
		const v: ReviewerVerdict = {
			verdict: "needs-fix",
			issues: [
				{
					severity: "error",
					rule: "cohesion-invalid",
					message: "AF-1 cohesion=sequential",
					suggestion: "Re-split AF-1 into 2 atomic functions",
				},
			],
			summary: "1 error",
			timestamp: "2026-09-17T12:00:00.000Z",
		};
		const items = verdictToDoctorIssues(v);
		assert.equal(items[0]?.suggestion, "Re-split AF-1 into 2 atomic functions");
	});

	it("info verdict issue → info DiagnosticItem", () => {
		const v: ReviewerVerdict = {
			verdict: "approve",
			issues: [{ severity: "info", rule: "standards-mapping-missing", message: "RFC 5322" }],
			summary: "0 errors, 0 warnings, 1 info",
			timestamp: "2026-09-17T12:00:00.000Z",
		};
		const items = verdictToDoctorIssues(v);
		assert.equal(items.length, 1);
		assert.equal(items[0]?.status, "info");
	});
});

describe("loadReviewerVerdict — re-export smoke", () => {
	it("is a function exported from this layer", () => {
		assert.equal(typeof loadReviewerVerdict, "function");
	});
});