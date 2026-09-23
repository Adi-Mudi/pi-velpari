/**
 * Generator v2 — reviewer copies are emitted as part of Phase 3.
 *
 * v1 (Plan E) bolted reviewer copies onto the brainstorm-only run with a
 * bespoke markdown builder and no agents.json mappings. v2 generates them
 * like every other Phase 2–4 role: assembled from the bundled
 * `skills/agents/<role>.md` template, mapped in agents.json via the
 * default-column safety rule (D4).
 *
 *   - Phase 3 happy path: 17 created (13 scouts + 4 reviewers), 17 mappings
 *   - Custom reviewer mapping preserved (never rewritten), 16 created
 *   - Phase 1 no longer emits reviewer copies
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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-genv2-"));
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
	fs.writeFileSync(path.join(dir, "agents.json"), JSON.stringify({ version: 1, agents }), "utf8");
}

function slugOf(cwd: string): string {
	return path
		.basename(cwd)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-");
}

const REVIEWER_ROLES_UNDER_TEST = ["reviewer", "pseudocode-reviewer", "testplan-reviewer", "design-reviewer"] as const;

describe("generator v2 — Phase 3 emits reviewer copies (from bundled templates)", () => {
	it("Phase 3 happy path: 17 created (13 scouts + 4 reviewers), 17 mappings", async () => {
		const ctx = makeCtx(tmpDir, {
			select: async (_title, labels) => labels[0] ?? null,
			input: async () => "typescript",
			confirm: async () => true,
		});

		const result = await runAgentGenerator(ctx, { phase: 3 });
		assert.equal(result.cancelled, false);
		assert.equal(result.created, 17, "13 stage scouts + 4 reviewers");
		assert.equal(result.mappingsAdded, 17, "all generated roles get mappings (D4)");

		const agentsDir = path.join(tmpDir, ".pi", "agents");
		const slug = slugOf(tmpDir);
		for (const role of REVIEWER_ROLES_UNDER_TEST) {
			const p = path.join(agentsDir, `${slug}-${role}.md`);
			assert.ok(fs.existsSync(p), `${role} should exist at ${p}`);
			// The generated copy carries the canonical template body (the
			// reviewer's verdict contract) + the v2 generator footer.
			const content = fs.readFileSync(p, "utf8");
			assert.match(content, /from canonical body file: /);
			assert.match(content, /generator v2/);
		}

		// agents.json maps the reviewer roles to the generated names.
		const agentsJson = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "velpari", "agents.json"), "utf8")) as {
			agents: Record<string, string>;
		};
		for (const role of REVIEWER_ROLES_UNDER_TEST) {
			assert.equal(agentsJson.agents[role], `${slug}-${role}`);
		}
	});

	it("custom reviewer mapping is preserved (16 created, custom row untouched)", async () => {
		// Pre-map ONLY the atomic-function reviewer to a custom agent.
		makeAgentsJson(tmpDir, { reviewer: "my-custom-reviewer" });

		const ctx = makeCtx(tmpDir, {
			select: async (_title, labels) => labels[0] ?? null,
			input: async () => "typescript",
			confirm: async () => true,
		});

		const result = await runAgentGenerator(ctx, { phase: 3 });
		assert.equal(result.cancelled, false);
		assert.equal(result.created, 16, "reviewer skipped — the user owns that row");
		assert.equal(result.mappingsAdded, 16);

		// Custom reviewer file NOT created; mapping preserved byte-for-byte.
		const agentsDir = path.join(tmpDir, ".pi", "agents");
		assert.ok(
			!fs.existsSync(path.join(agentsDir, "my-custom-reviewer.md")),
			"custom reviewer file should NOT be created",
		);
		const agentsJson = JSON.parse(fs.readFileSync(path.join(tmpDir, ".pi", "velpari", "agents.json"), "utf8")) as {
			agents: Record<string, string>;
		};
		assert.equal(agentsJson.agents.reviewer, "my-custom-reviewer");
	});

	it("Phase 1 does not emit reviewer copies (4 brainstorm agents only)", async () => {
		const ctx = makeCtx(tmpDir, {
			select: async (_title, labels) => labels[0] ?? null,
			input: async () => "typescript",
			confirm: async () => true,
		});

		const result = await runAgentGenerator(ctx); // empty project → Phase 1
		assert.equal(result.cancelled, false);
		assert.equal(result.created, 4);
		assert.equal(result.mappingsAdded, 4);

		const agentsDir = path.join(tmpDir, ".pi", "agents");
		const slug = slugOf(tmpDir);
		for (const role of REVIEWER_ROLES_UNDER_TEST) {
			assert.ok(!fs.existsSync(path.join(agentsDir, `${slug}-${role}.md`)), `${role} must not be generated at Phase 1`);
		}
	});
});
