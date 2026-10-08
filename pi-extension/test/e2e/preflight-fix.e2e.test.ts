/**
 * Phase 6.5 — E2E: broken config detected → remediate repairs →
 * preflight clean → command-proceeds boundary (plan §6.5).
 *
 * Tier-1 RPC suite following `doctor.e2e.test.ts` exactly: synthetic
 * test home (`makeTestHome`) + real `pi --mode rpc --no-session`
 * (`RpcClient`) — the preflight is driven over the RPC `bash` channel
 * and its result travels via a FILE (never stdout, which the bash
 * channel truncates near 50KB).
 *
 * Embedded scripts contain NO backticks and NO `${...}` (bash-channel
 * convention) — string concatenation only.
 *
 * Tier 1 only. No LLM key required.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, distModuleUrl, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedVelpariConfig } from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

/** Valid v4 config content (rewritten between the untracked/tracked cases). */
const VALID_CONFIG = JSON.stringify({ version: 4, projectName: "E2EFixture" });

describe("e2e/preflight-fix", () => {
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

	/**
	 * Drive `runPreflight` over the RPC bash channel; result via transport FILE.
	 * @returns {Promise<{ok: boolean, hardStop: string | null, findings: Array<{blocking: boolean, fingerprint: string}>}>} The parsed preflight result.
	 */
	async function runPreflightJson(): Promise<{
		ok: boolean;
		hardStop: string | null;
		findings: Array<{ blocking: boolean; fingerprint: string }>;
	}> {
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: [
				"node --input-type=module -e",
				JSON.stringify(
					'import { writeFileSync } from "node:fs"; ' +
						`import { runPreflight } from ${JSON.stringify(distModuleUrl("doctor/preflight.js"))}; ` +
						'const r = runPreflight(process.cwd(), { command: "/velpari-prd", mode: "stage-start" }); ' +
						'writeFileSync(process.cwd() + "/preflight-result.json", JSON.stringify(r)); ' +
						'process.stdout.write("PREFLIGHT " + r.ok);',
				),
			].join(" "),
		});
		assert.equal(result.success, true, `preflight subprocess failed: ${JSON.stringify(result.error ?? result)}`);
		const parsed = JSON.parse(readFileSync(join(home.cwd, "preflight-result.json"), "utf8"));
		return parsed;
	}

	/**
	 * Run the `config-restore-git` remediate over the RPC bash channel.
	 * @returns {Promise<{changedFiles: string[]}>} The parsed remediate outcome.
	 */
	async function runConfigRestore(): Promise<{ changedFiles: string[] }> {
		assert.ok(client && home, "test setup missing");
		const result = await client.request<any>("bash", {
			command: [
				"node --input-type=module -e",
				JSON.stringify(
					'import { writeFileSync } from "node:fs"; ' +
						`import { remediate } from ${JSON.stringify(
							distModuleUrl("doctor/checks/remediate/config-restore-git.js"),
						)}; ` +
						'const r = await remediate({ cwd: process.cwd(), projectName: "E2EFixture" }); ' +
						'writeFileSync(process.cwd() + "/remediate-result.json", JSON.stringify(r)); ' +
						'process.stdout.write("REMEDIATED " + r.changedFiles.length);',
				),
			].join(" "),
		});
		assert.equal(result.success, true, `remediate subprocess failed: ${JSON.stringify(result.error ?? result)}`);
		return JSON.parse(readFileSync(join(home.cwd, "remediate-result.json"), "utf8"));
	}

	it("(a) corrupt UNTRACKED files.json → blocking config-unreadable", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(home, "test setup missing");
		writeFileSync(join(home.cwd, ".pi", "velpari", "files.json"), "{broken", "utf8");

		const preflight = await runPreflightJson();
		assert.equal(preflight.ok, false, "corrupt config must block");
		assert.equal(preflight.hardStop, null, "config corruption is a finding, not a session hard stop");
		const row4 = preflight.findings.find((f) => f.fingerprint === "config-unreadable");
		assert.ok(row4, `expected config-unreadable, got ${JSON.stringify(preflight.findings.map((f) => f.fingerprint))}`);
		assert.equal(row4.blocking, true, "config-unreadable must be blocking");
	});

	it("(b) tracked corrupt → config-restore-git repairs → preflight clean (command proceeds)", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(home, "test setup missing");
		// Commit a VALID config at HEAD, then corrupt the working copy —
		// the tracked+invalid shape the restore remediate needs.
		writeFileSync(join(home.cwd, ".pi", "velpari", "files.json"), VALID_CONFIG, "utf8");
		/**
		 * Run one git setup command in the test-home project (throws on failure).
		 * @param {...string} args - Arguments after `git` (e.g. `init`, `-q`).
		 * @returns {void} Nothing; throws when the command fails.
		 */
		const git = (...args: string[]): void => {
			const r = spawnSync("git", args, { cwd: home!.cwd, encoding: "utf8" });
			if (r.error) throw r.error;
			if (r.status !== 0 && !args.includes("commit")) {
				throw new Error(`git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
			}
		};
		git("init", "-q");
		git("add", ".pi/velpari/files.json");
		git("-c", "user.email=t@t.local", "-c", "user.name=T", "commit", "-q", "-m", "init");
		writeFileSync(join(home.cwd, ".pi", "velpari", "files.json"), "{broken", "utf8");

		const blocked = await runPreflightJson();
		assert.equal(blocked.ok, false, "tracked corrupt config must block");
		const restoreRow = blocked.findings.find((f) => f.fingerprint === "config-restore-git");
		assert.ok(
			restoreRow,
			`expected config-restore-git, got ${JSON.stringify(blocked.findings.map((f) => f.fingerprint))}`,
		);
		assert.equal(restoreRow.blocking, true);

		// The doctor-fixes path: remediate restores HEAD → preflight clean.
		const fixed = await runConfigRestore();
		assert.ok(fixed.changedFiles.length >= 1, "config-restore-git must have restored the tracked file");
		const clean = await runPreflightJson();
		assert.equal(clean.ok, true, "preflight must be clean after the repair — the original command proceeds");
		assert.equal(
			clean.findings.some((f) => f.blocking),
			false,
			"no blocking finding may remain",
		);
	});

	it("(c) /velpari-doctor still registered", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client, "test setup missing");
		const result = await client.getCommands();
		const names = (result.commands ?? []).map((c: { name: string }) => String(c.name).replace(/^\//, ""));
		assert.ok(names.includes("velpari-doctor"), `/velpari-doctor missing: ${names.join(", ")}`);
	});
});
