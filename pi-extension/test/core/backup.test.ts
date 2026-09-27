// Unit tests — core/backup.ts snapshot creation (Phase 3, N9/N10/N11, G-3).
// Covers: happy path + manifest line (case 1), source byte-for-byte untouched
// and no sidecars (case 2), dirty-WAL rows captured (case 3), per-trigger
// manifest ordering (case 4), non-repo git fallback (case 5), missing DB
// creates nothing (case 6), invalid retention config never blocks (case 7).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
	createBackupSnapshot,
	listBackupFiles,
	MANIFEST_NAME,
	readBackupManifest,
	restoreBackupSnapshot,
	verifyBackup,
	type BackupManifestLine,
	type BackupTrigger,
} from "../../src/core/backup.js";
import { verifyChain, type ChainedRow } from "../../src/core/hashchain.js";
import { buildBackupDir, buildStoreDbPath } from "../../src/core/paths.js";
import { closeStoreDb, openStoreDb, openStoreDbReadOnly } from "../../src/io/db.js";
import { auditCanonicalPayload, publishArtifactCas, writeArtifact, type ArtifactPayload } from "../../src/io/store.js";

const PROJECT = "TestApp";

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Parse manifest.jsonl the way a consumer would (one JSON object per line). */
function readManifest(cwd: string, projectName: string): BackupManifestLine[] {
	const file = join(buildBackupDir(projectName, cwd), MANIFEST_NAME);
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as BackupManifestLine);
}

/** Create a fixture store DB with `rows` rows in `backup_fixture`. */
function makeFixtureStore(cwd: string, rows = 3): string {
	const dbPath = buildStoreDbPath(PROJECT, cwd);
	const db = openStoreDb(dbPath);
	try {
		db.exec("CREATE TABLE IF NOT EXISTS backup_fixture(id INTEGER PRIMARY KEY, v TEXT);");
		const insert = db.prepare("INSERT INTO backup_fixture(v) VALUES (?)");
		for (let i = 0; i < rows; i++) insert.run(`row-${i + 1}`);
	} finally {
		closeStoreDb(db);
	}
	return dbPath;
}

function countFixtureRows(dbPath: string): number {
	const db = openStoreDbReadOnly(dbPath);
	try {
		const row = db.prepare("SELECT COUNT(*) AS n FROM backup_fixture").get() as { n: number };
		return row.n;
	} finally {
		db.close();
	}
}

/** Read audit_ledger rows in storage order as ChainedRow[] (N15 verify input). */
function auditChain(db: DatabaseSync): ChainedRow[] {
	const rows = db
		.prepare(
			"SELECT at, actor, action, artifact_kind, revision_number, reason, detail_json, prev_hash, entry_hash FROM audit_ledger ORDER BY entry_id",
		)
		.all() as Array<Record<string, unknown>>;
	return rows.map((r) => ({
		prev_hash: String(r.prev_hash),
		entry_hash: String(r.entry_hash),
		canonicalPayload: () =>
			auditCanonicalPayload({
				at: String(r.at),
				actor: String(r.actor),
				action: String(r.action),
				artifact_kind: r.artifact_kind === null ? null : String(r.artifact_kind),
				revision_number: r.revision_number === null ? null : Number(r.revision_number),
				reason: r.reason === null ? null : String(r.reason),
				detail_json: String(r.detail_json),
			}),
	}));
}

function readUserVersion(dbPath: string): number {
	const db = openStoreDbReadOnly(dbPath);
	try {
		return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
	} finally {
		db.close();
	}
}

function hasAuditLedger(dbPath: string): boolean {
	const db = openStoreDbReadOnly(dbPath);
	try {
		const row = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_ledger'")
			.get() as { name?: string } | undefined;
		return row?.name === "audit_ledger";
	} finally {
		db.close();
	}
}

describe("backup — snapshot creation (N9/N10/N11, G-3)", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "velpari-backup-"));
	});

	after(() => {
		// per-test dirs are tiny; clean the whole prefix on suite exit
	});

	test("1: happy path — snapshot under Backup/velpari with matching manifest line", () => {
		const dbPath = makeFixtureStore(cwd, 3);
		const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
		assert.ok(record !== null, "snapshot must succeed");

		const abs = join(cwd, record.backupPath);
		assert.ok(existsSync(abs), `snapshot missing: ${abs}`);
		assert.ok(
			record.backupPath.startsWith(`Backup/velpari/${PROJECT}/`),
			`N10 location violated: ${record.backupPath}`,
		);
		assert.match(
			basename(abs),
			/^index-\d{8}T\d{6}Z-([0-9a-f]{7}|nogit)(-\d+)?\.db$/,
			"filename = index-<UTC>-<git-short>.db (D1)",
		);
		assert.equal(record.dbDigest, sha256File(abs), "digest must cover the snapshot bytes");
		assert.equal(record.quickCheckOk, true, "N11 self-test must pass");

		const lines = readManifest(cwd, PROJECT);
		assert.equal(lines.length, 1, "exactly one manifest line");
		const line = lines[0]!;
		assert.equal(line.type, "backup");
		assert.equal(line.project, PROJECT);
		assert.equal(line.backupPath, record.backupPath);
		assert.equal(line.sha256, record.dbDigest);
		assert.equal(line.trigger, "publish");
		assert.equal(line.quickCheck, true);
		assert.equal(typeof line.bytes, "number");
		assert.equal(line.createdAt, record.createdAt);
		assert.match(line.dbPath ?? "", /index\.db$/);
	});

	test("2: source untouched — same bytes, no frame loss, no checkpoint (G-3)", () => {
		const dbPath = makeFixtureStore(cwd, 4);
		const before = sha256File(dbPath);
		const rowsBefore = countFixtureRows(dbPath);

		const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
		assert.ok(record !== null);

		assert.equal(sha256File(dbPath), before, "source bytes must not change");
		assert.equal(countFixtureRows(dbPath), rowsBefore, "no rows added or removed by the backup");
		// SQLite read scratch (plan v1.1 Issue 4, user-approved deviation): a
		// read-only handle on a WAL-mode file may leave an empty -wal + -shm
		// beside the source after close. That is inert — the invariant is that
		// NOTHING was checkpointed or dropped: a leftover -wal must be empty.
		// The risky case (a pre-existing dirty -wal) is asserted in case 3.
		const walPath = `${dbPath}-wal`;
		if (existsSync(walPath)) {
			assert.equal(statSync(walPath).size, 0, "leftover -wal must be empty (no frames lost)");
		}
	});

	test("3: dirty-WAL rows are in the snapshot (source connection held open)", () => {
		const dbPath = makeFixtureStore(cwd, 3);
		const db = openStoreDb(dbPath); // stays open → rows sit in the WAL
		let snapshotPath: string | null = null;
		try {
			const insert = db.prepare("INSERT INTO backup_fixture(v) VALUES (?)");
			insert.run("wal-1");
			insert.run("wal-2");
			const visible = countFixtureRows(dbPath);
			assert.equal(visible, 5);

			const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
			assert.ok(record !== null);

			// The dirty WAL must survive the backup untouched: never
			// checkpointed, never deleted by the read-only snapshot path.
			const walPath = `${dbPath}-wal`;
			assert.ok(existsSync(walPath), "dirty -wal must still be there");
			assert.ok(statSync(walPath).size > 0, "dirty -wal must still hold frames");
			snapshotPath = join(cwd, record.backupPath);
		} finally {
			closeStoreDb(db);
		}

		assert.ok(snapshotPath);
		assert.equal(
			countFixtureRows(snapshotPath),
			5,
			"VACUUM INTO must include committed-but-uncheckpointed WAL rows",
		);
	});

	test("4: each trigger records its own value; 3 snapshots → 3 manifest lines (oldest first)", () => {
		const dbPath = makeFixtureStore(cwd, 2);
		const triggers: BackupTrigger[] = ["publish", "db-reset", "migrate"];
		for (const trigger of triggers) {
			const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger, dbPath });
			assert.ok(record !== null, `trigger ${trigger}`);
		}
		const lines = readManifest(cwd, PROJECT);
		assert.equal(lines.length, 3);
		assert.deepEqual(
			lines.map((l) => l.trigger),
			[...triggers],
			"manifest appends in creation order",
		);
		assert.ok(lines.every((l) => l.type === "backup"));
		const files = lines.map((l) => basename(l.backupPath ?? ""));
		assert.equal(new Set(files).size, 3, "each snapshot gets a unique filename");
	});

	test("5: non-repo cwd → gitCommit null and -nogit filename, still a record", () => {
		const dbPath = makeFixtureStore(cwd, 1);
		const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
		assert.ok(record !== null);
		assert.equal(record.gitCommit, null, "temp dir is not a git repo");
		assert.match(basename(join(cwd, record.backupPath)), /^index-\d{8}T\d{6}Z-nogit(-\d+)?\.db$/);
		const line = readManifest(cwd, PROJECT)[0]!;
		assert.equal(line.gitCommit, null);
	});

	test("6: missing DB → null and NO Backup folder created (rule 2)", () => {
		const record = createBackupSnapshot({
			cwd,
			projectName: PROJECT,
			trigger: "publish",
			dbPath: join(cwd, "Doc", "store", PROJECT, "index.db"),
		});
		assert.equal(record, null);
		assert.equal(existsSync(join(cwd, "Backup")), false, "no Backup folder for a missing source");
	});

	test("7: invalid files.json retention never blocks a backup (rule 1, keep-10 fallback)", () => {
		const dbPath = makeFixtureStore(cwd, 2);
		mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: PROJECT, velpari: { retention: { backups: 0 } } }),
			"utf8",
		);
		const created: string[] = [];
		for (let i = 0; i < 12; i++) {
			const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
			assert.ok(record !== null, `malformed retention must not fail snapshot ${i + 1}`);
			assert.equal(record.quickCheckOk, true);
			created.push(record.backupPath);
		}
		const files = readdirSync(buildBackupDir(PROJECT, cwd)).filter((f) => f.endsWith(".db"));
		assert.equal(files.length, 10, "invalid retention falls back to keep-last-10");
		const trims = readManifest(cwd, PROJECT).filter((l) => l.type === "trim");
		assert.equal(trims.length, 2);
		assert.ok(trims.every((l) => l.kept === 10), "fallback keep recorded as 10");
	});
});

describe("backup — FIFO prune (N10)", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "velpari-fifo-"));
	});

	test("1: 12 snapshots → exactly 10 kept, the 2 oldest gone, 2 trim lines", () => {
		const dbPath = makeFixtureStore(cwd, 3);
		const created: string[] = [];
		for (let i = 0; i < 12; i++) {
			const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
			assert.ok(record !== null, `snapshot ${i + 1}`);
			created.push(record.backupPath);
		}

		const dir = buildBackupDir(PROJECT, cwd);
		const files = readdirSync(dir).filter((f) => f.endsWith(".db"));
		assert.equal(files.length, 10, "FIFO keeps exactly 10 (default retention)");

		const expectedGone = created.slice(0, 2).map((p) => basename(p));
		for (const gone of expectedGone) {
			assert.equal(existsSync(join(dir, gone)), false, `${gone} (oldest) must be pruned`);
		}
		const expectedKept = created.slice(2).map((p) => basename(p));
		for (const kept of expectedKept) {
			assert.ok(files.includes(kept), `${kept} must survive`);
		}
		assert.ok(files.includes(basename(created[11]!)), "the 12th snapshot itself is always retained");

		const lines = readManifest(cwd, PROJECT);
		const trims = lines.filter((l) => l.type === "trim");
		assert.equal(trims.length, 2, "one trim line per deletion");
		assert.deepEqual(trims.map((t) => basename(t.deleted ?? "")).sort(), [...expectedGone].sort());
		assert.ok(trims.every((t) => t.kept === 10));
		assert.ok(trims.every((t) => t.project === PROJECT));
		assert.equal(lines.filter((l) => l.type === "backup").length, 12, "all 12 backup lines kept");
	});

	test("2: configured keep — retention.backups = 3 → 5 snapshots → 3 remain", () => {
		const dbPath = makeFixtureStore(cwd, 2);
		mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "velpari", "files.json"),
			JSON.stringify({
				version: 4,
				projectName: PROJECT,
				velpari: { retention: { revisions: "all", backups: 3 } },
			}),
			"utf8",
		);
		const created: string[] = [];
		for (let i = 0; i < 5; i++) {
			const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
			assert.ok(record !== null);
			created.push(basename(record.backupPath));
		}
		const files = readdirSync(buildBackupDir(PROJECT, cwd)).filter((f) => f.endsWith(".db"));
		assert.equal(files.length, 3, "configured keep honored");
		for (const gone of created.slice(0, 2)) {
			assert.equal(files.includes(gone), false, `${gone} must be pruned`);
		}
		for (const kept of created.slice(2)) {
			assert.ok(files.includes(kept), `${kept} must survive`);
		}
		const trims = readManifest(cwd, PROJECT).filter((l) => l.type === "trim");
		assert.equal(trims.length, 2);
		assert.ok(trims.every((l) => l.kept === 3));
	});

	test("3: trim writes audit_ledger rows and the chain still verifies", () => {
		const dbPath = makeFixtureStore(cwd, 3);
		for (let i = 0; i < 12; i++) {
			assert.ok(createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath }));
		}
		const db = openStoreDb(dbPath);
		try {
			const rows = db
				.prepare("SELECT actor, action, reason, detail_json FROM audit_ledger WHERE action = 'backup-trim'")
				.all() as Array<{ actor: string; action: string; reason: string; detail_json: string }>;
			assert.equal(rows.length, 2, "one audit row per pruned backup");
			for (const row of rows) {
				assert.equal(row.actor, "velpari-backup");
				assert.equal(row.reason, "FIFO keep-last-10");
				const detail = JSON.parse(row.detail_json) as { project: string; kept: number; deleted: string[] };
				assert.equal(detail.project, PROJECT);
				assert.equal(detail.kept, 10);
				assert.equal(detail.deleted.length, 1);
				assert.match(detail.deleted[0]!, /^Backup\/velpari\//);
			}
			assert.equal(verifyChain(auditChain(db)), null, "N15 chain stays clean after trim rows");
		} finally {
			closeStoreDb(db);
		}
	});

	test("4: legacy DB without audit_ledger — trim works, DB never opened for write", () => {
		const dbPath = buildStoreDbPath(PROJECT, cwd);
		mkdirSync(join(dirname(dbPath)), { recursive: true });
		const legacy = new DatabaseSync(dbPath);
		legacy.exec("CREATE TABLE legacy_t(id INTEGER PRIMARY KEY); PRAGMA user_version = 3;");
		legacy.close();
		const userVersionBefore = readUserVersion(dbPath);
		assert.equal(userVersionBefore, 3);
		assert.equal(hasAuditLedger(dbPath), false);

		const created: string[] = [];
		for (let i = 0; i < 11; i++) {
			const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
			assert.ok(record !== null);
			created.push(record.backupPath);
		}

		const files = readdirSync(buildBackupDir(PROJECT, cwd)).filter((f) => f.endsWith(".db"));
		assert.equal(files.length, 10, "FIFO works without an audit ledger");
		assert.equal(existsSync(join(cwd, created[0]!)), false, "oldest pruned");

		const trims = readManifest(cwd, PROJECT).filter((l) => l.type === "trim");
		assert.equal(trims.length, 1);
		assert.equal(hasAuditLedger(dbPath), false, "backup must never migrate a legacy DB");
		assert.equal(readUserVersion(dbPath), userVersionBefore, "user_version untouched");
	});

	test("5: snapshots keep matching their manifest digest after a trim (source was written by audit)", () => {
		const dbPath = makeFixtureStore(cwd, 3);
		for (let i = 0; i < 5; i++) {
			assert.ok(createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "migrate", dbPath }));
		}
		const backupLines = readManifest(cwd, PROJECT).filter((l) => l.type === "backup");
		assert.ok(backupLines.some((l) => l.type === "backup"));
		let checked = 0;
		for (const line of backupLines) {
			const abs = join(cwd, line.backupPath!);
			if (!existsSync(abs)) continue; // pruned snapshot — nothing to verify
			assert.equal(sha256File(abs), line.sha256, `${line.backupPath} digest drifted`);
			checked++;
		}
		assert.ok(checked >= 3, `expected surviving snapshots, checked ${checked}`);
	});
});

// --- restore helpers (G-2 suite) -----------------------------------------

/** Publish one PRD artifact so the fixture has an envelope to restore. */
function publishDraftPrd(db: DatabaseSync, runId: string): void {
	writeArtifact(
		db,
		"prd",
		runId,
		{ version: 1, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" },
		{ fr: [{ id: "FR-1", phase: 1, textHash: "aaa111", text: "Prose for restore." }] } as ArtifactPayload,
	);
	publishArtifactCas(db, runId, "prd", null);
}

/** Published envelope row for `runId` (null when destroyed). */
function envelopeOf(dbPath: string, runId: string): { version: number; stage: string; run_id: string } | null {
	const db = openStoreDbReadOnly(dbPath);
	try {
		const row = db
			.prepare("SELECT version, stage, run_id FROM artifact_revisions WHERE kind = 'prd' AND run_id = ?")
			.get(runId) as { version: number; stage: string; run_id: string } | undefined;
		return row ?? null;
	} finally {
		db.close();
	}
}

function quickOk(path: string): boolean {
	const db = openStoreDbReadOnly(path);
	try {
		return (db.prepare("PRAGMA quick_check").get() as { quick_check?: string }).quick_check === "ok";
	} finally {
		db.close();
	}
}

/** Fixture: store DB with rows + one published artifact, then a snapshot. */
function storeWithSnapshot(cwd: string, rows = 3): { dbPath: string; backupPath: string } {
	const dbPath = makeFixtureStore(cwd, rows);
	const db = openStoreDb(dbPath);
	try {
		publishDraftPrd(db, "run-g2");
	} finally {
		closeStoreDb(db);
	}
	const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
	assert.ok(record !== null, "fixture snapshot must succeed");
	return { dbPath, backupPath: record.backupPath };
}

describe("backup — restore (G-2 mandatory proof)", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "velpari-restore-"));
	});

	test("1: round trip on a healthy target — content, envelope, safety copy, audit", () => {
		const { dbPath, backupPath } = storeWithSnapshot(cwd, 3);
		const db = openStoreDb(dbPath);
		try {
			db.exec("DELETE FROM backup_fixture; DELETE FROM artifact_revisions;");
		} finally {
			closeStoreDb(db);
		}
		assert.equal(countFixtureRows(dbPath), 0, "live DB destroyed");
		assert.equal(envelopeOf(dbPath, "run-g2"), null);

		const res = restoreBackupSnapshot({ cwd, projectName: PROJECT, backupPath });
		assert.deepEqual(res.problems, [], "healthy restore must succeed");
		assert.equal(res.ok, true);
		assert.deepEqual(res.warnings, [], "healthy-target restore has no skips");
		assert.equal(res.restoredFrom, backupPath);
		assert.equal(res.bytesMatchSnapshot, true, "internal byte-for-byte proof after the replace");

		assert.equal(countFixtureRows(dbPath), 3, "rows back");
		const env = envelopeOf(dbPath, "run-g2");
		assert.ok(env !== null, "envelope row back");
		assert.equal(env.version, 1);
		assert.equal(env.stage, "drafting-prd");
		assert.ok(quickOk(dbPath), "post-restore quick_check");

		assert.ok(res.safetyCopy !== null, "pre-restore safety snapshot taken");
		assert.ok(existsSync(join(cwd, res.safetyCopy)));
		const lines = readManifest(cwd, PROJECT);
		const pre = lines.filter((l) => l.type === "pre-restore");
		assert.equal(pre.length, 1);
		assert.equal(pre[0]!.backupPath, res.safetyCopy);
		assert.equal(pre[0]!.sha256, sha256File(join(cwd, res.safetyCopy)));
		assert.equal(pre[0]!.quickCheck, true);

		const restores = lines.filter((l) => l.type === "restore");
		assert.equal(restores.length, 1, "restore manifest line written");
		assert.equal(restores[0]!.restoredFrom, backupPath);
		assert.equal(restores[0]!.safetyCopy, res.safetyCopy);

		const verifyDb = openStoreDb(dbPath);
		try {
			const rows = verifyDb
				.prepare("SELECT actor, action, detail_json FROM audit_ledger WHERE action = 'backup-restore'")
				.all() as Array<{ actor: string; action: string; detail_json: string }>;
			assert.equal(rows.length, 1, "backup-restore audit row");
			assert.equal(rows[0]!.actor, "velpari-backup");
			const detail = JSON.parse(rows[0]!.detail_json) as { from: string };
			assert.equal(detail.from, backupPath);
			assert.equal(verifyChain(auditChain(verifyDb)), null, "chain clean after restore");
		} finally {
			closeStoreDb(verifyDb);
		}
		assert.equal(verifyBackup(cwd, PROJECT, backupPath).ok, true, "snapshot itself untouched");
	});

	test("2: GAP-1 — target index.db DELETED: restore recreates it with one warning", () => {
		const { dbPath, backupPath } = storeWithSnapshot(cwd, 3);
		rmSync(dbPath, { force: true });
		assert.equal(existsSync(dbPath), false);

		const res = restoreBackupSnapshot({ cwd, projectName: PROJECT, backupPath });
		assert.equal(res.ok, true, JSON.stringify(res.problems));
		assert.equal(res.safetyCopy, null, "no target → no safety copy (GAP-1)");
		assert.deepEqual(res.warnings, ["pre-restore safety snapshot skipped — no target to copy"]);
		assert.ok(existsSync(dbPath), "target recreated");
		assert.equal(countFixtureRows(dbPath), 3);
		assert.ok(envelopeOf(dbPath, "run-g2") !== null);
		assert.ok(quickOk(dbPath));
		assert.ok(existsSync(join(cwd, backupPath)), "original snapshot still present");

		const lines = readManifest(cwd, PROJECT);
		const restores = lines.filter((l) => l.type === "restore");
		assert.equal(restores.length, 1);
		assert.equal(restores[0]!.safetyCopy, null, "manifest records the skip");
	});

	test("3: GAP-1b — target present but corrupt: safety copy skipped, restore proceeds", () => {
		const { dbPath, backupPath } = storeWithSnapshot(cwd, 3);
		writeFileSync(dbPath, "total garbage, not sqlite at all — the disaster case", "utf8");

		const res = restoreBackupSnapshot({ cwd, projectName: PROJECT, backupPath });
		assert.equal(res.ok, true, JSON.stringify(res.problems));
		assert.equal(res.safetyCopy, null);
		assert.equal(res.warnings.length, 1);
		assert.match(res.warnings[0]!, /target failed quick_check/);
		assert.equal(countFixtureRows(dbPath), 3, "corrupt target replaced by the snapshot");
		assert.ok(quickOk(dbPath));
	});

	test("4: safety-snapshot abort — healthy target whose safety copy cannot be written", () => {
		const { dbPath, backupPath } = storeWithSnapshot(cwd, 3);
		const dir = buildBackupDir(PROJECT, cwd);
		const before = sha256File(dbPath);
		chmodSync(dir, 0o500);
		try {
			const res = restoreBackupSnapshot({ cwd, projectName: PROJECT, backupPath });
			assert.equal(res.ok, false, "healthy DB must be protectable before it is overwritten");
			assert.match(res.problems.join(" "), /safety snapshot failed/);
			assert.equal(res.bytesMatchSnapshot, undefined, "no copy happened");
		} finally {
			chmodSync(dir, 0o700);
		}
		assert.equal(sha256File(dbPath), before, "target byte-identical after the refused restore");
	});

	test("5: tampered snapshot — digest mismatch refused, zero writes", () => {
		const { dbPath, backupPath } = storeWithSnapshot(cwd, 3);
		const abs = join(cwd, backupPath);
		const beforeTarget = sha256File(dbPath);
		const bytes = readFileSync(abs);
		bytes[Math.floor(bytes.length / 2)] = bytes[Math.floor(bytes.length / 2)]! ^ 0x5a;
		writeFileSync(abs, bytes);

		const res = restoreBackupSnapshot({ cwd, projectName: PROJECT, backupPath });
		assert.equal(res.ok, false);
		assert.match(res.problems.join(" "), /digest mismatch|quick_check failed/);
		assert.equal(res.restoredFrom, "", "refused before any write");
		assert.equal(sha256File(dbPath), beforeTarget, "target untouched");
	});

	test("6: unknown path — a .db with no manifest line is refused", () => {
		const { dbPath, backupPath } = storeWithSnapshot(cwd, 3);
		const dir = buildBackupDir(PROJECT, cwd);
		const unknown = join(dir, "index-20990101T000000Z-abcd123.db");
		copyFileSync(join(cwd, backupPath), unknown);
		const before = sha256File(dbPath);

		const res = restoreBackupSnapshot({
			cwd,
			projectName: PROJECT,
			backupPath: `Backup/velpari/${PROJECT}/index-20990101T000000Z-abcd123.db`,
		});
		assert.equal(res.ok, false);
		assert.match(res.problems[0]!, /no manifest entry/);
		assert.match(res.problems[0]!, /manifest\.jsonl/, "problem tells the user where to look");
		assert.equal(sha256File(dbPath), before, "target untouched");
	});

	test("7: newer-schema snapshot (G3) is refused before any write", () => {
		const { dbPath, backupPath } = storeWithSnapshot(cwd, 3);
		const dir = buildBackupDir(PROJECT, cwd);
		const future = join(dir, "index-20990101T000000Z-future.db");
		copyFileSync(join(cwd, backupPath), future);
		const craft = new DatabaseSync(future);
		craft.exec("PRAGMA user_version = 99;");
		craft.close();
		const relFuture = `Backup/velpari/${PROJECT}/index-20990101T000000Z-future.db`;
		const manifestPath = join(dir, MANIFEST_NAME);
		const line = {
			type: "backup",
			project: PROJECT,
			dbPath: `Doc/store/${PROJECT}/index.db`,
			backupPath: relFuture,
			sha256: sha256File(future),
			bytes: statSync(future).size,
			gitCommit: null,
			createdAt: new Date().toISOString(),
			trigger: "migrate",
			quickCheck: true,
		};
		writeFileSync(manifestPath, `${JSON.stringify(line)}\n`, { encoding: "utf8", flag: "a" });
		const before = sha256File(dbPath);

		const res = restoreBackupSnapshot({ cwd, projectName: PROJECT, backupPath: relFuture });
		assert.equal(res.ok, false);
		assert.match(res.problems.join(" "), /newer than this extension/);
		assert.equal(sha256File(dbPath), before, "target untouched");
	});

	test("8: active run lock (Issue 2) refuses with holder guidance; unlock lets it through", () => {
		const { dbPath, backupPath } = storeWithSnapshot(cwd, 3);
		const lockDir = join(cwd, ".pi", "velpari", ".lock");
		mkdirSync(lockDir, { recursive: true });
		writeFileSync(
			join(lockDir, "meta.json"),
			JSON.stringify({
				pid: 424242,
				host: "test-host",
				command: "/velpari-stage-publish",
				startedAt: "2026-09-27T00:00:00Z",
				heartbeatAt: "2026-09-27T00:00:00Z",
			}),
			"utf8",
		);
		const before = sha256File(dbPath);

		const refused = restoreBackupSnapshot({ cwd, projectName: PROJECT, backupPath });
		assert.equal(refused.ok, false);
		assert.match(refused.problems.join(" "), /run lock exists/);
		assert.match(refused.problems.join(" "), /424242/);
		assert.match(refused.problems.join(" "), /\/velpari-stage-publish/);
		assert.match(refused.problems.join(" "), /\.lock/);
		assert.match(refused.problems.join(" "), /close any running pi session/);
		assert.equal(sha256File(dbPath), before, "target untouched while locked");

		rmSync(lockDir, { recursive: true, force: true });
		const allowed = restoreBackupSnapshot({ cwd, projectName: PROJECT, backupPath });
		assert.equal(allowed.ok, true, JSON.stringify(allowed.problems));
		assert.equal(countFixtureRows(dbPath), 3);
	});

	test("9: readers — manifest order skips damage, listBackupFiles newest first, verifyBackup", () => {
		const dbPath = makeFixtureStore(cwd, 2);
		const paths: string[] = [];
		for (let i = 0; i < 3; i++) {
			const r = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
			assert.ok(r !== null);
			paths.push(r.backupPath);
		}
		const lines = readBackupManifest(cwd, PROJECT);
		assert.equal(lines.length, 3, "file order preserved");
		assert.deepEqual(lines.map((l) => l.backupPath), paths);

		const manifestPath = join(buildBackupDir(PROJECT, cwd), MANIFEST_NAME);
		writeFileSync(manifestPath, "{ this line is damaged\n", { encoding: "utf8", flag: "a" });
		const afterDamage = readBackupManifest(cwd, PROJECT);
		assert.equal(afterDamage.length, 3, "damaged line skipped, never thrown");
		assert.deepEqual(afterDamage.map((l) => l.backupPath), paths);

		const files = listBackupFiles(cwd, PROJECT);
		assert.equal(files.length, 3);
		assert.equal(basename(files[0]!), basename(paths[2]!), "newest first");
		assert.equal(basename(files[2]!), basename(paths[0]!), "oldest last");

		assert.deepEqual(verifyBackup(cwd, PROJECT, paths[0]!), { ok: true, problems: [] });
		const unknown = verifyBackup(cwd, PROJECT, `Backup/velpari/${PROJECT}/index-19990101T000000Z-aaaaaaa.db`);
		assert.equal(unknown.ok, false);
		assert.ok(unknown.problems.length > 0);
		// exported reader agrees with the local parse helper
		assert.equal(readBackupManifest(cwd, PROJECT).length, afterDamage.length);
	});
});
