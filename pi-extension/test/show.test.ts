import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	showDiscussion,
	showPrd,
	showRtm,
	showFeasibility,
	showDesign,
	showPseudocode,
	showTestplan,
} from "../src/view/show.js";
import { saveFilesConfig } from "../src/core/config.js";
import { createRun, clearRun } from "../src/core/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-show-"));
}

interface MockUI {
	notifies: Array<{ msg: string; level: string }>;
	confirmCalls: number;
	confirm: (t: string, m: string) => Promise<boolean>;
	notify: (msg: string, level: string) => void;
}

function makeUI(): MockUI {
	return {
		notifies: [],
		confirmCalls: 0,
		async confirm(_t: string, _m: string) {
			this.confirmCalls++;
			return true;
		},
		notify(msg: string, level: string) {
			this.notifies.push({ msg, level });
		},
	};
}

function saveConfigAndCreateRun(dir: string, projectName: string, mission: string): void {
	saveFilesConfig(
		{ version: 3, projectName, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
		dir,
	);
	createRun(mission, dir);
}

function writeDocFile(dir: string, artifact: string, projectName: string, content = "# Test\n"): void {
	mkdirSync(join(dir, "Doc"), { recursive: true });
	writeFileSync(join(dir, "Doc", `${artifact}_${projectName}.md`), content, "utf8");
}

test("showPrd reads Doc/PRD_<projectName>.md and prints content", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		const content = "# PRD content here\n\nMore details.";
		writeDocFile(dir, "PRD", "TestApp", content);
		const ui = makeUI();
		const ctx = { ui } as never;
		await showPrd(ctx, dir);
		const info = ui.notifies.find((n) => n.level === "info");
		assert.ok(info, "expected an info notification");
		assert.match(info.msg, /PRD content here/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showPrd errors when projectName is missing", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir); // no saveFilesConfig
		const ui = makeUI();
		const ctx = { ui } as never;
		await showPrd(ctx, dir);
		const errored = ui.notifies.some((n) => n.level === "error");
		assert.ok(errored, "expected an error notification");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showPrd errors when Doc file is missing", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		// No Doc file created
		const ui = makeUI();
		const ctx = { ui } as never;
		await showPrd(ctx, dir);
		const errored = ui.notifies.some((n) => n.level === "error" && /not found/i.test(n.msg));
		assert.ok(errored, "expected 'not found' error");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showRtm reads and prints Doc/RTM_<projectName>.md", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		writeDocFile(dir, "RTM", "TestApp", "# RTM\n");
		const ui = makeUI();
		await showRtm({ ui } as never, dir);
		const info = ui.notifies.find((n) => n.level === "info");
		assert.ok(info);
		assert.match(info.msg, /RTM/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showFeasibility reads and prints Doc/feasibility-study_<projectName>.md", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		writeDocFile(dir, "feasibility-study", "TestApp", "# Feasibility\n");
		const ui = makeUI();
		await showFeasibility({ ui } as never, dir);
		const info = ui.notifies.find((n) => n.level === "info");
		assert.ok(info);
		assert.match(info.msg, /Feasibility/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showDesign reads and prints Doc/design_<projectName>.md", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		writeDocFile(dir, "design", "TestApp", "# Design\n");
		const ui = makeUI();
		await showDesign({ ui } as never, dir);
		const info = ui.notifies.find((n) => n.level === "info");
		assert.ok(info);
		assert.match(info.msg, /Design/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showPseudocode reads and prints Doc/pseudocode_<projectName>.md", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		writeDocFile(dir, "pseudocode", "TestApp", "# Pseudocode\n");
		const ui = makeUI();
		await showPseudocode({ ui } as never, dir);
		const info = ui.notifies.find((n) => n.level === "info");
		assert.ok(info);
		assert.match(info.msg, /Pseudocode/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showTestplan reads BOTH test-plan and test-cases files", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		writeDocFile(dir, "test-plan", "TestApp", "# Plan\n");
		writeDocFile(dir, "test-cases", "TestApp", "# Cases\n");
		const ui = makeUI();
		await showTestplan({ ui } as never, dir);
		const info = ui.notifies.find((n) => n.level === "info");
		assert.ok(info);
		assert.match(info.msg, /Plan/);
		assert.match(info.msg, /Cases/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showDiscussion reads Doc/discussion-<slug>.md from mission", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "My Mission");
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "discussion-my-mission.md"), "# Notes\n", "utf8");
		const ui = makeUI();
		await showDiscussion({ ui } as never, dir);
		const info = ui.notifies.find((n) => n.level === "info");
		assert.ok(info);
		assert.match(info.msg, /Notes/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showDiscussion errors when discussion file is missing", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		const ui = makeUI();
		await showDiscussion({ ui } as never, dir);
		const errored = ui.notifies.some((n) => n.level === "error" && /not found/i.test(n.msg));
		assert.ok(errored, "expected 'not found' error for missing discussion file");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("show commands are read-only (state.json unchanged after show)", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		writeDocFile(dir, "PRD", "TestApp", "# PRD\n");
		const ui = makeUI();

		// Snapshot state.json mtime before showPrd
		const { readFileSync, statSync } = await import("node:fs");
		const statePath = join(dir, ".IDE_Plans", "velpari", "state.json");
		const beforeStat = statSync(statePath);

		await showPrd({ ui } as never, dir);

		// State.json should not be modified by a read-only show command
		const afterStat = statSync(statePath);
		assert.equal(
			beforeStat.mtimeMs,
			afterStat.mtimeMs,
			"showPrd must not modify state.json",
		);
		void readFileSync;
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showPrd truncates content larger than MAX_NOTIFY_LENGTH (8000 chars)", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		const longContent = "x".repeat(9000);
		writeDocFile(dir, "PRD", "TestApp", longContent);
		const ui = makeUI();
		await showPrd({ ui } as never, dir);
		const info = ui.notifies.find((n) => n.level === "info");
		assert.ok(info, "expected an info notification");
		assert.ok(info.msg.length <= 8000, `truncated notification must be <= 8000 chars, got ${info.msg.length}`);
		assert.match(info.msg, /\.\.\. \[truncated\]/, "truncated notification must include the truncation marker");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showTestplan emits partial content + warning when one file is missing", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		// Only write test-cases; test-plan is missing
		writeDocFile(dir, "test-cases", "TestApp", "# Test Cases content\n");
		const ui = makeUI();
		await showTestplan({ ui } as never, dir);
		const info = ui.notifies.find((n) => n.level === "info");
		assert.ok(info, "expected an info notification");
		assert.match(info.msg, /Test Cases content/);
		assert.match(info.msg, /test-plan_TestApp\.md/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showDiscussion picks canonical (no-suffix) file when FR-69 re-runs exist", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "My Mission");
		mkdirSync(join(dir, "Doc"), { recursive: true });
		// Canonical file
		writeFileSync(
			join(dir, "Doc", "discussion-my-mission.md"),
			"# Canonical discussion notes\n",
			"utf8",
		);
		// FR-69 timestamped re-run (older canonical content)
		writeFileSync(
			join(dir, "Doc", "discussion-my-mission-20260902-120000.md"),
			"# OLDER re-run content (should not appear)\n",
			"utf8",
		);
		const ui = makeUI();
		await showDiscussion({ ui } as never, dir);
		const info = ui.notifies.find((n) => n.level === "info");
		assert.ok(info);
		assert.match(info.msg, /Canonical discussion notes/);
		assert.doesNotMatch(info.msg, /OLDER re-run/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("showTestplan emits partial content + warning when test-cases is missing (mirror case)", async () => {
	const dir = tempDir();
	try {
		saveConfigAndCreateRun(dir, "TestApp", "Mission");
		// Only write test-plan; test-cases is missing
		writeDocFile(dir, "test-plan", "TestApp", "# Test Plan content\n");
		const ui = makeUI();
		await showTestplan({ ui } as never, dir);
		const info = ui.notifies.find((n) => n.level === "info");
		assert.ok(info, "expected an info notification");
		assert.match(info.msg, /Test Plan content/);
		assert.match(info.msg, /test-cases_TestApp\.md/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
