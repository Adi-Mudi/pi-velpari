// ============================================================================
// ops/db-publish.ts — the Phase-4 DB publish chain (RES-1, Q6) — Layer 1
// ============================================================================
// Runs INSIDE the approve flow (handleApprove), after the markdown targets
// are written and before the post-publish doctor audit + stage advance.
// Plan order (dbstore_phase4_plan §4.5):
//   1. Pre-checks (payload valid + git repo/identity usable) — before ANY
//      file is touched (Q6a).
//   2. Markdown publish — handled by approve.ts (Q3: markdown stays
//      read-authoritative; this module never touches it).
//   3. DB write: openStoreDb → writeArtifact (draft) → checksum verify →
//      publishArtifact (Q2 draft→published flip, one txn).
//   4. Export + verify: exportArtifactYaml → atomic write beside the DB
//      (RES-1) → verifyExportChecksum must be ok.
//   5. G8 PRD mirror check (prd kind): published PRD file hash must equal
//      envelope.inputs["prd-file"].
//   6. Checkpoint (G1): wal_checkpoint(TRUNCATE) right before the commit.
//   7. Git commit (Q6c): explicit paths ONLY (DB + YAML + published
//      markdown targets), message `velpari(<artifact>): <project> v<N> (run <runId>)`.
//   8. Failure after the DB write → revertPublish + YAML deleted + error
//      returned; the stage does NOT advance. Markdown is NOT rolled back
//      (accepted risk R1 — a retry rewrites it deterministically).
//
// Scope: L1 — imports L0 (io/store, io/db, core/paths, core/fingerprints,
// io/atomic-write) + node:child_process. No TUI, no state mutation.
// ============================================================================

import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { relative } from "node:path";
import {
	checkpointNow,
	exportArtifactYaml,
	publishArtifact,
	revertPublish,
	verifyExportChecksum,
	writeArtifact,
	type ArtifactEnvelopeInput,
	type ArtifactPayload,
} from "../io/store.js";
import { ensureStoreGitIntegration } from "./git-attributes.js";
import { syncPortfolioRegistry, repairPortfolioRegistry } from "./portfolio.js";
import { openStoreDb } from "../io/db.js";
import { buildStoreDbPath, buildStoreYamlPath, buildPortfolioDbPath } from "../core/paths.js";
import { hashFileContent } from "../core/fingerprints.js";
import { atomicWriteFile } from "../io/atomic-write.js";
import { resolveDocArtifact } from "../core/paths.js";
import type { ArtifactKind } from "../io/store.js";

export interface DbPublishInput {
	cwd: string;
	projectName: string;
	runId: string;
	/** Store kind resolved from the stage's workingDir (4.3 map). */
	kind: ArtifactKind;
	/** Label used in the YAML filename + commit message (e.g. "PRD"). */
	yamlArtifact: string;
	/** Validated envelope (already normalized by loadStagePayload). */
	envelope: ArtifactEnvelopeInput;
	/** Validated payload rows (already normalized). */
	payload: ArtifactPayload;
	/** Absolute paths of the markdown targets just published (git add set). */
	publishedPaths: string[];
	/** prd kind only: absolute path of the just-published PRD (G8). */
	prdPublishedPath?: string;
}

export interface DbPublishOutcome {
	ok: boolean;
	/** Blocking errors (publish failed or was refused). */
	problems: string[];
	/** Non-blocking notes (published, but worth surfacing). */
	warnings: string[];
	/** Absolute DB path when the store was opened. */
	dbPath?: string;
}

/** Result of the pre-checks that run BEFORE anything is written. */
export interface DbPrecheckResult {
	ok: boolean;
	problems: string[];
}

// ---------------------------------------------------------------------------
// Pre-checks (Q6a) — pure reads, no side effects.
// ---------------------------------------------------------------------------

/**
 * Verify the payload source and the git worktree BEFORE any write. Payload
 * validation itself happens in ops/stage-payloads.ts (loadStagePayload);
 * this checks the git side: inside a work tree, identity configured, and
 * status readable. Refusing here means nothing is ever half-published.
 *
 * @param {string} cwd - Project root (the git work tree).
 * @returns {DbPrecheckResult} ok=false with the exact refusal reasons.
 */
export function precheckGitForPublish(cwd: string): DbPrecheckResult {
	const problems: string[] = [];
	const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf-8" });
	if (inside.error || inside.status !== 0 || inside.stdout.trim() !== "true") {
		problems.push(
			"git pre-check failed: not inside a git work tree — the DB publish chain " +
				"(Q6c) requires git; init a repo or publish without the DB chain once the plan owner approves.",
		);
		return { ok: false, problems };
	}
	const status = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf-8" });
	if (status.error || status.status !== 0) {
		problems.push(
			`git pre-check failed: 'git status --porcelain' errored (${(status.stderr ?? "").trim() || "unknown"}).`,
		);
	}
	for (const key of ["user.name", "user.email"]) {
		const cfg = spawnSync("git", ["config", "--get", key], { cwd, encoding: "utf-8" });
		if (cfg.status !== 0 || !(cfg.stdout ?? "").trim()) {
			problems.push(
				`git pre-check failed: '${key}' is not configured — set it (no silent fallback identity, plan Risk 6).`,
			);
		}
	}
	return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// The chain — call ONLY after the markdown targets are already written.
// ---------------------------------------------------------------------------

/**
 * Execute the DB publish chain for one artifact (steps 3–8). Throws
 * nothing — every failure is returned as problems so the caller can
 * notify + abort the stage advance.
 *
 * @param {DbPublishInput} input - Kind, envelope/rows, published paths.
 * @returns {DbPublishOutcome} ok=true when DB + YAML + git commit landed.
 */
export function runDbPublish(input: DbPublishInput): DbPublishOutcome {
	const problems: string[] = [];
	const warnings: string[] = [];
	const dbPath = buildStoreDbPath(input.projectName, input.cwd);
	const yamlPath = buildStoreYamlPath(input.projectName, input.yamlArtifact, input.cwd);
	let db: ReturnType<typeof openStoreDb> | null = null;
	let dbWriteLanded = false;
	let yamlWritten = false;

	try {
		// --- 3. DB write (draft) ---
		db = openStoreDb(dbPath);
		writeArtifact(db, input.kind, input.runId, input.envelope, input.payload);
		dbWriteLanded = true;

		// Gate check on the draft rows (RES-1): the fingerprint must match
		// a fresh deterministic export BEFORE the flip.
		const preVerify = verifyExportChecksum(db, input.runId, input.kind);
		if (!preVerify.ok) {
			problems.push(
				`store checksum mismatch before publish (expected ${preVerify.expected}, got ${preVerify.actual}) — draft rows reverted.`,
			);
		}

		// --- Q2 flip (one txn) ---
		if (problems.length === 0) {
			publishArtifact(db, input.runId, input.kind);
		}

		// --- 4. Export + verify (RES-1) ---
		if (problems.length === 0) {
			const yaml = exportArtifactYaml(db, input.runId, input.kind);
			if (yaml === null) {
				problems.push("store export returned null after publish — rows vanished (store bug).");
			} else {
				atomicWriteFile(yamlPath, yaml, "utf-8");
				yamlWritten = true;
				const postVerify = verifyExportChecksum(db, input.runId, input.kind);
				if (!postVerify.ok) {
					problems.push(
						`store checksum mismatch after publish (expected ${postVerify.expected}, got ${postVerify.actual}).`,
					);
				}
			}
		}

		// --- 5. G8 PRD mirror check ---
		if (problems.length === 0 && input.kind === "prd" && input.prdPublishedPath) {
			const expected = input.envelope.inputs
				? (JSON.parse(input.envelope.inputs as string) as Record<string, string>)["prd-file"]
				: undefined;
			const actual = hashFileContent(input.prdPublishedPath);
			if (!expected || expected !== actual) {
				problems.push(
					`G8 mirror check failed: payload inputs["prd-file"] (${expected ?? "missing"}) does not match ` +
						`the published PRD hash (${actual ?? "unreadable"}). Re-hash the published markdown and fix the payload.`,
				);
			}
		}

		// --- 6. Checkpoint (G1) before the commit ---
		if (problems.length === 0 && db) {
			const cp = checkpointNow(db);
			if (cp.busy !== 0) {
				warnings.push(
					`wal_checkpoint reported busy=${cp.busy} — committed index.db may lag; retry the publish if the commit looks stale.`,
				);
			}
		}

		// --- 7. Git commit (Q6c) — explicit paths ONLY ---
		if (problems.length === 0) {
			// 7a. User-repo git integration (Phase 9, §15.4): append-if-missing
			// the binary attr + wal/shm ignores. Automatic but NOT silent —
			// the notify below reports the heal, and the changed files JOIN
			// addPaths so the heal lands in this publish commit.
			const heal = ensureStoreGitIntegration(input.cwd);
			for (const line of heal.appended) {
				warnings.push(`git integration healed: ${line}`);
			}
			// 7b. Portfolio registry sync (Phase 10, §15.5) — PRE-commit so the
			// registry joins the same commit it describes (review v1.3 ordering).
			// Fail-open and OUTSIDE the store transaction: any failure is a
			// warning, the publish proceeds (RES-1 untouched). The registry file
			// itself joins addPaths when present.
			const registry = syncPortfolioRegistry(input.cwd);
			for (const change of registry.changes) {
				warnings.push(`portfolio registry: ${change.kind} ${change.projectName} — ${change.detail}`);
			}
			/**
			 * Convert an absolute path to a repo-relative path for git add/commit.
			 * @param {string} p - Absolute path under the project root.
			 * @returns {string} Path relative to the git work tree (cwd).
			 */
			const rel = (p: string): string => relative(input.cwd, p);
			const registryPath = buildPortfolioDbPath(input.cwd);
			const registryInCommit = existsSync(registryPath) ? [registryPath] : [];
			const addPaths = [dbPath, yamlPath, ...input.publishedPaths, ...heal.changedPaths, ...registryInCommit].map(rel);
			const add = spawnSync("git", ["add", "--", ...addPaths], { cwd: input.cwd, encoding: "utf-8" });
			if (add.error || add.status !== 0) {
				problems.push(`git add failed: ${(add.stderr ?? add.error?.message ?? "unknown").trim()}`);
			} else {
				const message = `velpari(${input.yamlArtifact}): ${input.projectName} v${input.envelope.version} (run ${input.runId})`;
				const commit = spawnSync("git", ["commit", "-m", message, "--", ...addPaths], {
					cwd: input.cwd,
					encoding: "utf-8",
				});
				if (commit.error || commit.status !== 0) {
					const errText = (commit.stderr ?? commit.error?.message ?? "").trim();
					problems.push(
						`git commit failed: ${errText || "no changes staged"} — DB rows reverted to draft; markdown stays (R1).`,
					);
				}
			}
		}
	} catch (err) {
		problems.push(`DB publish chain threw: ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		if (db) {
			try {
				db.close();
			} catch {
				// close is best-effort; the file handle is process-global anyway
			}
		}
	}

	// --- 8. Failure rollback (Q6d) ---
	if (problems.length > 0) {
		if (dbWriteLanded) {
			try {
				const rdb = openStoreDb(dbPath);
				try {
					if (yamlWritten && existsSync(yamlPath)) unlinkSync(yamlPath);
					// Rows still draft → clean delete; already flipped → revert.
					const draftGone = deleteDraftIfDraft(rdb, input.runId, input.kind);
					if (!draftGone) revertPublish(rdb, input.runId, input.kind);
				} finally {
					rdb.close();
				}
				// Registry re-sync (Phase 10, review v1.3): the pre-commit sync
				// may describe the now-rolled-back publish — re-derive from the
				// reverted spokes (idempotent, fail-open, self-correcting).
				const resync = repairPortfolioRegistry(input.cwd);
				warnings.push(`portfolio registry re-synced after rollback (${resync.changes.length} change(s)).`);
			} catch (rollbackErr) {
				problems.push(
					`ROLLBACK FAILED on top of the publish failure — store may hold published rows for ` +
						`${input.runId}/${input.kind}: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
				);
			}
		}
		return { ok: false, problems, warnings, dbPath };
	}

	return { ok: true, problems: [], warnings, dbPath };
}

/**
 * Try deleteRunDrafts-style cleanup for one run/kind when the rows never
 * flipped. Returns true when the draft envelope existed and was deleted.
 *
 * @param {ReturnType<typeof openStoreDb>} db - Open store connection.
 * @param {string} runId - Owning run.
 * @param {ArtifactKind} kind - Artifact kind to clean.
 * @returns {boolean} true when a draft envelope was found + deleted.
 */
function deleteDraftIfDraft(db: ReturnType<typeof openStoreDb>, runId: string, kind: ArtifactKind): boolean {
	const row = db.prepare("SELECT status FROM artifacts WHERE run_id = ? AND kind = ?").get(runId, kind) as
		| { status: string }
		| undefined;
	if (row?.status !== "draft") return false;
	db.prepare("DELETE FROM artifacts WHERE run_id = ? AND kind = ? AND status = 'draft'").run(runId, kind);
	return true;
}

/**
 * G8 helper shared with approve.ts: absolute path of the published PRD for
 * one project (grouped layout, then legacy fallback), or null when absent.
 *
 * @param {string} projectName - files.json projectName (or mission slug).
 * @param {string} cwd - Project root.
 * @returns {string | null} Absolute published-PRD path, or null.
 */
export function publishedPrdPath(projectName: string, cwd: string): string | null {
	const resolved = resolveDocArtifact("PRD", projectName, cwd);
	return resolved ? resolved.path : null;
}
