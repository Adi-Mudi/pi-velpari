/**
 * Phase B E2E — fixture migration (backup-first proof, N28/G7/G1).
 *
 * Drives the instruction §6.3 ladder inside a real `pi --mode rpc`
 * process (Tier 1, no LLM key):
 *
 *   1. Build a genuine v005 store fixture through the RPC bash channel:
 *      a built-module script applies only `MIGRATIONS ≤ 5` (direct
 *      `node:sqlite` — D9 covers `src/`, not test scripts) + seeds one
 *      `fr` row; `PRAGMA user_version` = 5.
 *   2. Open through the extension (`openStoreDb`) → backup snapshot under
 *      `Backup/velpari/<proj>/` + `manifest.jsonl` line
 *      `trigger:"migrate"` + `quickCheck:true`; `user_version` =
 *      `maxKnownVersion()`; the seeded `fr` row survives; audit entry
 *      `action:"migration"` carries `{from, to, backupPath}`; the digest
 *      stamp is readable (`readStoreDigestStamp`).
 *   3. Doctor clean: `runDoctor` reports zero errors (fixture hygiene =
 *      the lanes recipe: skills/ copy + package.json keywords/pi.extensions).
 *   4. Re-open → idempotent: no second backup, same version.
 *
 * Fixture note: `git init` first so the backup records a git commit;
 * the skills/ + package.json additions are required for doctor green
 * (they are stage-skills / official-readiness ERRORS otherwise).
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, distModuleUrl, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedVelpariConfig } from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

const PROJECT = "E2EMigrateApp";

/** Walk up from this file until the pi-velpari package.json — same rule
 *  as helpers/test-home.ts:findProjectRoot (not exported). */
function findProjectRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 16; i++) {
		const pkg = join(dir, "package.json");
		if (existsSync(pkg)) {
			try {
				const json = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string };
				if (json.name === "pi-velpari" || json.name === "@adi-mudi/pi-velpari") return dir;
			} catch {
				/* keep walking */
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error("migrate-v006 e2e: could not locate the pi-velpari project root");
}

/** Run `script` (ESM source, top-level await allowed) in the temp project
 *  via the RPC bash channel; returns the parsed JSON payload the script
 *  printed to stdout.
 *  @param {RpcClient} client - Live RPC session against the temp project.
 *  @param {string} script - ESM source executed with cwd = the fixture.
 *  @returns {Promise<T>} The JSON payload the script wrote to stdout.
 */
async function runModuleScript<T>(client: RpcClient, script: string): Promise<T> {
	const result = await client.request<any>("bash", {
		command: [
			// node:sqlite prints an ExperimentalWarning to stderr on first
			// load (D9); the bash channel merges stdout+stderr and these
			// scripts parse the union as JSON, so silence warnings.
			"NODE_NO_WARNINGS=1 node --input-type=module -e",
			JSON.stringify(script),
		].join(" "),
	});
	assert.ok(result.success === true, `subprocess failed: ${JSON.stringify(result.error ?? result)}`);
	const output: string = result.data?.output ?? result.output ?? "";
	assert.ok(output.length > 0, "subprocess produced no output");
	try {
		return JSON.parse(output) as T;
	} catch {
		throw new Error(
			`subprocess output is not pure JSON — head: ${JSON.stringify(output.slice(0, 400))} — tail: ${JSON.stringify(output.slice(-1500))}`,
		);
	}
}

const DB_JS = JSON.stringify(distModuleUrl("io/db.js"));
const DOCTOR_JS = JSON.stringify(distModuleUrl("doctor/index.js"));

describe("e2e/migrate-v006", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;
	/** Snapshot file count observed at the first open — test 4 proves no second backup. */
	let firstSnapshotCount = 0;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedVelpariConfig(home, { projectName: PROJECT });
		// Official-readiness: keywords + pi.extensions are errors otherwise.
		writeFileSync(
			join(home.cwd, "package.json"),
			JSON.stringify(
				{
					name: "pi-velpari-e2e-fixture",
					version: "0.0.0",
					type: "module",
					private: true,
					keywords: ["pi-package", "pi-extension"],
					pi: { extensions: ["./pi-extension/src/index.ts"] },
				},
				null,
				2,
			) + "\n",
			"utf8",
		);
		// Stage-skills check resolves skills/ from the project cwd.
		cpSync(join(findProjectRoot(), "skills"), join(home.cwd, "skills"), { recursive: true });
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("1. builds a genuine v005 fixture (MIGRATIONS ≤ 5 + one fr row)", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<{ version: number; frCount: number }>(
			client,
			`import { execSync } from "node:child_process"; ` +
				`import { mkdirSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`import { DatabaseSync } from "node:sqlite"; ` +
				`import { MIGRATIONS } from ${DB_JS}; ` +
				`const cwd = process.cwd(); ` +
				`try { execSync("git init -q && git add -A && git -c user.email=e2e@e2e -c user.name=e2e commit -qm init"); } catch (e) { } ` +
				`const dir = join(cwd, "Doc", "store", "${PROJECT}"); ` +
				`mkdirSync(dir, { recursive: true }); ` +
				`const db = new DatabaseSync(join(dir, "index.db")); ` +
				`let version = -1; ` +
				`try { ` +
				`  db.exec("PRAGMA journal_mode = WAL;"); ` +
				`  for (const m of MIGRATIONS) { if (m.version <= 5) m.up(db); } ` +
				`  db.exec("PRAGMA user_version = 5"); ` +
				`  db.prepare("INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint) " + ` +
				`    "VALUES ('r1', 'prd', 1, 'drafting-prd', '2026-09-27T00:00:00Z', 'fp')").run(); ` +
				`  db.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'aaa')").run(); ` +
				`  version = db.prepare("PRAGMA user_version").get().user_version; ` +
				`} finally { db.close(); } ` +
				`const frCount = (() => { const d = new DatabaseSync(join(dir, "index.db")); ` +
				`  try { return d.prepare("SELECT count(*) AS c FROM fr").get().c; } finally { d.close(); } })(); ` +
				`process.stdout.write(JSON.stringify({ version, frCount }));`,
		);

		assert.strictEqual(out.version, 5, "fixture must be a genuine v005 DB");
		assert.strictEqual(out.frCount, 1, "fixture must carry the seeded fr row");
	});

	it("2. openStoreDb migrates with backup-first proof (manifest, audit, digest)", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<{
			version: number;
			maxKnown: number;
			frCount: number;
			stampNotNull: boolean;
			audit: { reason: string; detailJson: string } | null;
			backupFiles: string[];
			backupLines: { type: string; trigger?: string; quickCheck?: boolean; backupPath?: string }[];
		}>(
			client,
			`import { readFileSync, readdirSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`import { openStoreDb, closeStoreDb, readStoreDigestStamp, maxKnownVersion } from ${DB_JS}; ` +
				`const cwd = process.cwd(); ` +
				`const dbPath = join(cwd, "Doc", "store", "${PROJECT}", "index.db"); ` +
				`const db = openStoreDb(dbPath); ` +
				`let version; let frCount; let audit = null; let stampNotNull = false; ` +
				`try { ` +
				`  version = db.prepare("PRAGMA user_version").get().user_version; ` +
				`  frCount = db.prepare("SELECT count(*) AS c FROM fr").get().c; ` +
				`  const rows = db.prepare("SELECT reason, detail_json AS detailJson FROM audit_ledger " + ` +
				`    "WHERE action = 'migration' ORDER BY entry_id").all(); ` +
				`  audit = rows.length > 0 ? rows[0] : null; ` +
				`  stampNotNull = readStoreDigestStamp(db) !== null; ` +
				`} finally { closeStoreDb(db); } ` +
				`const backupDir = join(cwd, "Backup", "velpari", "${PROJECT}"); ` +
				`const backupFiles = readdirSync(backupDir); ` +
				`const backupLines = readFileSync(join(backupDir, "manifest.jsonl"), "utf8") ` +
				`  .split("\\n").filter(function (l) { return l.trim().length > 0; }) ` +
				`  .map(function (l) { return JSON.parse(l); }) ` +
				`  .filter(function (l) { return l.type === "backup"; }); ` +
				`process.stdout.write(JSON.stringify({ ` +
				`  version, maxKnown: maxKnownVersion(), frCount, stampNotNull, audit, backupFiles, backupLines ` +
				`}));`,
		);

		// v006 applied — version expectations derive from maxKnownVersion(),
		// never a hardcoded 6.
		assert.strictEqual(out.version, out.maxKnown, "user_version must equal maxKnownVersion()");
		assert.ok(out.maxKnown >= 6, `expected the v006 locking migration, got maxKnown=${out.maxKnown}`);
		assert.strictEqual(out.frCount, 1, "seeded fr row must survive the migration");
		assert.strictEqual(out.stampNotNull, true, "digest stamp must be readable after migrate");
		// Backup first: snapshot + manifest exist; manifest line proves
		// trigger + N11 quick_check.
		assert.ok(out.backupFiles.includes("manifest.jsonl"), "manifest.jsonl must exist");
		assert.strictEqual(
			out.backupFiles.filter((f) => f.endsWith(".db")).length,
			1,
			"exactly one snapshot db (got: " + JSON.stringify(out.backupFiles) + ")",
		);
		firstSnapshotCount = out.backupFiles.filter((f) => f.endsWith(".db")).length;
		assert.strictEqual(out.backupLines.length, 1, "exactly one backup manifest line");
		const line = out.backupLines[0];
		assert.ok(line !== undefined, "backup line present");
		assert.strictEqual(line.trigger, "migrate", "manifest line must carry trigger=migrate");
		assert.strictEqual(line.quickCheck, true, "manifest line must record quick_check pass");
		assert.ok(
			typeof line.backupPath === "string" && line.backupPath.startsWith(`Backup/velpari/${PROJECT}/`),
			`backupPath under Backup/velpari/${PROJECT}/ (got: ${String(line.backupPath)})`,
		);
		// G7 audit: one migration entry naming from/to/backupPath.
		assert.ok(out.audit !== null, "audit entry action=migration must exist");
		assert.strictEqual(out.audit.reason, `schema v5 → v${out.maxKnown}`, "audit reason names the version transition");
		const detail = JSON.parse(out.audit.detailJson) as { from: number; to: number; backupPath: string | null };
		assert.strictEqual(detail.from, 5, "audit detail.from");
		assert.strictEqual(detail.to, out.maxKnown, "audit detail.to");
		assert.ok(
			typeof detail.backupPath === "string" && detail.backupPath.startsWith(`Backup/velpari/${PROJECT}/`),
			`audit backupPath names the snapshot (got: ${String(detail.backupPath)})`,
		);
	});

	it("3. doctor is green (zero errors) after the migration", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		// File transport (doctor.e2e pattern): the report exceeds the bash
		// channel's stdout cap.
		const transportPath = `${home.cwd}/e2e-migrate-doctor.json`;
		const result = await client.request<any>("bash", {
			command: [
				"NODE_NO_WARNINGS=1 node --input-type=module -e",
				JSON.stringify(
					`import { writeFileSync } from "node:fs"; ` +
						`import { runDoctor } from ${DOCTOR_JS}; ` +
						`const report = runDoctor(process.cwd()); ` +
						`const errors = []; ` +
						`for (const s of report.sections) { ` +
						`  for (const item of s.items) { ` +
						`    if (item.status === "error") errors.push(s.title + ": " + item.message); ` +
						`  } ` +
						`} ` +
						`const summary = JSON.stringify({ ok: report.ok, errorCount: report.summary.error, errors }); ` +
						`writeFileSync(process.cwd() + "/e2e-migrate-doctor.json", summary); ` +
						`process.stdout.write("WROTE " + summary.length);`,
				),
			].join(" "),
		});
		assert.ok(result.success === true, `runDoctor subprocess failed: ${JSON.stringify(result.error ?? result)}`);
		const output: string = result.data?.output ?? result.output ?? "";
		assert.ok(output.startsWith("WROTE "), `unexpected doctor output: ${JSON.stringify(output)}`);
		assert.ok(existsSync(transportPath), `doctor transport file missing at ${transportPath}`);
		const out = JSON.parse(readFileSync(transportPath, "utf8")) as {
			ok: boolean;
			errorCount: number;
			errors: string[];
		};

		assert.deepStrictEqual(out.errors, [], `doctor reported errors: ${JSON.stringify(out.errors, null, 2)}`);
		assert.strictEqual(out.errorCount, 0, "doctor summary must count zero errors");
		assert.strictEqual(out.ok, true, "doctor verdict must be green");
	});

	it("4. re-open is idempotent: no second backup", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<{
			version: number;
			maxKnown: number;
			snapshotCount: number;
			backupLines: number;
		}>(
			client,
			`import { readFileSync, readdirSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`import { openStoreDb, closeStoreDb, maxKnownVersion } from ${DB_JS}; ` +
				`const cwd = process.cwd(); ` +
				`const db = openStoreDb(join(cwd, "Doc", "store", "${PROJECT}", "index.db")); ` +
				`let version; ` +
				`try { version = db.prepare("PRAGMA user_version").get().user_version; } finally { closeStoreDb(db); } ` +
				`const backupDir = join(cwd, "Backup", "velpari", "${PROJECT}"); ` +
				`const backupFiles = readdirSync(backupDir); ` +
				`const backupLines = readFileSync(join(backupDir, "manifest.jsonl"), "utf8") ` +
				`  .split("\\n").filter(function (l) { return l.trim().length > 0; }) ` +
				`  .filter(function (l) { return JSON.parse(l).type === "backup"; }).length; ` +
				`process.stdout.write(JSON.stringify({ ` +
				`  version, maxKnown: maxKnownVersion(), ` +
				`  snapshotCount: backupFiles.filter(function (f) { return f.endsWith(".db"); }).length, backupLines ` +
				`}));`,
		);

		assert.strictEqual(out.version, out.maxKnown, "re-open must land on maxKnownVersion()");
		assert.strictEqual(
			out.snapshotCount,
			firstSnapshotCount,
			"re-open (no pending migrations) must not create a second snapshot",
		);
		assert.strictEqual(out.backupLines, 1, "manifest must still carry exactly one backup line");
	});
});
