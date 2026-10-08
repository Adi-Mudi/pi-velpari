/**
 * Tests — commands/revision-status.ts (v1.2 B6, L3 flow).
 *
 * Mock ExtensionContext.ui: scripted select/input/confirm drive
 * runRevisionStatusFlow against a seeded real store DB (temp dir; git commit
 * is warnings-only outside a repo — commitProtectionChange contract). Covers:
 * restore happy path (withdrawn → published), view-only message for a
 * published revision (zero confirms), declined confirm, empty reason,
 * head-conflict refusal.
 *
 * Note: revisions list newest-first, so the head-conflict case scripts
 * `selectLabel` to pick the WITHDRAWN older revision (default = first label).
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { writeArtifact, publishArtifactCas, type ArtifactPayload } from "../../src/io/store.js";
import type { DatabaseSync } from "node:sqlite";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { withdrawRevision, readRevisionIdentity } from "../../src/ops/protection.js";
import { runRevisionStatusFlow } from "../../src/commands/revision-status.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

interface NotifyRecord {
	message: string;
	severity: string;
}

interface Script {
	input?: string;
	confirms: boolean[];
	/** Exact picker label to choose; default = first label. */
	selectLabel?: string;
}

interface MockCtx extends ExtensionContext {
	notifications: NotifyRecord[];
	confirmCalls: number;
}

/**
 * Mock ExtensionContext recording every notify + confirm call.
 * @param {Script} script - Ordered scripted answers.
 * @returns {MockCtx} Mock ctx with notifications + confirmCalls.
 */
function makeMockCtx(script: Script): MockCtx {
	const notifications: NotifyRecord[] = [];
	let confirmCalls = 0;
	const ctx = {
		notifications,
		/**
		 * Number of ui.confirm calls observed so far.
		 * @returns {number} Confirm call count.
		 */
		get confirmCalls(): number {
			return confirmCalls;
		},
		ui: {
			/**
			 * Record a notification (mock of ctx.ui.notify).
			 * @param {string} message - The notified message.
			 * @param {string} severity - One of info/warning/error.
			 * @returns {void}
			 */
			notify(message: string, severity?: string) {
				notifications.push({ message, severity: severity ?? "info" });
			},
			/**
			 * Non-TUI picker fallback: pick the scripted label, else the first.
			 * @param {_title} _title - Ignored picker title.
			 * @param {string[]} labels - Picker labels.
			 * @returns {Promise<string | undefined>} Chosen label.
			 */
			select(_title: string, labels: string[]): Promise<string | undefined> {
				if (script.selectLabel !== undefined) {
					return Promise.resolve(labels.find((label) => label === script.selectLabel) ?? labels[0]);
				}
				return Promise.resolve(labels[0]);
			},
			/**
			 * Scripted confirm answer (shifts the queue; default false).
			 * @returns {Promise<boolean>} Next scripted answer.
			 */
			confirm(): Promise<boolean> {
				confirmCalls++;
				return Promise.resolve(script.confirms.length > 0 ? script.confirms.shift()! : false);
			},
			/**
			 * Scripted text input (default empty string).
			 * @returns {Promise<string | undefined>} Scripted input.
			 */
			input(): Promise<string | undefined> {
				return Promise.resolve(script.input ?? "");
			},
		},
	};
	return ctx as unknown as MockCtx;
}

/** Minimal PRD payload. */
function prdPayload(): ArtifactPayload {
	return { fr: [{ id: "FR-1", phase: 1, textHash: "h1" }] };
}

let dir: string;
let dbPath: string;
let db: DatabaseSync;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-revision-status-"));
	dbPath = buildStoreDbPath("Project", dir);
	db = openStoreDb(dbPath);
});

after(() => {
	closeStoreDb(db);
	rmSync(dir, { recursive: true, force: true });
});

/**
 * Seed one published prd revision; optionally withdraw it.
 * @param {boolean} withdraw - Withdraw the revision after publish.
 * @returns {number} Revision id.
 */
function seedOne(withdraw: boolean): number {
	writeArtifact(db, "prd", "r1", { version: 1, stage: "drafting-prd", generatedAt: "2026-09-29T00:00:00Z" }, prdPayload());
	const id = publishArtifactCas(db, "r1", "prd", null).revisionId;
	if (withdraw) {
		const out = withdrawRevision(db, { kind: "prd", revisionId: id, reason: "seed", actor: "test" });
		assert.equal(out.ok, true, "seed withdrawal must succeed");
	}
	return id;
}

test("restore happy path: withdrawn → published + head re-point", async () => {
	const id = seedOne(true);
	const ctx = makeMockCtx({ input: "restore after review", confirms: [true] });
	await runRevisionStatusFlow(ctx, dir);

	// warnings may trail the outcome message when git is unusable — find it.
	const outcome = ctx.notifications.find((n) => /restored to published/.test(n.message));
	assert.ok(outcome, `expected restore success, got: ${JSON.stringify(ctx.notifications)}`);
	assert.equal(readRevisionIdentity(db, id)?.status, "published");
});

test("published revision is view-only: zero confirms, guidance message", async () => {
	const id = seedOne(false);
	const ctx = makeMockCtx({ confirms: [] });
	await runRevisionStatusFlow(ctx, dir);

	assert.equal(ctx.confirmCalls, 0, "no confirm for a view-only revision");
	assert.ok(ctx.notifications.some((n) => /view only/.test(n.message)));
	assert.equal(readRevisionIdentity(db, id)?.status, "published");
});

test("declined confirm → still withdrawn, nothing changed", async () => {
	const id = seedOne(true);
	const ctx = makeMockCtx({ input: "restore?", confirms: [false] });
	await runRevisionStatusFlow(ctx, dir);

	assert.ok(ctx.notifications.some((n) => /cancelled/.test(n.message)));
	assert.equal(readRevisionIdentity(db, id)?.status, "withdrawn");
});

test("empty reason → refused before any confirm", async () => {
	const id = seedOne(true);
	const ctx = makeMockCtx({ input: "  ", confirms: [] });
	await runRevisionStatusFlow(ctx, dir);

	assert.ok(ctx.notifications.some((n) => /typed reason/.test(n.message)));
	assert.equal(ctx.confirmCalls, 0, "reason gate runs before the confirm");
	assert.equal(readRevisionIdentity(db, id)?.status, "withdrawn");
});

test("head conflict: restore refused while another revision is head", async () => {
	writeArtifact(db, "prd", "r1", { version: 1, stage: "drafting-prd", generatedAt: "2026-09-29T00:00:00Z" }, prdPayload());
	const v1 = publishArtifactCas(db, "r1", "prd", null).revisionId;
	writeArtifact(db, "prd", "r1", { version: 2, stage: "drafting-prd", generatedAt: "2026-09-29T00:01:00Z" }, prdPayload());
	publishArtifactCas(db, "r1", "prd", v1); // v2 becomes head
	const out = withdrawRevision(db, { kind: "prd", revisionId: v1, reason: "seed", actor: "test" });
	assert.equal(out.ok, true);

	// Revisions list newest-first → script the picker to the withdrawn v1.
	const ctx = makeMockCtx({ input: "restore", confirms: [true], selectLabel: "v1" });
	await runRevisionStatusFlow(ctx, dir);

	assert.ok(
		ctx.notifications.some((n) => n.severity === "error" && /head/.test(n.message)),
		`expected head-conflict refusal, got: ${JSON.stringify(ctx.notifications)}`,
	);
	assert.equal(readRevisionIdentity(db, v1)?.status, "withdrawn");
});
