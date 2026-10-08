/**
 * N33 unit tests — `scripts/run-tests.js` scope resolution.
 *
 * All cases exercise `--print-scope` (or the pre-scope failure paths), so
 * no test suite is ever executed by these spawns — safe under the thermal
 * protocol. Matrix (plan subphase 5.2):
 *
 *   (a) no CI + no `testing` key      → runner "remote", scope "targeted"
 *   (b) no CI + `"local"`             → scope "full"
 *   (c) CI=true + `"remote"`          → scope "full"
 *   (d) CI=true + `"local"`           → scope "full"
 *   (e) invalid runner value          → non-zero exit + B's error text
 *   (f) missing dist                  → build-instruction message
 *   (g) file-args passthrough flag    → reported in the JSON
 *
 * Temp dirs follow the tracked-mkdtemp convention (I12.1 guard: removal in
 * the same file).
 */

import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync as realMkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findPackageRoot } from "../../src/core/paths.js";

/** Package root (dist/pi-extension/test/… → package.json owner). */
const PKG_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** The N33 entry point under test. */
const SCRIPT = join(PKG_ROOT, "scripts", "run-tests.js");

/** Temp dirs created in this file; removed at module teardown (I12.1 sweep). */
const tempDirs: string[] = [];

/**
 * Tracked mkdtempSync: creates a temp dir and registers it for teardown removal.
 * @param {string} prefix - Directory path/prefix passed to fs.mkdtempSync.
 * @returns {string} The created directory path.
 */
const mkdtempSync = (prefix: string): string => {
	const dir = realMkdtempSync(prefix);
	tempDirs.push(dir);
	return dir;
};

after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Create a fresh temp project directory.
 * @returns {string} Absolute path of the tracked temp dir.
 */
function tmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-run-tests-"));
}

/**
 * Write a raw JSON value into `<cwd>/.pi/velpari/files.json`.
 * @param {string} cwd - Project root to write into.
 * @param {unknown} value - JSON-serializable config value.
 * @returns {void}
 */
function writeFilesJson(cwd: string, value: unknown): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "velpari", "files.json"), JSON.stringify(value), "utf8");
}

/**
 * Environment WITHOUT any CI marker (local-run simulation).
 * @returns {Record<string, string | undefined>} Copy of process.env minus CI flags.
 */
function envNoCi(): Record<string, string | undefined> {
	const env = { ...process.env };
	delete env.CI;
	delete env.GITHUB_ACTIONS;
	return env;
}

/**
 * Environment with `CI=true` (CI-run simulation).
 * @returns {Record<string, string | undefined>} Copy of process.env with CI set.
 */
function envCi(): Record<string, string | undefined> {
	const env = envNoCi();
	env.CI = "true";
	return env;
}

/**
 * Spawn the runner with `--print-scope` and capture its result.
 * @param {string} cwd - Project cwd for the spawn (files.json location).
 * @param {Record<string, string | undefined>} env - Environment for the spawn.
 * @param {string[]} [extraArgs] - Extra argv entries (e.g. file args).
 * @returns {{status: number | null, stdout: string, stderr: string}} Spawn result.
 */
function runPrintScope(
	cwd: string,
	env: Record<string, string | undefined>,
	extraArgs: string[] = [],
): { status: number | null; stdout: string; stderr: string } {
	const res = spawnSync(process.execPath, [SCRIPT, "--print-scope", ...extraArgs], {
		cwd,
		env,
		encoding: "utf8",
		timeout: 60_000,
	});
	return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/**
 * Parse the single JSON line the runner prints for `--print-scope`.
 * @param {string} stdout - Captured stdout.
 * @returns {{runner: string, ci: boolean, scope: string, passthrough: boolean, files: string[]}} Parsed scope facts.
 */
function parseScope(stdout: string): {
	runner: string;
	ci: boolean;
	scope: string;
	passthrough: boolean;
	files: string[];
} {
	const lines = stdout
		.trim()
		.split("\n")
		.filter((l) => l.length > 0);
	assert.equal(lines.length, 1, `expected exactly one output line, got: ${stdout}`);
	return JSON.parse(lines[0] as string);
}

describe("N33 scripts/run-tests.js scope resolution", () => {
	it("(a) local + no testing key → runner remote, scope targeted", () => {
		const cwd = tmp();
		writeFilesJson(cwd, { projectName: "ScopeFixture" });
		const scope = parseScope(runPrintScope(cwd, envNoCi()).stdout);
		assert.equal(scope.runner, "remote");
		assert.equal(scope.ci, false);
		assert.equal(scope.scope, "targeted");
		assert.equal(scope.passthrough, false);
	});

	it("(b) local + runner local → scope full", () => {
		const cwd = tmp();
		writeFilesJson(cwd, { projectName: "ScopeFixture", testing: { runner: "local" } });
		const scope = parseScope(runPrintScope(cwd, envNoCi()).stdout);
		assert.equal(scope.runner, "local");
		assert.equal(scope.scope, "full");
	});

	it("(c) CI=true + runner remote → scope full", () => {
		const cwd = tmp();
		writeFilesJson(cwd, { projectName: "ScopeFixture", testing: { runner: "remote" } });
		const scope = parseScope(runPrintScope(cwd, envCi()).stdout);
		assert.equal(scope.runner, "remote");
		assert.equal(scope.ci, true);
		assert.equal(scope.scope, "full");
	});

	it("(d) CI=true + runner local → scope full", () => {
		const cwd = tmp();
		writeFilesJson(cwd, { projectName: "ScopeFixture", testing: { runner: "local" } });
		const scope = parseScope(runPrintScope(cwd, envCi()).stdout);
		assert.equal(scope.ci, true);
		assert.equal(scope.scope, "full");
	});

	it("(e) invalid runner value → non-zero exit with B's error text", () => {
		const cwd = tmp();
		writeFilesJson(cwd, { projectName: "ScopeFixture", testing: { runner: "turbo" } });
		const run = runPrintScope(cwd, envNoCi());
		assert.notEqual(run.status, 0, "expected a non-zero exit for an invalid runner value");
		assert.ok(
			run.stderr.includes('files.json testing.runner is invalid: expected "remote" or "local" (got "turbo")'),
			`stderr should carry B's error verbatim, got: ${run.stderr}`,
		);
	});

	it("(f) missing dist → build-instruction message", () => {
		// Copy the script into a bare temp root so its dist-relative lookup misses.
		const root = tmp();
		mkdirSync(join(root, "scripts"), { recursive: true });
		writeFileSync(join(root, "scripts", "run-tests.js"), readFileSync(SCRIPT, "utf8"), "utf8");
		const run = spawnSync(process.execPath, [join(root, "scripts", "run-tests.js"), "--print-scope"], {
			cwd: root,
			env: envNoCi(),
			encoding: "utf8",
			timeout: 60_000,
		});
		assert.notEqual(run.status, 0, "expected a non-zero exit when dist is missing");
		assert.ok(
			(run.stderr ?? "").includes("run `npm run build` first"),
			`stderr should print the build instruction, got: ${run.stderr}`,
		);
	});

	it("(g) file args → passthrough flag and files reported", () => {
		const cwd = tmp();
		writeFilesJson(cwd, { projectName: "ScopeFixture" });
		const target = "pi-extension/test/core/state.test.js";
		const scope = parseScope(runPrintScope(cwd, envNoCi(), [target]).stdout);
		assert.equal(scope.passthrough, true, "file args must set the passthrough flag");
		assert.deepEqual(scope.files, [target]);
		// Scope facts still resolve with file args present.
		assert.equal(scope.runner, "remote");
		assert.equal(scope.scope, "targeted");
	});
});
