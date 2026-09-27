// ============================================================================
// ops/export-revision.ts — revision-aware export (Phase 4, Layer 1)
// ============================================================================
// Decision record: .IDE_Plans/velpari-versioning-locking-recovery_discussion_20260926_2134_v1.0.md
//   F6/F9  — every published revision is an immutable full snapshot; the
//            snapshot's `yaml_bytes` ARE the deterministic export bytes.
//   F10    — the export version picker is ordered by REVISION number (not
//            generated_at time).
//   F16    — withdrawn (tombstoned) revisions are never exportable.
//   N3     — export writes to the automatic grouped Doc/ path; this module
//            supplies the revision-specific filename so old revisions never
//            collide with head-export filenames.
//   G-1/Q1 — exports are audited too: one appendAuditEntry per export with
//            the revision_number (read-only audit; never blocks the export).
//
// Ownership note (Master Outline §4.2): `ops/export-doc*` + `commands/export`
// are Phase-4-owned; `io/store.ts` is Foundation-FROZEN (user review fix 1,
// plan v1.1) and `ops/protection.ts` is Phase-2-owned — both are IMPORT-only
// here. listExportableRevisions is deliberately a thin wrapper over
// ops/protection.ts:listRevisions (filter withdrawn → reverse ascending); a
// dedicated L0 reader would be a Phase-I integration request (Phase-5
// precedent).
//
// Scope guard: L1 rendering + file write + audit append only. No picker UX
// (L3 owns ctx.ui), no status/head mutations, no publish/approve logic.
// ============================================================================

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openStoreDb, closeStoreDb } from "../io/db.js";
import type { ArtifactEnvelope, ArtifactKind } from "../io/store.js";
import { appendAuditEntry } from "../io/store.js";
import { atomicWriteFile } from "../io/atomic-write.js";
import { parseYaml } from "../core/yaml-data.js";
import { listRevisions, readRevisionSnapshot, type RevisionRef, type RevisionSnapshot } from "./protection.js";

/** The picker's row type, re-exported so L3 consumers import from here. */
export type { RevisionRef };
import {
	mdToHtml,
	renderEnvelopeHeader,
	renderKindMarkdown,
	countRowsOf,
	KIND_LABELS,
	type ExportFormat,
} from "./export-doc.js";

// ---------------------------------------------------------------------------
// listExportableRevisions — the export picker's data door (F10)
// ---------------------------------------------------------------------------

/**
 * Revisions available to the export picker: everything
 * `ops/protection.ts:listRevisions` returns minus withdrawn, re-ordered
 * ASCENDING by revision_number (F10 — callers reverse for display so the
 * head revision is the first/default item).
 *
 * Wrapper, not a store change: `io/store.ts` is Foundation-frozen (Master
 * Outline §4.2; user review fix 1, plan v1.1). A dedicated L0 reader is a
 * Phase-I integration request (Phase-5 precedent).
 * @param {DatabaseSync} db - Open store connection (from openStoreDb).
 * @param {ArtifactKind} kind - Artifact kind to list.
 * @returns {RevisionRef[]} Ascending by revision_number; withdrawn excluded.
 */
export function listExportableRevisions(db: DatabaseSync, kind: ArtifactKind): RevisionRef[] {
	return listRevisions(db, kind)
		.filter((r) => r.status !== "withdrawn")
		.reverse();
}

// ---------------------------------------------------------------------------
// runRevisionExport — export ONE revision (any non-withdrawn status)
// ---------------------------------------------------------------------------

/** runRevisionExport input. `overwrite` must be caller-confirmed. */
export interface ExportRevisionInput {
	/** Store DB path (buildStoreDbPath output). */
	dbPath: string;
	/** Target revision id (from listExportableRevisions / the picker). */
	revisionId: number;
	/** Output format. */
	format: ExportFormat;
	/** Destination file path (automatic grouped Doc/ path — N3). */
	outputPath: string;
	/** Overwrite an existing file — the CALLER confirms with the user. */
	overwrite?: boolean;
}

/** runRevisionExport result — `ok:false` carries a human-readable `problem`. */
export interface ExportRevisionResult {
	ok: boolean;
	/** Absolute path of the written file (present when ok). */
	path?: string;
	/** Failure reason (present when !ok). Never thrown — callers notify. */
	problem?: string;
	/** The exported revision's number (present when ok). */
	revisionNumber?: number;
	/** Row counts per payload key (md/html only; present when ok). */
	counts?: Record<string, number>;
	/** Best-effort audit/git warnings — never a failed export. */
	warnings?: string[];
}

/**
 * Default destination for a REVISION export (N3 family):
 * `Doc/export/<project>/<Artifact>_<project>_rev<N>.<ext>` — the `_rev<N>`
 * suffix keeps old-revision downloads from colliding with head exports.
 * @param {string} projectName - Project name (sanitized into the path).
 * @param {ArtifactKind} kind - Selected artifact kind.
 * @param {number} revisionNumber - The revision's number.
 * @param {ExportFormat} format - Selected output format.
 * @param {string} cwd - Working directory root.
 * @returns {string} Absolute default path suggestion.
 */
export function buildRevisionExportPath(
	projectName: string,
	kind: ArtifactKind,
	revisionNumber: number,
	format: ExportFormat,
	cwd: string,
): string {
	const safeProject = projectName.replace(/[^A-Za-z0-9_-]+/g, "-");
	return join(
		cwd,
		"Doc",
		"export",
		safeProject,
		`${KIND_LABELS[kind]}_${safeProject}_rev${revisionNumber}.${format}`,
	);
}

/**
 * Narrow a snapshot row's `kind: string` into an ArtifactKind (the v004
 * snapshot table stores kind as TEXT). Null = unknown kind → refusal.
 */
const KIND_SET: ReadonlySet<string> = new Set(Object.keys(KIND_LABELS));
function asKind(kind: string): ArtifactKind | null {
	return KIND_SET.has(kind) ? (kind as ArtifactKind) : null;
}

/**
 * Reconstruct the envelope view a snapshot renders from — same fields
 * renderEnvelopeHeader consumes, sourced entirely from the immutable
 * snapshot row (F6: the snapshot is self-contained).
 */
function envelopeViewOf(snapshot: RevisionSnapshot, kind: ArtifactKind): ArtifactEnvelope {
	return {
		runId: snapshot.runId,
		kind,
		version: snapshot.version,
		stage: snapshot.stage,
		generatedAt: snapshot.generatedAt,
		sha256Fingerprint: snapshot.sha256Fingerprint,
		inputs: snapshot.inputs,
		reviewerVerdict: snapshot.reviewerVerdict,
		changeLog: snapshot.changeLog,
		status: "published",
		headRevisionId: null,
		frozen: false,
		freezeReason: null,
	};
}

/**
 * Export one stored revision from `artifact_revisions` (Phase 4).
 *
 * yaml = the snapshot's EXACT stored bytes — never re-rendered (they equal
 * the publish-time sidecar bytes by construction: publishArtifactCas stores
 * exactly exportArtifactYaml output). md/html = deterministic re-render from
 * the snapshot's parsed rows through the SAME renderers the head exporter
 * uses (renderEnvelopeHeader + renderKindMarkdown + mdToHtml) — identical
 * style, historical content.
 *
 * Read-only against the store except one best-effort audit entry (G-1/Q1)
 * appended AFTER the file write. Refusals return `ok:false` + `problem` —
 * never throw.
 * @param {ExportRevisionInput} input - Fully resolved export request.
 * @returns {ExportRevisionResult} Outcome (path + counts, or problem).
 */
export function runRevisionExport(input: ExportRevisionInput): ExportRevisionResult {
	if (!existsSync(input.dbPath)) {
		return { ok: false, problem: `store DB not found at ${input.dbPath}` };
	}
	let db: DatabaseSync;
	try {
		db = openStoreDb(input.dbPath);
	} catch (err) {
		return { ok: false, problem: `cannot open store DB: ${String(err)}` };
	}
	const warnings: string[] = [];
	try {
		const snapshot = readRevisionSnapshot(db, input.revisionId);
		if (!snapshot) {
			return { ok: false, problem: `no revision with id ${input.revisionId}` };
		}
		const kind = asKind(snapshot.kind);
		if (kind === null) {
			return { ok: false, problem: `revision ${input.revisionId} has unknown kind '${snapshot.kind}'` };
		}
		if (snapshot.status === "withdrawn") {
			return {
				ok: false,
				problem: `revision v${snapshot.revisionNumber} is tombstoned (F16) — withdrawn revisions are never exportable`,
			};
		}
		if (existsSync(input.outputPath) && input.overwrite !== true) {
			return { ok: false, problem: `file already exists: ${input.outputPath}` };
		}

		let bytes: string;
		let counts: Record<string, number> | undefined;
		if (input.format === "yaml") {
			// Exact stored bytes — never re-rendered (F6/F9; instruction doc).
			bytes = snapshot.yamlBytes;
		} else {
			const parsed = parseYaml(snapshot.yamlBytes);
			if (!parsed.ok) {
				return {
					ok: false,
					problem: `snapshot bytes for revision ${input.revisionId} are not parseable export YAML: ${parsed.error}`,
				};
			}
			const data = parsed.data as { rows?: Record<string, unknown> } | null;
			const rows = (data && typeof data === "object" ? data.rows : undefined) ?? {};
			const md =
				renderEnvelopeHeader(envelopeViewOf(snapshot, kind)) +
				"\n" +
				renderKindMarkdown(kind, rows, projectSlugOf(input.dbPath));
			bytes = input.format === "html" ? mdToHtml(md) : md;
			counts = countRowsOf(rows);
		}

		atomicWriteFile(input.outputPath, bytes, "utf8");

		// G-1/Q1: audit old-revision exports too — one entry with the
		// revision_number. Read-only audit in its own autocommit txn, best
		// effort: a failed log line is a warning, never a failed export.
		try {
			appendAuditEntry(db, {
				actor: "velpari-export",
				action: "export",
				artifactKind: kind,
				revisionNumber: snapshot.revisionNumber,
				detail: { runId: snapshot.runId, revisionId: snapshot.revisionId, format: input.format, outputPath: input.outputPath },
			});
		} catch (err) {
			warnings.push(`export audit entry failed: ${err instanceof Error ? err.message : String(err)}`);
		}

		return {
			ok: true,
			path: input.outputPath,
			revisionNumber: snapshot.revisionNumber,
			counts,
			warnings: warnings.length > 0 ? warnings : undefined,
		};
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Derive the project slug (DB dir name) from a store DB path —
 * `.../Doc/store/<slug>/index.db`. Empty when the shape does not match
 * (non-store dbPath) — the design renderer then falls back to its legacy
 * PROJECT placeholder, same as the head exporter.
 * @param {string} dbPath - The store DB path.
 * @returns {string} The project slug, or "".
 */
function projectSlugOf(dbPath: string): string {
	const m = /[\\/]store[\\/]([^\\/]+)[\\/]index\.db$/.exec(dbPath);
	return m ? m[1]! : "";
}
