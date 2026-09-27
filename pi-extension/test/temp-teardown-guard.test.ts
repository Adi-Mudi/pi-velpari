/**
 * Repo-wide temp-dir hygiene guard (I12.1 sweep).
 *
 * Assertion: for every test file that creates temp dirs via `mkdtempSync`,
 * a matching removal exists in the same file — an `rmSync`/`fs.rm` call or
 * a call to a registry cleanup helper (`cleanupFixtureRepos`,
 * `cleanupHarnessWorkspaces`). Suites own their teardown policy; this guard
 * makes "forgot the after() hook" a build failure instead of a /tmp leak
 * (see the 1,113-dir residue that motivated the sweep).
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findPackageRoot } from "../src/core/paths.js";

/** Package root (dist/pi-extension/test/… → package.json owner). */
const PKG_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** Source test tree this guard audits. */
const TEST_ROOT = join(PKG_ROOT, "pi-extension", "test");

/** Removal evidence accepted in the same file. */
const REMOVAL = /(rmSync\s*\(|\.rm\s*\(|cleanupFixtureRepos\s*\(|cleanupHarnessWorkspaces\s*\()/;

/**
 * Recursively collect .ts files under a directory.
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Absolute paths of all .ts files found.
 */
function collect(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...collect(p));
		else if (p.endsWith(".ts")) out.push(p);
	}
	return out;
}

describe("temp-dir hygiene (I12.1)", () => {
	it("every file calling mkdtempSync has a matching removal in the same file", () => {
		const offenders: string[] = [];
		for (const file of collect(TEST_ROOT)) {
			if (file.endsWith("temp-teardown-guard.test.ts")) continue; // this guard only mentions the API
			const src = readFileSync(file, "utf8");
			if (!src.includes("mkdtempSync(")) continue;
			if (!REMOVAL.test(src)) offenders.push(file.slice(TEST_ROOT.length + 1));
		}
		assert.deepEqual(
			offenders,
			[],
			`files create temp dirs without removing them: ${offenders.join(", ")}`,
		);
	});
});
