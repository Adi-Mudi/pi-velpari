/**
 * Secret-scan doctor check tests (NFR-04 / G9).
 *
 * Covers: no-config and pre-store fixtures (file scan only; side-effect
 * pin — the read-only store open must never create the store DB file),
 * an existing-store sweep through `openStoreDbReadOnly` (published row
 * carrying an AWS key → warning, file bytes unchanged), and a clean-store
 * sweep (ok summary — proves the read path still reads).
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { checkSecretScan } from "../../src/doctor/checks/secrets.js";

/** An AWS-style access key that matches the scanner's AWS Access Key pattern. */
const AWS_KEY = "AKIAABCDEFGHIJKLMNOP";

let dirs: string[] = [];
let cwd = "";

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-secrets-"));
	dirs.push(dir);
	cwd = dir;
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Seed `.pi/velpari/files.json` in the current fixture cwd.
 * @param {Record<string, unknown>} [config] - Extra config keys merged over `{version:4, projectName:"TodoApp"}`.
 * @returns {void}
 */
function seedConfig(config: Record<string, unknown> = {}): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TodoApp", ...config }),
		"utf8",
	);
}

/**
 * Seed a published PRD artifact + one published FR row in the TodoApp store.
 * @param {string | null} secretText - Prose for `fr.text` (null seeds NULL prose).
 * @returns {void}
 */
function seedStore(secretText: string | null): void {
	const db = openStoreDb(buildStoreDbPath("TodoApp", cwd));
	try {
		db.prepare(
			"INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint, inputs, reviewer_verdict, change_log, status) " +
				"VALUES ('r1', 'prd', 1, 'drafting-prd', '2026-09-22T00:00:00Z', 'f', '{}', NULL, '[]', 'published')",
		).run();
		db.prepare(
			"INSERT INTO fr (run_id, kind, id, phase, text_hash, status, text) VALUES ('r1', 'prd', 'FR-1', 1, 'h', 'published', ?)",
		).run(secretText);
	} finally {
		closeStoreDb(db);
	}
}

describe("checkSecretScan", () => {
	test("no config → single ok file-scan item, no store DB created", () => {
		const section = checkSecretScan(cwd);
		assert.equal(section.title, "Secret scan (NFR-04)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /No secrets detected across 0 file\(s\)/);
		assert.equal(
			existsSync(buildStoreDbPath("TodoApp", cwd)),
			false,
			"a read-only doctor check must not create the store DB (I11.1 side-effect pin)",
		);
	});

	test("pre-store config → file scan only (no sweep item), no store DB created", () => {
		seedConfig();
		const section = checkSecretScan(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /No secrets detected across 1 file\(s\)/);
		assert.ok(
			section.items.every((i) => i.message.startsWith("No secrets detected")),
			"no DB sweep items when no store DB exists",
		);
		assert.equal(
			existsSync(buildStoreDbPath("TodoApp", cwd)),
			false,
			"a read-only doctor check must not create the store DB (I11.1 side-effect pin)",
		);
	});

	test("existing store with a published secret → warning via the read-only open, bytes unchanged", () => {
		seedConfig();
		seedStore(AWS_KEY);
		const dbPath = buildStoreDbPath("TodoApp", cwd);
		const before = readFileSync(dbPath);
		const section = checkSecretScan(cwd);

		const hit = section.items.find((i) => /fr\[FR-1\]\.text: AWS Access Key/.test(i.message));
		assert.ok(hit, "DB sweep reports the AWS key hit");
		assert.equal(hit.status, "warning");
		assert.match(hit.message, /"AKIAABCDEFGHIJKLMNOP"/);

		const summary = section.items.find((i) => /Store DB sweep: 1 potential secret/.test(i.message));
		assert.ok(summary, "DB sweep summary item present");
		assert.equal(summary.status, "warning");

		const after = readFileSync(dbPath);
		assert.ok(before.equals(after), "a read-only doctor check must not rewrite store DB bytes (I11.1 pin)");
	});

	test("existing store with clean prose → ok sweep summary", () => {
		seedConfig();
		seedStore(null);
		const section = checkSecretScan(cwd);
		const summary = section.items.find((i) => /Store DB sweep: no secrets in text columns \(1 DB\(s\) scanned\)/.test(i.message));
		assert.ok(summary, "clean sweep summary present");
		assert.equal(summary.status, "ok");
	});
});
