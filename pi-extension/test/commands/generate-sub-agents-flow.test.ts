/**
 * /velpari-generate-sub-agents flow tests (Phase 5+6 combined).
 *
 * Mocks `ctx.ui` to drive the orchestration without a real TUI.
 * Mirrors `pi-seani/.../test/commands/16-generator-preview.e2e.test.ts`
 * shape, scoped to the unit-test runner (no RPC).
 *
 * Coverage:
 *   - TUI-less headless guard returns early with "warning" notify.
 *   - Nothing-to-do guard (all-custom mapping): notify + return.
 *   - Cancelled project-type picker: returns cancelled: true.
 *   - Empty language: notify + return cancelled.
 *   - Single confirmation gate: ctx.ui.confirm is called exactly ONCE.
 *   - User-declined confirmation: nothing written, cancelled: true.
 *   - Happy path: 3 questions → preview → confirm → 8 agents written
 *     (4 brainstorm + 4 reviewer) + 4 mappings added.
 *     Plan E extends the generator to emit per-stage reviewer copies
 *     (atomic-function / pseudocode / testplan / design) on top of the
 *     4 brainstorm roles.
 *   - Custom-agent non-clobber: a hand-made file under .pi/agents/
 *     stays on disk untouched.
 *   - Post-write notify carries the create count.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runAgentGenerator } from "../../src/commands/generate-sub-agents.js";

interface MockUiCall {
	method: "select" | "input" | "confirm" | "notify";
	args: unknown[];
}

interface MockCtx extends ExtensionContext {
	__calls: MockUiCall[];
	__responses: Partial<{
		select: (title: string, labels: string[]) => Promise<string | null>;
		input: (title: string) => Promise<string | null>;
		confirm: (title: string, message: string) => Promise<boolean>;
	}>;
}

function freshTmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-flow-"));
}

/** Build a ctx stub that records every ui call and uses the fallback
 *  code paths in runSimplePicker / runSimpleConfirm (i.e. ctx.ui.select
 *  + ctx.ui.confirm). */
function makeCtx(
	cwd: string,
	responses: Partial<{
		select: (title: string, labels: string[]) => Promise<string | null>;
		input: (title: string) => Promise<string | null>;
		confirm: (title: string, message: string) => Promise<boolean>;
	}>,
): MockCtx {
	const calls: MockUiCall[] = [];
	const ctx = {
		cwd,
		// hasUI omitted → undefined; gate at `ctx.hasUI === false` does not fire; isTui() also returns false because ctx.mode !== "tui", so simple-picker uses the fallback path
		ui: {
			select: async (title: string, labels: string[]) => {
				calls.push({ method: "select", args: [title, labels] });
				if (responses.select) return responses.select(title, labels);
				return labels[0] ?? null;
			},
			input: async (title: string) => {
				calls.push({ method: "input", args: [title] });
				if (responses.input) return responses.input(title);
				return null;
			},
			confirm: async (title: string, message: string) => {
				calls.push({ method: "confirm", args: [title, message] });
				if (responses.confirm) return responses.confirm(title, message);
				return false;
			},
			notify: (message: string, level: string) => {
				calls.push({ method: "notify", args: [message, level] });
			},
			custom: () => () => undefined,
		},
		__calls: calls,
		__responses: responses,
	} as unknown as MockCtx;
	return ctx;
}

describe("/velpari-generate-sub-agents flow (Phase 5+6", () => {
	it("returns early in headless mode (ctx.hasUI === false)", async () => {
		const cwd = freshTmp();
		try {
			const ctx = makeCtx(cwd, {
				select: async () => "automation / scripts",
				input: async () => "typescript",
				confirm: async () => true,
			});
			// The headless-mode gate is `ctx.hasUI === false`; the orchestrator
			// exits with an empty result before any UI fallback can run.
			(ctx as unknown as { hasUI: boolean }).hasUI = false;
			const result = await runAgentGenerator(ctx);
			assert.equal(result.created, 0);
			assert.equal(result.cancelled, false);
			const notifyCall = ctx.__calls.find((c) => c.method === "notify");
			assert.ok(notifyCall, "expected at least one notify call");
			assert.match(String(notifyCall!.args[0]), /interactive terminal/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Plan E: all 4 brainstorm roles custom → write only 4 reviewer copies (silently)", async () => {
		const cwd = freshTmp();
		try {
			mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
			writeFileSync(
				join(cwd, ".pi", "velpari", "agents.json"),
				JSON.stringify({
					version: 1,
					agents: {
						extractor: "my-custom-1",
						"prd-checker": "my-custom-2",
						"rtm-checker": "my-custom-3",
						"web-search-agent": "my-custom-4",
					},
				}),
				"utf8",
			);
			const ctx = makeCtx(cwd, {});
			const result = await runAgentGenerator(ctx);
			// Plan E: brainstorm is fully custom (no write). Reviewer roles
			// (4) have default mappings → all 4 reviewer copies are written.
			// No mappings are added to agents.json because reviewer roles
			// don't go through the default-column mapping path.
			assert.equal(result.created, 4, "4 reviewer agents written; 0 brainstorm");
			assert.equal(result.mappingsAdded, 0);
			assert.equal(result.cancelled, false);
			// Expect a post-write summary notify, NOT the headless / all-custom bail.
			const summary = ctx.__calls.find(
				(c) =>
					c.method === "notify" &&
					/4 agents written/.test(String(c.args[0])),
			);
			assert.ok(summary, "expected the post-write summary '4 agents written'");
			// The "all 4 brainstorm roles already have custom" notify should NOT fire.
			const allCustomNotify = ctx.__calls.find(
				(c) =>
					c.method === "notify" && /already have custom agents/.test(String(c.args[0])),
			);
			assert.equal(allCustomNotify, undefined, "should NOT bail with all-custom");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("happy path: 3 questions → preview → confirm → 8 agents written + 4 mappings added", async () => {
		const cwd = freshTmp();
		try {
			const ctx = makeCtx(cwd, {
				select: async (_title, labels) => labels[0] ?? null,
				input: async () => "typescript",
				confirm: async () => true,
			});
			const result = await runAgentGenerator(ctx);

			assert.equal(result.cancelled, false);
			// Plan E: 4 brainstorm + 4 reviewer = 8 agents written.
			assert.equal(result.created, 8, "all 8 agents should be created");
			// Mappings added only for brainstorm roles (4 default mappings).
			assert.equal(result.mappingsAdded, 4);

			// The slug is derived from the cwd's directory basename (no
			// package.json in tmp dirs), so slugify the actual cwd basename.
			const slug = cwd
				.split("/")
				.pop()!
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "");

			// 4 agent files exist
			const agentsDir = join(cwd, ".pi", "agents");
			for (const role of ["extractor", "prd-checker", "rtm-checker", "web-search-agent"]) {
				const path = join(agentsDir, `${slug}-${role}.md`);
				assert.ok(existsSync(path), `agent file should exist at ${path}`);
			}

			// agents.json updated
			const agentsJson = JSON.parse(
				readFileSync(join(cwd, ".pi", "velpari", "agents.json"), "utf8"),
			) as { agents: Record<string, string> };
			assert.equal(Object.keys(agentsJson.agents).length, 4);
			assert.equal(agentsJson.agents.extractor, `${slug}-extractor`);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("single confirmation gate — ctx.ui.confirm is called exactly ONCE for the whole flow", async () => {
		const cwd = freshTmp();
		try {
			const ctx = makeCtx(cwd, {
				select: async (_title, labels) => labels[0] ?? null,
				input: async () => "typescript",
				confirm: async () => true,
			});
			await runAgentGenerator(ctx);
			const confirmCalls = ctx.__calls.filter((c) => c.method === "confirm");
			assert.equal(
				confirmCalls.length,
				1,
				`expected exactly 1 confirm call, got ${confirmCalls.length}`,
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("user-declined confirmation: nothing written, cancelled: true", async () => {
		const cwd = freshTmp();
		try {
			const ctx = makeCtx(cwd, {
				select: async (_title, labels) => labels[0] ?? null,
				input: async () => "typescript",
				confirm: async () => false,
			});
			const result = await runAgentGenerator(ctx);
			assert.equal(result.cancelled, true);
			assert.equal(result.created, 0);
			assert.equal(result.mappingsAdded, 0);

			const slug = "adi-mudi-pi-velpari";
			const agentsDir = join(cwd, ".pi", "agents");
			assert.ok(!existsSync(join(agentsDir, `${slug}-extractor.md`)));
			assert.ok(!existsSync(join(cwd, ".pi", "velpari", "agents.json")));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("cancelled project-type picker → cancelled: true, no writes", async () => {
		const cwd = freshTmp();
		try {
			const ctx = makeCtx(cwd, {
				select: async () => null, // user pressed Esc on the first picker
				input: async () => "typescript",
				confirm: async () => true,
			});
			const result = await runAgentGenerator(ctx);
			assert.equal(result.cancelled, true);
			const confirmCalls = ctx.__calls.filter((c) => c.method === "confirm");
			assert.equal(confirmCalls.length, 0, "no confirm should be reached");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("empty primary-language input → notify error + cancelled: true", async () => {
		const cwd = freshTmp();
		try {
			const ctx = makeCtx(cwd, {
				select: async (_title, labels) => labels[0] ?? null,
				input: async () => "", // empty language
				confirm: async () => true,
			});
			const result = await runAgentGenerator(ctx);
			assert.equal(result.cancelled, true);
			const errNotify = ctx.__calls.find(
				(c) => c.method === "notify" && /Primary language is required/.test(String(c.args[0])),
			);
			assert.ok(errNotify, "expected the 'Primary language is required' notify");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("custom-agent non-clobber: a hand-made file under .pi/agents/ is not touched", async () => {
		const cwd = freshTmp();
		try {
			const customAgent = join(cwd, ".pi", "agents", "my-hand-made-agent.md");
			mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
			const handMade = "# my hand-made agent — must survive generation\n";
			writeFileSync(customAgent, handMade, "utf8");

			const ctx = makeCtx(cwd, {
				select: async (_title, labels) => labels[0] ?? null,
				input: async () => "typescript",
				confirm: async () => true,
			});
			await runAgentGenerator(ctx);

			// Hand-made file untouched
			assert.equal(readFileSync(customAgent, "utf8"), handMade);

			// And not in agents.json (custom agents are not mapped unless the user did so)
			const agentsJson = JSON.parse(
				readFileSync(join(cwd, ".pi", "velpari", "agents.json"), "utf8"),
			) as { agents: Record<string, string> };
			assert.ok(!("my-hand-made-agent" in agentsJson.agents));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("post-write notify carries the create count", async () => {
		const cwd = freshTmp();
		try {
			const ctx = makeCtx(cwd, {
				select: async (_title, labels) => labels[0] ?? null,
				input: async () => "typescript",
				confirm: async () => true,
			});
			await runAgentGenerator(ctx);
			const summary = ctx.__calls.find(
				(c) => c.method === "notify" && /Done\./.test(String(c.args[0])),
			);
			assert.ok(summary, "expected the post-write summary notify");
			assert.match(String(summary!.args[0]), /8 agents written/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
