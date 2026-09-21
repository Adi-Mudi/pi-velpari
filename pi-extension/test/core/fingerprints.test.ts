/**
 * Fingerprint tests (RTM traceability upgrade, Phase 3).
 *
 * Covers:
 *   - hashRequirementText: stable, content-sensitive
 *   - extractRequirementFingerprints: FR/NFR tables, status cell excluded
 *   - checkRowFingerprints: suspect / untracked / unknown-id / orphan
 *   - stampFingerprints: stamps known ids, leaves unknown ids unstamped
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	checkRowFingerprints,
	countTraceIssues,
	extractRequirementFingerprints,
	hashFileContent,
	hashFileContentNormalized,
	hashRequirementText,
	stampFingerprints,
	stripChangeLogSection,
} from "../../src/core/fingerprints.js";
import type { RtmRow } from "../../src/core/rtm-data.js";

const PSRS = [
	"# PSRS",
	"",
	"## 9. Functional Requirements",
	"",
	"| ID | Requirement | Priority | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|",
	"| FR-01 | Add expense | must | expense saved | Integration test | proposed |",
	"| FR-02 | List expenses | should | list shown | Unit test | proposed |",
	"",
	"## 10. Non-Functional Requirements",
	"",
	"| ID | Category | Requirement | Verification | Status |",
	"|---|---|---|---|---|",
	"| NFR-01 | performance | p95 < 200ms | Performance test | proposed |",
	"",
].join("\n");

function rtmRow(id: string, fingerprint?: string): RtmRow {
	return {
		id,
		title: id,
		phase: 1,
		design: "",
		implementation: "",
		tests: [],
		status: "proposed",
		coverage: "covered",
		...(fingerprint ? { fingerprint } : {}),
	};
}

describe("hashRequirementText", () => {
	it("is stable and content-sensitive", () => {
		assert.equal(hashRequirementText("abc"), hashRequirementText("abc"));
		assert.notEqual(hashRequirementText("abc"), hashRequirementText("abd"));
		assert.match(hashRequirementText("abc"), /^[0-9a-f]{64}$/);
	});
});

describe("extractRequirementFingerprints", () => {
	it("extracts FR and NFR rows from numbered sections", () => {
		const fps = extractRequirementFingerprints(PSRS);
		assert.deepEqual([...fps.keys()].sort(), ["FR-01", "FR-02", "NFR-01"]);
	});

	it("ignores the Status cell — a lifecycle move is not a content change", () => {
		const approved = PSRS.replace(
			"| FR-01 | Add expense | must | expense saved | Integration test | proposed |",
			"| FR-01 | Add expense | must | expense saved | Integration test | approved |",
		);
		const a = extractRequirementFingerprints(PSRS).get("FR-01");
		const b = extractRequirementFingerprints(approved).get("FR-01");
		assert.equal(a, b);
	});

	it("changes when the requirement substance changes", () => {
		const edited = PSRS.replace("expense saved", "expense persisted");
		const a = extractRequirementFingerprints(PSRS).get("FR-01");
		const b = extractRequirementFingerprints(edited).get("FR-01");
		assert.notEqual(a, b);
	});
});

describe("checkRowFingerprints", () => {
	const fps = extractRequirementFingerprints(PSRS);

	it("reports nothing when every row matches", () => {
		const rows = stampFingerprints(
			[rtmRow("FR-01"), rtmRow("FR-02"), rtmRow("NFR-01")],
			fps,
		);
		assert.deepEqual(checkRowFingerprints(rows, fps), []);
	});

	it("flags a suspect row when the requirement text changed", () => {
		const rows = [rtmRow("FR-01", "0".repeat(64)), rtmRow("FR-02", fps.get("FR-02")!), rtmRow("NFR-01", fps.get("NFR-01")!)];
		const issues = checkRowFingerprints(rows, fps);
		assert.equal(issues.length, 1);
		assert.equal(issues[0]!.problem, "suspect");
		assert.equal(issues[0]!.id, "FR-01");
	});

	it("flags untracked rows (no fingerprint)", () => {
		const issues = checkRowFingerprints([rtmRow("FR-01")], fps);
		assert.ok(issues.some((i) => i.problem === "untracked" && i.id === "FR-01"));
	});

	it("flags unknown ids not present in the PSRS", () => {
		const issues = checkRowFingerprints([rtmRow("FR-99")], fps);
		assert.ok(issues.some((i) => i.problem === "unknown-id" && i.id === "FR-99"));
	});

	it("flags orphan PSRS requirements with no RTM row", () => {
		const rows = stampFingerprints([rtmRow("FR-01")], fps);
		const issues = checkRowFingerprints(rows, fps);
		const orphans = issues.filter((i) => i.problem === "orphan").map((i) => i.id).sort();
		assert.deepEqual(orphans, ["FR-02", "NFR-01"]);
	});
});

describe("stampFingerprints", () => {
	it("stamps known ids and leaves unknown ids unstamped", () => {
		const fps = extractRequirementFingerprints(PSRS);
		const [known, unknown] = stampFingerprints([rtmRow("FR-01"), rtmRow("FR-99")], fps);
		assert.equal(known!.fingerprint, fps.get("FR-01"));
		assert.equal(unknown!.fingerprint, undefined);
	});
});

describe("countTraceIssues (Phase 6)", () => {
	function setup(rows: ReturnType<typeof rtmRow>[], psrs: string = PSRS): string {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-cti-"));
		mkdirSync(join(cwd, "Doc", "requirements"), { recursive: true });
		writeFileSync(join(cwd, "Doc", "requirements", "PRD_TestApp.md"), psrs);
		writeFileSync(join(cwd, "Doc", "requirements", "RTM_TestApp.md"), "# RTM\n");
		writeFileSync(
			join(cwd, "Doc", "requirements", "RTM_TestApp.json"),
			JSON.stringify({ project: "TestApp", version: "1.0.0", rows }),
		);
		return cwd;
	}

	it("returns null when project name is empty or artifacts are missing", () => {
		assert.equal(countTraceIssues(mkdtempSync(join(tmpdir(), "velpari-cti-")), "TestApp"), null);
		assert.equal(countTraceIssues(setup([]), ""), null);
	});

	it("returns 0 when every row matches the PSRS", () => {
		const fps = extractRequirementFingerprints(PSRS);
		const cwd = setup(stampFingerprints([rtmRow("FR-01"), rtmRow("FR-02"), rtmRow("NFR-01")], fps));
		assert.equal(countTraceIssues(cwd, "TestApp"), 0);
	});

	it("counts suspect, unknown-id and orphan rows (untracked ignored)", () => {
		const fps = extractRequirementFingerprints(PSRS);
		const rows = [
			rtmRow("FR-01", "0".repeat(64)), // suspect
			rtmRow("FR-99"), // unknown-id
			rtmRow("NFR-01", fps.get("NFR-01")!), // clean
		];
		// FR-02 has no row → orphan. Total: suspect + unknown + orphan = 3.
		assert.equal(countTraceIssues(setup(rows), "TestApp"), 3);
	});

	it("returns null when the sidecar is not valid JSON", () => {
		const cwd = setup([]);
		writeFileSync(join(cwd, "Doc", "requirements", "RTM_TestApp.json"), "not json");
		assert.equal(countTraceIssues(cwd, "TestApp"), null);
	});
});

describe("phase edits flag rows as suspect", () => {
	it("changing only the Phase cell changes the fingerprint", () => {
		const before = extractRequirementFingerprints(PSRS);
		const phased = PSRS.replace(
			"| FR-01 | Add expense | must | expense saved | Integration test | proposed |",
			"| FR-01 | Add expense | must | 2 | expense saved | Integration test | proposed |",
		);
		const after = extractRequirementFingerprints(phased);
		assert.notEqual(after.get("FR-01"), before.get("FR-01"));
		// Untouched rows keep their fingerprint.
		assert.equal(after.get("FR-02"), before.get("FR-02"));
	});
});

describe("stripChangeLogSection (A5/D3)", () => {
	const DOC = [
		"---",
		"artifact: design",
		"version: 1.2.0",
		"---",
		"",
		"# Design",
		"",
		"## 1. Module Breakdown",
		"",
		"body",
		"",
		"## Change Log",
		"",
		"- v1.0.0 initial",
		"",
		"## 12. Appendix",
		"",
		"tail",
		"",
	].join("\n");

	it("strips the section up to the next ## heading", () => {
		const stripped = stripChangeLogSection(DOC);
		assert.ok(!stripped.includes("## Change Log"));
		assert.ok(!stripped.includes("- v1.0.0 initial"));
		assert.ok(stripped.includes("## 12. Appendix"));
		assert.ok(stripped.includes("## 1. Module Breakdown"));
	});

	it("strips to EOF when Change Log is the last section", () => {
		const doc = "# A\n\n## Change Log\n\n- entry\n";
		const stripped = stripChangeLogSection(doc);
		assert.equal(stripped, "# A\n");
	});

	it("returns the content unchanged when there is no Change Log section", () => {
		const doc = "# A\n\n## Changes\n\n- not the same heading\n";
		assert.equal(stripChangeLogSection(doc), doc);
	});
});

describe("hashFileContentNormalized (A5/D3)", () => {
	function tmpFile(content: string): string {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-hnorm-"));
		const p = join(cwd, "artifact.md");
		writeFileSync(p, content);
		return p;
	}

	it("ignores Change Log edits but detects body edits", () => {
		const base = "# Doc\n\n## Body\n\nx\n\n## Change Log\n\n- v1\n";
		const p = tmpFile(base);
		const before = hashFileContentNormalized(p);
		writeFileSync(p, base.replace("- v1", "- v1\n- Reviewed after `prd:App` v1.0.0 — no changes required."));
		assert.equal(hashFileContentNormalized(p), before, "Change Log append must not change the hash");
		writeFileSync(p, base.replace("x", "y"));
		assert.notEqual(hashFileContentNormalized(p), before, "body edit must change the hash");
	});

	it("equals the whole-file hash when there is no Change Log section", () => {
		const p = tmpFile("# Doc\n\nno change log here\n");
		assert.equal(hashFileContentNormalized(p), hashFileContent(p));
	});

	it("differs from the whole-file hash when a Change Log section exists", () => {
		const p = tmpFile("# Doc\n\n## Change Log\n\n- v1\n");
		assert.notEqual(hashFileContentNormalized(p), hashFileContent(p));
	});

	it("returns null on missing files", () => {
		assert.equal(hashFileContentNormalized(join(tmpdir(), "velpari-hnorm-missing.md")), null);
	});
});
