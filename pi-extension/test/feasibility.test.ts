import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleFeasibility } from "../src/feasibility.js";
import { saveFilesConfig } from "../src/config.js";
import { createRun, clearRun } from "../src/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-feasibility-"));
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

test("handleFeasibility refuses when RTM is missing", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleFeasibility(ctx, dir);
		const errored = notifies.some((n) => n.level === "error" && /RTM/i.test(n.msg));
		assert.ok(errored, "expected an error about missing RTM");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility writes a working copy at the project-derived path", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		const { writeFileSync, mkdirSync, readdirSync } = await import("node:fs");
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "RTM_TestApp.md"), "# RTM\n", "utf8");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleFeasibility(ctx, dir);

		const feasDir = join(dir, ".IDE_Plans", "velpari", "runs");
		const find = (d: string): string | null => {
			for (const e of readdirSync(d, { withFileTypes: true })) {
				const full = join(d, e.name);
				if (e.isDirectory()) {
					const r = find(full);
					if (r) return r;
				} else if (e.name.startsWith("feasibility-study_") && e.name.endsWith(".md")) {
					return full;
				}
			}
			return null;
		};
		const workingPath = find(feasDir);
		assert.ok(workingPath, "feasibility working copy not created");
		assert.match(workingPath, /feasibility-study_TestApp\.md$/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
