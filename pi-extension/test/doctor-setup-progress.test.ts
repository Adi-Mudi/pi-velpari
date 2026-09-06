/**
 * doctor/checks/setup-progress tests (Phase 2).
 *
 * Locks the setup-progress contract: 6 steps, "next" suggestion names
 * the first pending step, never emits `error`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSetupProgress } from "../src/discipline/doctor/checks/setup-progress.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-setup-"));
}

test("returns 6 numbered steps plus a Next summary", () => {
	const dir = tempDir();
	try {
		const section = checkSetupProgress(dir);
		assert.equal(section.title, "Setup progress");
		const numbered = section.items.filter((it) => /^\d\./.test(it.message));
		assert.equal(numbered.length, 6, "expected exactly 6 numbered steps");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("every step is either ok or info (never error)", () => {
	const dir = tempDir();
	try {
		const section = checkSetupProgress(dir);
		for (const item of section.items) {
			assert.ok(
				item.status === "ok" || item.status === "info",
				`step should never be error/warning; got ${item.status}: ${item.message}`,
			);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("step 1 is pending when no files.json exists", () => {
	const dir = tempDir();
	try {
		const section = checkSetupProgress(dir);
		const step1 = section.items.find((it) => it.message.startsWith("1."));
		assert.ok(step1);
		assert.equal(step1.status, "info");
		assert.match(step1.suggestion ?? "", /\/velpari-configure-inputs/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("step 1 is ok when files.json exists with a projectName", () => {
	const dir = tempDir();
	try {
		mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			join(dir, ".pi", "velpari", "files.json"),
			JSON.stringify({
				version: 3,
				projectName: "Demo",
				framework: {},
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			}),
			"utf8",
		);
		const section = checkSetupProgress(dir);
		const step1 = section.items.find((it) => it.message.startsWith("1."));
		assert.ok(step1);
		assert.equal(step1.status, "ok");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("step 2 is pending when state.json is missing", () => {
	const dir = tempDir();
	try {
		const section = checkSetupProgress(dir);
		const step2 = section.items.find((it) => it.message.startsWith("2."));
		assert.ok(step2);
		assert.equal(step2.status, "info");
		assert.match(step2.suggestion ?? "", /\/velpari-discuss/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("step 2 is ok when state.json shows currentStage past 'discussing'", () => {
	const dir = tempDir();
	try {
		mkdirSync(join(dir, ".IDE_Plans", "velpari"), { recursive: true });
		writeFileSync(
			join(dir, ".IDE_Plans", "velpari", "state.json"),
			JSON.stringify({
				version: 1,
				runId: "test",
				mission: "x",
				currentStage: "discussed",
				history: [],
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		const section = checkSetupProgress(dir);
		const step2 = section.items.find((it) => it.message.startsWith("2."));
		assert.ok(step2);
		assert.equal(step2.status, "ok");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("step 5 (requirements profile) is pending without a profile file", () => {
	const dir = tempDir();
	try {
		const section = checkSetupProgress(dir);
		const step5 = section.items.find((it) => it.message.startsWith("5."));
		assert.ok(step5);
		assert.equal(step5.status, "info");
		assert.match(step5.suggestion ?? "", /\/velpari-configure-requirements/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("summary line names a Next command when at least one step is pending", () => {
	const dir = tempDir();
	try {
		const section = checkSetupProgress(dir);
		const next = section.items.find((it) => it.message.startsWith("Next:"));
		assert.ok(next, "expected a 'Next:' summary item");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("summary line says setup complete when all required steps are done", () => {
	const dir = tempDir();
	try {
		mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			join(dir, ".pi", "velpari", "files.json"),
			JSON.stringify({
				version: 3,
				projectName: "Demo",
				framework: {},
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			}),
			"utf8",
		);
		mkdirSync(join(dir, ".IDE_Plans", "velpari"), { recursive: true });
		writeFileSync(
			join(dir, ".IDE_Plans", "velpari", "state.json"),
			JSON.stringify({
				version: 1,
				runId: "test",
				mission: "x",
				currentStage: "discussed",
				history: [],
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		const section = checkSetupProgress(dir);
		const summary = section.items.find((it) => /complete/i.test(it.message));
		assert.ok(summary, "expected a 'Setup complete' summary item");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
