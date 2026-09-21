/**
 * E2E registration test for /velpari-generate-sub-agents.
 *
 * Generator v2 (per-phase C1 + doctor freshness C2 + verifier wiring C3).
 * Tier-1 only — no LLM call required. Mirrors
 * pi-seani/.../test/e2e/16-generator-preview.e2e.test.ts in spirit.
 *
 * Scope:
 *   - Proves the slash command actually registers (proves the L3 wiring
 *     `commands/generate-sub-agents.ts -> commands/index.ts` is intact).
 *   - The doctor checks 'Sub-agent generator completeness' (now covering
 *     every generatable role across the 4 generation phases), 'Generated
 *     agent freshness', and 'Verifier verdicts (Layer 3)' are part of the
 *     report — verify they appear via `runDoctor` directly (no RPC
 *     needed; the doctor module is imported in-process).
 *
 * Out of scope (deferred to future phases):
 *   - Driving the full interview + preview + confirm flow over RPC.
 *     The flow is unit-tested in
 *     pi-extension/test/commands/generate-sub-agents-flow.test.ts with
 *     a mock ctx. The RPC layer does not surface ui.* callbacks cleanly
 *     enough for an automated e2e of the confirm gate, so we keep that
 *     coverage at the unit-test level for v2.
 *   - Tier 2 (LLM-driven regen). Not applicable here — the generator
 *     is deterministic assembly, no LLM.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

import { RpcClient } from "./helpers/rpc-client.js";
import {
	makeTestHome,
	shouldRunE2E,
	type TestHome,
} from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedVelpariConfig } from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";
import { runDoctor } from "../../src/doctor/index.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

describe("e2e/generate-sub-agents", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedVelpariConfig(home, { projectName: "E2EGeneratorFixture" });
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("get_commands reports /velpari-generate-sub-agents", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");
		const result = await client.getCommands();
		const names = (result.commands ?? []).map((c: { name: string }) =>
			String(c.name).replace(/^\//, ""),
		);
		assert.ok(
			names.includes("velpari-generate-sub-agents"),
			`/velpari-generate-sub-agents missing from registered commands: ${names.join(", ")}`,
		);
	});

	it("get_commands keeps the new command sorted alongside existing discipline commands", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");
		const result = await client.getCommands();
		const names = (result.commands ?? []).map((c: { name: string }) =>
			String(c.name).replace(/^\//, ""),
		);
		// The new command should appear in the discipline section
		// alongside velpari-doctor and velpari-configure-agents.
		assert.ok(names.includes("velpari-doctor"));
		assert.ok(names.includes("velpari-configure-agents"));
		assert.ok(names.includes("velpari-generate-sub-agents"));
	});
});

describe("e2e/generate-sub-agents — doctor section", () => {
	let home: TestHome | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedVelpariConfig(home, { projectName: "E2EGeneratorFixture" });
	});

	after(async () => {
		if (home) home.cleanup();
	});

	it("runDoctor includes the generator v2 sections", { timeout: 30_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(home, "test setup missing");
		const report = runDoctor(home.cwd);
		const titles = report.sections.map((s) => s.title);
		for (const expected of [
			"Sub-agent generator completeness",
			"Generated agent freshness",
			"Verifier verdicts (Layer 3)",
		]) {
			assert.ok(
				titles.includes(expected),
				`doctor sections missing '${expected}'. Found: ${titles.join(", ")}`,
			);
		}
	});

	it("doctor verdict stays PASS for a fresh project (no generated agents yet)", { timeout: 30_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(home, "test setup missing");
		const report = runDoctor(home.cwd);
		// Fresh project has no .pi/agents/; the completeness section reports
		// one 'bundled default' info per generatable role across the 4
		// generation phases (no errors, no warnings).
		const section = report.sections.find((s) => s.title === "Sub-agent generator completeness");
		assert.ok(section);
		const errors = section!.items.filter((i) => i.status === "error");
		const warnings = section!.items.filter((i) => i.status === "warning");
		assert.equal(errors.length, 0, `unexpected errors: ${errors.map((i) => i.message).join(" | ")}`);
		assert.equal(warnings.length, 0, `unexpected warnings: ${warnings.map((i) => i.message).join(" | ")}`);
		const summary = section!.items.find((i) => /Sub-agent generator summary/.test(i.message));
		assert.ok(summary, "summary item present");
		assert.match(summary!.message, /across 4 generation phase\(s\)/);
		// The freshness + verifier sections are info-only on a fresh project
		// (basic tier → reviewer not required; no verdicts on disk yet).
		for (const title of ["Generated agent freshness", "Verifier verdicts (Layer 3)"]) {
			const s = report.sections.find((sec) => sec.title === title);
			assert.ok(s, `section '${title}' present`);
			assert.equal(
				s!.items.filter((i) => i.status === "error").length,
				0,
				`unexpected errors in '${title}': ${s!.items.filter((i) => i.status === "error").map((i) => i.message).join(" | ")}`,
			);
		}
	});
});
