/**
 * /velpari-design-logging publish path (v1.4.0).
 *
 * The handler is self-publishing: the parent LLM (per the skill markdown)
 * writes BOTH the working copy AND the published Doc/observability/...
 * copy and updates state.json:loggingPlanPublishedPath. This file
 * covers the path that the parent LLM follows via bash invocation.
 *
 * We exercise the validators + atom writer (atomicWriteJsonWithFrontmatter)
 * + state.json patch that the parent LLM uses. The handler itself
 * does NOT publish — see ops/design-logging.test.ts for handler gates.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	atomicWriteJsonWithFrontmatter,
} from "../../src/io/atomic-write.js";
import { loadState, saveState } from "../../src/core/state.js";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "vp-publish-"));
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("logging-plan publish path (parent LLM contract)", () => {
	it("atomicWriteJsonWithFrontmatter writes frontmatter + body in one file", () => {
		const path = join(cwd, "Doc", "observability", "logging-plan_Test.md");
		mkdirSync(join(cwd, "Doc", "observability"), { recursive: true });
		atomicWriteJsonWithFrontmatter(
			path,
			{
				artifact: "logging-plan",
				project: "Test",
				version: "1.0.0",
				status: "approved",
				created: "2026-09-16T10:00:00Z",
			},
			"# Logging Plan\n\n## 1. Logging Objectives & Scope\n",
		);
		assert.ok(existsSync(path));
		const content = readFileSync(path, "utf8");
		assert.ok(content.startsWith("---\n"));
		assert.ok(content.includes("artifact: logging-plan"));
		assert.ok(content.includes("project: Test"));
		assert.ok(content.includes("version: 1.0.0"));
		assert.ok(content.includes("# Logging Plan"));
	});

	it("atomicWriteJsonWithFrontmatter handles nested object frontmatter via JSON", () => {
		const path = join(cwd, "frontmatter-nested.md");
		atomicWriteJsonWithFrontmatter(
			path,
			{
				artifact: "logging-plan",
				overlay: { id: "financial-payments", version: "1.0.0" },
			},
			"body",
		);
		const content = readFileSync(path, "utf8");
		assert.ok(content.includes('overlay: {"id":"financial-payments"'));
	});

	it("atomicWriteJsonWithFrontmatter skips undefined / null frontmatter keys", () => {
		const path = join(cwd, "frontmatter-skip.md");
		atomicWriteJsonWithFrontmatter(
			path,
			{ a: "1", b: undefined, c: null, d: "2" },
			"body",
		);
		const content = readFileSync(path, "utf8");
		assert.ok(content.includes("a: 1"));
		assert.ok(content.includes("d: 2"));
		assert.ok(!content.includes("b:"));
		assert.ok(!content.includes("c:"));
	});

	it("publish path: parent LLM updates state.json:loggingPlanPublishedPath", () => {
		const state = loadState(cwd);
		state.loggingPlanPublishedPath =
			"/abs/Doc/observability/logging-plan_Demo.md";
		saveState(state, cwd);
		const reloaded = loadState(cwd);
		assert.strictEqual(
			reloaded.loggingPlanPublishedPath,
			"/abs/Doc/observability/logging-plan_Demo.md",
		);
	});

	it("published plan survives a state.json round-trip (legacy + new fields coexist)", () => {
		// Simulate a state.json that was written by an older Velpari
		// (no loggingPlanPublishedPath). Then a v1.4.0 publish adds it.
		mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "velpari", "state.json"),
			JSON.stringify({
				version: 1,
				runId: "r",
				mission: "m",
				currentStage: "designed",
				history: [],
				updatedAt: "2026-09-16T10:00:00Z",
			}),
		);
		const before = loadState(cwd);
		assert.strictEqual(before.loggingPlanPublishedPath, undefined);
		before.loggingPlanPublishedPath = "/x/y.md";
		saveState(before, cwd);
		const after = loadState(cwd);
		assert.strictEqual(after.loggingPlanPublishedPath, "/x/y.md");
	});
});
