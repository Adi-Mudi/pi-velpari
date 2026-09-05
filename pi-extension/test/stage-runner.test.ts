import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStageWithScouts, type StageRunConfig } from "../src/core/stage-runner.js";
import { ensureStageAgents } from "../src/core/agents-install.js";

interface MockUI {
	notifies: Array<{ msg: string; level: string }>;
	notify: (msg: string, level: string) => void;
}

function makeMockUI(): MockUI {
	const notifies: Array<{ msg: string; level: string }> = [];
	return {
		notifies,
		notify(msg, level) {
			notifies.push({ msg, level });
		},
	};
}

function makeMockPi(): { sent: Array<{ prompt: string }>; sendUserMessage: (p: string) => void } {
	const sent: Array<{ prompt: string }> = [];
	return {
		sent,
		sendUserMessage(p: string) {
			sent.push({ prompt: p });
		},
	};
}

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-stage-runner-"));
}

function makeConfig(cwd: string, overrides: Partial<StageRunConfig> = {}): StageRunConfig {
	const runDir = join(cwd, "run");
	const docsDir = join(cwd, "Doc");
	const scoutReportsDir = join(runDir, "scouts");
	const workingCopyDir = join(runDir, "prd");
	return {
		stage: "drafting-prd",
		mission: "Build a todo app",
		framework: "TypeScript",
		runId: "2026-09-03-10-00-todo-app",
		scouts: [
			{ name: "fr-extractor", reportPath: join(scoutReportsDir, "fr-extractor-report.json") },
			{ name: "nfr-checker", reportPath: join(scoutReportsDir, "nfr-checker-report.json") },
			{ name: "helper-detector", reportPath: join(scoutReportsDir, "helper-detector-report.json") },
			{ name: "consolidator", reportPath: join(scoutReportsDir, "consolidator-report.json") },
		],
		inputArtifactPath: join(docsDir, "discussion-todo-app.md"),
		workingCopyDir,
		workingCopyPath: join(workingCopyDir, "PRD_TodoApp.md"),
		scoutsDir: scoutReportsDir,
		answers: [],
		cwd,
		inputArtifactContent: "stub",
		...overrides,
	};
}

test("runStageWithScouts calls pi.sendUserMessage with the assembled prompt", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const config = makeConfig(dir);
		await runStageWithScouts(config, ctx, pi as never);
		assert.equal(pi.sent.length, 1);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /Mission: Build a todo app/);
		assert.match(prompt, /<pi-velpari stage="drafting-prd">/);
		assert.match(prompt, /Framework: TypeScript/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runStageWithScouts embeds all 4 scout report paths in the prompt", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const config = makeConfig(dir);
		await runStageWithScouts(config, ctx, pi as never);
		const prompt = pi.sent[0]!.prompt;
		for (const s of config.scouts) {
			assert.match(prompt, new RegExp(`${s.name}-report\\.json`));
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runStageWithScouts embeds input artifact path + working-copy path", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const config = makeConfig(dir);
		await runStageWithScouts(config, ctx, pi as never);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /Input artifact:/);
		assert.match(prompt, /Working copy \(LLM writes here\):/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runStageWithScouts does NOT write the working copy (LLM's job)", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const config = makeConfig(dir);
		await runStageWithScouts(config, ctx, pi as never);
		// working copy should NOT exist yet — LLM writes it after spawning scouts
		assert.equal(existsSync(config.workingCopyPath), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runStageWithScouts notifies user with location + scout location + next-step hint", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const config = makeConfig(dir);
		await runStageWithScouts(config, ctx, pi as never);
		const followup = ui.notifies.find(
			(n) => /\/velpari-approve/.test(n.msg) && /Stage "drafting-prd" started/.test(n.msg),
		);
		assert.ok(followup, "expected a notify mentioning the stage start and the approve hint");
		assert.match(followup!.msg, /fr-extractor/);
		assert.match(followup!.msg, /Scout reports:/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runStageWithScouts emits an error notify when input artifact cannot be read", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const config = makeConfig(dir, {
			inputArtifactPath: "/definitely/does/not/exist.md",
			inputArtifactContent: undefined,
		});
		await runStageWithScouts(config, ctx, pi as never);
		const errored = ui.notifies.find((n) => n.level === "error" && /Cannot read input artifact/.test(n.msg));
		assert.ok(errored, "expected an error notify for missing input artifact");
		assert.equal(pi.sent.length, 0, "must NOT call sendUserMessage when input is unreadable");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runStageWithScouts uses pre-provided inputArtifactContent when supplied", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const config = makeConfig(dir, {
			inputArtifactContent: "PRE_PROVIDED_CONTENT",
			inputArtifactPath: "/should/not/be/read.md", // would throw if read
		});
		await runStageWithScouts(config, ctx, pi as never);
		assert.equal(pi.sent.length, 1, "should still hand off to parent LLM");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// ensureStageAgents
// ---------------------------------------------------------------------------

test("ensureStageAgents copies all requested agents into .pi/agents/", () => {
	const dir = tempDir();
	try {
		const ids = ["extractor", "prd-checker", "rtm-checker", "web-search-agent"];
		const result = ensureStageAgents(ids, dir);
		const total = result.installed.length + result.alreadyPresent.length + result.missing.length;
		assert.equal(total, 4, "every requested id is accounted for");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("ensureStageAgents is idempotent on repeated calls", () => {
	const dir = tempDir();
	try {
		const ids = ["extractor", "prd-checker"];
		ensureStageAgents(ids, dir);
		const second = ensureStageAgents(ids, dir);
		// Second call should report alreadyPresent (not installed).
		assert.equal(second.installed.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("ensureStageAgents reports missing agents separately from installed", () => {
	const dir = tempDir();
	try {
		// Pass a bogus id that has no bundled file.
		const result = ensureStageAgents(["this-agent-does-not-exist"], dir);
		assert.equal(result.installed.length, 0);
		assert.ok(result.missing.includes("this-agent-does-not-exist"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("ensureStageAgents preserves user-edited agents (does not overwrite)", () => {
	const dir = tempDir();
	try {
		const agentsDir = join(dir, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		const custom = "# user edited\n";
		writeFileSync(join(agentsDir, "extractor.md"), custom, "utf8");
		const result = ensureStageAgents(["extractor"], dir);
		assert.ok(result.alreadyPresent.includes("extractor"));
		const after = readFileSync(join(agentsDir, "extractor.md"), "utf8");
		assert.equal(after, custom, "user-edited file must not be overwritten");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});