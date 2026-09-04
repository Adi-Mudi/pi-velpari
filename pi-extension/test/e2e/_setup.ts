/**
 * Shared setup helpers for e2e tests in test/e2e/*.e2e.test.ts.
 *
 * Gate the entire e2e suite on:
 *  - RUN_E2E=1 (developer opt-in; CI never sets this)
 *  - `pi` executable on $PATH
 *  - ANTHROPIC_API_KEY or OPENAI_API_KEY (LLM key for real Pi)
 *  - dist/pi-extension/src/index.js exists (must run `npm run build` first)
 *
 * If any condition is missing, e2e tests skip silently (they don't fail
 * the regular `npm test` run).
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Path to the built Velpari extension (must exist after `npm run build`). */
export const EXTENSION_PATH = resolve(process.cwd(), "dist/pi-extension/src/index.js");

/** Reason e2e is skipped. `null` when e2e can run. */
export type E2eSkipReason = "no-env-flag" | "no-pi" | "no-llm-key" | "no-build" | null;

/** Return the reason e2e is being skipped, or null if it can run. */
export function getE2eSkipReason(): E2eSkipReason {
	if (process.env.RUN_E2E !== "1") return "no-env-flag";
	if (!commandExists("pi")) return "no-pi";
	if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) return "no-llm-key";
	if (!existsSync(EXTENSION_PATH)) return "no-build";
	return null;
}

/** True if e2e tests should run. */
export function e2eEnabled(): boolean {
	return getE2eSkipReason() === null;
}

/** Throw a clear error if `command` is not on $PATH. */
function commandExists(command: string): boolean {
	try {
		execSync(`command -v ${command}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** Human-readable reason (for skip messages). */
export function describeE2eSkip(): string {
	switch (getE2eSkipReason()) {
		case "no-env-flag":
			return "RUN_E2E=1 not set";
		case "no-pi":
			return "`pi` executable not on $PATH";
		case "no-llm-key":
			return "neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set";
		case "no-build":
			return `built extension not found at ${EXTENSION_PATH} — run \`npm run build\``;
		default:
			return "ready";
	}
}