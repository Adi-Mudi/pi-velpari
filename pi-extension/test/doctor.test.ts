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

test("runDoctor returns 'No active run' when state missing", () => {
	const dir = tempDir();
	try {
		const report = runDoctor(dir);
		assert.match(report, /No active Velpari run/);
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
		assert.match(report, /Stage: discussing/);
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

test("scanForSecrets returns an empty array (Phase A stub)", () => {
	const hits = scanForSecrets("hello world");
	assert.ok(Array.isArray(hits));
	assert.equal(hits.length, 0);
});
