/**
 * N29 — store-backed version metadata in the architect-inputs.json payload,
 * exercised via runHandoff.
 *
 * Asserts:
 *   (a) a seeded store with published heads → every document carries a
 *       numeric `version` + `revisionId`/`revisionNumber` matching
 *       getHeadRevision for its kind;
 *   (b) after runHandoff succeeds: every document is `frozen: true` with
 *       `freezeReason: "handoff (N4)"` (decision-6 order proof: freeze →
 *       refresh → write), the store rows are frozen, and the stage
 *       advanced to `handoff-ready`;
 *   (c) NO store (legacy fixture) → the keys are present with null/false,
 *       no throw, payload written;
 *   (d) a wireframe file → 11th `Wireframe` document with metadata;
 *   (e) no wireframe file → exactly 10 documents (backend unchanged);
 *   (f) validateSenaiSchema passes on a legacy payload WITHOUT the new
 *       keys AND on the new payload (and rejects a wrong-typed key);
 *   (g) corrupt store → freeze fails → payload NOT written, stage not
 *       advanced, message names N4.
 *
 * Fixture recipes: test/integration/handoff-lanes.test.ts (state/config/
 * doc seeds + confirm ctx) + raw-SQL store seeding (the lanes recipe — no
 * git repo needed; freeze + read paths don't require one).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runHandoff, validateSenaiSchema, type ArchitectInputs } from "../../src/ops/handoff.js";
import { VELPARI_STORE_KINDS } from "../../src/ops/freeze.js";
import { loadState, saveState, type RunState } from "../../src/core/state.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { getHeadRevision, type ArtifactKind } from "../../src/io/store.js";

const PROJECT = "MetaApp";
const RUN = "meta-run";

let cwd: string;

function seedState(patch: Partial<RunState> = {}): void {
	const state: RunState = {
		version: 1,
		runId: RUN,
		mission: "metadata mission",
		currentStage: "finalized-design",
		history: [],
		updatedAt: new Date().toISOString(),
		...patch,
	};
	saveState(state, cwd);
}

function seedConfig(): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "velpari", "files.json"),
		JSON.stringify({
			version: 4,
			projectName: PROJECT,
			codePaths: ["src/"],
			testPaths: ["test/"],
			docPaths: ["Doc/"],
			excludedPaths: [],
		}),
	);
}

function seedAllRequiredDocs(): void {
	for (const dir of ["requirements", "feasibility", "design", "atomic-functions", "pseudocode", "tests", "development-order"]) {
		mkdirSync(join(cwd, "Doc", dir), { recursive: true });
	}
	const stub = "## section\n\nbody";
	writeFileSync(join(cwd, "Doc", "requirements", `PRD_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "requirements", `RTM_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "feasibility", `feasibility-study_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "design", `design_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "atomic-functions", `atomic-functions_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "pseudocode", `pseudocode_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "tests", `test-plan_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "tests", `test-cases_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "development-order", `development-order_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "design", `final-design_${PROJECT}.md`), stub);
}

/**
 * Seed a published envelope + head revision for EVERY store kind via raw
 * SQL (no git repo, no payload-shape coupling). Returns the heads so the
 * payload can be compared against getHeadRevision.
 */
function seedStoreWithHeads(): void {
	const db = openStoreDb(buildStoreDbPath(PROJECT, cwd));
	try {
		for (const kind of VELPARI_STORE_KINDS) {
			db.prepare(
				`INSERT INTO artifacts
				 (run_id, kind, version, stage, generated_at, sha256_fingerprint, inputs, change_log, status)
				 VALUES (?, ?, 1, 'finalized-design', '2026-09-28T00:00:00Z', 'f', '{}', '[]', 'published')`,
			).run(RUN, kind);
			const inserted = db
				.prepare(
					`INSERT INTO artifact_revisions
					 (kind, run_id, revision_number, status, version, stage, generated_at, published_at, sha256_fingerprint, inputs, change_log, yaml_bytes)
					 VALUES (?, ?, 1, 'published', 1, 'finalized-design', '2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z', 'f', '{}', '[]', '')`,
				)
				.run(kind, RUN);
			const revisionId = Number(inserted.lastInsertRowid);
			db.prepare("UPDATE artifacts SET head_revision_id = ? WHERE run_id = ? AND kind = ?").run(revisionId, RUN, kind);
		}
	} finally {
		closeStoreDb(db);
	}
}

interface Notice {
	msg: string;
	level: string;
}

function makeCtx(): { ctx: never; notices: Notice[] } {
	const notices: Notice[] = [];
	return {
		ctx: {
			ui: {
				notify: (msg: string, level: string) => {
					notices.push({ msg, level });
				},
				setStatus: () => {},
				confirm: async () => true,
			},
		} as never,
		notices,
	};
}

function allMessages(notices: Notice[]): string {
	return notices.map((n) => n.msg).join("\n");
}

function readPayload(): ArchitectInputs {
	const payloadPath = join(cwd, ".pi", "senai", "architect-inputs.json");
	assert.ok(existsSync(payloadPath), "architect-inputs.json should exist");
	return JSON.parse(readFileSync(payloadPath, "utf8")) as ArchitectInputs;
}

function payloadPathAbs(): string {
	return join(cwd, ".pi", "senai", "architect-inputs.json");
}

/** Document type → store kind (mirrors ARTIFACT_TO_KIND for assertions). */
const TYPE_TO_KIND: Record<string, ArtifactKind> = {
	PRD: "prd",
	RTM: "rtm",
	"Feasibility Study": "feasibility",
	Design: "design",
	"Atomic Functions": "atomic-functions",
	Pseudocode: "pseudocode",
	"Test Plan": "testplan",
	"Test Cases": "testplan",
	"Development Order": "development-order",
	"Final Design": "final-design",
	Wireframe: "design",
};

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "vp-handoff-version-meta-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("runHandoff — N29 per-document version metadata", () => {
	it("(a) seeded store → every document carries version + revisionId matching getHeadRevision", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		seedStoreWithHeads();

		const { ctx } = makeCtx();
		await runHandoff(loadState(cwd), ctx, cwd);
		const payload = readPayload();

		assert.equal(validateSenaiSchema(payload), true);
		assert.ok(payload.documents.length >= 10, "the 10 required documents are present");
		for (const doc of payload.documents) {
			const kind = TYPE_TO_KIND[doc.type];
			assert.ok(kind, `unexpected document type ${doc.type}`);
			assert.equal(typeof doc.version, "number", `${doc.type}: version must be numeric`);
			assert.equal(typeof doc.revisionId, "number", `${doc.type}: revisionId must be numeric`);
			assert.equal(typeof doc.revisionNumber, "number", `${doc.type}: revisionNumber must be numeric`);

			const db = openStoreDb(buildStoreDbPath(PROJECT, cwd));
			try {
				const head = getHeadRevision(db, RUN, kind);
				assert.ok(head, `${kind} must have a head revision`);
				assert.equal(doc.revisionId, head.revisionId, `${doc.type}: revisionId must match getHeadRevision`);
				assert.equal(doc.revisionNumber, head.revisionNumber, `${doc.type}: revisionNumber must match`);
				assert.equal(doc.version, 1, `${doc.type}: envelope version`);
			} finally {
				closeStoreDb(db);
			}
		}
	});

	it("(b) freeze → refresh → write: documents state post-freeze truth; store frozen; stage advanced", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		seedStoreWithHeads();

		const { ctx, notices } = makeCtx();
		await runHandoff(loadState(cwd), ctx, cwd);
		const payload = readPayload();

		for (const doc of payload.documents) {
			assert.equal(doc.frozen, true, `${doc.type} must be frozen in the written payload`);
			assert.equal(doc.freezeReason, "handoff (N4)", `${doc.type} must carry the N4 freeze reason`);
		}

		// Store rows are frozen too (the payload never outpaces the store).
		const db = openStoreDb(buildStoreDbPath(PROJECT, cwd));
		try {
			const rows = db
				.prepare("SELECT kind, frozen, freeze_reason FROM artifacts WHERE run_id = ?")
				.all(RUN) as Array<{ kind: string; frozen: number; freeze_reason: string | null }>;
			assert.ok(rows.length >= VELPARI_STORE_KINDS.length, "every kind has a row");
			for (const row of rows) {
				assert.equal(row.frozen, 1, `${row.kind} row must be frozen`);
				assert.equal(row.freeze_reason, "handoff (N4)");
			}
		} finally {
			closeStoreDb(db);
		}

		assert.match(allMessages(notices), /Handoff freeze: \d+ artifact kind\(s\) frozen/);
		assert.match(allMessages(notices), /Handoff written to/);
		assert.equal(loadState(cwd).currentStage, "handoff-ready", "stage must advance after the write");
	});

	it("(c) NO store (legacy fixture) → keys present with null/false, no throw", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();

		const { ctx } = makeCtx();
		await runHandoff(loadState(cwd), ctx, cwd);
		const payload = readPayload();

		assert.ok(payload.documents.length >= 10);
		for (const doc of payload.documents) {
			assert.equal(Object.hasOwn(doc, "version"), true, `${doc.type}: version key must be present`);
			assert.equal(doc.version, null, `${doc.type}: no store row → null version`);
			assert.equal(doc.revisionId, null);
			assert.equal(doc.revisionNumber, null);
			assert.equal(doc.frozen, false, `${doc.type}: no store row → frozen false`);
			assert.equal(doc.freezeReason, null);
		}
		assert.equal(validateSenaiSchema(payload), true);
		assert.equal(loadState(cwd).currentStage, "handoff-ready");
	});

	it("(d) wireframe file seeded → 11th Wireframe document with metadata", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		seedStoreWithHeads();
		writeFileSync(join(cwd, "Doc", "design", `wireframe_${PROJECT}.md`), "# Wireframe\n", "utf8");

		const { ctx } = makeCtx();
		await runHandoff(loadState(cwd), ctx, cwd);
		const payload = readPayload();

		assert.equal(payload.documents.length, 11, "wireframe joins as the 11th document");
		const wireframe = payload.documents.find((d) => d.type === "Wireframe");
		assert.ok(wireframe, "Wireframe entry must be present");
		assert.ok(wireframe.path.endsWith(join("Doc", "design", `wireframe_${PROJECT}.md`)));
		// The wireframe rides the design envelope → shares the design meta.
		const design = payload.documents.find((d) => d.type === "Design");
		assert.ok(design);
		assert.equal(wireframe.version, design.version);
		assert.equal(wireframe.revisionId, design.revisionId);
		assert.equal(wireframe.frozen, true, "wireframe meta follows the design envelope freeze");
		assert.equal(wireframe.freezeReason, "handoff (N4)");
		assert.equal(validateSenaiSchema(payload), true);
	});

	it("(e) no wireframe file → exactly 10 documents (backend unchanged)", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		seedStoreWithHeads();

		const { ctx } = makeCtx();
		await runHandoff(loadState(cwd), ctx, cwd);
		const payload = readPayload();

		assert.equal(payload.documents.length, 10, "backend projects keep exactly 10 documents");
		assert.equal(payload.documents.some((d) => d.type === "Wireframe"), false);
	});

	it("(f) validateSenaiSchema: legacy payload without the keys passes; new payload passes; wrong type rejected", async () => {
		const legacy = {
			version: 1,
			projectName: PROJECT,
			createdAt: new Date().toISOString(),
			mission: "m",
			documents: [{ type: "PRD", path: "Doc/requirements/PRD_x.md" }],
			architectureDecisions: [],
			standardsProfile: null,
		};
		assert.equal(validateSenaiSchema(legacy), true, "legacy payload without N29 keys must pass");

		seedState();
		seedConfig();
		seedAllRequiredDocs();
		seedStoreWithHeads();
		const { ctx } = makeCtx();
		await runHandoff(loadState(cwd), ctx, cwd);
		assert.equal(validateSenaiSchema(readPayload()), true, "the new payload must pass");

		const wrongType = {
			...legacy,
			documents: [{ type: "PRD", path: "Doc/requirements/PRD_x.md", version: "one" }],
		};
		assert.throws(() => validateSenaiSchema(wrongType), /version must be a number or null/);
	});

	it("(g) broken store → freeze fails → payload NOT written, stage not advanced, message names N4", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		seedStoreWithHeads();
		// Freeze-failure fixture: the audit ledger is GONE, so the freeze's
		// audit write throws. The store stays READABLE on purpose — a fully
		// corrupt file would crash the pre-existing, unguarded store open in
		// the MVP gate (readLatestPublishedRows → io/store.ts, out of Phase D
		// scope) long before the freeze runs. Same assertion set as the plan's
		// corrupt-store case: freeze failure ⇒ payload unwritten + no advance.
		const db = openStoreDb(buildStoreDbPath(PROJECT, cwd));
		try {
			db.exec("DROP TABLE audit_ledger");
		} finally {
			closeStoreDb(db);
		}

		const { ctx, notices } = makeCtx();
		await runHandoff(loadState(cwd), ctx, cwd);

		assert.ok(!existsSync(payloadPathAbs()), "a failed freeze must leave the payload unwritten");
		assert.equal(loadState(cwd).currentStage, "finalized-design", "stage must not advance");
		assert.match(allMessages(notices), /Handoff freeze failed/);
		assert.match(allMessages(notices), /N4/);
	});
});
