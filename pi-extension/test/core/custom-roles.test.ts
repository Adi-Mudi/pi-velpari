/**
 * Tests for pi-extension/src/core/custom-roles.ts.
 *
 * Layer 0 unit tests. Uses Node's built-in test runner via `npm test`
 * (which compiles to dist/pi-extension/test/core/custom-roles.test.js).
 *
 * Each test uses fs.mkdtempSync for isolation.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	getCustomRolesPath,
	loadCustomRoles,
	saveCustomRoles,
	validateCustomRole,
	validateCustomRoles,
	findCustomRole,
	listCustomRoleIds,
	getBundledCustomRoles,
	type CustomRole,
	type CustomRolesConfig,
} from "../../src/core/custom-roles.js";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "velpari-custom-roles-"));
});

describe("getCustomRolesPath", () => {
	it("returns .pi/velpari/custom-roles.json relative to cwd", () => {
		const p = getCustomRolesPath(cwd);
		assert.equal(p, join(cwd, ".pi", "velpari", "custom-roles.json"));
	});
});

describe("loadCustomRoles", () => {
	it("returns null when the file is missing", () => {
		assert.equal(loadCustomRoles(cwd), null);
	});

	it("returns a valid config when the file is present", () => {
		mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
		const role: CustomRole = {
			role: "test-role",
			label: "Test Role",
			tools: ["read"],
			mandate: "do the test thing",
			invocationHint: "spawn on test trigger",
			outOfScope: ["do not break things"],
		};
		writeFileSync(getCustomRolesPath(cwd), JSON.stringify({ version: 1, roles: [role] }, null, 2), "utf8");

		const config = loadCustomRoles(cwd);
		assert.ok(config !== null);
		assert.equal(config.version, 1);
		assert.equal(config.roles.length, 1);
		const firstRole = config.roles[0];
		assert.ok(firstRole !== undefined);
		assert.equal(firstRole.role, "test-role");
	});

	it("strips the _comment field before returning", () => {
		mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			getCustomRolesPath(cwd),
			JSON.stringify({
				_comment: "ignored",
				version: 1,
				roles: [],
			}),
			"utf8",
		);
		const config = loadCustomRoles(cwd);
		assert.ok(config !== null);
		assert.equal((config as unknown as Record<string, unknown>)._comment, undefined);
	});

	it("throws on bad JSON", () => {
		mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
		writeFileSync(getCustomRolesPath(cwd), "not json", "utf8");
		assert.throws(() => loadCustomRoles(cwd), /invalid custom-roles config/i);
	});

	it("throws on wrong version", () => {
		mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
		writeFileSync(getCustomRolesPath(cwd), JSON.stringify({ version: 2, roles: [] }), "utf8");
		assert.throws(() => loadCustomRoles(cwd), /invalid custom-roles config/i);
	});

	it("throws on missing required field", () => {
		mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			getCustomRolesPath(cwd),
			JSON.stringify({
				version: 1,
				roles: [{ role: "x" }],
			}),
			"utf8",
		);
		assert.throws(() => loadCustomRoles(cwd), /invalid custom-roles config/i);
	});

	it("throws on duplicate role ids", () => {
		mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
		const role: CustomRole = {
			role: "dup",
			label: "Dup",
			tools: ["read"],
			mandate: "m",
			invocationHint: "i",
			outOfScope: ["o"],
		};
		writeFileSync(getCustomRolesPath(cwd), JSON.stringify({ version: 1, roles: [role, role] }, null, 2), "utf8");
		assert.throws(() => loadCustomRoles(cwd), /duplicate role id/i);
	});
});

describe("saveCustomRoles + loadCustomRoles round-trip", () => {
	it("writes and reads back the same config", () => {
		const config: CustomRolesConfig = {
			version: 1,
			roles: [
				{
					role: "alpha",
					label: "Alpha",
					tools: ["read", "write"],
					mandate: "do alpha",
					invocationHint: "spawn alpha",
					outOfScope: ["do not break"],
				},
				{
					role: "beta",
					label: "Beta",
					tools: ["read"],
					mandate: "do beta",
					invocationHint: "spawn beta",
					outOfScope: ["do not break", "do not edit"],
					bodyFile: "beta-body.md",
					interactive: true,
				},
			],
		};
		saveCustomRoles(cwd, config);

		const raw = readFileSync(getCustomRolesPath(cwd), "utf8");
		assert.match(raw, /_comment/);

		const loaded = loadCustomRoles(cwd);
		assert.deepEqual(loaded, config);
	});
});

describe("validateCustomRole", () => {
	it("returns the role on success", () => {
		const role: CustomRole = {
			role: "x",
			label: "X",
			tools: ["read"],
			mandate: "m",
			invocationHint: "i",
			outOfScope: ["o"],
		};
		assert.deepEqual(validateCustomRole(role), role);
	});

	it("throws on empty role id", () => {
		assert.throws(
			() =>
				validateCustomRole({
					role: "",
					label: "X",
					tools: ["read"],
					mandate: "m",
					invocationHint: "i",
					outOfScope: ["o"],
				}),
			/non-empty string/i,
		);
	});

	it("throws on non-string tools", () => {
		assert.throws(
			() =>
				validateCustomRole({
					role: "x",
					label: "X",
					// @ts-expect-error -- intentionally wrong type
					tools: ["read", 42],
					mandate: "m",
					invocationHint: "i",
					outOfScope: ["o"],
				}),
			/array of strings/i,
		);
	});

	it("throws on non-boolean interactive", () => {
		assert.throws(
			() =>
				validateCustomRole({
					role: "x",
					label: "X",
					tools: ["read"],
					mandate: "m",
					invocationHint: "i",
					outOfScope: ["o"],
					// @ts-expect-error -- intentionally wrong type
					interactive: "yes",
				}),
			/boolean/i,
		);
	});
});

describe("findCustomRole", () => {
	it("returns the matching role", () => {
		const role: CustomRole = {
			role: "alpha",
			label: "Alpha",
			tools: ["read"],
			mandate: "m",
			invocationHint: "i",
			outOfScope: ["o"],
		};
		saveCustomRoles(cwd, { version: 1, roles: [role] });
		assert.deepEqual(findCustomRole(cwd, "alpha"), role);
	});

	it("returns null when not found", () => {
		saveCustomRoles(cwd, {
			version: 1,
			roles: [
				{
					role: "alpha",
					label: "Alpha",
					tools: ["read"],
					mandate: "m",
					invocationHint: "i",
					outOfScope: ["o"],
				},
			],
		});
		assert.equal(findCustomRole(cwd, "beta"), null);
	});

	it("returns null when no custom-roles.json exists", () => {
		assert.equal(findCustomRole(cwd, "anything"), null);
	});
});

describe("listCustomRoleIds", () => {
	it("returns all role ids", () => {
		saveCustomRoles(cwd, {
			version: 1,
			roles: [
				{
					role: "alpha",
					label: "A",
					tools: ["read"],
					mandate: "m",
					invocationHint: "i",
					outOfScope: ["o"],
				},
				{
					role: "beta",
					label: "B",
					tools: ["read"],
					mandate: "m",
					invocationHint: "i",
					outOfScope: ["o"],
				},
			],
		});
		assert.deepEqual(listCustomRoleIds(cwd), ["alpha", "beta"]);
	});

	it("returns [] when no custom-roles.json exists", () => {
		assert.deepEqual(listCustomRoleIds(cwd), []);
	});
});

describe("getBundledCustomRoles", () => {
	it("returns the bundled starter with at least one role", () => {
		const config = getBundledCustomRoles();
		assert.equal(config.version, 1);
		assert.ok(config.roles.length >= 1, "bundled starter should ship at least one role");
		const pseudocodeReviewer = config.roles.find((r) => r.role === "pseudocode-reviewer");
		assert.ok(pseudocodeReviewer, "bundled starter should include pseudocode-reviewer");
		assert.equal(pseudocodeReviewer.bodyFile, "pseudocode-reviewer-body.md");
	});
});
