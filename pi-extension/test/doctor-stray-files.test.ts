/**
 * doctor/checks/stray-files tests (Phase 4b).
 *
 * Locks the contract: ok when no tmp_*.sh/tmp_*.ts files exist;
 * warning when they do (in project root or .IDE_Plans/velpari/runs/);
 * ignored extensions don't trigger; non-matching prefixes don't trigger.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkStrayFiles } from "../src/discipline/doctor/checks/stray-files.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-stray-"));
}

test("returns ok with one item when no stray files exist", () => {
	const dir = tempDir();
	try {
		const section = checkStrayFiles(dir);
		assert.equal(section.title, "Stray files");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "ok");
		assert.match(section.items[0]!.message, /No stray/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("flags tmp_*.sh in the project root", () => {
	const dir = tempDir();
	try {
		writeFileSync(join(dir, "tmp_helper.sh"), "#!/bin/bash\n", "utf8");
		const section = checkStrayFiles(dir);
		const warn = section.items.find((it) => it.status === "warning" && /tmp_helper\.sh/.test(it.message));
		assert.ok(warn, "expected a warning for tmp_helper.sh");
		assert.match(warn.message, /Stray tmp_\* helper file/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("flags tmp_*.ts in the project root", () => {
	const dir = tempDir();
	try {
		writeFileSync(join(dir, "tmp_helper.ts"), "console.log('x');\n", "utf8");
		const section = checkStrayFiles(dir);
		const warn = section.items.find((it) => it.status === "warning" && /tmp_helper\.ts/.test(it.message));
		assert.ok(warn, "expected a warning for tmp_helper.ts");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("flags tmp_*.sh inside .IDE_Plans/velpari/runs/<run-id>/", () => {
	const dir = tempDir();
	try {
		const runDir = join(dir, ".IDE_Plans", "velpari", "runs", "2026-09-06-12-00-mission");
		mkdirSync(runDir, { recursive: true });
		writeFileSync(join(runDir, "tmp_scout.sh"), "#!/bin/bash\n", "utf8");
		const section = checkStrayFiles(dir);
		const warn = section.items.find(
			(it) => it.status === "warning" && /tmp_scout\.sh/.test(it.message),
		);
		assert.ok(warn, "expected a warning for tmp_scout.sh under runs/");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("ignores files that do not match tmp_ prefix or .sh/.ts extension", () => {
	const dir = tempDir();
	try {
		writeFileSync(join(dir, "legit.sh"), "#!/bin/bash\n", "utf8");
		writeFileSync(join(dir, "tmp_helper.txt"), "x", "utf8");
		writeFileSync(join(dir, "tmp_helper.py"), "x", "utf8");
		writeFileSync(join(dir, "important-file.md"), "x", "utf8");
		const section = checkStrayFiles(dir);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "ok");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("emits a final summary item with the total count", () => {
	const dir = tempDir();
	try {
		writeFileSync(join(dir, "tmp_a.sh"), "#!/bin/bash\n", "utf8");
		writeFileSync(join(dir, "tmp_b.ts"), "x", "utf8");
		const section = checkStrayFiles(dir);
		const summary = section.items.find(
			(it) => /stray tmp_\* helper file\(s\) found in total/.test(it.message),
		);
		assert.ok(summary, "expected a summary item with total count");
		assert.equal(summary.status, "warning");
		assert.match(summary.message, /2 stray/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handles a missing .IDE_Plans directory without crashing", () => {
	const dir = tempDir();
	try {
		// No .IDE_Plans; only a stray in the root.
		writeFileSync(join(dir, "tmp_x.sh"), "#!/bin/bash\n", "utf8");
		const section = checkStrayFiles(dir);
		assert.ok(section.items.some((it) => it.status === "warning" && /tmp_x\.sh/.test(it.message)));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
