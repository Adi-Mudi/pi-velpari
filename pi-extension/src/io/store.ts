// ============================================================================
// io/store.ts — Store API (Layer 0, DB-primary storage, Phase 3)
// ============================================================================
// Decision record: .IDE_Plans/velpari-storage-traceability_decision-record_20260921_v1.0.md
//   D9    — single data-access module: the ONLY file above the driver
//           (io/db.ts) that composes reads/writes; one audit door.
//   RES-1 — export-from-DB: YAML comes from exportArtifactYaml over the
//           committed rows, never hand-written; sha256_fingerprint is the
//           SHA-256 of the EXACT deterministic export bytes, computed inside
//           writeArtifact at write time (Phase 3 plan Risks note 2).
//   G5    — deterministic export: fixed per-kind ORDER BY + toYamlString
//           (lineWidth: 0) — same rows in, same bytes out.
//   Q2    — rows are written 'draft'; publishArtifact flips draft→published
//           (envelope + children) in ONE transaction; deleteRunDrafts removes
//           draft envelopes ONLY — CASCADE removes their children; published
//           rows survive untouched. revertPublish is the Q6d inverse: it
//           flips published→draft (envelope + children) when a publish-gate
//           step AFTER the DB write fails, so a retry starts clean.
//   G1    — checkpointNow wraps PRAGMA wal_checkpoint(TRUNCATE) for pre-commit
//           use (Phase 4).
//
// Phase 4 note: v001 was amended to per-run composite PKs (every child
// table's natural key is scoped by run_id). All queries here were already
// run_id+kind scoped, so no logic changed — the store is PK-agnostic by
// construction; the coexistence invariant is locked in store tests 14/15.
//
// Export body excludes `sha256_fingerprint` (no self-reference — plan Risks
// note 2) AND `status` (the draft→published flip must not invalidate the
// fingerprint: Phase 4 verifies AFTER publishArtifact, per RES-1's flow).
//
// Scope guard: L0 only. No publish-path logic, no git, no doctor (Phases
// 4/9/7). Nothing above Layer 0 imports this module yet.
// ============================================================================

import type { DatabaseSync } from "node:sqlite"; // type-only: the driver stays behind io/db.ts (D9)
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { toYamlString, parseYaml } from "../core/yaml-data.js";
import { buildStoreDbPath } from "../core/paths.js";
import { openStoreDb, closeStoreDb } from "./db.js";

/** The 9 approve-command artifact kinds (envelope PK `kind` values). */
export type ArtifactKind =
	| "prd"
	| "rtm"
	| "feasibility"
	| "design"
	| "atomic-functions"
	| "pseudocode"
	| "testplan"
	| "development-order"
	| "final-design";

// ---------------------------------------------------------------------------
// Row interfaces — camelCase TS ↔ snake_case columns, v001 DDL mirrored 1:1.
// Payload rows carry their natural columns only; the store injects
// `run_id`, `kind`, and (non-edge tables) `status` itself.
//
// v002 prose columns (Phase 6, decision §14) are added as OPTIONAL/NULLABLE
// fields. The store round-trips any keys present in the payload via the
// snake_case converter in insertRow + SELECT * in readRows — widening the
// TS interfaces is the only code change required; the SQL itself is
// schema-generic. Tables touched in v002: fr / nfr / prd_section /
// pseudocode_block / test_case / design_module / atomic_function / dev_step.
// ---------------------------------------------------------------------------

export interface FrRow {
	id: string;
	phase: number;
	textHash: string;
	/** v002 — requirement prose for slice reads (textHash stays authoritative for fingerprints). */
	text?: string | null;
}
export interface NfrRow {
	id: string;
	phase: number;
	textHash: string;
	/** v002 — NFR prose for slice reads. */
	text?: string | null;
}
export interface PrdSectionRow {
	no: number;
	title: string;
	bodyRef?: string | null;
	/** v002 — PRD section prose (the canonical text behind bodyRef when present). */
	body?: string | null;
}
export interface RtmRowRow {
	id: string;
	frRef: string;
	afRef?: string | null;
	tcRef?: string | null;
	phase: number;
	targetSha256: string;
}
export interface FeasibilityDecisionRow {
	// Dual vocabulary (Phase 4 amendment): §5 go/* AND the verified record's
	// reuse/partial/build — both legal, DDL CHECK mirrored.
	verdict: "go" | "no-go" | "go-with-conditions" | "reuse" | "partial" | "build";
	language?: string | null;
	decidedBy: string;
	at: string;
	webSearchConsent?: 0 | 1 | null;
}
export interface FeasibilitySpikeRow {
	language: string;
	passed: 0 | 1;
	resultRef?: string | null;
}
export interface ReuseScanRow {
	candidate: string;
	license?: string | null;
	repoFreshness?: string | null;
	verdict: string;
}
export interface DesignModuleRow {
	id: string;
	name: string;
	/** v002 — module responsibility prose (drives the DB-rendered design view). */
	description?: string | null;
}
export interface ModuleSourceFrRow {
	moduleId: string;
	frId: string;
}
export interface AdrRow {
	id: string;
	adrStatus: "proposed" | "accepted" | "superseded" | "rejected";
	options: string;
	chosen?: string | null;
	rationale?: string | null;
}
export interface DiagramRow {
	id: string;
	diagramKind: string;
	mermaidText: string;
}
export interface ApproachRow {
	moduleId: string;
	tacticId: string;
}
export interface AtomicFunctionRow {
	id: string;
	name: string;
	signature: string;
	tier: "entry" | "basic" | "intermediate" | "advanced";
	criticality: "A" | "B" | "C";
	sil: "none" | "sil-1" | "sil-2" | "sil-3" | "sil-4";
	isLeaf: 0 | 1;
	/** v002 — 5 of 8 base-core fields (principle 10a); tier-gate decides when required. */
	purpose?: string | null;
	source?: string | null;
	cohesion?: string | null;
	verification?: string | null;
	testable?: string | null;
}
export interface PseudocodeBlockRow {
	id: string;
	afRef: string;
	contentHash: string;
	/** v002 — pseudocode prose (the canonical text behind contentHash). */
	content?: string | null;
}
export interface TestCaseRow {
	id: string;
	tcKind: "TC" | "IT";
	strategyRef?: string | null;
	/** v002 — REQUIRED for the testplan kind (DB-rendered test-cases.md must not render empty). */
	steps?: string | null;
	objective?: string | null;
	expected?: string | null;
}
export interface TcTraceRow {
	tcId: string;
	targetKind: "fr" | "nfr" | "af";
	targetId: string;
}
export interface DevStepRow {
	id: string;
	module: string;
	/** v002 — dev-step prose for the DB-rendered development-order doc. */
	description?: string | null;
}
export interface StepAfRow {
	stepId: string;
	afId: string;
}
export interface StepDepRow {
	stepId: string;
	dependsOnId: string;
}
export interface FinalSectionRow {
	no: number;
	title: string;
	sourceArtifact: string;
	sourceIds?: string; // JSON array (default '[]')
}

/** Discriminated payload rows per kind — mirrors v001 DDL columns exactly. */
export type ArtifactPayload =
	| { fr?: FrRow[]; nfr?: NfrRow[]; prdSection?: PrdSectionRow[] } // prd
	| { rtmRow?: RtmRowRow[] } // rtm
	| {
			feasibilityDecision?: FeasibilityDecisionRow;
			feasibilitySpike?: FeasibilitySpikeRow[];
			reuseScan?: ReuseScanRow[];
	  } // feasibility
	| {
			designModule?: DesignModuleRow[];
			moduleSourceFr?: ModuleSourceFrRow[];
			adr?: AdrRow[];
			diagram?: DiagramRow[];
			approach?: ApproachRow[];
	  } // design
	| { atomicFunction?: AtomicFunctionRow[] } // atomic-functions
	| { pseudocodeBlock?: PseudocodeBlockRow[] } // pseudocode
	| { testCase?: TestCaseRow[]; tcTrace?: TcTraceRow[] } // testplan
	| { devStep?: DevStepRow[]; stepAf?: StepAfRow[]; stepDep?: StepDepRow[] } // development-order
	| { finalSection?: FinalSectionRow[] }; // final-design

/** Envelope fields for writeArtifact (status + fingerprint are store-managed). */
export interface ArtifactEnvelopeInput {
	version: number;
	stage: string;
	generatedAt: string;
	inputs?: string; // JSON map artifact→hash (default '{}')
	reviewerVerdict?: string | null;
	changeLog?: string; // JSON array (default '[]')
}

/** The full stored envelope (read side). */
export interface ArtifactEnvelope {
	runId: string;
	kind: ArtifactKind;
	version: number;
	stage: string;
	generatedAt: string;
	sha256Fingerprint: string;
	inputs: string;
	reviewerVerdict: string | null;
	changeLog: string;
	status: "draft" | "published";
}

/** readArtifact result — `rows` is keyed by payload key, camelCase fields. */
export interface ReadArtifactResult {
	envelope: ArtifactEnvelope;
	rows: Record<string, unknown>;
}

/** verifyExportChecksum result. */
export interface ChecksumResult {
	ok: boolean;
	expected: string;
	actual: string;
}

/** checkpointNow result (PRAGMA wal_checkpoint(TRUNCATE) row). */
export interface CheckpointResult {
	busy: number;
	log: number;
	checkpointed: number;
}

// ---------------------------------------------------------------------------
// Per-kind dispatch: child-table spec. Insert order matters (FK parents
// first); delete runs the REVERSE of the listed order (referencing tables
// first). `edge` tables carry no `status` column. `single` marks the
// one-row feasibility_decision object. `orderBy` fixes read and export row
// order (G5). camelCase payload keys map to snake_case columns.
// ---------------------------------------------------------------------------

interface TableSpec {
	table: string;
	/** Key of the row array (or single decision object) in the payload. */
	key: string;
	/** Single-row table (feasibility_decision) instead of an array. */
	single?: boolean;
	/** No `status` column (pure edge table). */
	edge?: boolean;
	orderBy: string;
}

const KIND_TABLES: Record<ArtifactKind, readonly TableSpec[]> = {
	prd: [
		{ table: "fr", key: "fr", orderBy: "id" },
		{ table: "nfr", key: "nfr", orderBy: "id" },
		{ table: "prd_section", key: "prdSection", orderBy: "no" },
	],
	rtm: [{ table: "rtm_row", key: "rtmRow", orderBy: "id" }],
	feasibility: [
		{ table: "feasibility_decision", key: "feasibilityDecision", single: true, orderBy: "run_id" },
		{ table: "feasibility_spike", key: "feasibilitySpike", orderBy: "language" },
		{ table: "reuse_scan", key: "reuseScan", orderBy: "candidate" },
	],
	design: [
		{ table: "design_module", key: "designModule", orderBy: "id" },
		{ table: "module_source_fr", key: "moduleSourceFr", edge: true, orderBy: "module_id, fr_id" },
		{ table: "adr", key: "adr", orderBy: "id" },
		{ table: "diagram", key: "diagram", orderBy: "id" },
		{ table: "approach", key: "approach", edge: true, orderBy: "module_id, tactic_id" },
	],
	"atomic-functions": [{ table: "atomic_function", key: "atomicFunction", orderBy: "id" }],
	pseudocode: [{ table: "pseudocode_block", key: "pseudocodeBlock", orderBy: "id" }],
	testplan: [
		{ table: "test_case", key: "testCase", orderBy: "id" },
		{ table: "tc_trace", key: "tcTrace", edge: true, orderBy: "tc_id, target_kind, target_id" },
	],
	"development-order": [
		{ table: "dev_step", key: "devStep", orderBy: "id" },
		{ table: "step_af", key: "stepAf", edge: true, orderBy: "step_id, af_id" },
		{ table: "step_dep", key: "stepDep", edge: true, orderBy: "step_id, depends_on_id" },
	],
	"final-design": [{ table: "final_section", key: "finalSection", orderBy: "no" }],
};

/**
 * Canonical kind order — the export/picker display order (Phase 5, plan
 * subphase 1.1). Derived from KIND_TABLES keys so it can never drift from
 * the dispatch table itself.
 */
export const KIND_ORDER: readonly ArtifactKind[] = Object.keys(KIND_TABLES) as ArtifactKind[];

/** Values this store ever binds (STRICT tables reject anything else). */
type SqlValue = string | number | null;

/** camelCase → snake_case (payload field name → DDL column name). */
function snake(name: string): string {
	return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** snake_case (DDL column) → camelCase (payload field name). */
function camel(name: string): string {
	return name.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * SHA-256 hex digest of a UTF-8 string (export bytes → fingerprint).
 * @param {string} text - The exact bytes to hash (deterministic YAML export).
 * @returns {string} Lowercase 64-char hex digest.
 */
function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Reads (shared by readArtifact, export, and the write-time fingerprint)
// ---------------------------------------------------------------------------

/**
 * Read the envelope row for one artifact from the `artifacts` table.
 * @param {DatabaseSync} db - Open store connection (from openStoreDb).
 * @param {string} runId - Run identifier (envelope PK part 1).
 * @param {ArtifactKind} kind - Artifact kind (envelope PK part 2).
 * @returns {ArtifactEnvelope | null} Mapped envelope, or null when absent.
 */
function readEnvelope(db: DatabaseSync, runId: string, kind: ArtifactKind): ArtifactEnvelope | null {
	const row = db.prepare("SELECT * FROM artifacts WHERE run_id = ? AND kind = ?").get(runId, kind) as
		| Record<string, SqlValue>
		| undefined;
	if (!row) return null;
	return {
		runId: String(row.run_id),
		kind: String(row.kind) as ArtifactKind,
		version: Number(row.version),
		stage: String(row.stage),
		generatedAt: String(row.generated_at),
		sha256Fingerprint: String(row.sha256_fingerprint),
		inputs: String(row.inputs),
		reviewerVerdict: row.reviewer_verdict === null ? null : String(row.reviewer_verdict),
		changeLog: String(row.change_log),
		status: String(row.status) as "draft" | "published",
	};
}

/** Read child rows, payload-keyed, camelCase, run_id/kind/status stripped. */
function readRows(db: DatabaseSync, runId: string, kind: ArtifactKind): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const spec of KIND_TABLES[kind]) {
		const raw = db
			.prepare(`SELECT * FROM ${spec.table} WHERE run_id = ? AND kind = ? ORDER BY ${spec.orderBy}`)
			.all(runId, kind) as Record<string, SqlValue>[];
		if (raw.length === 0) continue;
		const mapped = raw.map((row) => {
			const rec: Record<string, SqlValue> = {};
			for (const [col, value] of Object.entries(row)) {
				if (col === "run_id" || col === "kind" || col === "status") continue;
				rec[camel(col)] = value;
			}
			return rec;
		});
		out[spec.key] = spec.single ? mapped[0] : mapped;
	}
	return out;
}

/**
 * The deterministic export object (G5): envelope identity fields (fingerprint
 * and status excluded — see header) + non-empty row sets in KIND_TABLES order.
 * `inputs`/`changeLog` stay raw JSON strings — their shape is Phase 4's call.
 */
function buildExportObject(envelope: ArtifactEnvelope, rows: Record<string, unknown>): Record<string, unknown> {
	const rowSets: Record<string, unknown> = {};
	for (const spec of KIND_TABLES[envelope.kind]) {
		const value = rows[spec.key];
		if (value === undefined || value === null) continue;
		if (Array.isArray(value) && value.length === 0) continue;
		rowSets[spec.key] = value;
	}
	return {
		runId: envelope.runId,
		kind: envelope.kind,
		version: envelope.version,
		stage: envelope.stage,
		generatedAt: envelope.generatedAt,
		inputs: envelope.inputs,
		reviewerVerdict: envelope.reviewerVerdict,
		changeLog: envelope.changeLog,
		rows: rowSets,
	};
}

// ---------------------------------------------------------------------------
// writeArtifact
// ---------------------------------------------------------------------------

/**
 * Write (or idempotently rewrite) one artifact: envelope upsert + child rows,
 * all inside ONE `BEGIN IMMEDIATE…COMMIT` transaction (RES-1). Rows land as
 * 'draft' (Q2 — publishArtifact flips later; a rewrite re-opens the draft
 * cycle). Any constraint violation rolls the whole txn back and rethrows.
 *
 * The envelope fingerprint is computed INSIDE this txn as the SHA-256 of the
 * exact deterministic YAML bytes exportArtifactYaml produces from the rows
 * just written (plan Risks note 2 — hash(payload) would never match
 * hash(export); the YAML body excludes the fingerprint field itself).
 */
export function writeArtifact(
	db: DatabaseSync,
	kind: ArtifactKind,
	runId: string,
	envelope: ArtifactEnvelopeInput,
	payload: ArtifactPayload,
): void {
	const specs = KIND_TABLES[kind];
	db.exec("BEGIN IMMEDIATE;");
	try {
		// Envelope first — children FK-reference it. Fingerprint is stamped
		// after the rows land (below); '' is a placeholder inside this txn.
		db.prepare(
			`INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint, inputs, reviewer_verdict, change_log, status)
			 VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'draft')
			 ON CONFLICT(run_id, kind) DO UPDATE SET
			   version = excluded.version, stage = excluded.stage,
			   generated_at = excluded.generated_at, sha256_fingerprint = '',
			   inputs = excluded.inputs, reviewer_verdict = excluded.reviewer_verdict,
			   change_log = excluded.change_log, status = 'draft'`,
		).run(
			runId,
			kind,
			envelope.version,
			envelope.stage,
			envelope.generatedAt,
			envelope.inputs ?? "{}",
			envelope.reviewerVerdict ?? null,
			envelope.changeLog ?? "[]",
		);

		// Idempotent rewrite: delete this run's existing child rows for the
		// kind, referencing tables first (reverse of insert order).
		for (const spec of [...specs].reverse()) {
			db.prepare(`DELETE FROM ${spec.table} WHERE run_id = ? AND kind = ?`).run(runId, kind);
		}

		// Insert payload rows (FK parents first).
		for (const spec of specs) {
			const raw = (payload as Record<string, unknown>)[spec.key];
			const rows: unknown[] = spec.single ? [raw] : ((raw as unknown[] | undefined) ?? []);
			for (const row of rows) {
				if (row === undefined || row === null) continue;
				insertRow(db, spec, runId, kind, row as Record<string, unknown>);
			}
		}

		// Fingerprint = SHA-256 of the deterministic export bytes of the rows
		// just written (read back through the same ORDER BY as export — the
		// uncommitted rows are visible on this connection inside the txn).
		const read = readArtifact(db, runId, kind);
		if (!read) {
			throw new Error(`store: envelope vanished mid-txn (${runId}/${kind})`);
		}
		const yamlBytes = toYamlString(buildExportObject(read.envelope, read.rows));
		db.prepare("UPDATE artifacts SET sha256_fingerprint = ? WHERE run_id = ? AND kind = ?").run(
			sha256(yamlBytes),
			runId,
			kind,
		);

		db.exec("COMMIT;");
	} catch (err) {
		try {
			db.exec("ROLLBACK;");
		} catch {
			// Txn already closed (e.g. the error itself aborted it) — the
			// original error is the one that matters.
		}
		throw err;
	}
}

/** Insert one payload row; the store injects run_id/kind (+status). */
function insertRow(
	db: DatabaseSync,
	spec: TableSpec,
	runId: string,
	kind: ArtifactKind,
	record: Record<string, unknown>,
): void {
	const cols: string[] = ["run_id", "kind"];
	const values: SqlValue[] = [runId, kind];
	for (const [key, value] of Object.entries(record)) {
		if (value === undefined) continue; // omitted → column default (NULL)
		cols.push(snake(key));
		values.push(value as SqlValue);
	}
	if (!spec.edge) {
		cols.push("status");
		values.push("draft");
	}
	const placeholders = cols.map(() => "?").join(", ");
	db.prepare(`INSERT INTO ${spec.table} (${cols.join(", ")}) VALUES (${placeholders})`).run(...values);
}

// ---------------------------------------------------------------------------
// Public read / export / verify primitives
// ---------------------------------------------------------------------------

/**
 * Read one artifact. Returns `{envelope, rows}` — `rows` keyed by payload
 * key (camelCase fields, run_id/kind/status stripped) — or null when the
 * run has no artifact of that kind.
 */
export function readArtifact(db: DatabaseSync, runId: string, kind: ArtifactKind): ReadArtifactResult | null {
	const envelope = readEnvelope(db, runId, kind);
	if (!envelope) return null;
	return { envelope, rows: readRows(db, runId, kind) };
}

/**
 * Deterministic YAML export (G5, RES-1): the exact bytes the fingerprint
 * covers. Same rows + envelope in → same bytes out, every time. Returns
 * null when the artifact is absent.
 */
export function exportArtifactYaml(db: DatabaseSync, runId: string, kind: ArtifactKind): string | null {
	const read = readArtifact(db, runId, kind);
	if (!read) return null;
	return toYamlString(buildExportObject(read.envelope, read.rows));
}

/**
 * Verify the committed rows still produce the bytes that were fingerprinted
 * at write time (RES-1 tamper detection). Throws when the artifact is
 * absent — verifying a nonexistent artifact is a caller bug, not a mismatch.
 */
export function verifyExportChecksum(db: DatabaseSync, runId: string, kind: ArtifactKind): ChecksumResult {
	const read = readArtifact(db, runId, kind);
	if (!read) {
		throw new Error(`store: cannot verify — no artifact (${runId}/${kind})`);
	}
	const yamlBytes = toYamlString(buildExportObject(read.envelope, read.rows));
	const actual = sha256(yamlBytes);
	return {
		ok: actual === read.envelope.sha256Fingerprint,
		expected: read.envelope.sha256Fingerprint,
		actual,
	};
}

// ---------------------------------------------------------------------------
// Export-listing primitives (Phase 5 — read-only, D4 on-demand export)
// ---------------------------------------------------------------------------

/** One published (run_id, kind) row — the version picker's list item. */
export interface PublishedVersionRef {
	runId: string;
	version: number;
	generatedAt: string;
	stage: string;
}

/**
 * Kinds with at least one PUBLISHED version, in canonical KIND_ORDER
 * (Phase 5 subphase 1.1 — the kind picker's menu). Drafts never count.
 * @param {DatabaseSync} db - Open store connection (from openStoreDb).
 * @returns {ArtifactKind[]} Kinds, ordered by KIND_ORDER (never SQL order).
 */
export function listExportableKinds(db: DatabaseSync): ArtifactKind[] {
	const rows = db.prepare("SELECT DISTINCT kind FROM artifacts WHERE status = 'published'").all() as Record<
		string,
		SqlValue
	>[];
	const present = new Set(rows.map((r) => String(r.kind)));
	return KIND_ORDER.filter((kind) => present.has(kind));
}

/**
 * Published versions of one kind, newest first (Phase 5 subphase 1.2 — the
 * version picker). Drafts are never listed.
 * @param {DatabaseSync} db - Open store connection (from openStoreDb).
 * @param {ArtifactKind} kind - Artifact kind to list.
 * @returns {PublishedVersionRef[]} Newest first (generated_at DESC).
 */
export function listPublishedVersions(db: DatabaseSync, kind: ArtifactKind): PublishedVersionRef[] {
	const rows = db
		.prepare(
			`SELECT run_id, version, generated_at, stage FROM artifacts
			 WHERE kind = ? AND status = 'published' ORDER BY generated_at DESC`,
		)
		.all(kind) as Record<string, SqlValue>[];
	return rows.map((r) => ({
		runId: String(r.run_id),
		version: Number(r.version),
		generatedAt: String(r.generated_at),
		stage: String(r.stage),
	}));
}

/**
 * Read the rows of the newest PUBLISHED version of one kind for one
 * project (Phase 6 §14.3 — DB-primary readers prefer the store over
 * the legacy sidecar file). Opens the store, finds the newest
 * published envelope, returns its `rows` payload (camelCase keys
 * already mapped by `readRows`).
 *
 * @param {string} cwd - Project root (locates the store DB).
 * @param {string} projectName - Project whose published rows to load.
 * @param {ArtifactKind} kind - Artifact kind to load.
 * @returns {{ envelope: ArtifactEnvelope; rows: Record<string, unknown> } | null} Newest published slice, or null when no published version exists for that (project, kind).
 */
export function readLatestPublishedRows(
	cwd: string,
	projectName: string,
	kind: ArtifactKind,
): { envelope: ArtifactEnvelope; rows: Record<string, unknown> } | null {
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) return null;
	const db = openStoreDb(dbPath);
	try {
		const versions = listPublishedVersions(db, kind);
		if (versions.length === 0) return null;
		const newest = versions[0]!;
		const result = readArtifact(db, newest.runId, kind);
		if (!result) return null;
		return { envelope: result.envelope, rows: result.rows };
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Pull the AF id list straight from the project store (Phase 6 §14.3
 * DB-primary reader for id-coverage). Returns null when no published
 * AF rows exist — caller falls back to the legacy sidecar reader.
 * @param {string} cwd - Project root.
 * @param {string} projectName - Project whose AF ids to list.
 * @returns {string[] | null} Unique sorted AF ids, or null when no published rows exist.
 */
export function extractAfIdsFromStore(cwd: string, projectName: string): string[] | null {
	const fromDb = readLatestPublishedRows(cwd, projectName, "atomic-functions");
	if (!fromDb) return null;
	const rows = (fromDb.rows.atomicFunction as Array<{ id: unknown }> | undefined) ?? [];
	const ids = rows.map((r) => String(r.id)).filter((id) => /^AF-\d+$/.test(id));
	return ids.length > 0 ? Array.from(new Set(ids)).sort() : null;
}

/**
 * The test-case→requirement trace ids from the store's `tc_trace` rows
 * (Phase 7 id-coverage edges — the store's machine-written link edges
 * beat sidecar parsing). FR/NFR targets only (AF traces have no RTM row
 * counterpart, matching the legacy sidecar extractor).
 * @param {string} cwd - Project root (locates the store DB).
 * @param {string} projectName - Project whose testplan edges to read.
 * @returns {string[] | null} Sorted unique trace ids, or null when no published rows exist.
 */
export function extractTestCaseTracesFromStore(cwd: string, projectName: string): string[] | null {
	const fromDb = readLatestPublishedRows(cwd, projectName, "testplan");
	if (!fromDb) return null;
	const rows = (fromDb.rows.tcTrace as Array<{ targetId: unknown }> | undefined) ?? [];
	const ids = rows.map((r) => String(r.targetId)).filter((id) => /^(?:FR|NFR)-\d+$/.test(id));
	return ids.length > 0 ? Array.from(new Set(ids)).sort() : null;
}

/**
 * The dev-step→AF references from the store's `step_af` rows (Phase 7
 * id-coverage edges — machine-written edges beat sidecar parsing).
 * @param {string} cwd - Project root (locates the store DB).
 * @param {string} projectName - Project whose development-order edges to read.
 * @returns {string[] | null} Sorted unique AF ids, or null when no published rows exist.
 */
export function extractDevOrderAfRefsFromStore(cwd: string, projectName: string): string[] | null {
	const fromDb = readLatestPublishedRows(cwd, projectName, "development-order");
	if (!fromDb) return null;
	const rows = (fromDb.rows.stepAf as Array<{ afId: unknown }> | undefined) ?? [];
	const ids = rows.map((r) => String(r.afId)).filter((id) => /^AF-\d+$/.test(id));
	return ids.length > 0 ? Array.from(new Set(ids)).sort() : null;
}

// ---------------------------------------------------------------------------
// importArtifactYaml — the D9 rebuild path (Phase 9, §15.4)
// ---------------------------------------------------------------------------

/** importArtifactYaml result — `ok:false` carries human-refusal reasons. */
export interface ImportArtifactResult {
	ok: boolean;
	/** Human summary (refusal reason or success note) — callers notify verbatim. */
	message: string;
	/** Total rows imported across row-sets (0 on refusal). */
	rowCount: number;
}

/**
 * Import one artifact from its export YAML — the D9 rebuild tool (Phase 9
 * review gap 2): "DB is rebuildable from YAML" becomes executable. The
 * input must be exactly `exportArtifactYaml`/`buildExportObject`'s shape
 * (runId/kind/version/stage/generatedAt/inputs/reviewerVerdict/changeLog +
 * rows), because the YAML beside the DB IS that bytes (RES-1).
 *
 * Run id: the YAML's own `runId` WINS; the `runId` parameter is only the
 * fallback for hand-repaired YAML that omits it. Rationale: cross-kind FKs
 * are run-scoped (`rtm_row.fr_ref → fr(run_id, id)`), so a chained rebuild
 * (rtm → prd, pseudocode → atomic-functions) lands correctly only under
 * the original run ids. Re-importing the same (run_id, kind) is idempotent
 * — writeArtifact's upsert rewrites that version in place.
 *
 * Flow: parse → validate rows against KIND_TABLES (schema-invalid YAML is
 * a loud refusal, never a partial import) → writeArtifact → verify →
 * publishArtifact — all or nothing (writeArtifact's own txn + a draft
 * rollback below when the checksum verify fails).
 *
 * Tamper scope (plan R6, honest): the export carries NO fingerprint, so
 * the post-import checksum proves YAML↔row consistency only — it catches
 * schema-invalid YAML, never content tampering. The real tamper guard is
 * git's reviewable YAML diffs + the merge runbook's human resolution.
 *
 * @param {DatabaseSync} db - Open store connection.
 * @param {string} runId - FALLBACK run id (the YAML's own runId wins).
 * @param {string} yamlText - The export YAML bytes (the store YAML file read).
 * @returns {ImportArtifactResult} Outcome; throws nothing.
 */
export function importArtifactYaml(db: DatabaseSync, runId: string, yamlText: string): ImportArtifactResult {
	// 1. Parse (strict — line/column errors reach the user verbatim).
	const parsed = parseYaml(yamlText);
	if (!parsed.ok) {
		return { ok: false, message: `YAML parse failed: ${parsed.error}`, rowCount: 0 };
	}
	const data = parsed.data as Record<string, unknown> | null;
	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return {
			ok: false,
			message:
				"YAML is not a mapping — expected the export shape (runId/kind/version/stage/generatedAt/inputs/reviewerVerdict/changeLog + rows).",
			rowCount: 0,
		};
	}

	// 2. Identity fields.
	const kindRaw = typeof data.kind === "string" ? data.kind : "";
	const kind = KIND_ORDER.find((k) => k === kindRaw);
	if (!kind) {
		return {
			ok: false,
			message: `unknown or missing kind '${kindRaw}' — expected one of: ${KIND_ORDER.join(", ")}`,
			rowCount: 0,
		};
	}
	const version = Number(data.version);
	if (!Number.isFinite(version) || version < 1 || Math.floor(version) !== version) {
		return { ok: false, message: `version must be a positive integer (got ${String(data.version)})`, rowCount: 0 };
	}
	const stage = typeof data.stage === "string" && data.stage.length > 0 ? data.stage : null;
	const generatedAt = typeof data.generatedAt === "string" && data.generatedAt.length > 0 ? data.generatedAt : null;
	if (!stage || !generatedAt) {
		return { ok: false, message: "missing envelope fields: stage and generatedAt are required", rowCount: 0 };
	}
	// The YAML's own runId wins (run-scoped FK chains — see docblock); the
	// parameter is the fallback for hand-repaired YAML that omits it.
	const yamlRunId = typeof data.runId === "string" && data.runId.length > 0 ? data.runId : runId;
	if (!yamlRunId) {
		return {
			ok: false,
			message: "missing runId — the export shape carries one; supply it or pass the fallback parameter",
			rowCount: 0,
		};
	}
	// inputs/changeLog stay raw JSON strings in the export shape; a
	// hand-repaired mapping is preserved by re-serializing it.
	const asJsonString = (v: unknown, fallback: string): string => {
		if (typeof v === "string") return v;
		if (v === undefined || v === null) return fallback;
		try {
			return JSON.stringify(v);
		} catch {
			return fallback;
		}
	};
	const inputs = asJsonString(data.inputs, "{}");
	const reviewerVerdict = typeof data.reviewerVerdict === "string" ? data.reviewerVerdict : null;
	const changeLog = asJsonString(data.changeLog, "[]");

	// 3. Rows: validate every row-set key against KIND_TABLES; unknown keys
	// and non-mapping rows are loud refusals (STRICT tables would reject
	// them mid-txn anyway — refuse BEFORE the write with a clean message).
	const rowsField = data.rows;
	if (rowsField === undefined || rowsField === null || typeof rowsField !== "object" || Array.isArray(rowsField)) {
		return { ok: false, message: "missing or malformed 'rows' mapping — expected the export shape", rowCount: 0 };
	}
	const legalKeys = new Set(KIND_TABLES[kind].map((spec) => spec.key));
	const specs = KIND_TABLES[kind];
	const payload: Record<string, unknown> = {};
	let rowCount = 0;
	for (const [key, value] of Object.entries(rowsField as Record<string, unknown>)) {
		if (!legalKeys.has(key)) {
			return {
				ok: false,
				message: `unknown row-set '${key}' for kind '${kind}' — legal: ${[...legalKeys].join(", ") || "(none)"}`,
				rowCount: 0,
			};
		}
		const spec = specs.find((s) => s.key === key);
		if (spec?.single) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) {
				return { ok: false, message: `row-set '${key}' must be a mapping (single decision row)`, rowCount: 0 };
			}
			payload[key] = value;
			rowCount += 1;
			continue;
		}
		if (value !== undefined && value !== null && !Array.isArray(value)) {
			return { ok: false, message: `row-set '${key}' must be a list of mappings`, rowCount: 0 };
		}
		const list = (value as unknown[] | undefined) ?? [];
		for (const row of list) {
			if (row === null || typeof row !== "object" || Array.isArray(row)) {
				return { ok: false, message: `row-set '${key}' carries a non-mapping row — schema-invalid YAML`, rowCount: 0 };
			}
		}
		if (list.length > 0) payload[key] = list;
		rowCount += list.length;
	}
	if (rowCount === 0) {
		return { ok: false, message: "export carries zero rows — refusing an empty import", rowCount: 0 };
	}

	// 4. Write → verify → publish (the backfill chain). A checksum failure
	// rolls the rows back to draft-free state (delete the draft envelope).
	try {
		writeArtifact(
			db,
			kind,
			yamlRunId,
			{ version, stage, generatedAt, inputs, reviewerVerdict, changeLog },
			payload as ArtifactPayload,
		);
	} catch (err) {
		return {
			ok: false,
			message: `store write failed (schema-invalid YAML?): ${err instanceof Error ? err.message : String(err)}`,
			rowCount,
		};
	}
	const check = verifyExportChecksum(db, yamlRunId, kind);
	if (!check.ok) {
		try {
			db.prepare("DELETE FROM artifacts WHERE run_id = ? AND kind = ? AND status = 'draft'").run(yamlRunId, kind);
		} catch {
			// Rollback is best-effort; the refusal below is what matters.
		}
		return {
			ok: false,
			message: `checksum verify failed after import (expected ${check.expected}, got ${check.actual}) — draft rows removed. Schema-invalid YAML is not importable.`,
			rowCount,
		};
	}
	publishArtifact(db, yamlRunId, kind);
	return {
		ok: true,
		message: `imported ${rowCount} row(s) for kind '${kind}' as run ${yamlRunId} v${version} (published).`,
		rowCount,
	};
}

// ---------------------------------------------------------------------------
// Lifecycle primitives
// ---------------------------------------------------------------------------

/**
 * Delete the run's DRAFT envelopes only (Q2 reset semantics). CASCADE
 * removes their child rows; published rows survive untouched. Returns the
 * number of draft envelopes deleted.
 */
export function deleteRunDrafts(db: DatabaseSync, runId: string): number {
	const result = db.prepare("DELETE FROM artifacts WHERE run_id = ? AND status = 'draft'").run(runId);
	return Number(result.changes);
}

/**
 * Checkpoint the WAL into the main DB file and truncate it (G1). Phase 4
 * calls this right before the raw git commit so the committed index.db is
 * self-contained.
 */
export function checkpointNow(db: DatabaseSync): CheckpointResult {
	const row = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as Partial<
		Record<"busy" | "log" | "checkpointed", number | bigint>
	>;
	return {
		busy: Number(row?.busy ?? 0),
		log: Number(row?.log ?? 0),
		checkpointed: Number(row?.checkpointed ?? 0),
	};
}

/**
 * Q6d rollback helper: flip one artifact published→draft (envelope + every
 * non-edge child table, ONE transaction) — the inverse of publishArtifact.
 * Used by the Phase 4 publish gate when a step AFTER the DB write fails
 * (YAML export/verify, git commit): the store returns to its pre-publish
 * draft state so a retry starts clean. Throws when there is no PUBLISHED
 * artifact for the run/kind (a silent no-op would hide caller bugs).
 */
export function revertPublish(db: DatabaseSync, runId: string, kind: ArtifactKind): void {
	const specs = KIND_TABLES[kind];
	db.exec("BEGIN IMMEDIATE;");
	try {
		const result = db
			.prepare("UPDATE artifacts SET status = 'draft' WHERE run_id = ? AND kind = ? AND status = 'published'")
			.run(runId, kind);
		if (Number(result.changes) === 0) {
			throw new Error(`store: no published artifact to revert (${runId}/${kind})`);
		}
		for (const spec of specs) {
			if (spec.edge) continue; // edge tables carry no status column
			db.prepare(`UPDATE ${spec.table} SET status = 'draft' WHERE run_id = ? AND kind = ?`).run(runId, kind);
		}
		db.exec("COMMIT;");
	} catch (err) {
		try {
			db.exec("ROLLBACK;");
		} catch {
			// Txn already closed — the original error is the one that matters.
		}
		throw err;
	}
}

/**
 * Flip one artifact draft→published: envelope + every non-edge child table,
 * in ONE transaction (Q2 approve semantics). Throws when there is no DRAFT
 * envelope for the run/kind — a silent no-op would hide caller bugs. YAML
 * export + git are NOT here: they are Phase 4's publish-gate steps (RES-1).
 */
export function publishArtifact(db: DatabaseSync, runId: string, kind: ArtifactKind): void {
	const specs = KIND_TABLES[kind];
	db.exec("BEGIN IMMEDIATE;");
	try {
		const result = db
			.prepare("UPDATE artifacts SET status = 'published' WHERE run_id = ? AND kind = ? AND status = 'draft'")
			.run(runId, kind);
		if (Number(result.changes) === 0) {
			throw new Error(`store: no draft artifact to publish (${runId}/${kind})`);
		}
		for (const spec of specs) {
			if (spec.edge) continue; // edge tables carry no status column
			db.prepare(`UPDATE ${spec.table} SET status = 'published' WHERE run_id = ? AND kind = ?`).run(runId, kind);
		}
		db.exec("COMMIT;");
	} catch (err) {
		try {
			db.exec("ROLLBACK;");
		} catch {
			// Txn already closed — the original error is the one that matters.
		}
		throw err;
	}
}
