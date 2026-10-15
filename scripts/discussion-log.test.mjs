/**
 * discussion-log.test.mjs — DDT tracker roundtrip tests.
 *
 * Covers: add → list roundtrip, list --json shape, id ordering,
 * open-point kind rejection (document-only ruling), required-field
 * validation, and schema idempotency (openDb twice).
 * DB path is overridden via DISCUSSIONS_DB into a temp dir.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the module at a throwaway DB BEFORE importing its helpers.
const tempDir = mkdtempSync(join(tmpdir(), "ddt-"));
process.env.DISCUSSIONS_DB = join(tempDir, "DISCUSSIONS.db");

const { openDb, addDiscussion, listDiscussions, ALLOWED_KINDS } = await import(
	"./discussion-log.mjs"
);

test("add → list roundtrip preserves fields", () => {
	const db = openDb();
	try {
		const row = addDiscussion(db, {
			kind: "clarification",
			topic: "RTM in SQL",
			summary: "Verified RTM + ChangeLog already live in the store DB.",
			decisions: "No new build needed",
		});
		assert.ok(row.id >= 1, "got a real id");
		assert.equal(row.kind, "clarification");

		const rows = listDiscussions(db, 10);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].topic, "RTM in SQL");
		assert.equal(rows[0].decisions, "No new build needed");
		assert.ok(rows[0].at, "timestamp stamped");
	} finally {
		db.close();
	}
});

test("list returns newest first with ascending ids in storage", () => {
	const db = openDb();
	try {
		addDiscussion(db, { kind: "decision", topic: "first", summary: "s1" });
		addDiscussion(db, { kind: "status", topic: "second", summary: "s2" });
		const rows = listDiscussions(db, 10);
		assert.equal(rows[0].topic, "second", "newest first");
		assert.ok(rows[0].id > rows[1].id, "ids strictly increase");
	} finally {
		db.close();
	}
});

test("list --json shape (array of flat records)", () => {
	const db = openDb();
	try {
		addDiscussion(db, { kind: "decision", topic: "t", summary: "s" });
		const rows = listDiscussions(db, 5);
		const json = JSON.parse(JSON.stringify(rows));
		assert.ok(Array.isArray(json));
		for (const key of ["id", "at", "kind", "topic", "summary"]) {
			assert.ok(key in json[0], `row has ${key}`);
		}
	} finally {
		db.close();
	}
});

test("open-point kind is rejected (document-only ruling)", () => {
	const db = openDb();
	try {
		assert.throws(
			() => addDiscussion(db, { kind: "open-point", topic: "x", summary: "y" }),
			/open points belong in DISCUSSIONS\.md/,
		);
		assert.ok(!ALLOWED_KINDS.includes("open-point"));
	} finally {
		db.close();
	}
});

test("missing topic/summary rejected", () => {
	const db = openDb();
	try {
		assert.throws(() => addDiscussion(db, { kind: "decision", topic: "", summary: "y" }), /topic/);
		assert.throws(() => addDiscussion(db, { kind: "decision", topic: "x", summary: "" }), /summary/);
	} finally {
		db.close();
	}
});

test("openDb is idempotent (no table-recreate error)", () => {
	const first = openDb();
	first.close();
	const second = openDb(); // must not throw on existing schema
	second.close();
});

// Cleanup the temp dir at the end of the file's tests.
test.after(() => {
	rmSync(tempDir, { recursive: true, force: true });
});
