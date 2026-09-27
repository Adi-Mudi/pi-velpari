/**
 * core/upstream.ts — who moved an upstream revision (Layer 0; Phase 5, N8).
 *
 * The freshness stale set (`core/freshness.ts:computeStaleSet`) already says
 * WHICH inputs moved. It cannot say WHO moved them — and that is exactly the
 * N8 A/B split:
 *
 *   * own-run staleness  → my own flow republished an upstream artifact
 *                          → normal update flow (F14): report + confirm.
 *   * foreign-run move   → a DIFFERENT run/worktree published a newer revision
 *                          → STOP, notify, force a separate worktree.
 *
 * The publisher identity lives in `artifact_revisions.run_id` (status
 * `'published'`). This module reads it through a READ-ONLY store handle — it
 * never writes, and never edits the F-frozen `io/store.ts` (Phase I may add an
 * exported reader later; §11.2 of the plan records that).
 *
 * Deterministic + fail-soft: no store, no published revision or an unreadable
 * DB → null. Nothing here is ever guessed.
 */

import { existsSync } from "node:fs";
import { relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openStoreDbReadOnly } from "../io/db.js";
import { getHeadRevision, type ArtifactKind } from "../io/store.js";
import type { StaleItem } from "./freshness.js";
import { buildStoreDbPath } from "./paths.js";
import { lastCommitForPath } from "./worktree.js";

/**
 * Lowercase artifact name → store kind. StaleItem.artifact is always
 * lowercase (`prd`, `rtm`, `test-plan`, …). `ops/db-slices.ts` holds the
 * display-name map; `test/core/upstream.test.ts` pins the two together so
 * either table drifting fails CI.
 */
export const ARTIFACT_TO_KIND: Record<string, ArtifactKind> = {
	prd: "prd",
	rtm: "rtm",
	"feasibility-study": "feasibility",
	design: "design",
	"atomic-functions": "atomic-functions",
	pseudocode: "pseudocode",
	"test-plan": "testplan",
	"test-cases": "testplan",
	"development-order": "development-order",
	"final-design": "final-design",
};

/**
 * The store kind behind a stale item, or null for file-only inputs
 * (brainstorm notes) — those can only ever be own-run (design note 9).
 * @param {StaleItem} item - One entry of the freshness stale set.
 * @returns {ArtifactKind | null} Store kind, or null when not store-backed.
 */
export function artifactKindForItem(item: StaleItem): ArtifactKind | null {
	return ARTIFACT_TO_KIND[item.artifact.toLowerCase()] ?? null;
}

/** One published revision of one kind (the row the notice names). */
export interface PublishedHead {
	/** Store kind. */
	kind: string;
	/** `artifact_revisions.revision_id`. */
	revisionId: number;
	/** Monotonic revision number across the whole kind (F6/F10). */
	revisionNumber: number;
	/** The run that published this revision. */
	runId: string;
	/** ISO publish timestamp. */
	publishedAt: string;
	/** Envelope fingerprint stored with the revision. */
	fingerprint: string;
	/** Artifact version (e.g. 3 for v3). */
	version: number;
}

/** The A/B verdict for one artifact kind. */
export interface UpstreamMove {
	/** Store kind the verdict is about. */
	kind: string;
	/** Which side moved it. */
	move: "foreign-run" | "own-run";
	/** The revision the notice names (newest foreign head when foreign). */
	publishedHead: PublishedHead;
	/** The revision MY line is at (null = my line never published this kind). */
	myRevisionNumber: number | null;
	/** Last commit touching the store DB on this branch (R5), or null. */
	storeLastCommit: string | null;
	/** Other runs holding a published revision of this kind. */
	otherRuns: string[];
}

/**
 * Every PUBLISHED revision of a kind, newest revision first.
 * @param {DatabaseSync} db - Open store handle (read-only is enough).
 * @param {ArtifactKind} kind - Kind to read.
 * @returns {PublishedHead[]} Rows ordered by `revision_number DESC`.
 */
export function publishedHeadsForKind(db: DatabaseSync, kind: ArtifactKind): PublishedHead[] {
	const rows = db
		.prepare(
			`SELECT revision_id, revision_number, run_id, published_at, sha256_fingerprint, version
			 FROM artifact_revisions WHERE kind = ? AND status = 'published' ORDER BY revision_number DESC`,
		)
		.all(kind) as Record<string, unknown>[];
	return rows.map((row) => ({
		kind,
		revisionId: Number(row.revision_id),
		revisionNumber: Number(row.revision_number),
		runId: String(row.run_id),
		publishedAt: String(row.published_at),
		fingerprint: String(row.sha256_fingerprint),
		version: Number(row.version),
	}));
}

/**
 * Open the project store read-only, run `fn`, always close. Returns null when
 * the store file does not exist or cannot be read — callers treat that as
 * "nothing to report", never as an error (fail-open).
 */
function withStoreDb<T>(cwd: string, projectName: string, fn: (db: DatabaseSync) => T): T | null {
	if (projectName === "") return null;
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) return null;
	let db: DatabaseSync | null = null;
	try {
		db = openStoreDbReadOnly(dbPath);
		return fn(db);
	} catch {
		return null;
	} finally {
		try {
			db?.close();
		} catch {
			// already closed or never opened
		}
	}
}

/** The newest published revision of a kind, or null (no store / none published). */
export function newestPublishedHead(cwd: string, projectName: string, kind: ArtifactKind): PublishedHead | null {
	return withStoreDb(cwd, projectName, (db) => publishedHeadsForKind(db, kind)[0] ?? null);
}

/**
 * Classify one kind as own-run or foreign-run (N8) and gather the facts the
 * notice needs (revision, run, commit). Returns null when there is nothing to
 * classify (no store, no published revision).
 *
 * "Foreign" means: a revision published by a DIFFERENT run is newer than the
 * revision my own line is at (`myRevisionNumber`), or my line never published
 * the kind at all. When the newest revision is mine, the kind is own-run.
 *
 * @param {string} cwd - Project root (also the git work tree for R5's commit).
 * @param {string} projectName - Project whose store to read.
 * @param {string} runId - The run asking ("mine").
 * @param {ArtifactKind} kind - Kind to classify.
 * @returns {UpstreamMove | null} The verdict, or null when nothing is known.
 */
export function classifyMove(cwd: string, projectName: string, runId: string, kind: ArtifactKind): UpstreamMove | null {
	const heads = withStoreDb(cwd, projectName, (db) => {
		const published = publishedHeadsForKind(db, kind);
		if (published.length === 0) return null;
		// Read my line's head pointer through the shipped reader (per-run row).
		const head = getHeadRevision(db, runId, kind);
		return { published, headRevisionNumber: head ? head.revisionNumber : null };
	});
	if (!heads) return null;

	const { published, headRevisionNumber } = heads;
	const mine = published.find((h) => h.runId === runId) ?? null;
	const foreign = published.filter((h) => h.runId !== runId);
	const myRevisionNumber = mine ? mine.revisionNumber : headRevisionNumber;
	const newestForeign = foreign[0] ?? null;
	const movedByForeign =
		newestForeign !== null && (myRevisionNumber === null || newestForeign.revisionNumber > myRevisionNumber);

	const storeRelPath = relative(cwd, buildStoreDbPath(projectName, cwd)).replace(/\\/g, "/");
	return {
		kind,
		move: movedByForeign ? "foreign-run" : "own-run",
		publishedHead: movedByForeign && newestForeign ? newestForeign : published[0]!,
		myRevisionNumber,
		storeLastCommit: lastCommitForPath(cwd, storeRelPath),
		otherRuns: foreign.map((head) => head.runId),
	};
}
