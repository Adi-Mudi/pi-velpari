/**
 * ops/self-heal tests (Phase C, plan Subphase 3.4 — N23 / G8).
 *
 * (a) no drift on healthy fixtures; (b) in-stage + published evidence
 * this run → drift found (brainstorm file evidence AND store-envelope
 * evidence); (c) apply advances via `advanceStage` with the history
 * line; (d) evidence from ANOTHER runId or absent → NO drift; (e) NEVER
 * for content states (handoff transitions untouched); (f) scaffold
 * creates only the listed paths, second run idempotent; (g) import scan:
 * self-heal.ts imports no approve/publish machinery (publish invariant).
 *
 * Store fixtures are REAL SQLite (openStoreDb + writeArtifact +
 * publishArtifact — driver behavior, no mocks).
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
	applyBookkeepingAdvance,
	detectBookkeepingDrift,
	ensureStandardScaffold,
} from "../../src/ops/self-heal.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { loadState } from "../../src/core/state.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { publishArtifact, readArtifact, writeArtifact, type ArtifactEnvelopeInput } from "../../src/io/store.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(path.join(os.tmpdir(), "velpari-self-heal-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

/** Write the minimal run state. */
function writeState(runId: string, currentStage: string): void {
	mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "state.json"),
		JSON.stringify({
			version: 1,
			runId,
			mission: "self-heal mission",
			currentStage,
			history: [],
			updatedAt: new Date().toISOString(),
		}),
		"utf8",
	);
}

/** Publish brainstorm notes stamped with `run: <runId>` (file-based stage). */
function publishNotes(runId: string): void {
	const dir = path.join(tmpDir, "Doc", "brainstorm");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, "brainstorm-self-heal.md"),
		`---\nartifact: brainstorm\nproject: self-heal\nstage: brainstorming\nrun: ${runId}\n---\n\n# Notes\n`,
		"utf8",
	);
}

/** Seed a published PRD envelope for `runId` in the real store. */
function publishPrd(runId: string): void {
	mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "HealApp" }),
		"utf8",
	);
	const dbPath = buildStoreDbPath("HealApp", tmpDir);
	const db = openStoreDb(dbPath);
	try {
		const envelope: ArtifactEnvelopeInput = {
			version: 1,
			stage: "drafting-prd",
			generatedAt: "2026-09-28T00:00:00Z",
			inputs: "{}",
			reviewerVerdict: null,
			changeLog: "[]",
		};
		writeArtifact(db, "prd", runId, envelope, {
			fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: null }],
		});
		publishArtifact(db, runId, "prd");
	} finally {
		closeStoreDb(db);
	}
}

describe("detectBookkeepingDrift", () => {
	it("(a) healthy fixture → no drift (no state file)", () => {
		assert.deepEqual(detectBookkeepingDrift(tmpDir), []);
	});

	it("(a) run present but stage is not an in-stage → no drift", () => {
		writeState("run-1", "drafted-prd");
		publishNotes("run-1");
		assert.deepEqual(detectBookkeepingDrift(tmpDir), []);
	});

	it("(b) brainstorming + notes stamped this run → drift found", () => {
		writeState("run-1", "brainstorming");
		publishNotes("run-1");
		const drift = detectBookkeepingDrift(tmpDir);
		assert.equal(drift.length, 1);
		assert.equal(drift[0]!.from, "brainstorming");
		assert.equal(drift[0]!.to, "brainstormed");
		assert.equal(drift[0]!.command, "/velpari-approve-brainstorm");
		assert.match(drift[0]!.evidence, /stamped run run-1/);
	});

	it("(b) drafting-prd + store PRD published this run → drift found", () => {
		writeState("run-1", "drafting-prd");
		publishPrd("run-1");
		const drift = detectBookkeepingDrift(tmpDir);
		assert.equal(drift.length, 1);
		assert.equal(drift[0]!.from, "drafting-prd");
		assert.equal(drift[0]!.to, "drafted-prd");
		assert.equal(drift[0]!.command, "/velpari-prd-approve");
		assert.match(drift[0]!.evidence, /store head prd v1 belongs to run run-1/);
	});

	it("(d) evidence from ANOTHER runId → NO drift", () => {
		writeState("run-1", "drafting-prd");
		publishPrd("run-other");
		assert.deepEqual(detectBookkeepingDrift(tmpDir), []);
	});

	it("(d) notes from another run → NO drift", () => {
		writeState("run-1", "brainstorming");
		publishNotes("run-other");
		assert.deepEqual(detectBookkeepingDrift(tmpDir), []);
	});

	it("(d) no evidence at all → NO drift", () => {
		writeState("run-1", "drafting-prd");
		assert.deepEqual(detectBookkeepingDrift(tmpDir), []);
	});

	it("(e) content states never drift — handoff transition untouched", () => {
		// finalized-design's only transition is /velpari-handoff (no approve)
		// and evidence exists — still ZERO drift (never auto-handoff).
		writeState("run-1", "finalized-design");
		publishNotes("run-1");
		assert.deepEqual(detectBookkeepingDrift(tmpDir), []);
	});

	it("(e) stage-start transitions (no approve) never drift", () => {
		// designed → analyzing-atomic-functions is /velpari-atomic-function
		// (stage start, not a publish) — evidence present, still no drift.
		writeState("run-1", "designed");
		publishNotes("run-1");
		assert.deepEqual(detectBookkeepingDrift(tmpDir), []);
	});
});

describe("applyBookkeepingAdvance", () => {
	it("(c) applies via advanceStage — stage advances + history line written", () => {
		writeState("run-1", "brainstorming");
		publishNotes("run-1");
		const drift = detectBookkeepingDrift(tmpDir);
		assert.equal(drift.length, 1);

		const result = applyBookkeepingAdvance(tmpDir, drift[0]!);
		assert.equal(result.ok, true, result.message);
		assert.match(result.message, /brainstorming → brainstormed via \/velpari-approve-brainstorm/);

		const state = loadState(tmpDir);
		assert.equal(state.currentStage, "brainstormed");
		// Per-run history.jsonl written through the normal state path —
		// state.json no longer carries history[] (legacy migration moves it).
		const historyFile = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "run-1", "history.jsonl");
		assert.ok(existsSync(historyFile), "history.jsonl must exist");
		const lines = readFileSync(historyFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { stage: string; command: string });
		const last = lines.at(-1);
		assert.equal(last?.command, "/velpari-approve-brainstorm");
		assert.equal(last?.stage, "brainstormed");
	});

	it("stage already moved → no-op, ok=false", () => {
		writeState("run-1", "brainstorming");
		publishNotes("run-1");
		const drift = detectBookkeepingDrift(tmpDir)[0]!;
		writeState("run-1", "brainstormed"); // someone/something else advanced
		const result = applyBookkeepingAdvance(tmpDir, drift);
		assert.equal(result.ok, false);
		assert.match(result.message, /already moved/);
		assert.equal(loadState(tmpDir).currentStage, "brainstormed");
	});

	it("no run state → ok=false, never throws", () => {
		const result = applyBookkeepingAdvance(tmpDir, {
			from: "brainstorming",
			to: "brainstormed",
			command: "/velpari-approve-brainstorm",
			evidence: "n/a",
		});
		assert.equal(result.ok, false);
	});
});

describe("ensureStandardScaffold", () => {
	it("(f) creates only the listed paths; second run idempotent", () => {
		const result = ensureStandardScaffold(tmpDir);
		assert.ok(result.created.length > 0);
		// Every created path is on the allowed list.
		const allowed = new Set<string>([
			".IDE_Plans/velpari",
			".IDE_Plans/velpari/runs",
			".pi/velpari/config-manifest.json",
		]);
		for (const cat of ["requirements", "feasibility", "design", "pseudocode", "tests", "atomic-functions", "development-order", "observability"]) {
			allowed.add(path.join("Doc", cat));
		}
		for (const rel of result.created) {
			assert.ok(allowed.has(rel), `unexpected created path: ${rel}`);
		}
		// Never writes config CONTENT (that's /velpari-configure-inputs).
		assert.ok(!existsSync(path.join(tmpDir, ".pi", "velpari", "files.json")), "must not create files.json");
		assert.ok(!existsSync(path.join(tmpDir, ".pi", "velpari", "agents.json")), "must not create agents.json");
		assert.ok(existsSync(path.join(tmpDir, ".IDE_Plans", "velpari", "runs")));
		assert.ok(existsSync(path.join(tmpDir, "Doc", "requirements")));

		const again = ensureStandardScaffold(tmpDir);
		assert.deepEqual(again.created, [], "second run must be idempotent");
		assert.match(again.message, /already present/);
	});
});

describe("(g) publish invariant — import scan", () => {
	it("self-heal.ts imports no approve/publish machinery", () => {
		// Test lives at dist/pi-extension/test/ops/ → ../../src/ops/self-heal.js
		const src = readFileSync(fileURLToPath(new URL("../../src/ops/self-heal.js", import.meta.url)), "utf8");
		const forbidden = [/from\s+"[^"]*\/approve[^"]*"/, /from\s+"[^"]*stage-publish-tool[^"]*"/, /from\s+"[^"]*doctor\/gate[^"]*"/];
		for (const re of forbidden) {
			assert.ok(!re.test(src), `self-heal.ts must not import matches of ${re}`);
		}
	});

	it("remediate fns for bookkeeping do not import approve/publish either", () => {
		const src = readFileSync(
			fileURLToPath(new URL("../../src/doctor/checks/remediate/bookkeeping-advance.js", import.meta.url)),
			"utf8",
		);
		assert.ok(!/from\s+"[^"]*\/approve[^"]*"/.test(src));
		assert.ok(!/from\s+"[^"]*stage-publish-tool[^"]*"/.test(src));
	});
});

describe("store fixture sanity", () => {
	it("publishPrd leaves exactly one published head", () => {
		publishPrd("run-1");
		const db = openStoreDb(buildStoreDbPath("HealApp", tmpDir));
		try {
			const read = readArtifact(db, "run-1", "prd");
			assert.ok(read, "published PRD must be readable");
			assert.equal(read.envelope.status, "published");
		} finally {
			closeStoreDb(db);
		}
		// Sanity: the fixture dir really is a temp dir (no cross-test bleed).
		assert.ok(readdirSync(tmpDir).includes(".pi"));
	});
});
