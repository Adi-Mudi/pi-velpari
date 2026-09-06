/**
 * Doctor _types.ts unit tests (Phase 1).
 *
 * Locks the contract for DiagnosticReport: summary computation,
 * verdict flag, icon selection, and formatter smoke test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	iconFor,
	summarize,
	formatDiagnosticReport,
	type DiagnosticReport,
	type DiagnosticSection,
} from "../src/discipline/doctor/index.js";

// ---------------------------------------------------------------------------
// iconFor
// ---------------------------------------------------------------------------

test("iconFor returns the correct icon per status", () => {
	assert.equal(iconFor("ok"), "✅");
	assert.equal(iconFor("warning"), "⚠️");
	assert.equal(iconFor("error"), "❌");
	assert.equal(iconFor("info"), "ℹ️");
});

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

test("summarize counts items per status across sections", () => {
	const sections: DiagnosticSection[] = [
		{
			title: "A",
			items: [
				{ status: "ok", message: "a1" },
				{ status: "warning", message: "a2" },
			],
		},
		{
			title: "B",
			items: [
				{ status: "ok", message: "b1" },
				{ status: "error", message: "b2" },
				{ status: "info", message: "b3" },
			],
		},
	];
	const { summary, ok } = summarize(sections);
	assert.equal(summary.ok, 2);
	assert.equal(summary.warning, 1);
	assert.equal(summary.error, 1);
	assert.equal(summary.info, 1);
	assert.equal(ok, false);
});

test("summarize returns ok=true when no item has status=error", () => {
	const sections: DiagnosticSection[] = [
		{ title: "A", items: [{ status: "ok", message: "a" }] },
		{ title: "B", items: [{ status: "warning", message: "b" }] },
		{ title: "C", items: [{ status: "info", message: "c" }] },
	];
	const { summary, ok } = summarize(sections);
	assert.equal(summary.error, 0);
	assert.equal(ok, true);
});

test("summarize on empty sections returns zeros and ok=true", () => {
	const { summary, ok } = summarize([]);
	assert.deepEqual(summary, { ok: 0, warning: 0, error: 0, info: 0 });
	assert.equal(ok, true);
});

// ---------------------------------------------------------------------------
// formatDiagnosticReport
// ---------------------------------------------------------------------------

test("formatDiagnosticReport includes title, summary, and verdict", () => {
	const report: DiagnosticReport = {
		ok: true,
		summary: { ok: 1, warning: 0, error: 0, info: 0 },
		sections: [
			{
				title: "Sample",
				items: [{ status: "ok", message: "everything fine" }],
			},
		],
	};
	const md = formatDiagnosticReport(report);
	assert.match(md, /# Velpari Doctor Report/);
	assert.match(md, /Summary: 1 OK, 0 warnings, 0 errors, 0 info/);
	assert.match(md, /✅ Configuration looks good/);
	assert.match(md, /## Sample/);
	assert.match(md, /✅ everything fine/);
});

test("formatDiagnosticReport renders verdict as ❌ when ok=false", () => {
	const report: DiagnosticReport = {
		ok: false,
		summary: { ok: 0, warning: 0, error: 1, info: 0 },
		sections: [
			{
				title: "Sample",
				items: [{ status: "error", message: "broken", suggestion: "fix it" }],
			},
		],
	};
	const md = formatDiagnosticReport(report);
	assert.match(md, /❌ Please fix the errors above/);
	assert.match(md, /❌ broken/);
	assert.match(md, /→ Fix: fix it/);
});

test("formatDiagnosticReport emits icons per status", () => {
	const report: DiagnosticReport = {
		ok: false,
		summary: { ok: 1, warning: 1, error: 1, info: 1 },
		sections: [
			{
				title: "Mix",
				items: [
					{ status: "ok", message: "ok-line" },
					{ status: "warning", message: "warn-line" },
					{ status: "error", message: "err-line" },
					{ status: "info", message: "info-line" },
				],
			},
		],
	};
	const md = formatDiagnosticReport(report);
	assert.match(md, /✅ ok-line/);
	assert.match(md, /⚠️ warn-line/);
	assert.match(md, /❌ err-line/);
	assert.match(md, /ℹ️ info-line/);
});

test("formatDiagnosticReport renders details with leading dash indentation", () => {
	const report: DiagnosticReport = {
		ok: true,
		summary: { ok: 1, warning: 0, error: 0, info: 0 },
		sections: [
			{
				title: "Sample",
				items: [
					{
						status: "ok",
						message: "with details",
						details: ["first detail", "second detail"],
					},
				],
			},
		],
	};
	const md = formatDiagnosticReport(report);
	assert.match(md, /- first detail/);
	assert.match(md, /- second detail/);
});
