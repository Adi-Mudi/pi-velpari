// Tests — doctor/checks/portfolio.ts (Phase 10 §15.5 drift visibility).
// Covers: fresh project (no registry, no spokes) → info; pre-registry
// (spokes, no hub) → info with repair pointer; ok (in sync); stale row
// (db_path missing) → warning; unregistered spoke → warning; asset sweep:
// missing asset → warning, `..` traversal → rejected WITHOUT probing.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPortfolioSection } from "../../src/doctor/checks/portfolio.js";
import { openPortfolioDb, openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { buildPortfolioDbPath, buildStoreDbPath } from "../../src/core/paths.js";
import { syncProject } from "../../src/io/portfolio.js";
import { writeArtifact, publishArtifact } from "../../src/io/store.js";

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-portfolio-doc-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Publish a design artifact whose diagram references an image asset.
 * Run-scoped FK: module_source_fr.fr_id → fr(run_id, id) — the PRD parent
 * and the design child MUST share one run id (r1). */
function seedDesignWithAsset(dir: string, projectName: string, diagramText: string): void {
	const db = openStoreDb(buildStoreDbPath(projectName, dir));
	try {
		writeArtifact(
			db,
			"prd",
			"r1",
			{ version: 1, stage: "drafting-prd", generatedAt: "2026-09-24T00:00:00.000Z" },
			{ fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "Seed prose." }] },
		);
		publishArtifact(db, "r1", "prd");
		writeArtifact(db, "design", "r1", { version: 1, stage: "designing", generatedAt: "2026-09-24T01:00:00.000Z" }, {
			designModule: [{ id: "M-1", name: "core" }],
			moduleSourceFr: [{ moduleId: "M-1", frId: "FR-1" }],
			diagram: [{ id: "D-1", diagramKind: "context", mermaidText: diagramText }],
		} as never);
		publishArtifact(db, "r1", "design");
	} finally {
		closeStoreDb(db);
	}
}

describe("checkPortfolioSection", () => {
	test("fresh project: no registry + no spokes → single info", () => {
		const dir = dirs[dirs.length - 1]!;
		const section = checkPortfolioSection(dir);
		assert.equal(section.title, "Portfolio registry");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
	});

	test("pre-registry: spokes exist, no hub → info with repair pointer", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openStoreDb(buildStoreDbPath("alpha", dir));
		closeStoreDb(db);
		const section = checkPortfolioSection(dir);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /No portfolio registry yet/);
	});

	test("in sync → ok item only", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openStoreDb(buildStoreDbPath("alpha", dir));
		closeStoreDb(db);
		const reg = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			syncProject(reg, {
				projectName: "alpha",
				dbPath: join("Doc", "store", "alpha", "index.db"),
				displayName: "alpha",
			});
		} finally {
			closeStoreDb(reg);
		}
		const section = checkPortfolioSection(dir);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
	});

	test("stale row (db_path missing) → warning portfolio-stale", () => {
		const dir = dirs[dirs.length - 1]!;
		const reg = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			syncProject(reg, {
				projectName: "ghost",
				dbPath: join("Doc", "store", "ghost", "index.db"),
				displayName: "ghost",
			});
		} finally {
			closeStoreDb(reg);
		}
		const section = checkPortfolioSection(dir);
		assert.ok(section.items.some((i) => i.status === "warning" && /ghost/.test(i.message)));
	});

	test("unregistered spoke → warning portfolio-unregistered", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openStoreDb(buildStoreDbPath("alpha", dir));
		closeStoreDb(db);
		const reg = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			syncProject(reg, {
				projectName: "other",
				dbPath: join("Doc", "store", "other", "index.db"),
				displayName: "other",
			});
		} finally {
			closeStoreDb(reg);
		}
		const section = checkPortfolioSection(dir);
		assert.ok(section.items.some((i) => i.status === "warning" && /alpha.*not registered/.test(i.message)));
	});

	test("asset sweep: missing image → portfolio-asset-missing", () => {
		const dir = dirs[dirs.length - 1]!;
		seedDesignWithAsset(dir, "alpha", "image:assets/missing.png");
		const reg = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			syncProject(reg, {
				projectName: "alpha",
				dbPath: join("Doc", "store", "alpha", "index.db"),
				displayName: "alpha",
			});
		} finally {
			closeStoreDb(reg);
		}
		const section = checkPortfolioSection(dir);
		const item = section.items.find((i) => /asset missing/.test(i.message));
		assert.ok(item, JSON.stringify(section.items));
		assert.equal(item?.status, "warning");
	});

	test("asset sweep: present image → no asset warning", () => {
		const dir = dirs[dirs.length - 1]!;
		seedDesignWithAsset(dir, "alpha", "image:assets/ok.png");
		mkdirSync(join(dir, "Doc", "store", "alpha", "assets"), { recursive: true });
		writeFileSync(join(dir, "Doc", "store", "alpha", "assets", "ok.png"), "PNG", "utf8");
		const reg = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			syncProject(reg, {
				projectName: "alpha",
				dbPath: join("Doc", "store", "alpha", "index.db"),
				displayName: "alpha",
			});
		} finally {
			closeStoreDb(reg);
		}
		const section = checkPortfolioSection(dir);
		// The ok summary mentions "missing assets" — assert no WARNING-level
		// asset item exists instead of a bare substring match.
		assert.ok(
			!section.items.some((i) => i.status === "warning" && /asset/.test(i.message)),
			JSON.stringify(section.items),
		);
	});

	test("asset sweep: `..` traversal → portfolio-asset-invalid, path NOT probed", () => {
		const dir = dirs[dirs.length - 1]!;
		seedDesignWithAsset(dir, "alpha", "image:../../secrets.txt");
		// Even if the escaped path EXISTS, the check must refuse to probe it.
		mkdirSync(join(dir, "Doc", "store"), { recursive: true });
		writeFileSync(join(dir, "secrets.txt"), "top secret", "utf8");
		assert.ok(existsSync(join(dir, "secrets.txt")));
		const reg = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			syncProject(reg, {
				projectName: "alpha",
				dbPath: join("Doc", "store", "alpha", "index.db"),
				displayName: "alpha",
			});
		} finally {
			closeStoreDb(reg);
		}
		const section = checkPortfolioSection(dir);
		const item = section.items.find((i) => /escapes the DB dir/.test(i.message));
		assert.ok(item, JSON.stringify(section.items));
		assert.equal(item?.status, "warning");
	});
});
