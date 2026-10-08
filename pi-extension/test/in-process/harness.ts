/**
 * L3 in-process test harness for Velpari.
 *
 * Wraps `pi-coding-agent-test` (https://pi.dev/packages/pi-coding-agent-test)
 * to spawn a real Pi subprocess with the compiled Velpari extension loaded,
 * a deterministic scripted LLM provider, and an isolated workspace.
 *
 * Trade-offs vs RPC e2e (Tier 1):
 *   - PRO: deterministic LLM responses — no key needed, no flakiness
 *   - PRO: real Pi subprocess loads the full extension (commands, hooks,
 *     skills, doctor, ui)
 *   - CON: spawns a real Pi process (~1-3s overhead per test)
 *   - CON: requires `pi` on PATH + Node 22.19+
 *
 * Use for flows that need scripted LLM determinism but full extension
 * load. Use RPC e2e (Tier 1) for command-only flows that don't need
 * LLM scripting. Use unit tests for pure logic.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PiIntegrationTest,
	testArtifactsDir,
	type AssistantMessageScenario,
	type PiIntegrationTestOptions,
} from "pi-coding-agent-test";

export { testArtifactsDir };
export type { AssistantMessageScenario, PiIntegrationTestOptions };

/** Path to the built extension entry point. */
export const EXTENSION_ENTRY = join(process.cwd(), "dist/pi-extension/src/index.js");

/** Temp workspaces created by defaultOptions; drained by cleanupHarnessWorkspaces(). */
const workspaces: string[] = [];

/**
 * Remove every temp workspace this module created since the last call.
 * Consumers call it from their after()/teardown hook (I12.1 sweep).
 * @returns {void}
 */
export function cleanupHarnessWorkspaces(): void {
	for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * Default options for a Velpari in-process test. Override per-test as
 * needed. Each test gets a fresh temp workspace.
 */
export function defaultOptions(testName: string): PiIntegrationTestOptions {
	const cwd = mkdtempSync(join(tmpdir(), "velpari-l3-"));
	workspaces.push(cwd);
	return {
		testName: `velpari-${testName}`,
		artifactsDir: testArtifactsDir(import.meta.filename),
		cwd,
		// Point Pi at our compiled extension via the `extensions` array.
		// The harness loads it as if it were a package-local extension.
		extensions: [EXTENSION_ENTRY],
		// Disable skill discovery + raw mode for deterministic tests.
		rawMode: true,
		isolateUserResources: true,
		timeoutMs: 30_000,
	};
}

/** Helper to create a PiIntegrationTest with the Velpari defaults. */
export function makeTest(testName: string, overrides: Partial<PiIntegrationTestOptions> = {}): PiIntegrationTest {
	return new PiIntegrationTest({ ...defaultOptions(testName), ...overrides });
}
