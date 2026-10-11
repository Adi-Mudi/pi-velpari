/**
 * Chat-render tests (Doctor upgrade Phase 1 — lane a1, subphase 1.3).
 *
 * Covers the `buildChatReport` contract:
 *   - the header + verdict and every section render;
 *   - "Recommended next steps" lists error items (then warnings) with
 *     their suggestions;
 *   - the setup-progress section is hoisted first;
 *   - `maxChars` truncates the whole render with the truncation tail.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { DiagnosticReport } from "../../src/doctor/_types.js";
import { buildChatReport } from "../../src/doctor/chat-render.js";
import { TRUNCATION_TAIL } from "../../src/doctor/report.js";

const REPORT: DiagnosticReport = {
	ok: false,
	summary: { ok: 1, warning: 1, error: 1, info: 0 },
	sections: [
		{ title: "Config", items: [{ status: "error", message: "Boom", suggestion: "Fix it" }] },
		{ title: "Environment", items: [{ status: "ok", message: "Fine" }] },
		{
			title: "Setup progress",
			items: [{ status: "info", message: "Next: /velpari-prd", suggestion: "/velpari-prd" }],
		},
		{ title: "Custom thing", items: [{ status: "warning", message: "Hmm", suggestion: "Fix the hmm" }] },
	],
};

describe("buildChatReport — header + sections", () => {
	it("renders the counts header and the verdict", () => {
		const text = buildChatReport(REPORT);
		assert.match(text, /Doctor: 1 OK \/ 1 warnings \/ 1 errors/);
		assert.match(text, /❌ Issues found/);
	});

	it("renders every section via the shared report renderer", () => {
		const text = buildChatReport(REPORT);
		assert.match(text, /## Setup progress/);
		assert.match(text, /## Environment/);
		assert.match(text, /## Custom thing/);
	});

	it("renders the ok verdict for a clean report", () => {
		const clean: DiagnosticReport = {
			ok: true,
			summary: { ok: 2, warning: 0, error: 0, info: 0 },
			sections: [{ title: "Environment", items: [{ status: "ok", message: "Fine" }] }],
		};
		const text = buildChatReport(clean);
		assert.match(text, /✅ Configuration looks good\./);
		assert.match(text, /Nothing to fix/);
	});
});

describe("buildChatReport — recommended next steps", () => {
	it("lists error items with their suggestions", () => {
		const text = buildChatReport(REPORT);
		assert.match(text, /### Recommended next steps/);
		assert.match(text, /- Boom → Fix it/);
	});

	it("lists warnings after errors", () => {
		const text = buildChatReport(REPORT);
		assert.match(text, /- Hmm → Fix the hmm/);
		assert.ok(
			text.indexOf("- Boom → Fix it") < text.indexOf("- Hmm → Fix the hmm"),
			"error suggestions must precede warning suggestions",
		);
	});

	it("ignores items without a suggestion", () => {
		const report: DiagnosticReport = {
			ok: false,
			summary: { ok: 0, warning: 0, error: 1, info: 0 },
			sections: [{ title: "X", items: [{ status: "error", message: "No fix here" }] }],
		};
		assert.ok(!buildChatReport(report).includes("- No fix here →"));
	});
});

describe("buildChatReport — setup-progress hoist", () => {
	it("moves setup-progress ahead of the other sections", () => {
		const text = buildChatReport(REPORT);
		const setup = text.indexOf("## Setup progress");
		assert.ok(setup >= 0, "setup-progress section must render");
		assert.ok(setup < text.indexOf("## Environment"), "setup-progress must precede other sections");
		assert.ok(setup < text.indexOf("## Custom thing"), "setup-progress must precede other sections");
		assert.ok(!text.includes("## Action items"), "the chat body no longer carries the derived callout");
	});
});

describe("buildChatReport — maxChars", () => {
	it("truncates the whole render with the tail and respects the cap", () => {
		const text = buildChatReport(REPORT, { maxChars: 120 });
		assert.ok(text.length <= 120, `expected <= 120 chars, got ${text.length}`);
		assert.ok(text.endsWith(TRUNCATION_TAIL), "expected the truncation tail");
	});

	it("leaves short output untouched", () => {
		assert.equal(buildChatReport(REPORT, { maxChars: 100_000 }), buildChatReport(REPORT));
	});
});
