/**
 * RTM data sidecar tests (RTM traceability upgrade, Phase 2).
 *
 * Covers:
 *   - validateRtmData: shape, vocabularies, duplicate ids, deprecated-reason
 *   - compareRtmVersions
 *   - diffRtmData: append-only IDs, new rows start proposed, version bump
 *   - renderRtmMarkdown: frontmatter, summary counts, gaps, table, change log
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	compareRtmVersions,
	diffRtmData,
	renderRtmMarkdown,
	validateRtmData,
	type RtmData,
} from "../../src/core/rtm-data.js";

function row(overrides: Record<string, unknown> = {}) {
	return {
		id: "FR-1",
		title: "Add expense",
		phase: 1,
		design: "expenses.add",
		implementation: "HF-01",
		tests: ["TC-1"],
		status: "proposed",
		coverage: "covered",
		...overrides,
	};
}

function data(overrides: Record<string, unknown> = {}): RtmData {
	return {
		project: "TestApp",
		version: "1.0.0",
		rows: [row()],
		...overrides,
	} as RtmData;
}

describe("validateRtmData", () => {
	it("accepts a valid document", () => {
		assert.equal(validateRtmData(data()).ok, true);
	});

	it("rejects non-objects and missing rows", () => {
		assert.equal(validateRtmData("nope").ok, false);
		assert.equal(validateRtmData({ project: "T", version: "1.0.0" }).ok, false);
	});

	it("rejects bad id patterns and duplicates", () => {
		const badId = validateRtmData(data({ rows: [row({ id: "XX-1" })] }));
		assert.equal(badId.ok, false);
		assert.ok(badId.issues.some((i) => i.includes("FR-<n>")));

		const dup = validateRtmData(data({ rows: [row(), row()] }));
		assert.equal(dup.ok, false);
		assert.ok(dup.issues.some((i) => i.includes("duplicate")));
	});

	it("rejects unknown status/coverage values", () => {
		const result = validateRtmData(data({ rows: [row({ status: "done", coverage: "lots" })] }));
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.includes(".status")));
		assert.ok(result.issues.some((i) => i.includes(".coverage")));
	});

	it("requires a reason on deprecated rows", () => {
		const result = validateRtmData(data({ rows: [row({ status: "deprecated" })] }));
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.includes("reason")));
	});

	it("accepts deprecated rows with a reason", () => {
		const result = validateRtmData(
			data({ rows: [row({ status: "deprecated", reason: "dropped from scope" })] }),
		);
		assert.equal(result.ok, true);
	});

	it("requires a positive-integer phase (1 = MVP)", () => {
		for (const bad of [undefined, 0, -1, 1.5, "1"]) {
			const result = validateRtmData(data({ rows: [row({ phase: bad })] }));
			assert.equal(result.ok, false, `phase ${JSON.stringify(bad)} must fail`);
			assert.ok(result.issues.some((i) => i.includes(".phase")));
		}
		assert.equal(validateRtmData(data({ rows: [row({ phase: 2 })] })).ok, true);
	});
});

describe("compareRtmVersions", () => {
	it("orders semver-ish versions", () => {
		assert.ok(compareRtmVersions("1.1.0", "1.0.0") > 0);
		assert.ok(compareRtmVersions("2.0.0", "1.9.9") > 0);
		assert.equal(compareRtmVersions("1.0.0", "1.0.0"), 0);
		assert.ok(compareRtmVersions("1.0.0", "1.0.1") < 0);
	});
});

describe("diffRtmData", () => {
	it("blocks deleting a baseline row (append-only)", () => {
		const baseline = data({ rows: [row(), row({ id: "FR-2", title: "List expenses" })] });
		const updated = data({ version: "1.1.0", rows: [row({ status: "approved" })] });
		const result = diffRtmData(baseline, updated);
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.includes("FR-2") && i.includes("deprecated")));
	});

	it("allows deprecation instead of deletion", () => {
		const baseline = data({ rows: [row(), row({ id: "FR-2", title: "List expenses" })] });
		const updated = data({
			version: "2.0.0",
			rows: [
				row({ status: "approved" }),
				row({ id: "FR-2", title: "List expenses", status: "deprecated", reason: "out of scope" }),
			],
		});
		assert.equal(diffRtmData(baseline, updated).ok, true);
	});

	it("blocks revisions without a version bump", () => {
		const result = diffRtmData(data(), data({ rows: [row({ status: "approved" })] }));
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.includes("version must strictly increase")));
	});

	it("requires new rows to start as proposed", () => {
		const updated = data({
			version: "1.1.0",
			rows: [row({ status: "approved" }), row({ id: "FR-2", title: "New", status: "approved" })],
		});
		const result = diffRtmData(data(), updated);
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.includes('must start with status "proposed"')));
	});

	it("accepts a clean revision", () => {
		const updated = data({
			version: "1.1.0",
			rows: [row({ status: "approved" }), row({ id: "NFR-1", title: "p95 < 200ms" })],
			changeLog: ["1.1.0 — added NFR-1"],
		});
		assert.equal(diffRtmData(data(), updated).ok, true);
	});
});

describe("renderRtmMarkdown", () => {
	it("renders frontmatter, summary, gaps, table and change log", () => {
		const md = renderRtmMarkdown(
			data({
				rows: [
					row(),
					row({ id: "FR-2", title: "List expenses", coverage: "partial", tests: [] }),
					row({ id: "NFR-1", title: "p95 latency", coverage: "missing", design: "", implementation: "" }),
				],
				changeLog: ["1.0.0 — initial"],
			}),
		);
		assert.ok(md.startsWith("---\nartifact: RTM\nproject: TestApp\nversion: 1.0.0\n---"));
		assert.match(md, /Total requirements: 3/);
		assert.match(md, /Covered: 1 \| Partial: 1 \| Missing: 1/);
		assert.match(md, /- FR-2 — List expenses \(partial\)/);
		assert.match(md, /\| FR-1 \| Add expense \| 1 \| expenses\.add \| HF-01 \| TC-1 \| proposed \/ covered \|/);
		assert.match(md, /\| FR-2 \| List expenses \| 1 \| expenses\.add \| HF-01 \| \(none\) \| proposed \/ partial \|/);
		assert.match(md, /## Change Log\n\n- 1\.0\.0 — initial/);
	});

	it("renders the no-gaps line when everything is covered", () => {
		const md = renderRtmMarkdown(data());
		assert.match(md, /\(none — every requirement is covered\)/);
	});

	it("renders the deprecation reason in the status column", () => {
		const md = renderRtmMarkdown(
			data({ rows: [row({ status: "deprecated", reason: "replaced by FR-9" })] }),
		);
		assert.match(md, /deprecated \(replaced by FR-9\)/);
	});
});
