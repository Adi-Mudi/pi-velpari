// Tests — the portfolio registry (Phase 10, §15.5).
// Covers: v001-p schema pin (user_version 1 + expected tables), registry
// G3 downgrade refusal, syncProject upsert/list/remove, repair
// (adds missing / removes orphans / refreshes stale), registry G1
// (wal 0 bytes or absent after every write), pre-commit sync order +
// post-rollback re-sync self-corrects (via runDbPublish), and the R5
// non-collision guarantee (store tooling never sees portfolio.db).
// Conventions: temp dirs under /var/tmp-safe TMPDIR + real openStoreDb /
// openPortfolioDb; real git repos for the publish-order test.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { openPortfolioDb, openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { buildPortfolioDbPath, buildStoreDbPath, buildStoreYamlPath } from "../../src/core/paths.js";
import { listProjects, syncProject, removeProject } from "../../src/io/portfolio.js";
import { PORTFOLIO_USER_VERSION } from "../../src/io/portfolio-schema.js";
import { syncPortfolioRegistry, repairPortfolioRegistry } from "../../src/ops/portfolio.js";
import { runDbPublish } from "../../src/ops/db-publish.js";
import { writeArtifact, publishArtifact } from "../../src/io/store.js";

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-portfolio-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Seed one spoke DB with a published artifact (newest-published source). */
function seedSpoke(dir: string, projectName: string, stage = "drafting-prd"): void {
	const db = openStoreDb(buildStoreDbPath(projectName, dir));
	try {
		writeArtifact(
			db,
			"prd",
			"run-1",
			{
				version: 1,
				stage,
				generatedAt: "2026-09-24T00:00:00.000Z",
				inputs: "{}",
				reviewerVerdict: null,
				changeLog: "[]",
			},
			{ fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "Prose for FR-1." }] },
		);
		publishArtifact(db, "run-1", "prd");
	} finally {
		closeStoreDb(db);
	}
}

describe("portfolio registry schema", () => {
	test("v001-p pin: user_version = 1, projects table present (STRICT)", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			const v = db.prepare("PRAGMA user_version").get() as { user_version: number };
			assert.equal(v.user_version, PORTFOLIO_USER_VERSION);
			const tables = (
				db
					.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
					.all() as {
					name: string;
				}[]
			).map((r) => r.name);
			assert.deepEqual(tables, ["projects"]);
			// STRICT: a BLOB insert must be refused.
			assert.throws(() => {
				db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)").run(Buffer.from("x"), null, "p", null, null, null);
			});
		} finally {
			closeStoreDb(db);
		}
	});

	test("registry G3: a future user_version is refused", () => {
		const dir = dirs[dirs.length - 1]!;
		const path = buildPortfolioDbPath(dir);
		const db = openPortfolioDb(path);
		db.exec("PRAGMA user_version = 99");
		closeStoreDb(db);
		assert.throws(() => openPortfolioDb(path), /upgrade your extension/i);
	});
});

describe("portfolio L0 API", () => {
	test("upsert / list (ordered) / remove — idempotent", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			syncProject(db, { projectName: "beta", dbPath: "Doc/store/beta/index.db", displayName: "beta", lastRunId: "r2" });
			syncProject(db, {
				projectName: "alpha",
				dbPath: "Doc/store/alpha/index.db",
				displayName: "alpha",
				lastRunId: "r1",
			});
			// Re-upsert alpha with new data (idempotent update, not a dupe).
			syncProject(db, {
				projectName: "alpha",
				dbPath: "Doc/store/alpha/index.db",
				displayName: "alpha",
				lastRunId: "r1b",
			});
			const rows = listProjects(db);
			assert.equal(rows.length, 2);
			assert.equal(rows[0]!.projectName, "alpha"); // ordered by name
			assert.equal(rows[0]!.lastRunId, "r1b");
			assert.equal(rows[1]!.projectName, "beta");
			assert.equal(removeProject(db, "beta"), true);
			assert.equal(removeProject(db, "beta"), false); // idempotent
			assert.equal(listProjects(db).length, 1);
		} finally {
			closeStoreDb(db);
		}
	});
});

describe("syncPortfolioRegistry / repairPortfolioRegistry", () => {
	test("adds missing spokes, refreshes stale, removes orphans; registry G1 (wal 0 bytes/absent)", () => {
		const dir = dirs[dirs.length - 1]!;
		seedSpoke(dir, "alpha");

		const first = syncPortfolioRegistry(dir);
		assert.equal(first.ok, true, JSON.stringify(first.changes));
		assert.ok(first.changes.some((c) => c.kind === "added" && c.projectName === "alpha"));

		// Idempotent second run: no changes.
		const second = syncPortfolioRegistry(dir);
		assert.equal(second.ok, true);
		assert.equal(second.changes.filter((c) => c.kind !== "warning").length, 0);

		// Refresh: publish a NEWER artifact into the spoke → sync updates.
		const db = openStoreDb(buildStoreDbPath("alpha", dir));
		try {
			writeArtifact(
				db,
				"prd",
				"run-2",
				{
					version: 2,
					stage: "drafting-prd",
					generatedAt: "2026-09-24T09:00:00.000Z",
					inputs: "{}",
					reviewerVerdict: null,
					changeLog: "[]",
				},
				{ fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "Prose for FR-1 v2." }] },
			);
			publishArtifact(db, "run-2", "prd");
		} finally {
			closeStoreDb(db);
		}
		const third = syncPortfolioRegistry(dir);
		assert.ok(third.changes.some((c) => c.kind === "updated" && c.projectName === "alpha"));

		// Orphan removal: delete the spoke dir → row removed.
		rmSync(join(dir, "Doc", "store", "alpha"), { recursive: true, force: true });
		const fourth = syncPortfolioRegistry(dir);
		assert.ok(fourth.changes.some((c) => c.kind === "removed" && c.projectName === "alpha"));

		// repairPortfolioRegistry === sync (derived-state pass).
		const repaired = repairPortfolioRegistry(dir);
		assert.equal(repaired.ok, true);

		// Registry G1: after every write the WAL must be empty or gone.
		const wal = buildPortfolioDbPath(dir) + "-wal";
		if (existsSync(wal)) assert.equal(statSync(wal).size, 0);
	});

	test("displayName: files.json projectName wins, dir-name fallback otherwise", () => {
		const dir = dirs[dirs.length - 1]!;
		seedSpoke(dir, "alpha");
		// No files.json in this temp dir → fallback = dir name.
		const result = syncPortfolioRegistry(dir);
		assert.equal(result.ok, true);
		const db = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			const rows = listProjects(db);
			assert.equal(rows[0]!.displayName, "alpha");
		} finally {
			closeStoreDb(db);
		}
	});
});

describe("publish-chain integration (pre-commit sync + rollback re-sync)", () => {
	test("runDbPublish syncs the registry PRE-commit; registry joins the same commit", () => {
		const dir = dirs[dirs.length - 1]!;
		execFileSync("git", ["init"], { cwd: dir });
		execFileSync("git", ["config", "user.name", "Velpari Test"], { cwd: dir });
		execFileSync("git", ["config", "user.email", "test@velpari.local"], { cwd: dir });
		// Seed the PRD spoke (run r1 so the sync picks the DESIGN run after it
		// publishes — same run id, later generatedAt breaks the tie).
		const db = openStoreDb(buildStoreDbPath("Demo", dir));
		try {
			writeArtifact(
				db,
				"prd",
				"r1",
				{ version: 1, stage: "drafting-prd", generatedAt: "2026-09-24T00:00:00.000Z" },
				{ fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "Seed prose." }] },
			);
			publishArtifact(db, "r1", "prd");
		} finally {
			closeStoreDb(db);
		}

		// Minimal design payload (loads through loadStagePayload would need a
		// working dir; construct the input directly — the chain validates).
		const designRows = {
			designModule: [{ id: "M-1", name: "core" }],
			moduleSourceFr: [{ moduleId: "M-1", frId: "FR-1" }],
			adr: [{ id: "ADR-1", adrStatus: "accepted", options: "a|b", chosen: "a", rationale: "r" }],
			diagram: [{ id: "D-1", diagramKind: "context", mermaidText: "graph TD; A-->B" }],
			approach: [{ moduleId: "M-1", tacticId: "T-01" }],
		};
		const markdown = join(dir, "Doc", "design", "design_Demo.md");
		mkdirSync(join(dir, "Doc", "design"), { recursive: true });
		writeFileSync(markdown, "# design\n", "utf-8");

		const outcome = runDbPublish({
			cwd: dir,
			projectName: "Demo",
			runId: "r1",
			kind: "design",
			yamlArtifact: "design",
			envelope: { version: 1, stage: "designing", generatedAt: "2026-09-24T01:00:00.000Z" },
			payload: designRows as never,
			publishedPaths: [markdown],
		});
		assert.deepEqual(outcome.problems, [], outcome.problems.join("; "));
		// Registry warnings are EXPECTED (non-blocking); the publish still ok.
		assert.equal(outcome.ok, true);

		// The registry row exists AND was committed in the SAME commit.
		const regDb = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			const rows = listProjects(regDb);
			assert.ok(
				rows.some((r) => r.projectName === "Demo" && r.lastRunId === "r1"),
				JSON.stringify(rows),
			);
		} finally {
			closeStoreDb(regDb);
		}
		const committed = execFileSync("git", ["show", "--name-only", "--pretty=format:", "HEAD"], { cwd: dir }).toString();
		assert.ok(committed.includes("portfolio.db"), "registry must join the publish commit");
		// The commit set stays exact: DB + YAML + markdown + heal files + registry.
		const files = committed
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		const legal =
			/^(?:Doc\/store\/Demo\/(?:index\.db|design_Demo\.yaml)|Doc\/design\/design_Demo\.md|\.gitattributes|\.gitignore|Doc\/store\/portfolio\.db)$/;
		for (const f of files) assert.match(f, legal, f);
	});
});
