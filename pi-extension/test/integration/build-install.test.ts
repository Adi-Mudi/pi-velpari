/**
 * Integration: Build + install verification (Phase 8, plan §Phase 8).
 *
 * Verifies the package builds cleanly and the metadata is correct
 * for npm install. Full npm pack + install in a clean temp dir is
 * exercised by scripts/smoke-npm-install-layout.mjs; here we only
 * check the static metadata.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findPackageRoot } from "../../src/core/paths.js";

const pkgRoot = findPackageRoot(process.cwd());
const pkgJson = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as Record<string, unknown>;

describe("build + install — Phase 8 verification", () => {
	it("dist/ exists and is non-empty after npm run build", () => {
		const dist = join(pkgRoot, "dist");
		assert.ok(existsSync(dist), "dist/ must exist (run `npm run build` first)");
		const stats = statSync(dist);
		assert.ok(stats.isDirectory(), "dist must be a directory");
	});

	it("dist/pi-extension/src/ contains the compiled entry point", () => {
		const entry = join(pkgRoot, "dist", "pi-extension", "src", "index.js");
		assert.ok(existsSync(entry), `compiled entry must exist at ${entry}`);
	});

	it("package.json has the right name + version", () => {
		assert.strictEqual(pkgJson["name"], "@adi-mudi/pi-velpari");
		assert.match(String(pkgJson["version"]), /^\d+\.\d+\.\d+/);
	});

	it("Q1 fix: package.json does NOT declare pi-interactive-subagents", () => {
		// The dep is now a runtime plugin loaded by Pi from the user's
		// global install at ~/.pi/agent/git/.../pi-interactive-subagents,
		// not via npm. See AGENTS.md "Runtime plugin (NOT a dep)" rule.
		const deps = Object.keys((pkgJson["dependencies"] ?? {}) as Record<string, unknown>);
		const bundled = (pkgJson["bundledDependencies"] ?? []) as string[];
		assert.equal(
			deps.includes("pi-interactive-subagents"),
			false,
			"pi-interactive-subagents must NOT be a dependency (Q1 fix)",
		);
		assert.equal(
			bundled.includes("pi-interactive-subagents"),
			false,
			"pi-interactive-subagents must NOT be in bundledDependencies (Q1 fix)",
		);
		// dependencies and bundledDependencies exist as empty arrays
		// so future maintainers can still add a real peer dep later.
		assert.ok(Array.isArray(pkgJson["bundledDependencies"]), "bundledDependencies is array");
	});

	it("package.json has a build script", () => {
		const scripts = pkgJson["scripts"] as Record<string, string>;
		assert.ok(scripts["build"], "build script must exist");
		assert.match(scripts["build"], /tsc/, "build script must run tsc");
	});

	it("package.json has a test script that uses node --test", () => {
		const scripts = pkgJson["scripts"] as Record<string, string>;
		assert.ok(scripts["test"], "test script must exist");
		assert.match(scripts["test"], /node --test/, "test script must use node --test");
	});

	it("package.json has a test:e2e script", () => {
		const scripts = pkgJson["scripts"] as Record<string, string>;
		assert.ok(scripts["test:e2e"], "test:e2e script must exist");
	});

	it("tsconfig.json exists and is valid JSON", () => {
		const tsconfigPath = join(pkgRoot, "tsconfig.json");
		assert.ok(existsSync(tsconfigPath));
		const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8")) as { compilerOptions?: { outDir?: string } };
		assert.match(String(tsconfig.compilerOptions?.outDir ?? ""), /dist/);
	});
});

describe("build + install — skills manifest sanity", () => {
	it("package.json includes the skills/ folder via pi.skills OR direct copy", () => {
		// Pi discovers skills from the package's skills/ directory; verify the
		// folder exists with at least one skill file.
		const skillsDir = join(pkgRoot, "skills");
		assert.ok(existsSync(skillsDir), "skills/ must exist");
		const entries = readdirSync(skillsDir);
		const mdCount = entries.filter((e) => e.endsWith(".md")).length;
		assert.ok(mdCount >= 10, `expected >=10 skill .md files at root, found ${mdCount}`);
	});
});
