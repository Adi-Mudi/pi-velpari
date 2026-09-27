/**
 * Hash-chain verification (Phase 6 — N15/G-1).
 *
 * Foundation chained every `audit_ledger` and `tx_log` row: each row
 * stores `hash(content + prev_row_hash)` anchored at `GENESIS_HASH`, and
 * `verifyChain` re-derives the whole chain in one linear pass. This check
 * surfaces the break point in the doctor report: a broken chain is an
 * ERROR naming the exact 1-based row index (acceptance row 6) — a stored
 * row was edited, deleted, or inserted out of order.
 *
 * Honest limit (discussion G-1): the chain is tamper-evident, not proof.
 * Deleting the *final* row leaves a valid prefix; external anchors (git
 * history, YAML checksums, backup manifests) catch that class.
 *
 * Reads store rows directly (Phase 7 doctor discipline) and writes
 * nothing: no stamp, no audit row, no migration of its own — the
 * `openStoreDb`/`closeStoreDb` discipline of `checkDbIntegritySection`
 * (R3). Every path is wrapped: doctor must always render.
 *
 * L1 (doctor) → L0 (core/paths, core/config, core/projectnames,
 * core/hashchain, io/db, io/store) — legal direction.
 */

import { existsSync } from "node:fs";
import { buildStoreDbPath } from "../../core/paths.js";
import { loadFilesConfig, validateFilesConfig } from "../../core/config.js";
import { getEffectiveProjectNames } from "../../core/projectnames.js";
import { GENESIS_HASH, computeEntryHash, verifyChain, type ChainedRow } from "../../core/hashchain.js";
import { openStoreDb, closeStoreDb } from "../../io/db.js";
import { auditCanonicalPayload, txCanonicalPayload } from "../../io/store.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Audit hash chain (N15)";

/** One chain table as read from the store. */
interface ChainRead {
	/** Row ids in storage order (for naming the broken row). */
	ids: number[];
	/** Rows handed to the verifier, in storage order. */
	rows: ChainedRow[];
	/** Human label of the first row's identity column ("entry_id"/"tx_id"). */
	idColumn: string;
}

/**
 * Read `audit_ledger` rows in storage order as verifier rows.
 * Returns null when the table does not exist (pre-v004 store).
 */
function readAuditChain(db: ReturnType<typeof openStoreDb>): ChainRead | null {
	const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_ledger'").get() as
		| { name: string }
		| undefined;
	if (!table) return null;
	const recs = db
		.prepare(
			"SELECT entry_id, at, actor, action, artifact_kind, revision_number, reason, detail_json, prev_hash, entry_hash " +
				"FROM audit_ledger ORDER BY entry_id ASC",
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
	return {
		idColumn: "entry_id",
		ids: recs.map((r) => r.entry_id),
		rows: recs.map((r) => ({
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
	};
}

/** Read `tx_log` rows in storage order as verifier rows (same shape). */
function readTxChain(db: ReturnType<typeof openStoreDb>): ChainRead | null {
	const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tx_log'").get() as
		| { name: string }
		| undefined;
	if (!table) return null;
	const recs = db
		.prepare(
			"SELECT tx_id, at, actor, operation, before_digest, after_digest, outcome, prev_hash, entry_hash " +
				"FROM tx_log ORDER BY tx_id ASC",
		)
		.all() as unknown as Array<{
		tx_id: number;
		at: string;
		actor: string;
		operation: string;
		before_digest: string | null;
		after_digest: string | null;
		outcome: string;
		prev_hash: string;
		entry_hash: string;
	}>;
	return {
		idColumn: "tx_id",
		ids: recs.map((r) => r.tx_id),
		rows: recs.map((r) => ({
			prev_hash: r.prev_hash,
			entry_hash: r.entry_hash,
			canonicalPayload: () =>
				txCanonicalPayload({
					at: r.at,
					actor: r.actor,
					operation: r.operation,
					before_digest: r.before_digest,
					after_digest: r.after_digest,
					outcome: r.outcome,
				}),
		})),
	};
}

/**
 * Build one broken-chain error item: names the 1-based index AND the row
 * id, plus which invariant failed (prev_hash mismatch vs payload-hash
 * mismatch) with expected/found values.
 */
function brokenItem(
	projectName: string,
	chain: ChainRead,
	table: string,
	index: number,
	dbPath: string,
): DiagnosticItem {
	const i = index - 1;
	const row = chain.rows[i];
	const id = chain.ids[i];
	const expectedPrev = i === 0 ? GENESIS_HASH : (chain.rows[i - 1]?.entry_hash ?? "");
	const details = [`table=${table}`, `row #${index} (${chain.idColumn} ${id})`, `db=${dbPath}`];
	let reason: string;
	if (row && row.prev_hash !== expectedPrev) {
		reason = `prev_hash mismatch — expected ${expectedPrev.slice(0, 12)}…, found ${row.prev_hash.slice(0, 12)}…`;
	} else if (row) {
		const recomputed = computeEntryHash(row.prev_hash, row.canonicalPayload());
		reason = `entry_hash does not match its content — stored ${row.entry_hash.slice(0, 12)}…, recomputed ${recomputed.slice(0, 12)}…`;
	} else {
		reason = "row missing from storage order";
	}
	return {
		status: "error",
		message:
			`${projectName}: ${table} chain BROKEN at row #${index} (${chain.idColumn} ${id}) — ` +
			"a stored row was edited, deleted or inserted out of order.",
		details: [reason, ...details],
		suggestion: suggestionFor("hash-chain-broken"),
	};
}

/**
 * Effective projectNames for the cwd, or [] when config is missing or
 * invalid (degrade to an info item — doctor must always render).
 */
function effectiveProjectNamesSafe(cwd: string): string[] {
	try {
		const cfg = loadFilesConfig(cwd);
		if (!validateFilesConfig(cfg)) return [];
		return getEffectiveProjectNames(cfg);
	} catch {
		return [];
	}
}

/**
 * Build the "Audit hash chain (N15)" section. Multi-design aware: one
 * audit per effective projectName's store DB. No DB anywhere → single
 * info note (pre-store project).
 */
export function checkHashChainSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		const projectNames = effectiveProjectNamesSafe(cwd);

		if (projectNames.length === 0) {
			items.push({
				status: "info",
				message: "Hash-chain check skipped — project name missing.",
				suggestion: suggestionFor("project-name-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		const dbPaths = projectNames.map((projectName) => ({
			projectName,
			dbPath: buildStoreDbPath(projectName, cwd),
		}));

		if (dbPaths.every(({ dbPath }) => !existsSync(dbPath))) {
			items.push({
				status: "info",
				message: "No store DB yet — hash chain verified after the first publish.",
				details: dbPaths.map(({ dbPath }) => `expected: ${dbPath}`),
				suggestion: suggestionFor("store-db-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		for (const { projectName, dbPath } of dbPaths) {
			if (!existsSync(dbPath)) {
				items.push({
					status: "info",
					message: `${projectName}: no store DB (pre-store project).`,
					details: [`expected: ${dbPath}`],
					suggestion: suggestionFor("store-db-missing"),
				});
				continue;
			}
			const db = openStoreDb(dbPath);
			try {
				const audit = readAuditChain(db);
				const tx = readTxChain(db);
				if (!audit || !tx) {
					items.push({
						status: "info",
						message: `${projectName}: ledger tables not present in this store schema.`,
						details: [`db=${dbPath}`],
					});
					continue;
				}

				let anyBroken = false;
				for (const [table, chain] of [
					["audit_ledger", audit],
					["tx_log", tx],
				] as const) {
					const broken = verifyChain(chain.rows);
					if (broken !== null) {
						anyBroken = true;
						items.push(brokenItem(projectName, chain, table, broken, dbPath));
					}
				}

				if (!anyBroken) {
					items.push({
						status: "ok",
						message:
							`${projectName}: audit_ledger (${audit.rows.length} rows) + tx_log (${tx.rows.length} rows) ` +
							"chains intact (genesis-anchored, N15).",
					});
				}
			} finally {
				closeStoreDb(db);
			}
		}
	} catch (err) {
		items.push({
			status: "info",
			message: `Hash-chain check skipped: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
	return { title: SECTION_TITLE, items };
}
