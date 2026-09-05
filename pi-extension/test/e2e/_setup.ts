/**
 * Shared setup helpers for e2e tests in test/e2e/*.e2e.test.ts.
 *
 * Two-tier gate (see /home/divakaran/.kimi-code/AGENTS.md → "core"
 * discipline — every gate the suite enforces is documented here so a
 * reviewer knows what each skip message means):
 *
 *   Tier 1 — runs in regular CI on every PR.
 *     - RUN_E2E=1 (developer opt-in or CI flag)
 *     - `pi` executable on $PATH
 *     - dist/pi-extension/src/index.js exists (run `npm run build` first)
 *     - No LLM key required. Tier 1 tests assert on registration
 *       (`get_commands` over RPC) and on the doctor module's output
 *       (`runDoctor` invoked via the RPC `bash` channel). Neither path
 *       ever calls the model.
 *
 *   Tier 2 — runs only on nightly schedule, manual dispatch with
 *     tier2=true, or PRs that carry the `e2e:llm` label.
 *     - Tier 1 gates, PLUS
 *     - RUN_LLM_E2E=1
 *     - A recognized provider API key set to a non-dummy value.
 *
 * If any condition is missing, the affected tier skips silently —
 * `npm test` does not fail when e2e is unavailable.
 *
 * The two tier helpers live in `helpers/test-home.ts` so the same
 * isolation primitives back both tiers.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export { shouldRunE2E, shouldRunLLME2E, hasRealLlmKey } from "./helpers/test-home.js";

/** Path to the built Velpari extension (must exist after `npm run build`). */
export const EXTENSION_PATH = resolve(process.cwd(), "dist/pi-extension/src/index.js");

/** Reason Tier 1 is skipped. `null` when Tier 1 can run. */
export type Tier1SkipReason = "no-env-flag" | "no-pi" | "no-build" | null;

/** Reason Tier 2 is skipped. `null` when Tier 2 can run. */
export type Tier2SkipReason = Tier1SkipReason | "no-tier2-flag" | "no-llm-key";

/** Return the reason Tier 1 is being skipped, or null if it can run. */
export function getTier1SkipReason(): Tier1SkipReason {
	if (process.env.RUN_E2E !== "1") return "no-env-flag";
	if (!commandExists("pi")) return "no-pi";
	if (!existsSync(EXTENSION_PATH)) return "no-build";
	return null;
}

/** True if Tier 1 e2e tests should run. */
export function tier1Enabled(): boolean {
	return getTier1SkipReason() === null;
}

/** Return the reason Tier 2 is being skipped, or null if it can run. */
export function getTier2SkipReason(): Tier2SkipReason {
	const base = getTier1SkipReason();
	if (base !== null) return base;
	if (process.env.RUN_LLM_E2E !== "1") return "no-tier2-flag";
	const dummy =
		!process.env.ANTHROPIC_API_KEY ||
		process.env.ANTHROPIC_API_KEY === "sk-ant-e2e-dummy-not-used" ||
		process.env.ANTHROPIC_API_KEY === "";
	if (dummy && !hasAnyRealKey()) return "no-llm-key";
	return null;
}

/** True if Tier 2 e2e tests should run. */
export function tier2Enabled(): boolean {
	return getTier2SkipReason() === null;
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

/** Recognized provider keys for the Tier 2 gate (mirrors helpers/test-home.ts). */
const PROVIDER_KEY_VARS = [
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GOOGLE_API_KEY",
	"MISTRAL_API_KEY",
	"KIMI_API_KEY",
];

/** True if any recognized provider env var is set to a non-dummy value. */
function hasAnyRealKey(): boolean {
	for (const k of PROVIDER_KEY_VARS) {
		const v = process.env[k];
		if (v && v.length > 0 && v !== "sk-ant-e2e-dummy-not-used") return true;
	}
	return false;
}

/** Human-readable reason (for skip messages). */
export function describeTier1Skip(): string {
	switch (getTier1SkipReason()) {
		case "no-env-flag":
			return "RUN_E2E=1 not set";
		case "no-pi":
			return "`pi` executable not on $PATH";
		case "no-build":
			return `built extension not found at ${EXTENSION_PATH} — run \`npm run build\``;
		default:
			return "ready";
	}
}

/** Human-readable reason (for skip messages). */
export function describeTier2Skip(): string {
	switch (getTier2SkipReason()) {
		case "no-env-flag":
			return "RUN_E2E=1 not set";
		case "no-pi":
			return "`pi` executable not on $PATH";
		case "no-build":
			return `built extension not found at ${EXTENSION_PATH} — run \`npm run build\``;
		case "no-tier2-flag":
			return "RUN_LLM_E2E=1 not set (Tier 2 also requires the LLM flag)";
		case "no-llm-key":
			return "no real LLM credential (set ANTHROPIC_API_KEY / OPENAI_API_KEY / etc. — the dummy CI key is treated as missing)";
		default:
			return "ready";
	}
}
