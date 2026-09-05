/**
 * E2E smoke test for the Velpari Doctor command.
 *
 * Replaces the prior PiIntegrationTest-based test. That test relied on a
 * scripted LLM conversation to keep Pi's interactive loop alive long
 * enough for `/velpari-doctor` to finish — but the framework's settle
 * detector never observed the run as complete on real `pi` versions, so
 * the test timed out at 30s despite Doctor actually writing its report.
 *
 * The new flow (mirrors pi-seani/15-doctor-full-run.test.ts):
 *
 *   1. Spin up a synthetic test home (`makeTestHome`) with the built
 *      extension symlinked into `~/.pi/agent/extensions/pi-velpari`.
 *   2. Spawn a real `pi --mode rpc --no-session` (`RpcClient`) against
 *      that home. No interactive prompt is sent — we never go near the
 *      LLM. Tier 1 therefore needs no real API key.
 *   3. Drive `runDoctor(cwd)` directly via the RPC `bash` channel: the
 *      server runs `node --input-type=module -e "import { runDoctor }
 *      from '<built module>'; process.stdout.write(runDoctor(process.cwd()))"`.
 *   4. Write the report to disk by importing `writeDoctorReport` from
 *      the same module, then assert on the `.IDE_Plans/velpari/doctor-report.md`
 *      file directly.
 *
 * Tier 1 only. No LLM key required.
 */

import { describe, it, before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

import { RpcClient } from "./helpers/rpc-client.js";
import {
	makeTestHome,
	distModuleUrl,
	shouldRunE2E,
	type TestHome,
} from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedVelpariConfig } from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

describe("e2e/doctor", () => {
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

	it(
		"runDoctor over RPC bash writes the expected sections and the on-disk report",
		{ timeout: 60_000 },
		async (t) => {
			if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
			assert.ok(client && home, "test setup missing");

			// Drive `runDoctor` directly through the RPC bash channel. The
			// subprocess runs in `home.cwd`, so process.cwd() inside the
			// script sees our temp project (and the .pi/velpari/files.json
			// the fixture wrote). We JSON-encode the report via
			// JSON.stringify so quoting issues in the markdown cannot
			// break the bash round trip.
			const result = await client.request<any>("bash", {
				command: [
					"node --input-type=module -e",
					JSON.stringify(
						`import { runDoctor } from ${JSON.stringify(distModuleUrl("doctor.js"))}; ` +
							`process.stdout.write(JSON.stringify(runDoctor(process.cwd())));`,
					),
				].join(" "),
			});
			assert.ok(
				result.success === true,
				`runDoctor subprocess failed: ${JSON.stringify(result.error ?? result)}`,
			);
			const output: string = result.data?.output ?? result.output ?? "";
			assert.ok(output.length > 0, "runDoctor subprocess produced no output");
			const report = JSON.parse(output) as string;

			// Top-level sections Doctor always emits (see doctor.ts lines
			// 342, 376, 405/409, 421, 447, 480).
			const expectedSections = [
				"## Requirements profile",
				"## Doc/ artifacts",
				"## Multiplexer (required for /velpari-discuss v2.0)",
				"## Scout agents (.pi/agents/)",
				"## Stage skills",
			];
			for (const want of expectedSections) {
				assert.ok(
					report.includes(want),
					`doctor report missing section heading: ${want}`,
				);
			}

			// Persist to disk via writeDoctorReport (same module). Mirrors
			// the real handler's flow: runDoctor → writeDoctorReport → notify.
			const writeRes = await client.request<any>("bash", {
				command: [
					"node --input-type=module -e",
					JSON.stringify(
						`import { writeDoctorReport, runDoctor } from ${JSON.stringify(distModuleUrl("doctor.js"))}; ` +
							`writeDoctorReport(runDoctor(process.cwd()), process.cwd());`,
					),
				].join(" "),
			});
			assert.ok(
				writeRes.success === true,
				`writeDoctorReport subprocess failed: ${JSON.stringify(writeRes.error ?? writeRes)}`,
			);

			const reportPath = `${home.cwd}/.IDE_Plans/velpari/doctor-report.md`;
			assert.ok(
				existsSync(reportPath),
				`doctor-report.md was not written to ${reportPath}`,
			);
			const onDisk = readFileSync(reportPath, "utf8");
			assert.ok(
				onDisk.includes("## Multiplexer"),
				"on-disk doctor-report.md missing Multiplexer section",
			);
			assert.ok(
				onDisk.includes("## Scout agents"),
				"on-disk doctor-report.md missing Scout agents section",
			);
			assert.ok(
				onDisk.includes("## Stage skills"),
				"on-disk doctor-report.md missing Stage skills section",
			);
		},
	);
});

test("E2E gate: this suite is skipped when Tier 1 prerequisites are missing", () => {
	if (!tier1Enabled()) {
		// eslint-disable-next-line no-console
		console.log(`[velpari-e2e] Tier 1 skipped: ${describeTier1Skip()}`);
	}
});
