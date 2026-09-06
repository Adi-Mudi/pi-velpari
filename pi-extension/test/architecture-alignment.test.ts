/**
 * Architecture alignment tests (Phase 0).
 *
 * Locks the new layered structure so future contributors cannot
 * regress it. Specifically:
 *   - Required folders exist: io/, hooks/, commands/.
 *   - Removed folder is gone: prompts/.
 *   - Moved files exist at new paths; old paths do not.
 *   - No source file imports the old core/agents-install or core/commands paths.
 *   - registerCommands and registerHooks are both exported and callable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Tests run from dist/pi-extension/test/. To reach pi-extension/src/, go up
// three levels to the project root, then back down into pi-extension/src/.
// We accept either the compiled `.js` (in dist/) or the source `.ts`
// (in pi-extension/src/), so the test passes regardless of whether the
// runner invokes the compiled output or the source directly.
const candidates = [
	resolve(__dirname, "..", "..", "src"),
	resolve(__dirname, "..", "..", "..", "pi-extension", "src"),
];
const srcDir = candidates.find((p) => existsSync(p)) ?? candidates[1]!;

// ---------------------------------------------------------------------------
// Folder presence
// ---------------------------------------------------------------------------

test("io/ folder exists", () => {
	assert.ok(existsSync(join(srcDir, "io")), "io/ folder should exist");
});

test("hooks/ folder exists", () => {
	assert.ok(existsSync(join(srcDir, "hooks")), "hooks/ folder should exist");
});

test("commands/ folder exists", () => {
	assert.ok(existsSync(join(srcDir, "commands")), "commands/ folder should exist");
});

test("prompts/ folder is gone", () => {
	assert.equal(
		existsSync(join(srcDir, "prompts")),
		false,
		"prompts/ placeholder folder should be removed",
	);
});

// ---------------------------------------------------------------------------
// File relocation
// ---------------------------------------------------------------------------

function fileExists(...parts: string[]): boolean {
	return existsSync(join(srcDir, ...parts));
}

test("io/agents-install exists at new path", () => {
	assert.ok(
		fileExists("io", "agents-install.ts") || fileExists("io", "agents-install.js"),
		"agents-install should live in io/ (source .ts or compiled .js)",
	);
});

test("core/agents-install no longer exists", () => {
	assert.equal(
		fileExists("core", "agents-install.ts") || fileExists("core", "agents-install.js"),
		false,
		"agents-install should have moved out of core/",
	);
});

test("commands/index exists at new path", () => {
	assert.ok(
		fileExists("commands", "index.ts") || fileExists("commands", "index.js"),
		"commands/index should be the composition root (source .ts or compiled .js)",
	);
});

test("core/commands no longer exists", () => {
	assert.equal(
		fileExists("core", "commands.ts") || fileExists("core", "commands.js"),
		false,
		"commands should have moved out of core/",
	);
});

test("hooks/index exists (empty composer scaffold)", () => {
	assert.ok(
		fileExists("hooks", "index.ts") || fileExists("hooks", "index.js"),
		"hooks/index composer should exist (source .ts or compiled .js)",
	);
});

// ---------------------------------------------------------------------------
// No stale imports
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) walk(p, out);
		else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
			out.push(p);
		}
	}
	return out;
}

test("no source file imports the old core/agents-install path", () => {
	const offenders: string[] = [];
	for (const file of walk(srcDir)) {
		const text = readFileSync(file, "utf8");
		if (/core\/agents-install/.test(text)) offenders.push(file);
	}
	assert.deepEqual(offenders, [], `Stale imports of core/agents-install in: ${offenders.join(", ")}`);
});

test("no source file imports the old core/commands path", () => {
	const offenders: string[] = [];
	for (const file of walk(srcDir)) {
		const text = readFileSync(file, "utf8");
		if (/core\/commands/.test(text)) offenders.push(file);
	}
	assert.deepEqual(offenders, [], `Stale imports of core/commands in: ${offenders.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Export shape
// ---------------------------------------------------------------------------

test("registerCommands is exported from commands/index.ts", async () => {
	const mod = await import("../src/commands/index.js");
	assert.equal(typeof mod.registerCommands, "function", "registerCommands must be a function");
});

test("registerHooks is exported from hooks/index.ts", async () => {
	const mod = await import("../src/hooks/index.js");
	assert.equal(typeof mod.registerHooks, "function", "registerHooks must be a function");
});
