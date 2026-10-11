/**
 * Report-render tests (Doctor upgrade Phase 0 — contract C3).
 *
 * Covers:
 *   - default output is byte-identical to `formatDiagnosticReport`.
 *   - `quiet` = header + summary + Action items only.
 *   - `grouped` buckets sections with per-group counts.
 *   - `severityFirst` puts error sections first.
 *   - `maxChars` truncation with the truncation tail.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { DiagnosticReport } from "../../src/doctor/_types.js";
import { formatDiagnosticReport, renderReport, TRUNCATION_TAIL } from "../../src/doctor/report.js";

const REPORT: DiagnosticReport = {
	ok: false,
	summary: { ok: 1, warning: 1, error: 1, info: 0 },
	sections: [
		{ title: "Action items", items: [{ status: "error", message: "Boom", suggestion: "Fix it" }] },
		{ title: "Environment", items: [{ status: "ok", message: "Fine" }] },
		{ title: "Custom thing", items: [{ status: "warning", message: "Hmm" }] },
	],
};

const EXPECTED_DEFAULT = [
	"# Velpari Doctor Report",
	"",
	"Summary: 1 OK, 1 warnings, 1 errors, 0 info.",
	"",
	"❌ Please fix the errors above. Each error item carries a `→ Fix:` hint.",
	"",
	"## Action items",
	"",
	"❌ Boom",
	"   → Fix: Fix it",
	"",
	"## Environment",
	"",
	"✅ Fine",
	"",
	"## Custom thing",
	"",
	"⚠️ Hmm",
	"",
].join("\n");

describe("renderReport — default", () => {
	it("renders the legacy format byte for byte", () => {
		assert.equal(renderReport(REPORT), EXPECTED_DEFAULT);
	});

	it("keeps formatDiagnosticReport as a thin wrapper", () => {
		assert.equal(formatDiagnosticReport(REPORT), renderReport(REPORT));
	});

	it("renders the ok verdict when the report is clean", () => {
		const clean: DiagnosticReport = { ok: true, summary: { ok: 1, warning: 0, error: 0, info: 0 }, sections: [] };
		assert.match(renderReport(clean), /✅ Configuration looks good\./);
	});
});

describe("renderReport — quiet", () => {
	it("keeps header + summary + Action items only", () => {
		const text = renderReport(REPORT, { quiet: true });
		assert.match(text, /^# Velpari Doctor Report/);
		assert.match(text, /Summary: 1 OK, 1 warnings, 1 errors, 0 info\./);
		assert.match(text, /## Action items/);
		assert.ok(!text.includes("## Environment"), "quiet mode must drop non-action sections");
		assert.ok(!text.includes("## Custom thing"), "quiet mode must drop non-action sections");
	});
});

describe("renderReport — grouped", () => {
	it("buckets sections and shows per-group counts", () => {
		const text = renderReport(REPORT, { grouped: true });
		assert.match(text, /## Environment — 1 section\(s\) · 0 error\(s\) · 0 warning\(s\)/);
		assert.match(text, /## Other — 1 section\(s\) · 0 error\(s\) · 1 warning\(s\)/);
		assert.match(text, /### Environment/);
		assert.match(text, /### Custom thing/);
	});

	it("renders Action items before the buckets", () => {
		const text = renderReport(REPORT, { grouped: true });
		assert.ok(text.indexOf("## Action items") < text.indexOf("## Environment —"));
	});

	it("counts errors per group", () => {
		const errored: DiagnosticReport = {
			ok: false,
			summary: { ok: 0, warning: 0, error: 1, info: 0 },
			sections: [{ title: "Environment", items: [{ status: "error", message: "bad" }] }],
		};
		assert.match(renderReport(errored, { grouped: true }), /## Environment — 1 section\(s\) · 1 error\(s\) · 0 warning\(s\)/);
	});
});

describe("renderReport — severityFirst", () => {
	it("puts error sections before ok sections", () => {
		const report: DiagnosticReport = {
			ok: false,
			summary: { ok: 1, warning: 0, error: 1, info: 0 },
			sections: [
				{ title: "Ok section", items: [{ status: "ok", message: "fine" }] },
				{ title: "Error section", items: [{ status: "error", message: "bad" }] },
			],
		};
		const text = renderReport(report, { severityFirst: true });
		assert.ok(text.indexOf("## Error section") < text.indexOf("## Ok section"));
	});
});

describe("renderReport — maxChars", () => {
	it("truncates with the tail and respects the cap", () => {
		const text = renderReport(REPORT, { maxChars: 80 });
		assert.ok(text.length <= 80, `expected <= 80 chars, got ${text.length}`);
		assert.ok(text.endsWith(TRUNCATION_TAIL), "expected the truncation tail");
	});

	it("leaves short output untouched", () => {
		assert.equal(renderReport(REPORT, { maxChars: 100_000 }), EXPECTED_DEFAULT);
	});
});
