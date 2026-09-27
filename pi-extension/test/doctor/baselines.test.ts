/**
 * Baselined-vs-superseded report tests (Phase 6 — F7).
 *
 * Covers: missing-config info, pre-store info, empty baselines, a
 * healthy published baseline, the two drift shapes (superseded = info,
 * withdrawn = error — decision D2), and the FK reality check (io/db.ts
 * sets PRAGMA foreign_keys = ON, so an orphan baseline cannot even be
 * seeded — v1.1 nit fix over v1.0's claim).
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { recordBaseline } from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { checkBaselinesSection } from "../../src/doctor/checks/baselines.js";
import { summarize } from "../../src/doctor/_types.js";

let dirs: string[] = [];
let cwd = "";

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-baselines-"));
	dirs.push(dir);
	cwd = dir;
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function seedConfig(config: Record<string, unknown> = {}): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TodoApp", ...config }),
		"utf8",
	);
}

function openStore(): ReturnType<typeof openStoreDb> {
	return openStoreDb(buildStoreDbPath("TodoApp", cwd));
}

/** Insert one artifact_revisions row with the given status. */
function seedRevision(
	db: ReturnType<typeof openStoreDb>,
	id: number,
	status: "published" | "superseded" | "withdrawn",
	revisionNumber: number,
): void {
	db.prepare(
		`INSERT INTO artifact_revisions
		 (revision_id, kind, run_id, revision_number, status, version, stage,
		  generated_at, published_at, sha256_fingerprint, yaml_bytes)
		 VALUES (?, 'prd', 'run-1', ?, ?, 1, 'drafting-prd',
		         '2026-09-27T00:00:00Z', '2026-09-27T00:00:00Z', 'f', 'y')`,
	).run(id, revisionNumber, status);
}

describe("checkBaselinesSection", () => {
	test("no config → single info item, no throw", () => {
		const section = checkBaselinesSection(cwd);
		assert.equal(section.title, "Baselines vs revisions (F7)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
	});

	test("config but no store DB → info note (pre-store)", () => {
		seedConfig();
		const section = checkBaselinesSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /No store DB yet/);
	});

	test("store with no baselines → ok", () => {
		seedConfig();
		const db = openStore();
		seedRevision(db, 1, "published", 1);
		closeStoreDb(db);
		const section = checkBaselinesSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /no baselines recorded yet/);
	});

	test("baseline → published revision → ok", () => {
		seedConfig();
		const db = openStore();
		seedRevision(db, 1, "published", 1);
		recordBaseline(db, "prd", "building-rtm", 1);
		closeStoreDb(db);
		const section = checkBaselinesSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /1 baseline\(s\), all pointing at published/);
	});

	test("baseline → superseded revision → info (acceptance 'report'), never warning/error", () => {
		seedConfig();
		const db = openStore();
		seedRevision(db, 1, "superseded", 1);
		seedRevision(db, 2, "published", 2);
		recordBaseline(db, "prd", "building-rtm", 1);
		closeStoreDb(db);

		const section = checkBaselinesSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /rev_id 1, superseded — head is r2/);
		assert.ok(section.items[0]?.suggestion);
		assert.equal(summarize([section]).summary.warning, 0);
		assert.equal(summarize([section]).summary.error, 0);
	});

	test("baseline → withdrawn revision → error naming kind, consumer, rev_id", () => {
		seedConfig();
		const db = openStore();
		seedRevision(db, 4, "withdrawn", 4);
		recordBaseline(db, "prd", "building-rtm", 4);
		closeStoreDb(db);

		const section = checkBaselinesSection(cwd);
		const errors = section.items.filter((i) => i.status === "error");
		assert.equal(errors.length, 1);
		assert.match(
			errors[0]?.message ?? "",
			/prd baseline adopted by building-rtm points at revision r4 \(rev_id 4, WITHDRAWN\)/,
		);
		assert.ok(errors[0]?.suggestion && errors[0].suggestion.length > 0);
		assert.equal(summarize([section]).summary.error, 1);
	});

	test("orphan baseline cannot be seeded — FK enforced (io/db.ts PRAGMA foreign_keys = ON)", () => {
		seedConfig();
		const db = openStore();
		seedRevision(db, 1, "published", 1);
		assert.throws(() => recordBaseline(db, "prd", "building-rtm", 999), /FOREIGN KEY constraint failed/);
		closeStoreDb(db);
		// and the check renders cleanly over a valid store
		const section = checkBaselinesSection(cwd);
		assert.equal(section.items.length, 1);
	});
});
