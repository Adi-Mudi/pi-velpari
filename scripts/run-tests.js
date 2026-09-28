#!/usr/bin/env node
/**
 * N33 — `testing.runner`-aware test entry point.
 *
 * Wires B's config reader (`core/config.ts:testingRunnerConfig`, import-only)
 * to the place where test scope is decided. Scope contract (plan design
 * decision 7):
 *
 *   - `CI` or `GITHUB_ACTIONS` env set  → scope `full`
 *   - local + `testing.runner: "local"` → scope `full`
 *   - local + `"remote"` (or absent)    → scope `targeted`
 *
 *   - `targeted` = the unit-only pattern from `package.json:test`
 *     (excludes `e2e/` and `in-process/`)
 *   - `full`     = unit + `test:e2e` (runs with `RUN_E2E=1`,
 *     `--test-force-exit`, `--test-timeout=180000`)
 *   - file args (`node scripts/run-tests.js <files...>`) always run
 *     exactly those files (thermal-protocol convenience), whatever the
 *     resolved scope would have been.
 *
 * Diagnostics:
 *   - `--print-scope` prints one JSON line `{"runner","ci","scope",
 *     "passthrough","files"}` and exits without executing a suite.
 *   - missing dist → prints the build instruction and exits non-zero
 *     (the reader lives in `dist/`).
 *   - invalid `testing.runner` value → B's throw message on stderr,
 *     exit non-zero (error text is not swallowed).
 *
 * No `package.json` edit here — wiring this script into npm scripts is
 * the Phase G integration request.
 *
 * Usage:
 *   node scripts/run-tests.js [--print-scope] [files...]
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Repo root — this script lives at `<root>/scripts/run-tests.js`. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** B's reader module (built output; import-only, never edited). */
const DIST_CONFIG = join(REPO_ROOT, "dist", "pi-extension", "src", "core", "config.js");

/** Built test tree the scopes select files from. */
const DIST_TESTS = join(REPO_ROOT, "dist", "pi-extension", "test");

/** Instruction printed when the build output is absent. */
const BUILD_HINT = "Built extension not found — run `npm run build` first.";

/** e2e suite timeout mirrored from package.json `test:e2e`. */
const E2E_TIMEOUT_MS = "180000";

/**
 * Recursively collect `*.test.js` files under a directory.
 * @param {string} dir - Directory to walk (missing dir → empty result).
 * @param {(rel: string) => boolean} include - Filter over the path relative to `dir`.
 * @returns {string[]} Sorted absolute file paths.
 */
function collectTests(dir, include) {
	if (!existsSync(dir)) return [];
	const out = [];
	/** @type {string[]} */
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) break;
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const abs = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(abs);
			} else if (entry.name.endsWith(".test.js")) {
				const rel = abs.slice(dir.length + 1);
				if (include(rel)) out.push(abs);
			}
		}
	}
	return out.sort();
}

/**
 * Unit-test files: every dist test EXCEPT the e2e and in-process suites
 * (mirrors the `package.json:test` find pattern).
 * @returns {string[]} Absolute paths of unit test files.
 */
function unitFiles() {
	return collectTests(DIST_TESTS, (rel) => {
		const segments = rel.split(/[/\\]/);
		return !segments.includes("e2e") && !segments.includes("in-process");
	});
}

/**
 * e2e-suite files (mirrors `package.json:test:e2e`).
 * @returns {string[]} Absolute paths of e2e test files.
 */
function e2eFiles() {
	return collectTests(DIST_TESTS, (rel) => rel.split(/[/\\]/).includes("e2e"));
}

/**
 * True when the environment marks a CI run.
 * @returns {boolean} True when `CI` or `GITHUB_ACTIONS` is set and non-empty.
 */
function ciEnvSet() {
	return Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
}

/**
 * Resolve the test scope per design decision 7 by importing B's reader.
 * @returns {Promise<{runner: "remote" | "local", ci: boolean, scope: "full" | "targeted"}>} Scope facts.
 * @throws {Error} B's error when `testing.runner` holds an invalid value.
 */
async function resolveScope() {
	const mod = await import(pathToFileURL(DIST_CONFIG).href);
	const runner = mod.testingRunnerConfig(process.cwd());
	const ci = ciEnvSet();
	return { runner, ci, scope: ci || runner === "local" ? "full" : "targeted" };
}

/**
 * Build the `node --test` invocation for the resolved scope.
 * @param {"full" | "targeted"} scope - Resolved scope.
 * @returns {{files: string[], flags: string[], env: Record<string, string | undefined>}} Invocation parts.
 * @throws {Error} When the build output has no test files for the scope.
 */
function invocationFor(scope) {
	const base = scope === "full" ? [...unitFiles(), ...e2eFiles()] : unitFiles();
	if (base.length === 0) throw new Error(BUILD_HINT);
	if (scope === "full") {
		return {
			files: base,
			flags: ["--test", "--test-force-exit", "--test-timeout=" + E2E_TIMEOUT_MS],
			env: { ...process.env, RUN_E2E: "1" },
		};
	}
	return { files: base, flags: ["--test"], env: { ...process.env } };
}

/**
 * Entry point: parse args, resolve scope, print diagnostics or execute.
 * @returns {Promise<void>} Resolves when the process is about to exit.
 */
async function main() {
	const argv = process.argv.slice(2);
	const printScope = argv.includes("--print-scope");
	const fileArgs = argv.filter((a) => a !== "--print-scope");

	if (!existsSync(DIST_CONFIG)) {
		console.error(BUILD_HINT);
		process.exit(1);
	}

	let facts;
	try {
		facts = await resolveScope();
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
		return;
	}

	if (printScope) {
		console.log(
			JSON.stringify({
				runner: facts.runner,
				ci: facts.ci,
				scope: facts.scope,
				passthrough: fileArgs.length > 0,
				files: fileArgs,
			}),
		);
		return;
	}

	let invocation;
	try {
		invocation =
			fileArgs.length > 0
				? { files: fileArgs, flags: ["--test"], env: { ...process.env } }
				: invocationFor(facts.scope);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
		return;
	}

	const run = spawnSync(process.execPath, [...invocation.flags, ...invocation.files], {
		stdio: "inherit",
		env: invocation.env,
	});
	process.exit(run.status ?? 1);
}

await main();
