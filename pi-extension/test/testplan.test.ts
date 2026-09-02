import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTestplan } from "../src/testplan.js";
import { saveFilesConfig } from "../src/config.js";
import { createRun, clearRun } from "../src/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-testplan-"));
}

function makeUI(notifies: Array<{ msg: string; level: string }>) {
	return {
		notifies,
		async confirm(_t: string, _m: string) {
			return true;
		},
		notify(msg: string, level: string) {
			notifies.push({ msg, level });
		},
	};
}

test("handleTestplan refuses when pseudocode is missing", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleTestplan(ctx, dir);
		const errored = notifies.some((n) => n.level === "error" && /[Pp]seudocode/i.test(n.msg));
		assert.ok(errored, "expected an error about missing pseudocode");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan writes BOTH test-plan and test-cases working copies", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		const { writeFileSync, mkdirSync } = await import("node:fs");
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "pseudocode_TestApp.md"), "# Pseudocode\n", "utf8");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleTestplan(ctx, dir);

		// Walk to find both files
		const testplanDir = join(dir, ".IDE_Plans", "velpari", "runs");
		const findFile = (d: string, prefix: string): string | null => {
			for (const e of readdirSync(d, { withFileTypes: true })) {
				const full = join(d, e.name);
				if (e.isDirectory()) {
					const r = findFile(full, prefix);
					if (r) return r;
				} else if (e.name.startsWith(prefix) && e.name.endsWith(".md")) {
					return full;
				}
			}
			return null;
		};
		const planPath = findFile(testplanDir, "test-plan_TestApp");
		const casesPath = findFile(testplanDir, "test-cases_TestApp");
		assert.ok(planPath, "test-plan working copy not created");
		assert.ok(casesPath, "test-cases working copy not created");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan does NOT publish when preview gate is declined", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		const { writeFileSync, mkdirSync, existsSync } = await import("node:fs");
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "pseudocode_TestApp.md"), "# Pseudocode\n", "utf8");

		const notifies: Array<{ msg: string; level: string }> = [];
		// Mock UI: confirm returns false
		const ctx = {
			ui: {
				notifies,
				async confirm(_t: string, _m: string) {
					return false;
				},
				notify(msg: string, level: string) {
					notifies.push({ msg, level });
				},
			},
		} as never;
		await handleTestplan(ctx, dir);

		// Working copies should exist
		const testplanDir = join(dir, ".IDE_Plans", "velpari", "runs");
		const findFile = (d: string, prefix: string): string | null => {
			for (const e of readdirSync(d, { withFileTypes: true })) {
				const full = join(d, e.name);
				if (e.isDirectory()) {
					const r = findFile(full, prefix);
					if (r) return r;
				} else if (e.name.startsWith(prefix) && e.name.endsWith(".md")) {
					return full;
				}
			}
			return null;
		};
		assert.ok(findFile(testplanDir, "test-plan_TestApp"), "test-plan working copy not created");

		// Published copies should NOT exist (preview gate declined)
		assert.ok(!existsSync(join(dir, "Doc", "test-plan_TestApp.md")), "test-plan should not be published when declined");
		assert.ok(!existsSync(join(dir, "Doc", "test-cases_TestApp.md")), "test-cases should not be published when declined");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
