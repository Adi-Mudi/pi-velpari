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
//      CAS head read → publishArtifactCas (F8/F9/F11: draft→published flip,
//      revision snapshot + supersession + head move, one txn).
//   4. Export + verify: exportArtifactYaml → atomic write beside the DB
//      (RES-1) → verifyExportChecksum must be ok.
//   5. G8 PRD mirror check (prd kind): the payload's inputs["prd-file"] must
//      match the published PRD file hash (markdown mode) or the stored head
//      digest (DB-only mode, re-pointed in Phase 1).
//   6. Checkpoint (G1): wal_checkpoint(TRUNCATE) right before the commit.
//   6b. Backup trigger (N9): createBackupSnapshot({trigger:"publish"}) —
//       no-op (null) until Phase 3; null = continue, never blocks.
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
	appendAuditEntry,
	appendTxEntry,
	checkpointNow,
	exportArtifactYaml,
	FrozenArtifactError,
	getHeadRevision,
	HeadMovedError,
	publishArtifactCas,
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
import { createBackupSnapshot } from "../core/backup.js";
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
	/**
	 * Revision identity of the flip (N2) — null on failure/rollback. When the
	 * publish supersedes a prior revision, `warnings` carries the line
	 * "Superseded <kind> revision <priorN>; head is now revision <newN>."
	 */
	revision: {
		revisionId: number;
		revisionNumber: number;
		supersededRevisionId: number | null;
		supersededRevisionNumber: number | null;
	} | null;
}

/** Result of the pre-checks that run BEFORE anything is written. */
export interface DbPrecheckResult {
	ok: boolean;
	problems: string[];
}

/**
 * Real actor name for call-site audit entries (F17: who/what/when/why).
 * The chain is deterministic approve-flow code — the actor is the extension
 * publishing this run's artifact, never the generic "velpari-store" (that
 * name stays in io/store.ts reference wiring).
 * @param {string} runId - Owning run.
 * @param {ArtifactKind} kind - Artifact kind being published.
 * @returns {string} e.g. "velpari:publish:prd:<runId>".
 */
function publishActor(runId: string, kind: ArtifactKind): string {
	return `velpari:publish:${kind}:${runId}`;
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
	let revisionInfo: DbPublishOutcome["revision"] = null;

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

		// CAS head read (F11) — AFTER the draft write (writeArtifact's upsert
		// never touches head_revision_id/frozen, so this is still the head the
		// caller's payload mirrors) and BEFORE the flip.
		const expectedHead = getHeadRevision(db, input.runId, input.kind);

		// --- 5. G8 PRD mirror check (re-pointed to the stored digest, N2) —
		// PRE-flip: every input (payload digest, pre-flip head, published-file
		// snapshot) is available before the CAS, so a mirror mismatch refuses
		// BEFORE anything publishes (Q6a — nothing is ever half-published, and
		// no revision number is burned on a refused publish).
		if (problems.length === 0 && input.kind === "prd") {
			const expected = input.envelope.inputs
				? (JSON.parse(input.envelope.inputs as string) as Record<string, string>)["prd-file"]
				: undefined;
			if (input.prdPublishedPath) {
				// Markdown mode — Phase 12 Fix 2b contract unchanged: the payload
				// mirrors the already-published PRD markdown file.
				const actual = hashFileContent(input.prdPublishedPath);
				if (!expected || expected !== actual) {
					problems.push(
						`G8 mirror check failed: payload inputs["prd-file"] (${expected ?? "missing"}) does not match ` +
							`the published PRD hash (${actual ?? "unreadable"}). Re-hash the published markdown and fix the payload.`,
					);
				}
			} else if (expected !== undefined && expectedHead) {
				// DB-only mode — the comparison source is the stored digest of the
				// current head revision (discussion §3.12 step 10). Lenient when
				// the payload omits prd-file (Phase 12 contract), strict when it
				// names one.
				if (expected !== expectedHead.sha256Fingerprint) {
					problems.push(
						`G8 mirror check failed (DB-only): payload inputs["prd-file"] does not match the stored digest of ` +
							`${input.kind} revision ${expectedHead.revisionNumber}. Re-read the store head and fix the payload.`,
					);
				}
			}
		}

		// --- Q2 flip (one txn) — CAS on head is the ONLY publish door (F8/F9/F11) ---
		if (problems.length === 0) {
			try {
				const head = publishArtifactCas(db, input.runId, input.kind, expectedHead ? expectedHead.revisionId : null);
				revisionInfo = {
					revisionId: head.revisionId,
					revisionNumber: head.revisionNumber,
					supersededRevisionId: expectedHead ? expectedHead.revisionId : null,
					supersededRevisionNumber: expectedHead ? expectedHead.revisionNumber : null,
				};
				if (expectedHead) {
					warnings.push(
						`Superseded ${input.kind} revision ${expectedHead.revisionNumber}; head is now revision ${head.revisionNumber}.`,
					);
				}
			} catch (err) {
				if (err instanceof HeadMovedError) {
					problems.push(
						`CAS refusal: head moved for '${input.kind}' (expected revision_id ${err.expected ?? "none"}, ` +
							`actual ${err.actual ?? "none"}). Another publish landed first — re-read the store head ` +
							`and re-run the approve. Draft rows reverted.`,
					);
				} else if (err instanceof FrozenArtifactError) {
					problems.push(
						`Publish refused: '${input.kind}' is frozen${err.reason ? ` — ${err.reason}` : ""}. ` +
							`Resolve the freeze before republishing. Draft rows reverted.`,
					);
				} else {
					throw err;
				}
			}
		}

		// Call-site audit entry (F17) with the real actor — the store-level
		// publish/supersede entries carry the reference actor; this one names
		// the run that published. The commit tx entry is written inside
		// publishArtifactCas (no duplicate here).
		if (revisionInfo) {
			appendAuditEntry(db, {
				actor: publishActor(input.runId, input.kind),
				action: "publish",
				artifactKind: input.kind,
				revisionNumber: revisionInfo.revisionNumber,
				detail: { runId: input.runId, revisionId: revisionInfo.revisionId, surface: "approve-flow" },
			});
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

		// --- 6. Checkpoint (G1) before the commit ---
		if (problems.length === 0 && db) {
			const cp = checkpointNow(db);
			if (cp.busy !== 0) {
				warnings.push(
					`wal_checkpoint reported busy=${cp.busy} — committed index.db may lag; retry the publish if the commit looks stale.`,
				);
			}
		}

		// --- 6b. Snapshot backup before the commit (N9) — no-op until Phase 3 ---
		// Success path ONLY: a failed publish never snapshots. Fail-open by
		// contract (core/backup.ts): null = subsystem not installed = continue.
		if (problems.length === 0) {
			try {
				const backup = createBackupSnapshot({
					cwd: input.cwd,
					projectName: input.projectName,
					trigger: "publish",
					dbPath,
				});
				if (backup) {
					warnings.push(`Backup snapshot written: ${backup.backupPath} (quickCheckOk=${String(backup.quickCheckOk)}).`);
				}
			} catch (backupErr) {
				warnings.push(
					`Backup snapshot failed (publish continues — N9 is fail-open): ` +
						`${backupErr instanceof Error ? backupErr.message : String(backupErr)}`,
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
				const message = revisionInfo
					? `velpari(${input.yamlArtifact}): ${input.projectName} v${input.envelope.version} rev ${revisionInfo.revisionNumber} (run ${input.runId})`
					: `velpari(${input.yamlArtifact}): ${input.projectName} v${input.envelope.version} (run ${input.runId})`;
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
					// Call-site rollback bookkeeping (F17/F18) — best-effort, never
					// masks the original failure or a rollback failure.
					try {
						appendAuditEntry(rdb, {
							actor: publishActor(input.runId, input.kind),
							action: "publish-failed",
							artifactKind: input.kind,
							detail: { problems: [...problems] },
						});
						appendTxEntry(rdb, {
							actor: publishActor(input.runId, input.kind),
							operation: "rollback",
							outcome: "rollback",
						});
					} catch {
						// audit must never mask the rollback
					}
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
		return { ok: false, problems, warnings, dbPath, revision: null };
	}

	return { ok: true, problems: [], warnings, dbPath, revision: revisionInfo };
}

/**
 * Try deleteRunDrafts-style cleanup for one run/kind when the rows never
 * flipped. Returns true when the draft envelope existed and was HANDLED
 * (deleted, or deliberately kept — see below).
 *
 * Phase 1 (revision model): a draft that carries a head_revision_id is a
 * REVISION of a published chain — deleting it would orphan the prior
 * published revision (the pointer lives only on this row). Such a draft is
 * KEPT (the normal update-mode resting state); the retry re-uses it and the
 * CAS read still sees the correct head. Only a first-publish draft (never
 * flipped, no head) is deleted as before.
 *
 * A flip that landed and then failed the chain (commit etc.) leaves a
 * published artifact_revisions row behind (F8: the flip committed, so it
 * WAS published); revertPublish restores the draft row with its head still
 * pointing at that revision, and the retry's CAS read supersedes it — the
 * chain stays linear without extra bookkeeping here.
 *
 * @param {ReturnType<typeof openStoreDb>} db - Open store connection.
 * @param {string} runId - Owning run.
 * @param {ArtifactKind} kind - Artifact kind to clean.
 * @returns {boolean} true when a draft envelope was found + handled.
 */
function deleteDraftIfDraft(db: ReturnType<typeof openStoreDb>, runId: string, kind: ArtifactKind): boolean {
	const row = db
		.prepare("SELECT status, head_revision_id FROM artifacts WHERE run_id = ? AND kind = ?")
		.get(runId, kind) as { status: string; head_revision_id: number | null } | undefined;
	if (row?.status !== "draft") return false;
	if (row.head_revision_id !== null && row.head_revision_id !== undefined) {
		return true; // revision draft — keep (head pointer must survive)
	}
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
