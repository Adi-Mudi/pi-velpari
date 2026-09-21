/**
 * /velpari-generate-sub-agents flow tests (generator v2 — per-phase).
 *
 * Mocks `ctx.ui` to drive the orchestration without a real TUI.
 * Mirrors `pi-seani/.../test/commands/16-generator-preview.e2e.test.ts`
 * shape, scoped to the unit-test runner (no RPC).
 *
 * Coverage:
 *   - TUI-less headless guard returns early with "warning" notify.
 *   - Nothing-to-do guard (all-custom mapping for the phase): notify + return.
 *   - Cancelled project-type picker: returns cancelled: true.
 *   - Empty language: notify + return cancelled.
 *   - Single confirmation gate: ctx.ui.confirm is called exactly ONCE.
 *   - User-declined confirmation: nothing written, cancelled: true.
 *   - Happy path Phase 1 (auto-detected on an empty project): 4 brainstorm
 *     agents written + 4 mappings added.
 *   - Phase override + auto-detect for Phase 3: 17 roles generated from the
 *     bundled templates (13 scouts + 4 reviewers), interview shrinks to the
 *     project-type picker when language/framework are on disk (D3).
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
import { parsePhaseArg, runAgentGenerator } from "../../src/commands/generate-sub-agents.js";
import { feasibilityRecordPath } from "../../src/core/feasibility-record.js";
import { writeYamlFile } from "../../src/core/yaml-data.js";

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

	it("all Phase 1 roles custom → bail with nothing-to-generate (no writes)", async () => {
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
			// v2: reviewers belong to Phase 3 — an all-custom Phase 1 bails
			// instead of silently writing reviewer copies.
			assert.equal(result.created, 0);
			assert.equal(result.mappingsAdded, 0);
			assert.equal(result.cancelled, false);
			const allCustomNotify = ctx.__calls.find(
				(c) =>
					c.method === "notify" && /All Phase 1 roles already have custom agents/.test(String(c.args[0])),
			);
			assert.ok(allCustomNotify, "expected the all-custom bail notify");
			// No confirm gate, no files.
			assert.equal(ctx.__calls.filter((c) => c.method === "confirm").length, 0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("happy path Phase 1: picker + 2 inputs → preview → confirm → 4 agents written + 4 mappings", async () => {
		const cwd = freshTmp();
		try {
			const ctx = makeCtx(cwd, {
				select: async (_title, labels) => labels[0] ?? null,
				input: async () => "typescript",
				confirm: async () => true,
			});
			const result = await runAgentGenerator(ctx);

			assert.equal(result.cancelled, false);
			// Phase 1 (auto-detected — empty project, stage "none"): the 4
			// brainstorm roles only.
			assert.equal(result.created, 4, "all 4 brainstorm agents should be created");
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
			assert.match(String(summary!.args[0]), /4 agents written/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("/velpari-generate-sub-agents — per-phase selection (generator v2)", () => {
	function slugOf(cwd: string): string {
		return cwd
			.split("/")
			.pop()!
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	it("--phase 3 override generates all 17 Phase-3 roles from the bundled templates", async () => {
		const cwd = freshTmp();
		try {
			const ctx = makeCtx(cwd, {
				select: async (_t, labels) => labels[0] ?? null,
				input: async () => "typescript",
				confirm: async () => true,
			});
			const result = await runAgentGenerator(ctx, { phase: 3 });
			assert.equal(result.cancelled, false);
			assert.equal(result.created, 17, "13 stage scouts + 4 reviewers");
			assert.equal(result.mappingsAdded, 17);

			const slug = slugOf(cwd);
			const agentsDir = join(cwd, ".pi", "agents");
			for (const role of [
				"design-style-selector",
				"af-source-rtm",
				"pseudo-consolidator",
				"reviewer",
				"pseudocode-reviewer",
				"testplan-reviewer",
				"design-reviewer",
			]) {
				assert.ok(existsSync(join(agentsDir, `${slug}-${role}.md`)), `${role} should be generated`);
			}
			// agents.json maps reviewer roles too (D4 — all generated roles).
			const agentsJson = JSON.parse(
				readFileSync(join(cwd, ".pi", "velpari", "agents.json"), "utf8"),
			) as { agents: Record<string, string> };
			assert.equal(agentsJson.agents.reviewer, `${slug}-reviewer`);
			assert.equal(Object.keys(agentsJson.agents).length, 17);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("auto-detect: currentStage analyzed-feasibility → Phase 3", async () => {
		const cwd = freshTmp();
		try {
			mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
			writeFileSync(
				join(cwd, ".pi", "velpari", "state.json"),
				JSON.stringify({ version: 1, currentStage: "analyzed-feasibility", mission: "demo" }),
				"utf8",
			);
			const ctx = makeCtx(cwd, {
				select: async (_t, labels) => labels[0] ?? null,
				input: async () => "typescript",
				confirm: async () => true,
			});
			const result = await runAgentGenerator(ctx);
			assert.equal(result.created, 17, "Phase 3 auto-detected from run state");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("auto-detect: currentStage brainstormed → Phase 2 (14 roles)", async () => {
		const cwd = freshTmp();
		try {
			mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
			writeFileSync(
				join(cwd, ".pi", "velpari", "state.json"),
				JSON.stringify({ version: 1, currentStage: "brainstormed", mission: "demo" }),
				"utf8",
			);
			const ctx = makeCtx(cwd, {
				select: async (_t, labels) => labels[0] ?? null,
				input: async () => "typescript",
				confirm: async () => true,
			});
			const result = await runAgentGenerator(ctx);
			assert.equal(result.created, 14, "Phase 2: prd 4 + rtm 4 + feasibility 4 + 2 conditional");
			assert.equal(result.mappingsAdded, 14);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("D3: interview asks only the project type when language + framework are on disk", async () => {
		const cwd = freshTmp();
		try {
			mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
			writeFileSync(
				join(cwd, ".pi", "velpari", "files.json"),
				JSON.stringify({
					version: 4,
					projectName: "demo",
					framework: { language: "rust", runtime: "tokio" },
				}),
				"utf8",
			);
			writeYamlFile(feasibilityRecordPath(cwd, "demo"), {
				project: "demo",
				verdict: "build",
				selectedLanguage: "rust",
				selectedBy: "user",
				languageCandidates: [],
				spikeResults: [],
				reuseSummary: [],
				recordedAt: "2026-09-21T00:00:00.000Z",
			});
			const ctx = makeCtx(cwd, {
				select: async (_t, labels) => labels[0] ?? null,
				input: async () => {
					throw new Error("ctx.ui.input must not be called — language and framework are on disk");
				},
				confirm: async () => true,
			});
			const result = await runAgentGenerator(ctx, { phase: 3 });
			assert.equal(result.created, 17);
			assert.equal(
				ctx.__calls.filter((c) => c.method === "input").length,
				0,
				"no input questions when language + framework are on disk",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("parsePhaseArg: parses --phase N, distinguishes absent from malformed", () => {
		assert.equal(parsePhaseArg(""), null);
		assert.equal(parsePhaseArg("--phase 3"), 3);
		assert.equal(parsePhaseArg("--phase=2"), 2);
		assert.equal(parsePhaseArg("--phase 1"), 1);
		assert.equal(parsePhaseArg("--phase 9"), "invalid");
		assert.equal(parsePhaseArg("--phase x"), "invalid");
		assert.equal(parsePhaseArg("--phase"), "invalid");
	});
});
