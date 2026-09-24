// Tests — commands/migrate.ts (Phase 11, the 45th command).
// Mock ExtensionContext.ui drives runMigrateFlow against temp dirs (the
// portfolio-command pattern; registration is covered by
// command-registration.test.ts). Covers: flag parse (both flags = error),
// usage + precondition status, G7 block on an open run (even --dry-run),
// --dry-run writes nothing, --execute confirm gate (declined → nothing
// written; accepted → migrates + commits + re-exports YAML).
// Conventions: temp dirs under TMPDIR (set TMPDIR=/var/tmp locally — /tmp
// tmpfs quota breaks SQLite WAL) + a real git repo (the execute path
// commits; the precheck gates identity like the publish chain).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { parseMigrateArgs, runMigrateFlow } from "../../src/commands/migrate.js";
import { readLatestPublishedRows } from "../../src/io/store.js";
import { buildStoreDbPath, buildStoreYamlPath } from "../../src/core/paths.js";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

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

interface NotifyRecord {
	message: string;
	severity: string;
}

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-migrate-cmd-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function currentDir(): string {
	return dirs[dirs.length - 1]!;
}

function writeLegacyPrd(dir: string): void {
	mkdirSync(join(dir, "Doc", "requirements"), { recursive: true });
	writeFileSync(join(dir, "Doc", "requirements", `PRD_${PROJECT}.md`), PRD_MD, "utf8");
}

function writeOpenRunState(dir: string): void {
	mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(dir, ".pi", "velpari", "state.json"),
		JSON.stringify({ version: 1, runId: "run-open", mission: "m", currentStage: "drafting-prd", updatedAt: "" }),
		"utf8",
	);
}

function gitInit(dir: string): void {
	const run = (args: string[]): void => {
		void spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
	};
	run(["init"]);
	run(["config", "user.email", "test@example.com"]);
	run(["config", "user.name", "Test"]);
	run(["config", "commit.gpgsign", "false"]);
}

function makeCtx(confirmAnswer: boolean): ExtensionCommandContext & { notifications: NotifyRecord[] } {
	const notifications: NotifyRecord[] = [];
	return {
		notifications,
		ui: {
			notify(message: string, severity?: string) {
				notifications.push({ message, severity: severity ?? "info" });
			},
			confirm: async () => confirmAnswer,
		},
	} as unknown as ExtensionCommandContext & { notifications: NotifyRecord[] };
}

describe("parseMigrateArgs", () => {
	test("flags map to modes; both flags reject; none → usage", () => {
		assert.equal(parseMigrateArgs("--dry-run"), "dry-run");
		assert.equal(parseMigrateArgs("--execute"), "execute");
		assert.equal(parseMigrateArgs(""), "usage");
		assert.equal(parseMigrateArgs(undefined), "usage");
		assert.equal(parseMigrateArgs("--dry-run --execute"), null);
	});
});

describe("runMigrateFlow", () => {
	test("usage: no flags → usage text + precheck + discovered projects", async () => {
		const dir = currentDir();
		gitInit(dir);
		writeLegacyPrd(dir);
		const ctx = makeCtx(true);
		await runMigrateFlow(ctx, dir, "usage");
		const note = ctx.notifications.at(-1)!;
		assert.match(note.message, /Usage: \/velpari-migrate-store --dry-run \| --execute/);
		assert.match(note.message, /Precheck: ok/);
		assert.match(note.message, /alpha/);
	});

	test("G7: an open run blocks even --dry-run, naming /velpari-reset", async () => {
		const dir = currentDir();
		writeLegacyPrd(dir);
		writeOpenRunState(dir);
		const ctx = makeCtx(true);
		await runMigrateFlow(ctx, dir, "dry-run");
		const note = ctx.notifications.at(-1)!;
		assert.equal(note.severity, "error");
		assert.match(note.message, /Migration blocked/);
		assert.match(note.message, /velpari-reset/);
	});

	test("dry-run: full report, writes NOTHING", async () => {
		const dir = currentDir();
		gitInit(dir);
		writeLegacyPrd(dir);
		const ctx = makeCtx(true);
		await runMigrateFlow(ctx, dir, "dry-run");
		const note = ctx.notifications.at(-1)!;
		assert.match(note.message, /dry run \(nothing written\)/);
		assert.match(note.message, /would migrate/);
		assert.match(note.message, /alpha/);
		assert.equal(existsSync(buildStoreDbPath(PROJECT, dir)), false, "dry run must not create the store DB");
	});

	test("execute declined → cancelled, nothing written", async () => {
		const dir = currentDir();
		gitInit(dir);
		writeLegacyPrd(dir);
		const ctx = makeCtx(false);
		await runMigrateFlow(ctx, dir, "execute");
		const note = ctx.notifications.at(-1)!;
		assert.match(note.message, /Migration cancelled — nothing written/);
		assert.equal(existsSync(buildStoreDbPath(PROJECT, dir)), false, "a declined confirm must not create the store DB");
	});

	test("execute accepted → migrates under run 'migrated', commits, re-exports YAML", async () => {
		const dir = currentDir();
		gitInit(dir);
		writeLegacyPrd(dir);
		const ctx = makeCtx(true);
		await runMigrateFlow(ctx, dir, "execute");
		const note = ctx.notifications.at(-1)!;
		assert.match(note.message, /alpha — migrated/);
		assert.match(note.message, /commit /);
		assert.match(note.message, /prd: migrated — migrated 4 row\(s\)/);
		// Store: run id `migrated`, published (OQ-P11c).
		const read = readLatestPublishedRows(dir, PROJECT, "prd");
		assert.ok(read, "prd must be readable as newest published rows");
		assert.equal(read.envelope.runId, "migrated");
		assert.equal(read.envelope.status, "published");
		// YAML beside the DB (the runbook rebuild source).
		assert.equal(existsSync(buildStoreYamlPath(PROJECT, "PRD", dir)), true, "PRD YAML must exist beside the DB");
		// The per-project migration commit (Design 3b).
		const log = spawnSync("git", ["log", "--format=%s", "-1"], { cwd: dir, encoding: "utf-8" });
		assert.match(log.stdout, /velpari\(migrate\): alpha \(run migrated\)/);
	});
});
