import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleRtm } from "../src/rtm.js";
import { saveFilesConfig } from "../src/config.js";
import { createRun, clearRun } from "../src/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-rtm-"));
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

test("handleRtm refuses when PRD is missing", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{
				version: 3,
				projectName: "TestApp",
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		createRun("Mission", dir);
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleRtm(ctx, dir);
		const errored = notifies.some((n) => n.level === "error" && /PRD/i.test(n.msg));
		assert.ok(errored, "expected an error about missing PRD");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm writes a working copy at the project-derived path", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{
				version: 3,
				projectName: "TestApp",
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		createRun("Mission", dir);
		// Create a fake PRD at the expected Doc/ path
		const { writeFileSync, mkdirSync, readdirSync } = await import("node:fs");
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "PRD_TestApp.md"), "# PRD\n", "utf8");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleRtm(ctx, dir);

		const rtmDir = join(dir, ".IDE_Plans", "velpari", "runs");
		const findInDir = (d: string): string | null => {
			for (const entry of readdirSync(d, { withFileTypes: true })) {
				const full = join(d, entry.name);
				if (entry.isDirectory()) {
					const r = findInDir(full);
					if (r) return r;
				} else if (entry.name.startsWith("RTM_") && entry.name.endsWith(".md")) {
					return full;
				}
			}
			return null;
		};
		const workingPath = findInDir(rtmDir);
		assert.ok(workingPath, "RTM working copy not created");
		assert.match(workingPath, /RTM_TestApp\.md$/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
