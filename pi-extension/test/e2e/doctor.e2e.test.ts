/**
 * E2E smoke test for the Velpari extension.
 *
 * Loads the built extension into a real Pi session (via
 * `pi-coding-agent-test`) and verifies `/velpari-doctor` runs without
 * error. This is the simplest interactive flow — Doctor has no
 * interview loop, no gate checks, no LLM-driven subagent fan-out —
 * so it's the right place to validate the e2e infrastructure first.
 *
 * Other e2e tests (per stage) can be added later using the same pattern.
 *
 * To run: `RUN_E2E=1 npm run test:e2e`
 * (Requires `pi` on $PATH and an LLM API key.)
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	PiIntegrationTest,
	testArtifactsDir,
	assistantMessage,
	text,
} from "pi-coding-agent-test";

import { EXTENSION_PATH, describeE2eSkip, e2eEnabled } from "./_setup.js";

const t = e2eEnabled() ? test : test.skip;

t("Velpari extension loads into a real Pi session and /velpari-doctor runs", async () => {
	const workspace = await mkdtemp(path.join(tmpdir(), "velpari-e2e-doctor-"));
	try {
		// Load the built extension into a real Pi session and run the doctor command.
		// The doctor handler calls ctx.ui.notify with the audit report and writes
		// it to .IDE_Plans/velpari/doctor-report.md. We can't directly observe
		// the notification from outside Pi, but we CAN verify:
		//  (a) the test produced a result (no exception thrown)
		//  (b) the doctor-report.md was written to the workspace
		//  (c) the report contains the expected sections
		const result = await new PiIntegrationTest({
			testName: "velpari-doctor-smoke",
			artifactsDir: testArtifactsDir(import.meta.filename),
			cwd: workspace,
			extensions: [EXTENSION_PATH],
			conversation: [
				assistantMessage([text("Doctor audit complete.")], { stopReason: "stop" }),
			],
		}).run("/velpari-doctor");

		assert.ok(result, "PiIntegrationTest should produce a result");

		// Assert the doctor wrote its report to the isolated workspace.
		const reportPath = path.join(workspace, ".IDE_Plans", "velpari", "doctor-report.md");
		const report = await readFile(reportPath, "utf8");
		assert.ok(report.includes("## Multiplexer"), "doctor-report.md should have Multiplexer section");
		assert.ok(report.includes("## Scout agents"), "doctor-report.md should have Scout agents section");
		assert.ok(report.includes("## Stage skills"), "doctor-report.md should have Stage skills section");
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});

t("E2E gate: this test is skipped when prerequisites are missing", () => {
	if (e2eEnabled()) {
		// If we got here, the gate passed. Sanity-check the extension path.
		assert.ok(
			EXTENSION_PATH.length > 0,
			"EXTENSION_PATH should be a non-empty string",
		);
	} else {
		// The test is skipped. Record the reason so the user knows why.
		// (The skip itself happens via test.skip; this branch just documents.)
		const reason = describeE2eSkip();
		// eslint-disable-next-line no-console
		console.log(`[velpari-e2e] skipped: ${reason}`);
	}
});
