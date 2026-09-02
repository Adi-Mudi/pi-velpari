import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor, writeDoctorReport, scanForSecrets } from "../src/doctor.js";
import { createRun, clearRun } from "../src/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-doctor-"));
}

test("runDoctor reports no active run when state missing", () => {
	const dir = tempDir();
	try {
		const report = runDoctor(dir);
		assert.match(report, /No active run/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runDoctor returns stage info when state exists", () => {
	const dir = tempDir();
	try {
		const state = createRun("Doctor Test", dir);
		const report = runDoctor(dir);
		assert.match(report, new RegExp(state.runId));
		assert.match(report, /Current stage: discussing/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("writeDoctorReport writes the report file", () => {
	const dir = tempDir();
	try {
		const report = runDoctor(dir);
		writeDoctorReport(report, dir);
		const reportPath = join(dir, ".IDE_Plans", "velpari", "doctor-report.md");
		assert.ok(existsSync(reportPath), "report file not written");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("scanForSecrets returns an empty array for plain text", () => {
	const hits = scanForSecrets("hello world");
	assert.ok(Array.isArray(hits));
	assert.equal(hits.length, 0);
});

test("scanForSecrets detects AWS Access Key pattern", () => {
	const hits = scanForSecrets("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.pattern, "AWS Access Key");
});

test("scanForSecrets detects GitHub PAT", () => {
	const hits = scanForSecrets("token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789");
	assert.ok(hits.length >= 1);
	assert.ok(hits.some((h) => h.pattern === "GitHub PAT"));
});

test("scanForSecrets detects multiple secrets in one text", () => {
	const text = [
		"AWS_KEY=AKIAIOSFODNN7EXAMPLE",
		"GH_TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
		"Authorization: Bearer abc123def456ghi789jkl012mno345pq",
	].join("\n");
	const hits = scanForSecrets(text);
	assert.ok(hits.length >= 3, `expected at least 3 hits, got ${hits.length}`);
	const patterns = new Set(hits.map((h) => h.pattern));
	assert.ok(patterns.has("AWS Access Key"));
	assert.ok(patterns.has("GitHub PAT"));
	assert.ok(patterns.has("Generic Bearer Token"));
	// Verify line numbers are 1, 2, 3
	const lines = new Set(hits.map((h) => h.line));
	assert.ok(lines.has(1));
	assert.ok(lines.has(2));
	assert.ok(lines.has(3));
});
