/**
 * Reuse scan tests (feasibility v2, Phase 2).
 *
 * Covers core/reuse-scan.ts:
 *   - matchPct math (covered=1, partial=0.5, missing=0)
 *   - health gate (restrictive/unknown license, stale repo, bad date)
 *   - candidate status + overall verdict thresholds (70 / 30)
 *   - health-blocked high match never becomes a reuse candidate
 *   - validateReuseCandidate structural checks
 *   - renderReuseSummary chat table
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	PARTIAL_THRESHOLD,
	REUSE_THRESHOLD,
	checkHealth,
	matchPct,
	renderReuseSummary,
	scoreCandidate,
	validateReuseCandidate,
	verdictFor,
	type CoreFunction,
	type ReuseCandidate,
} from "../../src/core/reuse-scan.js";

const NOW = new Date("2026-09-13T00:00:00Z");
const FRESH = "2026-08-01T00:00:00Z";
const STALE = "2024-01-01T00:00:00Z";

const FNS: CoreFunction[] = [
	{ id: "FR-01", title: "save expenses" },
	{ id: "FR-02", title: "export csv" },
	{ id: "FR-03", title: "sync offline" },
	{ id: "FR-04", title: "monthly report" },
];

function cand(overrides: Partial<ReuseCandidate> = {}): ReuseCandidate {
	return {
		name: "acme/expense-tracker",
		repoUrl: "https://github.com/acme/expense-tracker",
		license: "MIT",
		lastCommit: FRESH,
		coverage: { "FR-01": 1, "FR-02": 1, "FR-03": 1, "FR-04": 0.5 },
		...overrides,
	};
}

describe("matchPct", () => {
	it("computes weighted coverage as a rounded percentage", () => {
		// (1 + 1 + 1 + 0.5) / 4 = 87.5 → 88
		assert.equal(matchPct(cand(), FNS), 88);
	});
	it("treats missing coverage keys as 0", () => {
		assert.equal(matchPct(cand({ coverage: { "FR-01": 1 } }), FNS), 25);
	});
	it("returns 0 for an empty core-function list", () => {
		assert.equal(matchPct(cand(), []), 0);
	});
});

describe("checkHealth", () => {
	it("passes a permissive license + fresh repo", () => {
		assert.deepEqual(checkHealth(cand(), NOW), { ok: true, reasons: [] });
	});
	it("blocks restrictive licenses", () => {
		const r = checkHealth(cand({ license: "GPL-3.0" }), NOW);
		assert.equal(r.ok, false);
		assert.ok(r.reasons.some((x) => x.includes("restrictive license")));
	});
	it("blocks unknown/missing license", () => {
		assert.equal(checkHealth(cand({ license: "" }), NOW).ok, false);
		assert.equal(checkHealth(cand({ license: "unknown" }), NOW).ok, false);
	});
	it("blocks stale repos", () => {
		const r = checkHealth(cand({ lastCommit: STALE }), NOW);
		assert.equal(r.ok, false);
		assert.ok(r.reasons.some((x) => x.includes("stale")));
	});
	it("blocks invalid commit dates", () => {
		assert.equal(checkHealth(cand({ lastCommit: "not-a-date" }), NOW).ok, false);
	});
});

describe("scoreCandidate / verdictFor", () => {
	it("high match + healthy → reuse-candidate, verdict reuse", () => {
		const s = scoreCandidate(cand(), FNS, NOW);
		assert.equal(s.matchPct >= REUSE_THRESHOLD, true);
		assert.equal(s.status, "reuse-candidate");
		assert.equal(verdictFor([cand()], FNS, NOW).verdict, "reuse");
	});
	it("high match + bad license → health-blocked, verdict partial (never reuse)", () => {
		const gpl = cand({ license: "AGPL-3.0" });
		assert.equal(scoreCandidate(gpl, FNS, NOW).status, "health-blocked");
		assert.equal(verdictFor([gpl], FNS, NOW).verdict, "partial");
	});
	it("mid match → partial", () => {
		const mid = cand({ coverage: { "FR-01": 1, "FR-02": 0.5, "FR-03": 0, "FR-04": 0 } }); // 37.5 → 38
		const s = scoreCandidate(mid, FNS, NOW);
		assert.ok(s.matchPct >= PARTIAL_THRESHOLD && s.matchPct < REUSE_THRESHOLD);
		assert.equal(s.status, "partial");
		assert.equal(verdictFor([mid], FNS, NOW).verdict, "partial");
	});
	it("low match → low, verdict build", () => {
		const low = cand({ coverage: { "FR-01": 0.5, "FR-02": 0, "FR-03": 0, "FR-04": 0 } }); // 12.5 → 13
		assert.equal(scoreCandidate(low, FNS, NOW).status, "low");
		assert.equal(verdictFor([low], FNS, NOW).verdict, "build");
	});
	it("no candidates → build", () => {
		assert.equal(verdictFor([], FNS, NOW).verdict, "build");
	});
	it("scored list is sorted by matchPct descending", () => {
		const low = cand({ name: "low", coverage: { "FR-01": 0.5 } });
		const { scored } = verdictFor([low, cand()], FNS, NOW);
		assert.equal(scored[0]!.candidate.name, "acme/expense-tracker");
		assert.equal(scored[1]!.candidate.name, "low");
	});
});

describe("validateReuseCandidate", () => {
	it("accepts a complete candidate", () => {
		assert.deepEqual(validateReuseCandidate(cand(), FNS), []);
	});
	it("rejects non-objects and missing fields", () => {
		assert.deepEqual(validateReuseCandidate(null, FNS), ["candidate is not an object"]);
		const problems = validateReuseCandidate({ name: "", repoUrl: "ftp://x", coverage: {} }, FNS);
		assert.ok(problems.some((p) => p.includes("name")));
		assert.ok(problems.some((p) => p.includes("repoUrl")));
		assert.ok(problems.some((p) => p.includes("license")));
		assert.ok(problems.some((p) => p.includes("lastCommit")));
	});
	it("requires a coverage entry for every core function", () => {
		const problems = validateReuseCandidate(cand({ coverage: { "FR-01": 1 } }), FNS);
		assert.equal(problems.filter((p) => p.includes("coverage[FR-")).length, 3);
	});
	it("rejects unknown coverage ids and bad values", () => {
		const problems = validateReuseCandidate(
			cand({ coverage: { "FR-01": 1, "FR-02": 1, "FR-03": 1, "FR-04": 0.5, "FR-99": 1 } }),
			FNS,
		);
		assert.ok(problems.some((p) => p.includes('unknown core-function id "FR-99"')));
		const bad = validateReuseCandidate(
			cand({ coverage: { "FR-01": 2, "FR-02": 1, "FR-03": 1, "FR-04": 0.5 } as never }),
			FNS,
		);
		assert.ok(bad.some((p) => p.includes("coverage[FR-01]")));
	});
});

describe("renderReuseSummary", () => {
	it("renders a table with match %, license, and status", () => {
		const { scored } = verdictFor([cand()], FNS, NOW);
		const out = renderReuseSummary(scored);
		assert.ok(out.includes("| Repo | Match | License | Status |"));
		assert.ok(out.includes("| acme/expense-tracker | 88% | MIT | reuse-candidate |"));
	});
	it("annotates health-blocked candidates with reasons", () => {
		const out = renderReuseSummary([scoreCandidate(cand({ license: "GPL-3.0" }), FNS, NOW)]);
		assert.ok(out.includes("health-blocked (restrictive license (GPL-3.0))"));
	});
	it("handles the empty case", () => {
		assert.equal(renderReuseSummary([]), "Reuse scan: no candidates found.");
	});
});
