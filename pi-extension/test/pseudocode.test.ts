import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePseudocode } from "../src/pseudocode.js";
import { saveFilesConfig } from "../src/config.js";
import { createRun, clearRun } from "../src/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-pseudocode-"));
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

test("handlePseudocode refuses when design is missing", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handlePseudocode(ctx, dir);
		const errored = notifies.some((n) => n.level === "error" && /[Dd]esign/i.test(n.msg));
		assert.ok(errored, "expected an error about missing design");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePseudocode writes a working copy at the project-derived path", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		const { writeFileSync, mkdirSync, readdirSync } = await import("node:fs");
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "design_TestApp.md"), "# Design\n", "utf8");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handlePseudocode(ctx, dir);

		const pseudoDir = join(dir, ".IDE_Plans", "velpari", "runs");
		const find = (d: string): string | null => {
			for (const e of readdirSync(d, { withFileTypes: true })) {
				const full = join(d, e.name);
				if (e.isDirectory()) {
					const r = find(full);
					if (r) return r;
				} else if (e.name.startsWith("pseudocode_") && e.name.endsWith(".md")) {
					return full;
				}
			}
			return null;
		};
		const workingPath = find(pseudoDir);
		assert.ok(workingPath, "pseudocode working copy not created");
		assert.match(workingPath, /pseudocode_TestApp\.md$/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
