/**
 * Hash-chain verification tests (Phase 6 — N15/G-1).
 *
 * Covers: missing-config info, pre-store info, empty chains, intact
 * chains seeded through the real writers (appendAuditEntry/appendTxEntry),
 * and the three break shapes: edited row, deleted middle row, tx_log
 * tamper — each must land as an ERROR naming the exact row index.
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { appendAuditEntry, appendTxEntry, auditCanonicalPayload } from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { verifyChain, GENESIS_HASH, computeEntryHash } from "../../src/core/hashchain.js";
import { checkHashChainSection } from "../../src/doctor/checks/hash-chain.js";
import { summarize } from "../../src/doctor/_types.js";

let dirs: string[] = [];
let cwd = "";

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-hashchain-"));
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
 * Open the TodoApp store DB through the writer handle (fixture seeding).
 * @returns {ReturnType<typeof openStoreDb>} An open store connection (caller closes it).
 */
function openStore(): ReturnType<typeof openStoreDb> {
	return openStoreDb(buildStoreDbPath("TodoApp", cwd));
}

/** Seed n chained audit rows through the real writer. */
function seedAudit(db: ReturnType<typeof openStoreDb>, n: number): void {
	for (let i = 0; i < n; i++) {
		appendAuditEntry(db, { actor: "test", action: "publish", reason: `row ${i}` });
	}
}

describe("checkHashChainSection", () => {
	test("no config → single info item, no throw", () => {
		const section = checkHashChainSection(cwd);
		assert.equal(section.title, "Audit hash chain (N15)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
	});

	test("config but no store DB → info note (pre-store)", () => {
		seedConfig();
		const section = checkHashChainSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /No store DB yet/);
		assert.equal(
			existsSync(buildStoreDbPath("TodoApp", cwd)),
			false,
			"a read-only doctor check must not create the store DB (I11.1 side-effect pin)",
		);
	});

	test("store DB with empty chains → ok (genesis-anchored, nothing to break)", () => {
		seedConfig();
		const db = openStore();
		closeStoreDb(db);
		const section = checkHashChainSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /0 rows\) \+ tx_log \(0 rows\) chains intact/);
	});

	test("chained rows through the real writers → ok", () => {
		seedConfig();
		const db = openStore();
		seedAudit(db, 3);
		appendTxEntry(db, { actor: "test", operation: "publish", outcome: "commit" });
		closeStoreDb(db);
		const section = checkHashChainSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /chains intact/);
	});

	test("edited middle row → ERROR naming row #2 + entry_id 2", () => {
		seedConfig();
		const db = openStore();
		seedAudit(db, 3);
		db.prepare("UPDATE audit_ledger SET reason = 'tampered' WHERE entry_id = 2").run();
		closeStoreDb(db);

		const section = checkHashChainSection(cwd);
		const errors = section.items.filter((i) => i.status === "error");
		assert.equal(errors.length, 1);
		assert.match(errors[0]?.message ?? "", /audit_ledger chain BROKEN at row #2 \(entry_id 2\)/);
		assert.ok(errors[0]?.suggestion && errors[0].suggestion.length > 0);
		assert.equal(summarize([section]).summary.error, 1);
	});

	test("deleted middle row → ERROR (next row's prev_hash mismatch)", () => {
		seedConfig();
		const db = openStore();
		seedAudit(db, 3);
		db.prepare("DELETE FROM audit_ledger WHERE entry_id = 2").run();
		closeStoreDb(db);

		const section = checkHashChainSection(cwd);
		const errors = section.items.filter((i) => i.status === "error");
		assert.equal(errors.length, 1);
		assert.match(errors[0]?.message ?? "", /BROKEN at row #2/);
		// details explain which invariant failed
		assert.match(errors[0]?.details?.[0] ?? "", /prev_hash mismatch/);
	});

	test("tx_log tamper → ERROR naming tx_log", () => {
		seedConfig();
		const db = openStore();
		appendTxEntry(db, { actor: "test", operation: "publish", outcome: "commit" });
		appendTxEntry(db, { actor: "test", operation: "reset", outcome: "rollback" });
		db.prepare("UPDATE tx_log SET outcome = 'commit' WHERE tx_id = 2").run();
		closeStoreDb(db);

		const section = checkHashChainSection(cwd);
		const errors = section.items.filter((i) => i.status === "error");
		assert.equal(errors.length, 1);
		assert.match(errors[0]?.message ?? "", /tx_log chain BROKEN at row #2 \(tx_id 2\)/);
	});

	test("reported index equals verifyChain's contract + payload mismatch detail", () => {
		seedConfig();
		const db = openStore();
		seedAudit(db, 4);
		// Edit row 3's action — prev_hash still matches rows 1..2, so the
		// break is an entry_hash recomputation mismatch at index 3.
		db.prepare("UPDATE audit_ledger SET action = 'tampered' WHERE entry_id = 3").run();
		const recs = db
			.prepare(
				"SELECT entry_id, at, actor, action, artifact_kind, revision_number, reason, detail_json, prev_hash, entry_hash FROM audit_ledger ORDER BY entry_id",
			)
			.all() as unknown as Array<{
			entry_id: number;
			at: string;
			actor: string;
			action: string;
			artifact_kind: string | null;
			revision_number: number | null;
			reason: string | null;
			detail_json: string;
			prev_hash: string;
			entry_hash: string;
		}>;
		closeStoreDb(db);

		// independent recomputation with the same canonical payload builder
		const index = verifyChain(
			recs.map((r) => ({
				prev_hash: r.prev_hash,
				entry_hash: r.entry_hash,
				canonicalPayload: () =>
					auditCanonicalPayload({
						at: r.at,
						actor: r.actor,
						action: r.action,
						artifact_kind: r.artifact_kind,
						revision_number: r.revision_number,
						reason: r.reason,
						detail_json: r.detail_json,
					}),
			})),
		);
		assert.equal(index, 3);

		const section = checkHashChainSection(cwd);
		assert.match(section.items.find((i) => i.status === "error")?.message ?? "", /BROKEN at row #3 \(entry_id 3\)/);
		assert.match(
			section.items.find((i) => i.status === "error")?.details?.[0] ?? "",
			/entry_hash does not match its content/,
		);
	});

	test("genesis + computeEntryHash contract sanity", () => {
		// guards the check's expected-prev computation against hashchain drift
		const payload = "x";
		const h = computeEntryHash(GENESIS_HASH, payload);
		assert.match(h, /^[0-9a-f]{64}$/);
	});
});
