// ============================================================================
// ops/migrate.ts — /velpari-migrate-store one-time migration (Layer 1, Phase 11)
// ============================================================================
// Decision record §15.6 + RES-3: every legacy-published document migrates
// ONCE into the project's store DB; the markdown-as-source publish path is
// retired (Q3) in the same phase. Design pins (plan v1.5):
//   1. Reuse, don't reimplement — the 9 per-kind loaders are backfill's
//      (ops/backfill.ts exportLegacyLoaders); the only new logic here is
//      orchestration: multi-project discovery, ordering, verification,
//      reporting.
//   2. FK order = KIND_ORDER (prd → … → final-design), one shared run id
//      `migrated` per project (OQ-P11c) — run-scoped cross-kind FKs are
//      satisfied by construction.
//   3. Preconditions BEFORE any write: G7 run-open hard-block (message
//      names /velpari-reset) + git identity (the same precheck the publish
//      chain runs — it gates the per-project migration commit).
//   3b. Migration COMMITS per project: explicit paths only (per-project
//      store DB + YAML exports + portfolio registry + healed git files),
//      message `velpari(migrate): <project> (run migrated)` — the migrated
//      DB + YAML ARE the backup (D2/D7).
//   6. Verification per project: every migrated kind re-reads through a
//      FRESH connection and verifies its export checksum; every kind with
//      published rows has its YAML beside the DB (the Phase 9 runbook
//      rebuild source — including kinds previously imported by backfill,
//      which never exported); PRAGMA quick_check + integrity_check pass;
//      no link orphans; the portfolio registry lists the project.
//   8. Migrated envelopes carry inputs "{}" + a provenance change-log line
//      (the backfill pattern); freshness stamps land at the next real
//      publish (no-stamp warnings until then — documented, acceptable).
// Idempotent per kind: already-published kinds are a no-op skip; failures
// are per-kind, reported, re-runnable (R1). All-or-nothing is NOT claimed.
// Dry-run writes NOTHING (OQ-P11a): every read path here is pure.
// ============================================================================

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import type { ArtifactKind } from "../io/store.js";
import {
	KIND_ORDER,
	checkpointNow,
	exportArtifactYaml,
	publishArtifact,
	readLatestPublishedRows,
	verifyExportChecksum,
	writeArtifact,
	type ArtifactEnvelopeInput,
} from "../io/store.js";
import { closeStoreDb, openPortfolioDb, openStoreDb } from "../io/db.js";
import { atomicWriteFile } from "../io/atomic-write.js";
import { buildPortfolioDbPath, buildStoreDbPath, buildStoreYamlPath, categoryFor } from "../core/paths.js";
import { loadState } from "../core/state.js";
import { listProjects } from "../io/portfolio.js";
import { ensureStoreGitIntegration } from "./git-attributes.js";
import { syncPortfolioRegistry } from "./portfolio.js";
import { precheckGitForPublish } from "./db-publish.js";
import {
	FK_UPSTREAM,
	KIND_STAGE,
	KIND_YAML_LABELS,
	exportLegacyLoaders,
	payloadRowCount,
	type LegacyLoad,
} from "./backfill.js";

/** The one-time migration run id (OQ-P11c — one FK graph per project). */
export const MIGRATE_RUN_ID = "migrated";

// ---------------------------------------------------------------------------
// Report shapes (the command notifies these verbatim).
// ---------------------------------------------------------------------------

/** Per-kind outcome. `would-migrate` appears in dry-run reports only. */
export interface MigrateKindReport {
	kind: ArtifactKind;
	status: "migrated" | "skip-published" | "skip-empty" | "missing" | "failed" | "would-migrate";
	/** Human detail — report line verbatim. */
	detail: string;
	rowCount: number;
}

/** Per-project outcome. */
export interface MigrateProjectReport {
	projectName: string;
	status: "migrated" | "failed" | "reported";
	kinds: MigrateKindReport[];
	/** Short commit sha when the migration commit landed (execute only). */
	commitSha: string | null;
	/** Non-kind failures: commit problems + verification problems. */
	problems: string[];
	warnings: string[];
}

/** Whole-run outcome. ok=false means precheck blocked OR any kind failed. */
export interface MigrateReport {
	ok: boolean;
	/** Blocking precheck problems (G7 / git) — projects list is empty then. */
	precheckProblems: string[];
	projects: MigrateProjectReport[];
}

/** One legacy project found on disk (published docs and/or a store DB). */
export interface DiscoveredProject {
	projectName: string;
	/** Legacy markdown source path per kind (the loaders resolve the same). */
	sources: Partial<Record<ArtifactKind, string>>;
	/** A per-project store DB already exists under the store folder. */
	inStore: boolean;
}

// ---------------------------------------------------------------------------
// Preconditions (G7 + write safety) — pure reads, before ANY write.
// ---------------------------------------------------------------------------

/**
 * Migration precheck: (a) no in-flight run — state.json must be absent or
 * stage `none` (G7 hard-block; the message names /velpari-reset); (b) git
 * usable — the SAME precheck the publish chain runs, because migration
 * COMMITS (Design 3b). Nothing has been written when this fails.
 *
 * @param {string} cwd - Project root (the git work tree).
 * @returns {{ ok: boolean; problems: string[] }} ok=false blocks everything.
 */
export function migratePrecheck(cwd: string): { ok: boolean; problems: string[] } {
	const problems: string[] = [];
	const state = loadState(cwd);
	if (state.currentStage !== "none") {
		problems.push(
			`a run is open (stage '${state.currentStage}', run '${state.runId || "unnamed"}') — G7 blocks migration ` +
				`while a run is in flight. Finish the sequence or run /velpari-reset first.`,
		);
	}
	const git = precheckGitForPublish(cwd);
	problems.push(...git.problems);
	return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Discovery — legacy Doc/ projects + existing store dirs.
// ---------------------------------------------------------------------------

/**
 * Scan Doc/ (flat root + grouped category subfolders) for one artifact's
 * `<artifact>_<projectName>.md` files. Mirrors core/paths.resolveDocArtifact's
 * grouped-first/legacy-flat resolution, but ALSO sees legacy FLAT files
 * (resolveDocArtifactAll only scans subfolders) — flat projects are exactly
 * the migration audience.
 */
function scanDocForArtifact(cwd: string, artifact: string): Map<string, string> {
	const found = new Map<string, string>();
	const safeArtifact = artifact.replace(/[^A-Za-z0-9_-]+/g, "");
	const fileRe = new RegExp(`^${safeArtifact}_(.+)\\.md$`);
	const docRoot = join(cwd, "Doc");
	const dirs: string[] = [docRoot];
	const category = categoryFor(artifact);
	if (category) dirs.push(join(docRoot, category));
	for (const dir of dirs) {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const m = fileRe.exec(entry);
			if (!m || !m[1]) continue;
			if (!found.has(m[1])) found.set(m[1], join(dir, entry));
		}
	}
	return found;
}

/**
 * Discover migratable projects: any projectName with a published legacy
 * artifact under Doc/ (flat or grouped), plus any existing per-project
 * store DB under the store folder (already migrated / store-native — they
 * appear so the report can show their all-skips state). Sorted by name.
 *
 * @param {string} cwd - Project root.
 * @returns {DiscoveredProject[]} Deterministic, possibly empty.
 */
export function discoverLegacyProjects(cwd: string): DiscoveredProject[] {
	const byName = new Map<string, DiscoveredProject>();
	const ensure = (name: string): DiscoveredProject => {
		let p = byName.get(name);
		if (!p) {
			p = { projectName: name, sources: {}, inStore: false };
			byName.set(name, p);
		}
		return p;
	};
	for (const kind of KIND_ORDER) {
		for (const [projectName, path] of scanDocForArtifact(cwd, KIND_YAML_LABELS[kind])) {
			ensure(projectName).sources[kind] = path;
		}
	}
	const storeDir = join(cwd, "Doc", "store");
	if (existsSync(storeDir)) {
		try {
			for (const entry of readdirSync(storeDir, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				if (!existsSync(join(storeDir, entry.name, "index.db"))) continue;
				ensure(entry.name).inStore = true;
			}
		} catch {
			// unreadable store folder → no store-side discoveries
		}
	}
	return Array.from(byName.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));
}

// ---------------------------------------------------------------------------
// Per-kind evaluation shared by dry-run and execute.
// ---------------------------------------------------------------------------

interface KindPlan {
	status: MigrateKindReport["status"];
	loaded: LegacyLoad | null;
	rowCount: number;
	existingRunId: string | null;
	existingVersion: number | null;
}

/**
 * Evaluate one (project, kind): already-published → skip; loader parse →
 * would-migrate / skip-empty / missing. Pure read — writes nothing.
 */
function planKind(projectName: string, kind: ArtifactKind, cwd: string): KindPlan {
	const existing = readLatestPublishedRows(cwd, projectName, kind);
	if (existing) {
		return {
			status: "skip-published",
			loaded: null,
			rowCount: 0,
			existingRunId: existing.envelope.runId,
			existingVersion: existing.envelope.version,
		};
	}
	const loaded = exportLegacyLoaders()[kind](projectName, cwd);
	if (!loaded) {
		return { status: "missing", loaded: null, rowCount: 0, existingRunId: null, existingVersion: null };
	}
	const rowCount = payloadRowCount(loaded.payload);
	if (rowCount === 0) {
		return { status: "skip-empty", loaded, rowCount: 0, existingRunId: null, existingVersion: null };
	}
	return { status: "would-migrate", loaded, rowCount, existingRunId: null, existingVersion: null };
}

function skipDetail(plan: KindPlan): string {
	if (plan.status === "skip-published") {
		return `already in the store (run ${plan.existingRunId} v${plan.existingVersion}) — no-op.`;
	}
	if (plan.status === "skip-empty") return "legacy source parsed to zero rows — skipped (never an empty import).";
	return "no parseable legacy source found — skipped.";
}

// ---------------------------------------------------------------------------
// Dry run (OQ-P11a) — full report, writes NOTHING.
// ---------------------------------------------------------------------------

/**
 * Dry-run the migration: precheck + discovery + per-kind parse plan.
 * Pure read — no store DB is created or touched, no YAML written, no git
 * command runs.
 *
 * @param {string} cwd - Project root.
 * @returns {MigrateReport} projects carry `would-migrate` / skip statuses.
 */
export function migrateDryRun(cwd: string): MigrateReport {
	const pre = migratePrecheck(cwd);
	if (!pre.ok) return { ok: false, precheckProblems: pre.problems, projects: [] };
	const projects: MigrateProjectReport[] = discoverLegacyProjects(cwd).map((p) => ({
		projectName: p.projectName,
		status: "reported",
		commitSha: null,
		problems: [],
		warnings: [],
		kinds: KIND_ORDER.map((kind) => {
			const plan = planKind(p.projectName, kind, cwd);
			return {
				kind,
				status: plan.status,
				rowCount: plan.rowCount,
				detail:
					plan.status === "would-migrate"
						? `would migrate ${plan.rowCount} row(s) from ${p.sources[kind] ?? "loader source"}.`
						: skipDetail(plan),
			};
		}),
	}));
	return { ok: true, precheckProblems: [], projects };
}

// ---------------------------------------------------------------------------
// Execute — the real migration (per project: kinds → YAML → checkpoint →
// registry → commit → verify).
// ---------------------------------------------------------------------------

/**
 * Execute the migration. Re-runs the precheck FIRST (R3: the command also
 * checks, but the engine never trusts its caller). Per project:
 *   per kind in KIND_ORDER — skip-published (ensuring its YAML exists
 *   beside the DB — backfill imports never exported) → loader → zero-row
 *   skip → writeArtifact (run `migrated`) → checksum verify → publish →
 *   export YAML beside the DB → re-verify; then per project —
 *   checkpointNow (G1) → registry sync (fail-open) → git heal + add +
 *   commit (Design 3b, explicit paths, `velpari(migrate): <project> (run
 *   migrated)`) → fresh-connection verification (re-read + checksum +
 *   PRAGMA quick_check/integrity_check + link-orphan audit + registry row).
 *
 * A failed kind is reported and the remaining kinds continue (R1); a
 * failed commit is a project failure — rows stay published, and a re-run
 * skips the published kinds and retries the commit (idempotent).
 *
 * @param {string} cwd - Project root (the git work tree).
 * @returns {MigrateReport} Full per-project/per-kind report.
 */
export function migrateExecute(cwd: string): MigrateReport {
	const pre = migratePrecheck(cwd);
	if (!pre.ok) return { ok: false, precheckProblems: pre.problems, projects: [] };
	const registryPath = buildPortfolioDbPath(cwd);
	const projects: MigrateProjectReport[] = [];

	for (const discovered of discoverLegacyProjects(cwd)) {
		const projectName = discovered.projectName;
		const warnings: string[] = [];
		const kinds: MigrateKindReport[] = [];
		const dbPath = buildStoreDbPath(projectName, cwd);
		const db = openStoreDb(dbPath);
		try {
			// --- per-kind chain (FK order) ---
			for (const kind of KIND_ORDER) {
				const plan = planKind(projectName, kind, cwd);
				const yamlPath = buildStoreYamlPath(projectName, KIND_YAML_LABELS[kind], cwd);
				if (plan.status !== "would-migrate") {
					// YAML backfill for kinds already in the store whose YAML
					// is missing (backfill never exported) — the runbook
					// rebuild source must exist for EVERY kind with rows.
					if (plan.status === "skip-published" && !existsSync(yamlPath) && plan.existingRunId) {
						const yaml = exportArtifactYaml(db, plan.existingRunId, kind);
						if (yaml !== null) {
							atomicWriteFile(yamlPath, yaml, "utf-8");
							warnings.push(
								`${kind}: YAML exported for existing store rows (run ${plan.existingRunId}) — backfill imports do not export.`,
							);
						}
					}
					kinds.push({ kind, status: plan.status, rowCount: plan.rowCount, detail: skipDetail(plan) });
					continue;
				}
				const loaded = plan.loaded!;
				const envelope: ArtifactEnvelopeInput = {
					version: 1,
					stage: KIND_STAGE[kind],
					generatedAt: new Date().toISOString(),
					inputs: "{}",
					reviewerVerdict: null,
					changeLog: JSON.stringify([`Migrated by /velpari-migrate-store from ${loaded.source}.`]),
				};
				try {
					writeArtifact(db, kind, MIGRATE_RUN_ID, envelope, loaded.payload);
				} catch (err) {
					const upstream = FK_UPSTREAM[kind];
					const isFk = /FOREIGN KEY/i.test(String(err));
					kinds.push({
						kind,
						status: "failed",
						rowCount: plan.rowCount,
						detail: isFk
							? `rows reference upstream '${upstream}' rows that are not imported yet (run-scoped FK) — fix and re-run.`
							: `store write failed: ${err instanceof Error ? err.message : String(err)}`,
					});
					continue;
				}
				const preVerify = verifyExportChecksum(db, MIGRATE_RUN_ID, kind);
				if (!preVerify.ok) {
					kinds.push({
						kind,
						status: "failed",
						rowCount: plan.rowCount,
						detail: `checksum verify failed after write (expected ${preVerify.expected}, got ${preVerify.actual}) — rows left as draft; re-run after fixing.`,
					});
					continue;
				}
				publishArtifact(db, MIGRATE_RUN_ID, kind);
				const yaml = exportArtifactYaml(db, MIGRATE_RUN_ID, kind);
				if (yaml === null) {
					kinds.push({
						kind,
						status: "failed",
						rowCount: plan.rowCount,
						detail: "store export returned null after publish — rows vanished (store bug).",
					});
					continue;
				}
				atomicWriteFile(yamlPath, yaml, "utf-8");
				const postVerify = verifyExportChecksum(db, MIGRATE_RUN_ID, kind);
				if (!postVerify.ok) {
					kinds.push({
						kind,
						status: "failed",
						rowCount: plan.rowCount,
						detail: `checksum verify failed after export (expected ${postVerify.expected}, got ${postVerify.actual}).`,
					});
					continue;
				}
				kinds.push({
					kind,
					status: "migrated",
					rowCount: plan.rowCount,
					detail: `migrated ${plan.rowCount} row(s) from ${loaded.source} (run ${MIGRATE_RUN_ID} v1, published).`,
				});
			}

			// --- G1 checkpoint before the commit ---
			const cp = checkpointNow(db);
			if (cp.busy !== 0) {
				warnings.push(
					`wal_checkpoint reported busy=${cp.busy} — committed index.db may lag; re-run the migration if the commit looks stale.`,
				);
			}
		} finally {
			closeStoreDb(db);
		}

		// --- registry sync PRE-commit (fail-open, Phase 10 discipline) ---
		const registry = syncPortfolioRegistry(cwd);
		for (const change of registry.changes) {
			warnings.push(`portfolio registry: ${change.kind} ${change.projectName} — ${change.detail}`);
		}

		// --- git heal + commit (Design 3b — explicit paths ONLY) ---
		let commitSha: string | null = null;
		let commitProblem: string | null = null;
		const heal = ensureStoreGitIntegration(cwd);
		for (const line of heal.appended) warnings.push(`git integration healed: ${line}`);
		const yamlPaths = KIND_ORDER.map((kind) => buildStoreYamlPath(projectName, KIND_YAML_LABELS[kind], cwd)).filter(
			(p) => existsSync(p),
		);
		const rel = (p: string): string => relative(cwd, p);
		const addPaths = [
			dbPath,
			...yamlPaths,
			...heal.changedPaths,
			...(existsSync(registryPath) ? [registryPath] : []),
		].map(rel);
		const add = spawnSync("git", ["add", "--", ...addPaths], { cwd, encoding: "utf-8" });
		if (add.error || add.status !== 0) {
			commitProblem = `git add failed: ${(add.stderr ?? add.error?.message ?? "unknown").trim()}`;
		} else {
			const commit = spawnSync(
				"git",
				["commit", "-m", `velpari(migrate): ${projectName} (run ${MIGRATE_RUN_ID})`, "--", ...addPaths],
				{ cwd, encoding: "utf-8" },
			);
			if (commit.error || commit.status !== 0) {
				// Git has three no-op wordings and splits them across the two
				// streams: "nothing to commit, working tree clean" and "no
				// changes added to commit" go to stderr, while the explicit
				// pathspec variant "nothing added to commit but untracked files
				// present" goes to STDOUT. All three mean the same thing here —
				// an idempotent re-run with nothing new to record — so none may
				// be reported as a failure.
				const out = `${commit.stderr ?? ""} ${commit.stdout ?? ""}`;
				if (/nothing to commit|nothing added to commit|no changes added to commit/i.test(out)) {
					warnings.push("nothing to commit — the migrated state is already committed (idempotent re-run).");
				} else {
					commitProblem = `git commit failed: ${(commit.stderr ?? commit.error?.message ?? "").trim()} — rows stay published; re-run to retry the commit.`;
				}
			} else {
				const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf-8" });
				commitSha = sha.status === 0 ? sha.stdout.trim() : null;
			}
		}

		// --- verification (Design 6) — fresh connections only ---
		const verifyProblems = verifyMigratedProject(projectName, cwd, registryPath);

		const problems: string[] = commitProblem ? [commitProblem, ...verifyProblems] : verifyProblems;
		const failed = kinds.some((k) => k.status === "failed");
		const status: MigrateProjectReport["status"] = failed || problems.length > 0 ? "failed" : "migrated";
		projects.push({ projectName, status, commitSha, problems, warnings, kinds });
	}

	const ok = projects.every((p) => p.status === "migrated");
	return { ok, precheckProblems: [], projects };
}

/**
 * Design 6 verification for one migrated project — every check on FRESH
 * connections (proves persistence through close/reopen):
 *   1. every kind with published rows re-reads + verifies its export
 *      checksum;
 *   2. PRAGMA quick_check + integrity_check pass (the doctor's gate);
 *   3. no link orphans (same adjacency audit the doctor runs — inlined so
 *      verification stays engine-local and testable; keep in sync with
 *      doctor/checks/db-link-orphans.ts);
 *   4. the portfolio registry lists the project (when a registry exists).
 *
 * @returns {string[]} Verification problems (empty = verified).
 */
function verifyMigratedProject(projectName: string, cwd: string, registryPath: string): string[] {
	const problems: string[] = [];
	const dbPath = buildStoreDbPath(projectName, cwd);

	// 1. Re-read + checksum per kind.
	for (const kind of KIND_ORDER) {
		const read = readLatestPublishedRows(cwd, projectName, kind);
		if (!read) continue; // nothing migrated/stored for this kind
		const db = openStoreDb(dbPath);
		try {
			const check = verifyExportChecksum(db, read.envelope.runId, kind);
			if (!check.ok) {
				problems.push(`verify: ${kind} export checksum mismatch (expected ${check.expected}, got ${check.actual}).`);
			}
		} finally {
			closeStoreDb(db);
		}
	}

	// 2. Integrity (quick_check + integrity_check — the doctor's gate).
	{
		const db = openStoreDb(dbPath);
		try {
			const quick = db.prepare("PRAGMA quick_check").get() as { quick_check: string };
			if (quick.quick_check !== "ok") problems.push(`verify: PRAGMA quick_check returned ${quick.quick_check}.`);
			else {
				const full = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
				if (full.integrity_check !== "ok") {
					problems.push(`verify: PRAGMA integrity_check returned ${full.integrity_check}.`);
				}
			}
		} finally {
			closeStoreDb(db);
		}
	}

	// 3. Link-orphan audit (see doctor/checks/db-link-orphans.ts — same CTE).
	{
		const ENDPOINTS_CTE = `
WITH endpoints(run_id, kind, node_id) AS (
	SELECT run_id, 'fr', id FROM fr
	UNION ALL SELECT run_id, 'nfr', id FROM nfr
	UNION ALL SELECT run_id, 'feasibility', run_id FROM feasibility_decision
	UNION ALL SELECT run_id, 'design_module', id FROM design_module
	UNION ALL SELECT run_id, 'adr', id FROM adr
	UNION ALL SELECT run_id, 'diagram', id FROM diagram
	UNION ALL SELECT run_id, 'af', id FROM atomic_function
	UNION ALL SELECT run_id, 'pseudocode', id FROM pseudocode_block
	UNION ALL SELECT run_id, 'tc', id FROM test_case
	UNION ALL SELECT run_id, 'dev_step', id FROM dev_step
	UNION ALL SELECT run_id, 'final_section', CAST(no AS TEXT) FROM final_section
)`;
		const db = openStoreDb(dbPath);
		try {
			const row = db
				.prepare(
					`${ENDPOINTS_CTE}
					 SELECT COUNT(*) AS n FROM links l
					 WHERE NOT EXISTS (SELECT 1 FROM endpoints e WHERE e.run_id = l.run_id AND e.kind = l.from_kind AND e.node_id = l.from_id)
					    OR NOT EXISTS (SELECT 1 FROM endpoints e WHERE e.run_id = l.run_id AND e.kind = l.to_kind AND e.node_id = l.to_id)`,
				)
				.get() as { n: number };
			if (row.n > 0) problems.push(`verify: ${row.n} orphan link(s) — a link endpoint has no row.`);
		} finally {
			closeStoreDb(db);
		}
	}

	// 4. Registry row (when the registry exists — sync ran just before).
	if (existsSync(registryPath)) {
		const registry = openPortfolioDb(registryPath);
		try {
			const listed = listProjects(registry).some((p) => p.projectName === projectName);
			if (!listed) problems.push("verify: the portfolio registry does not list the project.");
		} finally {
			closeStoreDb(registry);
		}
	}

	return problems;
}

// ---------------------------------------------------------------------------
// Render — the command's notify text.
// ---------------------------------------------------------------------------

const KIND_STATUS_LABEL: Record<MigrateKindReport["status"], string> = {
	migrated: "migrated",
	"skip-published": "skip (published)",
	"skip-empty": "skip (zero rows)",
	missing: "skip (no source)",
	failed: "FAILED",
	"would-migrate": "would migrate",
};

/**
 * Render a report for the command notify (multi-line, per-project,
 * per-kind). Dry-run reports prepend an explicit nothing-written marker.
 *
 * @param {MigrateReport} report - Engine result (dry-run or execute).
 * @param {boolean} dryRun - True renders the dry-run banner.
 * @returns {string} Human-readable multi-line report.
 */
export function renderMigrateReport(report: MigrateReport, dryRun: boolean): string {
	const lines: string[] = [];
	if (report.precheckProblems.length > 0) {
		lines.push("Migration blocked — nothing written:");
		for (const problem of report.precheckProblems) lines.push(`  - ${problem}`);
		return lines.join("\n");
	}
	lines.push(dryRun ? "Migration dry run (nothing written):" : "Migration result:");
	if (report.projects.length === 0) {
		lines.push("  no legacy projects found under Doc/ (nothing to migrate).");
	}
	for (const project of report.projects) {
		const sha = project.commitSha ? ` (commit ${project.commitSha})` : "";
		lines.push(`  ${project.projectName} — ${project.status}${sha}`);
		for (const kind of project.kinds) {
			lines.push(`    ${kind.kind}: ${KIND_STATUS_LABEL[kind.status]} — ${kind.detail}`);
		}
		for (const problem of project.problems) lines.push(`    problem: ${problem}`);
		for (const warning of project.warnings) lines.push(`    note: ${warning}`);
	}
	if (!report.ok && !dryRun) lines.push("  migration finished WITH failures — fix and re-run (published kinds skip).");
	return lines.join("\n");
}
