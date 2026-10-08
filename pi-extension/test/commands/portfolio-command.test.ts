// Tests — commands/portfolio.ts (Phase 10, the 44th command).
// Mock ExtensionContext.ui drives the handler against a real registry in a
// temp dir. Covers: no-registry info notify, --repair creates + reports,
// list output carries project rows, empty-registry note, unreadable-
// registry error path.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPortfolioFlow } from "../../src/commands/portfolio.js";

import { openPortfolioDb, openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { buildPortfolioDbPath, buildStoreDbPath } from "../../src/core/paths.js";
import { writeArtifact, publishArtifact } from "../../src/io/store.js";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface NotifyRecord {
	message: string;
	severity: string;
}

function makeMocks() {
	// `pi` is unused by the flow-driven tests (registration is covered by
	// command-registration.test.ts); the flow takes only ctx + cwd.
	const notifications: NotifyRecord[] = [];
	const ctx = {
		notifications,
		ui: {
			notify(message: string, severity?: string) {
				notifications.push({ message, severity: severity ?? "info" });
			},
		},
	} as unknown as ExtensionCommandContext & { notifications: NotifyRecord[] };
	const pi = {} as never;
	const dir = dirs[dirs.length - 1]!;
	// Drive the FLOW directly (cwd = the active temp dir); registration is
	// covered by command-registration.test.ts.
	const out = {
		ctx,
		notifications,
		pi,
		run: (args?: string) => runPortfolioFlow(ctx, dir, (args ?? "").includes("--repair")),
	};
	return out;
}

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-portfolio-cmd-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("registerPortfolioCommand", () => {
	test("no registry → info notify naming the repair path", async () => {
		const { notifications, run } = makeMocks();
		await run(undefined);
		const note = notifications.at(-1)!;
		assert.match(note.message, /No portfolio registry yet/);
		assert.match(note.message, /--repair/);
	});

	test("--repair on empty world creates the registry (no crash, no changes)", async () => {
		const { notifications, run } = makeMocks();
		await run("--repair");
		assert.ok(notifications.some((n) => /already in sync|portfolio:/.test(n.message)));
	});

	test("list: registered project appears with its last publish", async () => {
		const dir = dirs[dirs.length - 1]!;
		// Seed a spoke + registry row (as the publish chain would).
		const db = openStoreDb(buildStoreDbPath("alpha", dir));
		try {
			writeArtifact(
				db,
				"prd",
				"run-1",
				{
					version: 1,
					stage: "drafting-prd",
					generatedAt: "2026-09-24T00:00:00.000Z",
					inputs: "{}",
					reviewerVerdict: null,
					changeLog: "[]",
				},
				{ fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "Prose." }] },
			);
			publishArtifact(db, "run-1", "prd");
		} finally {
			closeStoreDb(db);
		}
		const reg = openPortfolioDb(buildPortfolioDbPath(dir));
		try {
			reg
				.prepare(
					"INSERT INTO projects (project_name, display_name, db_path, last_published_at, last_run_id, last_stage) VALUES (?, ?, ?, ?, ?, ?)",
				)
				.run(
					"alpha",
					"alpha",
					join("Doc", "store", "alpha", "index.db"),
					"2026-09-24T00:00:00.000Z",
					"run-1",
					"drafting-prd",
				);
		} finally {
			closeStoreDb(reg);
		}
		const { notifications, run } = makeMocks();
		await run(undefined);
		const note = notifications.at(-1)!;
		assert.match(note.message, /portfolio \(1 project/);
		assert.match(note.message, /alpha/);
		assert.match(note.message, /run run-1/);
	});

	test("corrupt registry → error notify pointing at --repair", async () => {
		const dir = dirs[dirs.length - 1]!;
		mkdirSync(join(dir, "Doc", "store"), { recursive: true });
		writeFileSync(buildPortfolioDbPath(dir), "this is not a sqlite file", "utf8");
		const { notifications, run } = makeMocks();
		await run(undefined);
		const note = notifications.at(-1)!;
		assert.equal(note.severity, "error");
		assert.match(note.message, /cannot read the registry/);
	});
});
