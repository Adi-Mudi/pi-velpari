// ============================================================================
// core/hashchain.ts — Tamper-evident hash chain primitives (Layer 0)
// ============================================================================
// Foundation (2026-09-27), decision N15: audit_ledger and tx_log rows are
// hash-chained — each row's entry_hash covers the previous row's entry_hash
// plus the row's canonical payload, so editing or deleting a stored row
// breaks the chain at a NAMED position. The store (io/store.ts) writes rows;
// the doctor (Phase 6) verifies chains read-only. Pure module: node:crypto
// only, no other src/ imports.
// ============================================================================

import { createHash } from "node:crypto";

/** Chain anchor for the first row of every chain (64 zero hex chars). */
export const GENESIS_HASH = "0".repeat(64);

/**
 * Entry hash = SHA-256 of the previous entry's hash + the row's canonical
 * payload. The canonical payload is produced by the caller (JSON.stringify
 * with sorted keys over the row's content fields) — this module stays
 * payload-shape-agnostic.
 */
export function computeEntryHash(prevHash: string, canonicalPayload: string): string {
	return createHash("sha256").update(`${prevHash}\n${canonicalPayload}`, "utf8").digest("hex");
}

/** One chained row as seen by the verifier (storage order). */
export interface ChainedRow {
	prev_hash: string;
	entry_hash: string;
	/** The exact canonical payload string that was hashed at write time. */
	canonicalPayload(): string;
}

/**
 * Verify a chain of rows in storage order.
 * @returns {number | null} null when intact, else the 1-based index of the
 *   first broken row (chain break named for the doctor report).
 */
export function verifyChain(rows: readonly ChainedRow[]): number | null {
	let expectedPrev = GENESIS_HASH;
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!;
		if (row.prev_hash !== expectedPrev) return i + 1;
		if (row.entry_hash !== computeEntryHash(row.prev_hash, row.canonicalPayload())) return i + 1;
		expectedPrev = row.entry_hash;
	}
	return null;
}
