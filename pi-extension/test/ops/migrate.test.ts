// Unit tests — ops/migrate.ts (Phase 11, §15.6 — the one-time migration).
// Covers (plan 1.TEST gate): precheck blocks (G7 run-open naming
// /velpari-reset; missing git identity), dry-run writes NOTHING, execute
// migrates in FK order under run 'migrated' + commits per project with
// explicit paths (Design 3b) + re-exports YAML beside the DB (9-YAML
// contract, incl. the backfill-import branch) + registry lists the
// project + G1 wal truncation, idempotent re-run (second run all-skips,
// nothing-to-commit), and the R7 gate item: input-changed fires after a
// DB-era republish (markdown never changes — Design 10 YAML hashing).
// Conventions: temp dirs under TMPDIR + real git repos + real store DBs.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { MIGRATE_RUN_ID, migrateDryRun, migrateExecute, migratePrecheck } from "../../src/ops/migrate.js";
import {
	readLatestPublishedRows,
	writeArtifact,
	publishArtifact,
	type ArtifactEnvelopeInput,
	type ArtifactPayload,
} from "../../src/io/store.js";
import { runDbPublish } from "../../src/ops/db-publish.js";
import { openPortfolioDb, openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { buildPortfolioDbPath, buildStoreDbPath, buildStoreYamlPath } from "../../src/core/paths.js";
import { listProjects } from "../../src/io/portfolio.js";
import { computeStaleSet, recordPublish } from "../../src/core/freshness.js";
import { hashFileContentNormalized } from "../../src/core/fingerprints.js";

const PROJECT = "alpha";

const PRD_MD = `# PSRS — alpha

## Functional Requirements

| ID | Phase | Requirement |
|---|---|---|
| FR-1 | 1 | The system shall parse input |
| FR-2 | 2 | The system shall export reports |

## Non-Functional Requirements

| ID | Phase | Requirement |
|---|---|---|
| NFR-1 | 1 | Response under 200ms |

## PRD Sections

| No | Title | Body |
|---|---|---|
| 1 | Purpose | Why we build this |
`;

const RTM_MD = `# RTM — alpha

## Traceability

| FR | Phase | Design | Tests |
|---|---|---|---|
| FR-1 | 1 | M-1 | TC-1 |
`;

/** Prose-only PRD — no parseable tables → the loader returns null. */
const PROSE_PRD_MD = `# PSRS — prose only

This legacy draft never used tables. Nothing to parse here.
`;

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-migrate-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function currentDir(): string {
	return dirs[dirs.length - 1]!;
}

function writeDoc(dir: string, sub: string, artifact: string, markdown: string): void {
	mkdirSync(join(dir, "Doc", sub), { recursive: true });
	writeFileSync(join(dir, "Doc", sub, `${artifact}_${PROJECT}.md`), markdown, "utf8");
}

function writeOpenRunState(dir: string): void {
	mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(dir, ".pi", "velpari", "state.json"),
		JSON.stringify({ version: 1, runId: "run-open", mission: "m", currentStage: "drafting-prd", updatedAt: "" }),
		"utf8",
	);
}

function gitInit(dir: string, withIdentity = true): void {
	const run = (args: string[]): void => {
		void spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
	};
	run(["init"]);
	if (withIdentity) {
		run(["config", "user.email", "test@example.com"]);
		run(["config", "user.name", "Test"]);
		run(["config", "commit.gpgsign", "false"]);
	}
}

function headFiles(dir: string): string[] {
	return execFileSync("git", ["show", "--name-only", "--pretty=format:", "HEAD"], { cwd: dir })
		.toString()
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

const MIGRATE_COMMIT_LEGAL =
	/^(?:Doc\/store\/alpha\/(?:index\.db|[A-Za-z-]+_alpha\.yaml)|\.gitattributes|\.gitignore|Doc\/store\/portfolio\.db)$/;

describe("ops/migrate precheck", () => {
	test("G7: an open run blocks precheck, dry-run AND execute, naming /velpari-reset", () => {
		const dir = currentDir();
		gitInit(dir);
		writeDoc(dir, "requirements", "PRD", PRD_MD);
		writeOpenRunState(dir);
		const pre = migratePrecheck(dir);
		assert.equal(pre.ok, false);
		assert.ok(
			pre.problems.some((p) => /velpari-reset/.test(p)),
			pre.problems.join(" | "),
		);
		const dry = migrateDryRun(dir);
		assert.equal(dry.ok, false);
		assert.equal(dry.projects.length, 0, "a blocked dry-run reports no projects");
		const executed = migrateExecute(dir);
		assert.equal(executed.ok, false);
		assert.equal(executed.projects.length, 0, "a blocked execute writes nothing");
		assert.equal(existsSync(buildStoreDbPath(PROJECT, dir)), false, "blocked execute must not create the store DB");
	});

	test("git identity missing → precheck refuses before any write", () => {
		const dir = currentDir();
		gitInit(dir, false);
		// Isolate from any machine-level global/system git config (git ≥ 2.32):
		// `git config --get user.name` falls back to those, so a developer box
		// with a global identity would mask the missing-identity case. Same
		// idiom as test/db-store/publish.test.ts's precheck test.
		const prevGlobal = process.env.GIT_CONFIG_GLOBAL;
		const prevSystem = process.env.GIT_CONFIG_SYSTEM;
		process.env.GIT_CONFIG_GLOBAL = "/dev/null";
		process.env.GIT_CONFIG_SYSTEM = "/dev/null";
		try {
			const pre = migratePrecheck(dir);
			assert.equal(pre.ok, false);
			assert.ok(
				pre.problems.some((p) => /user\.name/.test(p)),
				pre.problems.join(" | "),
			);
		} finally {
			if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
			else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
			if (prevSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
			else process.env.GIT_CONFIG_SYSTEM = prevSystem;
		}
	});
});

describe("ops/migrate dry run", () => {
	test("dry-run reports would-migrate per kind and writes NOTHING", () => {
		const dir = currentDir();
		gitInit(dir);
		writeDoc(dir, "requirements", "PRD", PRD_MD);
		writeDoc(dir, "requirements", "RTM", RTM_MD);
		const report = migrateDryRun(dir);
		assert.equal(report.ok, true);
		assert.equal(report.projects.length, 1);
		const project = report.projects[0]!;
		assert.equal(project.projectName, PROJECT);
		assert.equal(project.status, "reported");
		const prd = project.kinds.find((k) => k.kind === "prd")!;
		assert.equal(prd.status, "would-migrate");
		assert.equal(prd.rowCount, 4);
		const rtm = project.kinds.find((k) => k.kind === "rtm")!;
		assert.equal(rtm.status, "would-migrate");
		assert.equal(rtm.rowCount, 1);
		// Nothing written anywhere.
		assert.equal(existsSync(buildStoreDbPath(PROJECT, dir)), false, "dry run must not create the store DB");
		assert.equal(existsSync(buildStoreYamlPath(PROJECT, "PRD", dir)), false, "dry run must not write YAML");
		const log = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf-8" });
		assert.notEqual(log.status, 0, "dry run must not commit");
	});

	test("a prose-only legacy source is a skip, not a failure", () => {
		const dir = currentDir();
		gitInit(dir);
		writeDoc(dir, "requirements", "PRD", PROSE_PRD_MD);
		const report = migrateDryRun(dir);
		assert.equal(report.ok, true);
		const prd = report.projects[0]!.kinds.find((k) => k.kind === "prd")!;
		assert.equal(prd.status, "missing");
	});
});

describe("ops/migrate execute", () => {
	test("migrates in FK order under run 'migrated', commits per project, re-exports YAML, registry lists", () => {
		const dir = currentDir();
		gitInit(dir);
		writeDoc(dir, "requirements", "PRD", PRD_MD);
		writeDoc(dir, "requirements", "RTM", RTM_MD);

		const report = migrateExecute(dir);
		assert.equal(report.ok, true, JSON.stringify(report.projects[0]?.kinds ?? report.precheckProblems));
		assert.equal(report.projects.length, 1);
		const project = report.projects[0]!;
		assert.equal(project.status, "migrated");
		assert.ok(project.commitSha, "the per-project migration commit must land");

		// Per-kind outcomes (FK order satisfied: rtm→fr in the SAME run).
		const prd = project.kinds.find((k) => k.kind === "prd")!;
		assert.equal(prd.status, "migrated");
		assert.equal(prd.rowCount, 4);
		const rtm = project.kinds.find((k) => k.kind === "rtm")!;
		assert.equal(rtm.status, "migrated");
		assert.equal(rtm.rowCount, 1);

		// Store: run 'migrated', published, provenance change-log line.
		const prdRead = readLatestPublishedRows(dir, PROJECT, "prd");
		assert.ok(prdRead);
		assert.equal(prdRead.envelope.runId, MIGRATE_RUN_ID);
		assert.equal(prdRead.envelope.status, "published");
		assert.ok(/Migrated by \/velpari-migrate-store from/.test(prdRead.envelope.changeLog));
		const rtmRead = readLatestPublishedRows(dir, PROJECT, "rtm");
		assert.ok(rtmRead, "rtm must be published (run-scoped FK satisfied by the shared run id)");
		assert.equal(rtmRead.envelope.runId, MIGRATE_RUN_ID);

		// 9-YAML contract: every migrated kind's YAML exists beside the DB.
		assert.ok(existsSync(buildStoreYamlPath(PROJECT, "PRD", dir)));
		assert.ok(existsSync(buildStoreYamlPath(PROJECT, "RTM", dir)));

		// Design 3b: per-project commit, explicit paths ONLY (no markdown).
		const files = headFiles(dir);
		assert.ok(
			files.every((f) => MIGRATE_COMMIT_LEGAL.test(f)),
			`unexpected commit paths: ${files.join(", ")}`,
		);
		assert.ok(!files.some((f) => f.endsWith(".md")), "migration commits carry NO markdown");
		const message = execFileSync("git", ["log", "--format=%s", "-1"], { cwd: dir }).toString();
		assert.match(message, /velpari\(migrate\): alpha \(run migrated\)/);

		// Registry lists the project (Phase 10 discipline).
		const registry = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			assert.ok(listProjects(registry).some((p) => p.projectName === PROJECT));
		} finally {
			closeStoreDb(registry);
		}

		// G1: the WAL is truncated before the commit.
		const wal = buildStoreDbPath(PROJECT, dir) + "-wal";
		if (existsSync(wal)) assert.equal(statSync(wal).size, 0);
	});

	test("idempotent: second run all-skips with nothing to commit", () => {
		const dir = currentDir();
		gitInit(dir);
		writeDoc(dir, "requirements", "PRD", PRD_MD);
		assert.equal(migrateExecute(dir).ok, true);

		const second = migrateExecute(dir);
		assert.equal(second.ok, true);
		const project = second.projects[0]!;
		assert.equal(project.status, "migrated");
		for (const kind of project.kinds) {
			if (kind.kind === "prd") assert.equal(kind.status, "skip-published", kind.detail);
		}
		// No markdown may enter ANY commit, even on a re-run.
		const allFiles = execFileSync("git", ["log", "--name-only", "--pretty=format:"], { cwd: dir }).toString();
		assert.ok(!/^Doc\/.*\.md$/m.test(allFiles), "no migration commit may carry markdown");
	});

	test("YAML backfill: existing store rows without YAML get their export (backfill-import branch)", () => {
		const dir = currentDir();
		gitInit(dir);
		// Seed store rows the way /velpari-backfill leaves them: published,
		// NEVER exported (backfill writes the store only).
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		const env: ArtifactEnvelopeInput = {
			version: 1,
			stage: "drafting-prd",
			generatedAt: "2026-09-24T00:00:00.000Z",
			inputs: "{}",
			reviewerVerdict: null,
			changeLog: "[]",
		};
		const rows: ArtifactPayload = {
			fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "The system shall parse input." }],
		};
		try {
			writeArtifact(db, "prd", "backfill-t9", env, rows);
			publishArtifact(db, "backfill-t9", "prd");
		} finally {
			closeStoreDb(db);
		}
		assert.equal(existsSync(buildStoreYamlPath(PROJECT, "PRD", dir)), false, "backfill leaves no YAML");

		const report = migrateExecute(dir);
		assert.equal(report.ok, true, JSON.stringify(report.projects[0]?.kinds ?? report.precheckProblems));
		const project = report.projects[0]!;
		const prd = project.kinds.find((k) => k.kind === "prd")!;
		assert.equal(prd.status, "skip-published");
		assert.ok(
			project.warnings.some((w) => /YAML exported for existing store rows/.test(w)),
			project.warnings.join(" | "),
		);
		assert.ok(existsSync(buildStoreYamlPath(PROJECT, "PRD", dir)), "the runbook rebuild source must exist");
		assert.ok(project.commitSha, "the YAML backfill joins a commit");
	});
});

describe("ops/migrate × freshness (Design 10)", () => {
	test("input-changed fires after a DB-era republish — the markdown never changes", () => {
		const dir = currentDir();
		gitInit(dir);
		writeDoc(dir, "requirements", "PRD", PRD_MD);

		// 1. Migrate: PRD rows + YAML land (run 'migrated').
		assert.equal(migrateExecute(dir).ok, true);
		const yamlPath = buildStoreYamlPath(PROJECT, "PRD", dir);
		assert.ok(existsSync(yamlPath));

		// 2. A downstream DB-era publish stamps its input against the PRD
		//    YAML bytes (the freshness-bearing artifact after retirement).
		const yamlHash = hashFileContentNormalized(yamlPath);
		assert.ok(yamlHash, "the exported YAML must be hashable");
		recordPublish(dir, {
			artifact: "rtm",
			projectName: PROJECT,
			path: `Doc/requirements/RTM_${PROJECT}.md`,
			publishedAt: new Date().toISOString(),
			inputs: { "PRD:alpha": yamlHash },
			hashv: 2,
		});
		assert.equal(
			computeStaleSet(dir).filter((s) => s.reason === "input-changed").length,
			0,
			"a fresh stamp must not be stale",
		);

		// 3. DB-era REPUBLISH through the publish chain (flag OFF —
		//    publishedPaths []): rows change → YAML bytes change → the
		//    frozen markdown (never rewritten) must NOT keep the chain dead.
		const outcome = runDbPublish({
			cwd: dir,
			projectName: PROJECT,
			runId: "r2",
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: {
				version: 2,
				stage: "drafting-prd",
				generatedAt: "2026-09-24T01:00:00.000Z",
				inputs: "{}",
				reviewerVerdict: null,
				changeLog: "[]",
			},
			payload: {
				fr: [{ id: "FR-1", phase: 1, textHash: "deadbeef", text: "The system shall parse input V2." }],
			},
			publishedPaths: [],
		});
		assert.deepEqual(outcome.problems, []);

		// 4. The stale set reports input-changed on the stamped input.
		const stale = computeStaleSet(dir).filter((s) => s.reason === "input-changed");
		assert.equal(stale.length, 1, "input-changed MUST fire after a DB-era republish");
		assert.equal(stale[0]!.key, "rtm:alpha");
		assert.deepEqual(stale[0]!.changedInputs, ["PRD:alpha"]);
	});
});
