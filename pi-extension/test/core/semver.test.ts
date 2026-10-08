/**
 * core/semver.ts tests — N27 declared-vs-actual bump decision table.
 * Pure functions; no filesystem needed. Message prefixes are pinned here
 * (bump-missing / bump-invalid / bump-violation / bump-over) because the
 * publish gate surfaces them verbatim to the user + parent LLM.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
	SEMVER_ID_PREFIXES,
	bumpGateMessages,
	classifyChange,
	parseDeclaredBump,
	validateBump,
} from "../../src/core/semver.js";

/** Build a markdown document, optionally with a YAML frontmatter block. */
function doc(body: string, frontmatter?: Record<string, string>): string {
	if (!frontmatter) return body;
	const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
	return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

const PUBLISHED = doc(
	[
		"# PRD",
		"",
		"## 1. Overview",
		"The system shall greet the user (FR-1) and export data (FR-3).",
		"",
		"## 2. Requirements",
		"| id | text |",
		"|---|---|",
		"| FR-1 | greet |",
		"| FR-3 | export |",
		"",
		"## Change Log",
		"- 2026-09-01: initial publish.",
		"",
	].join("\n"),
	{ artifact: "PRD", version: "1.0.0" },
);

/** Same body with FR-3 removed (id removal → MAJOR). */
const REMOVED_FR3 = PUBLISHED.replace(" and export data (FR-3)", "").replace("| FR-3 | export |\n", "");

/** Same body with an appended FR-9 row (backward-compatible addition). */
const ADDED_FR9 = PUBLISHED.replace("## Change Log", "| FR-9 | audit |\n\n## Change Log");

describe("semver — SEMVER_ID_PREFIXES", () => {
	test("carries every document id family", () => {
		assert.ok(SEMVER_ID_PREFIXES.includes("FR"));
		assert.ok(SEMVER_ID_PREFIXES.includes("NFR"));
		assert.ok(SEMVER_ID_PREFIXES.includes("AF"));
		assert.ok(SEMVER_ID_PREFIXES.length > 0);
	});
});

describe("semver — classifyChange decision table", () => {
	test("(a) removed id → major, evidence names the id", () => {
		const ev = classifyChange(PUBLISHED, REMOVED_FR3);
		assert.equal(ev.actual, "major");
		assert.deepEqual(ev.removedIds, ["FR-3"]);
	});

	test("(b) removed section heading → major", () => {
		const working = PUBLISHED.replace("## 2. Requirements\n", "");
		const ev = classifyChange(PUBLISHED, working);
		assert.equal(ev.actual, "major");
		assert.ok(ev.removedHeadings.includes("## 2. Requirements"));
	});

	test("(c) renamed section (old gone, new added) → major (reorganized)", () => {
		const working = PUBLISHED.replace("## 2. Requirements", "## 2. Specs");
		const ev = classifyChange(PUBLISHED, working);
		assert.equal(ev.actual, "major");
		assert.deepEqual(ev.removedHeadings, ["## 2. Requirements"]);
		assert.deepEqual(ev.addedHeadings, ["## 2. Specs"]);
	});

	test("(d) appended id, old ids untouched → minor", () => {
		const ev = classifyChange(PUBLISHED, ADDED_FR9);
		assert.equal(ev.actual, "minor");
		assert.deepEqual(ev.addedIds, ["FR-9"]);
		assert.deepEqual(ev.removedIds, []);
	});

	test("(e) added section heading, old intact → minor", () => {
		const working = PUBLISHED.replace("## Change Log", "## 9. Appendices\n\n## Change Log");
		const ev = classifyChange(PUBLISHED, working);
		assert.equal(ev.actual, "minor");
		assert.ok(ev.addedHeadings.includes("## 9. Appendices"));
	});

	test("(f) wording-only edit + new Change Log line → patch (log line is not structure)", () => {
		const working = PUBLISHED.replace("shall greet the user", "must greet the user").replace(
			"- 2026-09-01: initial publish.",
			"- 2026-09-01: initial publish.\n- 2026-09-02: reworded the greeting.",
		);
		const ev = classifyChange(PUBLISHED, working);
		assert.equal(ev.actual, "patch");
	});

	test("(g) identical bodies → patch", () => {
		assert.equal(classifyChange(PUBLISHED, PUBLISHED).actual, "patch");
	});

	test("(h) frontmatter version change alone → patch (frontmatter stripped)", () => {
		const working = PUBLISHED.replace("version: 1.0.0", "version: 2.0.0");
		assert.equal(classifyChange(PUBLISHED, working).actual, "patch");
	});

	test("(r) heading-like line inside a mermaid fence is not a section", () => {
		const published = `${PUBLISHED}\n\`\`\`\n## Fake Section\ngraph TD; A-->B\n\`\`\`\n`;
		const working = PUBLISHED; // fence removed entirely
		const ev = classifyChange(published, working);
		assert.equal(ev.actual, "patch");
		assert.deepEqual(ev.removedHeadings, []);
	});

	test("(q) CRLF content classifies the same as LF", () => {
		const crlf = PUBLISHED.replace(/\n/g, "\r\n");
		assert.equal(classifyChange(PUBLISHED, crlf).actual, "patch");
	});
});

describe("semver — parseDeclaredBump", () => {
	test("reads the flat frontmatter key (PRD-style block included)", () => {
		const fm = { artifact: "PRD", schema: "psrs/v1", version: "2.0.0", bump: "minor", status: "draft" };
		assert.deepEqual(parseDeclaredBump(doc("body", fm)), { ok: true, bump: "minor" });
	});

	test("(p) PSRS-flavoured frontmatter parses", () => {
		assert.deepEqual(parseDeclaredBump(doc("body", { artifact: "PRD", bump: "major" })), { ok: true, bump: "major" });
	});

	test("no frontmatter → missing", () => {
		assert.deepEqual(parseDeclaredBump("# just a body"), { ok: false, problem: "missing" });
	});

	test("frontmatter without bump → missing", () => {
		assert.deepEqual(parseDeclaredBump(doc("body", { artifact: "design" })), { ok: false, problem: "missing" });
	});

	test("empty bump value → missing", () => {
		assert.deepEqual(parseDeclaredBump(doc("body", { bump: "" })), { ok: false, problem: "missing" });
	});

	test("(n) unknown token → invalid with the raw value", () => {
		assert.deepEqual(parseDeclaredBump(doc("body", { bump: "bogus" })), { ok: false, problem: "invalid", value: "bogus" });
	});

	test("(o) uppercase token → invalid (exact lowercase tokens)", () => {
		assert.deepEqual(parseDeclaredBump(doc("body", { bump: "MAJOR" })), { ok: false, problem: "invalid", value: "MAJOR" });
	});
});

describe("semver — validateBump declared-vs-actual matrix", () => {
	const rev = (bump: string | undefined, body: string): string =>
		doc(body, bump === undefined ? { version: "1.1.0" } : { version: "1.1.0", bump });

	test("(i) declared major / actual patch → ok + overBump, warning line", () => {
		const working = rev("major", PUBLISHED.replace("shall greet the user", "must greet the user"));
		const verdict = validateBump(PUBLISHED, working);
		assert.equal(verdict.ok, true);
		if (!verdict.ok) return;
		assert.equal(verdict.declared, "major");
		assert.equal(verdict.actual, "patch");
		assert.equal(verdict.overBump, true);
		const { errors, warnings } = bumpGateMessages(verdict);
		assert.deepEqual(errors, []);
		assert.equal(warnings.length, 1);
		assert.ok(warnings[0]!.startsWith("bump-over:"), warnings[0]);
	});

	test("(j) declared patch / actual major → blocking violation naming level + id", () => {
		const verdict = validateBump(PUBLISHED, rev("patch", REMOVED_FR3));
		assert.equal(verdict.ok, false);
		if (verdict.ok) return;
		assert.ok(verdict.problem.startsWith("bump-violation:"), verdict.problem);
		assert.ok(verdict.problem.includes("MAJOR"), verdict.problem);
		assert.ok(verdict.problem.includes("FR-3"), verdict.problem);
		assert.equal(verdict.declared, "patch");
		assert.equal(verdict.actual, "major");
		const { errors, warnings } = bumpGateMessages(verdict);
		assert.equal(errors.length, 1);
		assert.deepEqual(warnings, []);
	});

	test("(k) declared minor / actual major → violation", () => {
		const verdict = validateBump(PUBLISHED, rev("minor", REMOVED_FR3));
		assert.equal(verdict.ok, false);
		if (!verdict.ok) assert.ok(verdict.problem.startsWith("bump-violation:"), verdict.problem);
	});

	test("(l) declared minor / actual patch → ok + over-bump", () => {
		const working = rev("minor", PUBLISHED.replace("shall greet", "must greet"));
		const verdict = validateBump(PUBLISHED, working);
		assert.equal(verdict.ok, true);
		if (verdict.ok) assert.equal(verdict.overBump, true);
	});

	test("(declared minor / actual minor) → ok, silent", () => {
		const verdict = validateBump(PUBLISHED, rev("minor", ADDED_FR9));
		assert.equal(verdict.ok, true);
		assert.deepEqual(bumpGateMessages(verdict), { errors: [], warnings: [] });
	});

	test("(m) missing bump on a revision → blocking with the exact fix", () => {
		const verdict = validateBump(PUBLISHED, rev(undefined, REMOVED_FR3));
		assert.equal(verdict.ok, false);
		if (verdict.ok) return;
		assert.ok(verdict.problem.startsWith("bump-missing:"), verdict.problem);
		assert.ok(verdict.problem.includes("add `bump: major|minor|patch`"), verdict.problem);
	});

	test("(n) invalid bump → blocking, quotes the value", () => {
		const verdict = validateBump(PUBLISHED, rev("bogus", ADDED_FR9));
		assert.equal(verdict.ok, false);
		if (verdict.ok) return;
		assert.ok(verdict.problem.startsWith("bump-invalid:"), verdict.problem);
		assert.ok(verdict.problem.includes("bump: bogus"), verdict.problem);
	});

	test("actual major with missing bump still reports the missing bump first", () => {
		const verdict = validateBump(PUBLISHED, rev(undefined, REMOVED_FR3));
		assert.equal(verdict.ok, false);
		if (!verdict.ok) {
			assert.ok(verdict.problem.startsWith("bump-missing:"), verdict.problem);
			assert.equal(verdict.actual, "major");
		}
	});
});
