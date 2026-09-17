/**
 * Plan E — `/velpari-generate-sub-agents` reviewer-copy tests.
 *
 * Verifies that the generator emits per-stage reviewer copies
 * (atomic-function, pseudocode, testplan, design) on top of the
 * brainstorm roles.
 *
 *   - happy path: 4 brainstorm + 4 reviewer = 8 created, 4 mappings
 *   - all brainstorm custom → 4 reviewer copies written silently
 *   - single reviewer custom → 3 reviewer + 4 brainstorm = 7 created
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runAgentGenerator } from "../../src/commands/generate-sub-agents.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

interface Call {
	method: string;
	args: unknown[];
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-planE-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeCtx(
	cwd: string,
	ui: {
		select?: (title: string, labels: string[]) => Promise<string | null>;
		input?: (prompt: string) => Promise<string>;
		confirm?: (title: string, body?: string) => Promise<boolean>;
	},
): ExtensionContext & { __calls: Call[] } {
	const calls: Call[] = [];
	return {
		cwd,
		hasUI: true,
		ui: {
			notify: (msg: string, _level: string) => {
				calls.push({ method: "notify", args: [msg] });
			},
			select: async (title: string, labels: string[]) => {
				calls.push({ method: "select", args: [title, labels] });
				if (ui.select) return ui.select(title, labels);
				return labels[0] ?? null;
			},
			input: async (prompt: string) => {
				calls.push({ method: "input", args: [prompt] });
				if (ui.input) return ui.input(prompt);
				return "typescript";
			},
			confirm: async (title: string, body?: string) => {
				calls.push({ method: "confirm", args: [title, body] });
				if (ui.confirm) return ui.confirm(title, body);
				return true;
			},
		},
		__calls: calls,
	} as unknown as ExtensionContext & { __calls: Call[] };
}

function makeAgentsJson(cwd: string, agents: Record<string, string>): void {
	const dir = path.join(cwd, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "agents.json"),
		JSON.stringify({ version: 1, agents }),
		"utf8",
	);
}

describe("Plan E — generator emits reviewer copies (Plan D)", () => {
	it("happy path: 4 brainstorm + 4 reviewer = 8 created, 4 mappings", async () => {
		// No custom mappings → both brainstorm and reviewer are fresh.
		const ctx = makeCtx(tmpDir, {
			select: async (_title, labels) => labels[0] ?? null,
			input: async () => "typescript",
			confirm: async () => true,
		});

		const result = await runAgentGenerator(ctx);
		assert.equal(result.cancelled, false);
		assert.equal(result.created, 8, "4 brainstorm + 4 reviewer");
		assert.equal(result.mappingsAdded, 4, "only brainstorm roles add mappings");

		// All 8 reviewer + brainstorm files exist on disk.
		const agentsDir = path.join(tmpDir, ".pi", "agents");
		const slug = path.basename(tmpDir).toLowerCase().replace(/[^a-z0-9]+/g, "-");
		for (const role of [
			"extractor",
			"prd-checker",
			"rtm-checker",
			"web-search-agent",
			"reviewer",
			"pseudocode-reviewer",
			"testplan-reviewer",
			"design-reviewer",
		]) {
			const p = path.join(agentsDir, `${slug}-${role}.md`);
			assert.ok(fs.existsSync(p), `${role} should exist at ${p}`);
		}

		// agents.json has 4 mappings (brainstorm only).
		const agentsJson = JSON.parse(
			fs.readFileSync(path.join(tmpDir, ".pi", "velpari", "agents.json"), "utf8"),
		) as { agents: Record<string, string> };
		assert.equal(Object.keys(agentsJson.agents).length, 4);
	});

	it("all 4 brainstorm custom → write only 4 reviewer copies (silently)", async () => {
		// Pre-map all 4 brainstorm roles to custom agents.
		makeAgentsJson(tmpDir, {
			extractor: "my-custom-1",
			"prd-checker": "my-custom-2",
			"rtm-checker": "my-custom-3",
			"web-search-agent": "my-custom-4",
		});

		const ctx = makeCtx(tmpDir, {}); // No UI mocks needed — should bail to writeReviewerCopiesOnly

		const result = await runAgentGenerator(ctx);
		assert.equal(result.cancelled, false);
		// Plan E — brainstorm is custom; reviewer defaults → 4 reviewer copies written.
		assert.equal(result.created, 4);
		assert.equal(result.mappingsAdded, 0, "no brainstorm mappings");

		// Reviewer files exist on disk.
		const agentsDir = path.join(tmpDir, ".pi", "agents");
		const slug = path.basename(tmpDir).toLowerCase().replace(/[^a-z0-9]+/g, "-");
		for (const role of [
			"reviewer",
			"pseudocode-reviewer",
			"testplan-reviewer",
			"design-reviewer",
		]) {
			const p = path.join(agentsDir, `${slug}-${role}.md`);
			assert.ok(fs.existsSync(p), `${role} should exist at ${p}`);
		}

		// agents.json unchanged (still 4 custom brainstorm mappings).
		const agentsJson = JSON.parse(
			fs.readFileSync(path.join(tmpDir, ".pi", "velpari", "agents.json"), "utf8"),
		) as { agents: Record<string, string> };
		assert.equal(Object.keys(agentsJson.agents).length, 4);
		assert.equal(agentsJson.agents.extractor, "my-custom-1");
	});

	it("single reviewer custom → 4 brainstorm + 3 reviewer = 7 created, 4 mappings", async () => {
		// Pre-map ONLY the atomic-function reviewer to a custom agent.
		makeAgentsJson(tmpDir, { reviewer: "my-custom-reviewer" });

		const ctx = makeCtx(tmpDir, {
			select: async (_title, labels) => labels[0] ?? null,
			input: async () => "typescript",
			confirm: async () => true,
		});

		const result = await runAgentGenerator(ctx);
		assert.equal(result.cancelled, false);
		assert.equal(result.created, 7, "4 brainstorm + 3 reviewer (reviewer skipped)");
		assert.equal(result.mappingsAdded, 4, "only brainstorm mappings");

		// Custom reviewer file untouched.
		const agentsDir = path.join(tmpDir, ".pi", "agents");
		const reviewerPath = path.join(agentsDir, "my-custom-reviewer.md");
		assert.ok(
			!fs.existsSync(reviewerPath),
			"custom reviewer file should NOT be created (would overwrite)",
		);
	});
});