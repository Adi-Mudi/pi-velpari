/**
 * E2E registration test for the Velpari extension.
 *
 * Proves the extension was actually loaded by a real `pi --mode rpc`
 * process by hitting the `get_commands` RPC and asserting the names of
 * Velpari's slash commands appear in the response.
 *
 * Tier 1 only — no LLM call required. Mirrors pi-seani's
 * `01-registration.test.ts`.
 *
 * We check a small representative subset (`/velpari-doctor` and
 * `/velpari-show-prd`) rather than every one of the 25 commands:
 *
 *   - `/velpari-doctor` is the discipline / audit command. It has no
 *     interview, no scout fan-out, and no gate dependencies — its mere
 *     presence in `get_commands` proves the extension's command
 *     registry is wired up correctly.
 *   - `/velpari-show-prd` is a view command. It uses the same
 *     `registerCommand` path as the stage commands but does NOT take
 *     any LLM-dependent code path; if it shows up, the registry path
 *     covers both real handlers and stubs.
 *
 * Per-command coverage belongs in unit tests in `pi-extension/test/`.
 * E2E registration is a smoke test on top of those.
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

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

describe("e2e/registration", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedVelpariConfig(home, { projectName: "E2EFixture" });
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("get_commands reports /velpari-doctor", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");
		const result = await client.getCommands();
		const names = (result.commands ?? []).map((c: { name: string }) =>
			String(c.name).replace(/^\//, ""),
		);
		assert.ok(
			names.includes("velpari-doctor"),
			`/velpari-doctor missing from registered commands: ${names.join(", ")}`,
		);
	});

	it("get_commands reports /velpari-show-prd", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");
		const result = await client.getCommands();
		const names = (result.commands ?? []).map((c: { name: string }) =>
			String(c.name).replace(/^\//, ""),
		);
		assert.ok(
			names.includes("velpari-show-prd"),
			`/velpari-show-prd missing from registered commands: ${names.join(", ")}`,
		);
	});
});
