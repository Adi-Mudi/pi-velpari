import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePrd } from "../src/prd.js";
import { saveFilesConfig } from "../src/config.js";
import { createRun, clearRun } from "../src/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-prd-"));
}

function makeUI(notifies: Array<{ msg: string; level: string }>, confirms: boolean[] = []) {
	return {
		notifies,
		confirms: [...confirms],
		confirmCalls: 0,
		async confirm(_t: string, _m: string) {
			this.confirmCalls++;
			return this.confirms.shift() ?? false;
		},
		notify(msg: string, level: string) {
			notifies.push({ msg, level });
		},
	};
}

test("handlePrd refuses when projectName is missing", async () => {
	const dir = tempDir();
	try {
		// Note: no files.json saved — projectName is empty
		createRun("Mission", dir);
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handlePrd(ctx, dir);
		const errored = notifies.some((n) => n.level === "error");
		assert.ok(errored, "expected an error notification when projectName is missing");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd refuses when no discussion exists", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{
				version: 3,
				projectName: "TestApp",
				framework: { language: "TypeScript" },
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		createRun("Mission", dir);
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handlePrd(ctx, dir);
		const errored = notifies.some((n) => n.level === "error" && /discussion/i.test(n.msg));
		assert.ok(errored, "expected an error about missing discussion");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd writes a working copy at the project-derived path", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{
				version: 3,
				projectName: "TestApp",
				framework: { language: "TypeScript" },
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		createRun("Mission", dir);
		// Create a fake discussion file at the expected Doc/ path
		const { writeFileSync, mkdirSync } = await import("node:fs");
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "discussion-mission.md"), "# Mission\n", "utf8");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies, [true]) } as never;
		await handlePrd(ctx, dir);

		// The working copy must contain "TestApp" in its name (project-derived)
		const { readdirSync } = await import("node:fs");
		const prdDir = join(dir, ".IDE_Plans", "velpari", "runs");
		// Walk to find the PRD file
		const findInDir = (d: string): string | null => {
			for (const entry of readdirSync(d, { withFileTypes: true })) {
				const full = join(d, entry.name);
				if (entry.isDirectory()) {
					const r = findInDir(full);
					if (r) return r;
				} else if (entry.name.startsWith("PRD_") && entry.name.endsWith(".md")) {
					return full;
				}
			}
			return null;
		};
		const workingPath = findInDir(prdDir);
		assert.ok(workingPath, "PRD working copy not created");
		assert.match(workingPath, /PRD_TestApp\.md$/);
		assert.ok(existsSync(workingPath));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
