// ============================================================================
// ops/handoff-meta.ts — N29 store-backed document version metadata — Layer 1
// ============================================================================
// The handoff payload (architect-inputs.json) gains per-document version
// metadata so Senai can detect "newer version published" downstream:
//
//   - `version`        — store envelope version (artifacts.version)
//   - `revisionId` / `revisionNumber` — the head artifact_revisions row
//                        handed to Senai (null when the kind has no head)
//   - `frozen` / `freezeReason` — freeze state (N4); refreshed AFTER
//                        freezeAllForHandoff so the written payload
//                        carries post-freeze truth (`frozen: true`,
//                        `freezeReason: "handoff (N4)"`)
//
// All SQL lives in this one D-owned file: ONE read-only store open per
// handoff (perf budget: handoff < 250 ms — ~2 tiny SELECTs per document).
// Contract: NEVER throws — a missing store, a corrupt store or a legacy
// pre-store project yields all-null / false metadata (legacy-safe).
//
// Layer 1 — imports only L0 (`io/`, `core/`) + the sibling L1
// `ops/protection.ts` read helper.
// ============================================================================

import type { DatabaseSync } from "node:sqlite";
import { closeStoreDb, openStoreDbReadOnly } from "../io/db.js";
import { getHeadRevision, readArtifact } from "../io/store.js";
import { buildStoreDbPath } from "../core/paths.js";
import { ARTIFACT_TO_KIND } from "../core/upstream.js";
import { readFrozenState } from "./protection.js";

/** One document's store-backed handoff metadata (N29). */
export interface DocumentVersionMeta {
	/** Store envelope version (`artifacts.version`); null when no row. */
	version: number | null;
	/** Head `artifact_revisions.revision_id`; null when the kind has no head. */
	revisionId: number | null;
	/** Monotonic revision number of that head; null when there is none. */
	revisionNumber: number | null;
	/** Freeze state (N4); false when the kind has no row. */
	frozen: boolean;
	/** Freeze reason (N4); null when unfrozen or no row. */
	freezeReason: string | null;
}

/** Per-artifact-key metadata map (artifact key = paths/upstream map key). */
export type DocumentMetaMap = Map<string, DocumentVersionMeta>;

/** Default meta for an artifact with no store row (legacy-safe). */
function nullMeta(): DocumentVersionMeta {
	return { version: null, revisionId: null, revisionNumber: null, frozen: false, freezeReason: null };
}

/**
 * Open the project store READ-ONLY once and run `fn`; any failure
 * (missing file, corrupt file, schema surprise) resolves to `null` —
 * callers fall back to the all-null metadata.
 * @param {string} projectName - Store project (Doc/store/<project>/index.db).
 * @param {string} cwd - Project root.
 * @param {(db: DatabaseSync) => T} fn - Work to run on the open handle.
 * @returns {T | null} The result, or null when the store could not be read.
 */
function withReadOnlyStore<T>(projectName: string, cwd: string, fn: (db: DatabaseSync) => T): T | null {
	let db: DatabaseSync | null = null;
	try {
		db = openStoreDbReadOnly(buildStoreDbPath(projectName, cwd));
		return fn(db);
	} catch {
		return null;
	} finally {
		if (db) closeStoreDb(db);
	}
}

/**
 * Collect store-backed version metadata for the handoff documents (N29).
 * Opens the project store once; per artifact key resolves
 * `ARTIFACT_TO_KIND` (wireframe → design, they share one envelope) and
 * reads the envelope + head revision. Missing store / missing row →
 * all-null entry (the key is always present so callers can fill blindly).
 * NEVER throws.
 * @param {string} projectName - Store project name.
 * @param {string} runId - The run whose published heads to read.
 * @param {string} cwd - Project root.
 * @param {readonly string[]} artifacts - Artifact keys (REQUIRED_TYPES order).
 * @returns {DocumentMetaMap} Metadata keyed by artifact key.
 */
export function collectDocumentMeta(
	projectName: string,
	runId: string,
	cwd: string,
	artifacts: readonly string[],
): DocumentMetaMap {
	const meta: DocumentMetaMap = new Map();
	for (const artifact of artifacts) meta.set(artifact, nullMeta());

	withReadOnlyStore(projectName, cwd, (db) => {
		for (const artifact of artifacts) {
			const kind = ARTIFACT_TO_KIND[artifact.toLowerCase()];
			if (!kind) continue; // file-only input (brainstorm notes) — no store row
			try {
				const read = readArtifact(db, runId, kind);
				if (!read) continue;
				const head = getHeadRevision(db, runId, kind);
				meta.set(artifact, {
					version: typeof read.envelope.version === "number" ? read.envelope.version : null,
					revisionId: head ? head.revisionId : null,
					revisionNumber: head ? head.revisionNumber : null,
					frozen: read.envelope.frozen === true,
					freezeReason: read.envelope.freezeReason ?? null,
				});
			} catch {
				// per-kind read failure keeps the all-null default
			}
		}
		return true;
	});

	return meta;
}

/**
 * Re-read the freeze state per artifact AFTER `freezeAllForHandoff`
 * succeeded, so the payload written next carries post-freeze truth
 * (N29 + decision 6). Mutates the given map's entries in place; keys
 * whose kind has no row stay untouched (frozen: false). NEVER throws.
 * @param {string} projectName - Store project name.
 * @param {string} runId - The run whose rows were just frozen.
 * @param {string} cwd - Project root.
 * @param {DocumentMetaMap} meta - Map produced by `collectDocumentMeta`.
 */
export function refreshFrozenMeta(projectName: string, runId: string, cwd: string, meta: DocumentMetaMap): void {
	withReadOnlyStore(projectName, cwd, (db) => {
		for (const [artifact, entry] of meta) {
			const kind = ARTIFACT_TO_KIND[artifact.toLowerCase()];
			if (!kind) continue;
			try {
				const frozen = readFrozenState(db, runId, kind);
				if (frozen) {
					entry.frozen = frozen.frozen;
					entry.freezeReason = frozen.reason;
				}
			} catch {
				// keep the pre-freeze value — the doctor reports store oddities
			}
		}
		return true;
	});
}
