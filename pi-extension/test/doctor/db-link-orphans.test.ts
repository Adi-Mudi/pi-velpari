/**
 * Store DB link-orphan check tests (Phase 7 — doctor as SQL).
 *
 * Covers: missing-config info, pre-store info, empty links table,
 * all-endpoints-resolve, orphan detection (dangling from + to), and
 * multi-design per-DB reporting.
 *
 * Seeds rows via direct SQL (schema.test.ts precedent) — the check is
 * about link resolution, not the payload writer.
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { checkDbLinkOrphansSection } from "../../src/doctor/checks/db-link-orphans.js";
import type { DatabaseSync } from "node:sqlite";

let dirs: string[] = [];
let cwd = "";

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-orphans-"));
	dirs.push(dir);
	cwd = dir;
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function seedConfig(config: Record<string, unknown>): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "velpari", "files.json"), JSON.stringify({ version: 4, ...config }), "utf8");
}

/** Seed one published prd artifact + two FR rows, then optional links. */
function seedStore(projectName: string, links: Array<[string, string, string, string, string]>): void {
	const db = openStoreDb(buildStoreDbPath(projectName, cwd));
	try {
		db.prepare(
			"INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint, inputs, reviewer_verdict, change_log, status) " +
				"VALUES ('r1', 'prd', 1, 'drafting-prd', '2026-09-22T00:00:00Z', 'f', '{}', NULL, '[]', 'published')",
		).run();
		db.prepare(
			"INSERT INTO fr (run_id, kind, id, phase, text_hash, status) VALUES ('r1', 'prd', 'FR-1', 1, 'h', 'published')",
		).run();
		db.prepare(
			"INSERT INTO nfr (run_id, kind, id, phase, text_hash, status) VALUES ('r1', 'prd', 'NFR-1', 1, 'h', 'published')",
		).run();
		for (const [fk, fid, tk, tid, rel] of links) {
			db.prepare(
				"INSERT INTO links (run_id, from_kind, from_id, to_kind, to_id, relation) VALUES (?, ?, ?, ?, ?, ?)",
			).run("r1", fk, fid, tk, tid, rel);
		}
	} finally {
		closeStoreDb(db);
	}
}

describe("checkDbLinkOrphansSection", () => {
	test("no config → single info item, no throw", () => {
		const section = checkDbLinkOrphansSection(cwd);
		assert.equal(section.title, "Store DB link orphans");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
	});

	test("config but no store DB → info note", () => {
		seedConfig({ projectName: "TodoApp" });
		const section = checkDbLinkOrphansSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /No store DB/);
	});

	test("store DB with empty links table → ok (nothing to audit)", () => {
		seedConfig({ projectName: "TodoApp" });
		const db = openStoreDb(buildStoreDbPath("TodoApp", cwd));
		closeStoreDb(db);
		const section = checkDbLinkOrphansSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /links adjacency empty/);
	});

	test("all endpoints resolve → ok", () => {
		seedConfig({ projectName: "TodoApp" });
		seedStore("TodoApp", [["fr", "FR-1", "nfr", "NFR-1", "traces"]]);
		const section = checkDbLinkOrphansSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /all endpoints resolve/);
	});

	test("dangling from endpoint → error item naming the orphan", () => {
		seedConfig({ projectName: "TodoApp" });
		seedStore("TodoApp", [["fr", "FR-999", "nfr", "NFR-1", "covers"]]);
		const section = checkDbLinkOrphansSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "error");
		assert.match(section.items[0]?.message ?? "", /orphan link fr:FR-999/);
	});

	test("dangling to endpoint → error item naming the orphan", () => {
		seedConfig({ projectName: "TodoApp" });
		seedStore("TodoApp", [["fr", "FR-1", "tc", "TC-404", "covers"]]);
		const section = checkDbLinkOrphansSection(cwd);
		assert.equal(section.items[0]?.status, "error");
		assert.match(section.items[0]?.message ?? "", /tc:TC-404/);
	});

	test("multi-design: per-DB items (alpha orphan, beta empty)", () => {
		seedConfig({ projectNames: ["alpha", "beta"] });
		seedStore("alpha", [["fr", "FR-999", "nfr", "NFR-1", "covers"]]);
		const dbBeta = openStoreDb(buildStoreDbPath("beta", cwd));
		closeStoreDb(dbBeta);
		const section = checkDbLinkOrphansSection(cwd);
		assert.equal(section.items.length, 2);
		assert.match(section.items[0]?.message ?? "", /^alpha:/);
		assert.equal(section.items[0]?.status, "error");
		assert.match(section.items[1]?.message ?? "", /^beta:/);
		assert.equal(section.items[1]?.status, "ok");
	});

	test("draft endpoint resolves (mid-pipeline references are not orphans)", () => {
		seedConfig({ projectName: "TodoApp" });
		seedStore("TodoApp", []);
		const db = openStoreDb(buildStoreDbPath("TodoApp", cwd));
		try {
			db.prepare(
				"INSERT INTO fr (run_id, kind, id, phase, text_hash, status) VALUES ('r1', 'prd', 'FR-DRAFT', 1, 'h', 'draft')",
			).run();
			db.prepare(
				"INSERT INTO links (run_id, from_kind, from_id, to_kind, to_id, relation) VALUES ('r1', 'fr', 'FR-DRAFT', 'nfr', 'NFR-1', 'covers')",
			).run();
		} finally {
			closeStoreDb(db);
		}
		const section = checkDbLinkOrphansSection(cwd);
		assert.equal(section.items[0]?.status, "ok");
	});
});
