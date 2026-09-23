// Unit tests — view/show.ts DB-primary rendering (Phase 6, Subphase 3.5).
// Covers: show-prd / show-rtm render the project store's newest published
// rows via the Phase 5 renderers (with a "rendered from the project store"
// note), and the legacy Doc/ file read is the fallback VIEW when the store
// has no published rows for the kind. Brainstorm (file-based) unchanged.
// Conventions: temp dirs under the workspace (local /tmp quota breaks
// SQLite WAL — see Phase 3 retrospective) + real openStoreDb.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import {
	writeArtifact,
	publishArtifact,
	type ArtifactEnvelopeInput,
} from "../../src/io/store.js";
import { showPrd, showRtm, showTestplan } from "../../src/view/show.js";
import { buildStoreDbPath } from "../../src/core/paths.js";

const PROJECT = "alpha";

/** Collect-notify mock of ExtensionCommandContext.ui. */
function mockCtx() {
	const messages: { text: string; level: string }[] = [];
	const ctx = {
		ui: {
			notify: (text: string, level: string) => {
				messages.push({ text, level });
			},
		},
	} as unknown as ExtensionCommandContext;
	return { messages, ctx };
}

function env(overrides: Partial<ArtifactEnvelopeInput> = {}): ArtifactEnvelopeInput {
	return {
		version: 1,
		stage: "drafting-prd",
		generatedAt: "2026-09-23T00:00:00Z",
		inputs: "{}",
		reviewerVerdict: null,
		changeLog: "[]",
		...overrides,
	};
}

describe("view/show — DB-primary rendering", () => {
	let dirs: string[] = [];

	beforeEach(() => {
		const dir = mkdtempSync(join(process.cwd(), ".tmp-show-"));
		dirs.push(dir);
		mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			join(dir, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: PROJECT }),
			"utf8",
		);
	});

	after(() => {
		for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	});

	function seedStore(dir: string): void {
		const dbPath = buildStoreDbPath(PROJECT, dir);
		const db = openStoreDb(dbPath);
		try {
			writeArtifact(db, "prd", "r1", env(), {
				fr: [{ id: "FR-1", phase: 1, textHash: "h1", text: "The system shall parse" }],
				nfr: [{ id: "NFR-1", phase: 1, textHash: "h2", text: "Fast" }],
				prdSection: [{ no: 1, title: "Purpose", body: "Why we build" }],
			});
			publishArtifact(db, "r1", "prd");
		} finally {
			closeStoreDb(db);
		}
	}

	test("1. show-prd renders the newest published prd rows from the store", async () => {
		const dir = dirs[dirs.length - 1]!;
		seedStore(dir);
		const { ctx, messages } = mockCtx();
		await showPrd(ctx, dir);
		const emitted = messages.map((m) => m.text).join("\n");
		assert.ok(emitted.includes("The system shall parse"));
		assert.ok(emitted.includes("Why we build"));
		assert.ok(emitted.match(/rendered from the project store/));
	});

	test("2. show-rtm falls back to the legacy Doc/ file when the store is absent", async () => {
		const dir = dirs[dirs.length - 1]!;
		mkdirSync(join(dir, "Doc", "requirements"), { recursive: true });
		writeFileSync(
			join(dir, "Doc", "requirements", `RTM_${PROJECT}.md`),
			"| ID | FR |\n|---|---|\n| R-1 | FR-1 |",
			"utf8",
		);
		const { ctx, messages } = mockCtx();
		await showRtm(ctx, dir);
		const emitted = messages.map((m) => m.text).join("\n");
		assert.ok(emitted.includes("R-1"));
		assert.ok(!emitted.includes("rendered from the project store"));
	});

	test("3. show-testplan renders plan + cases projections from one testplan kind", async () => {
		const dir = dirs[dirs.length - 1]!;
		const dbPath = buildStoreDbPath(PROJECT, dir);
		const db = openStoreDb(dbPath);
		try {
			writeArtifact(db, "testplan", "r1", { ...env(), stage: "planning-tests" }, {
				testCase: [
					{
						id: "TC-1",
						tcKind: "TC",
						strategyRef: "S-1",
						steps: "run parse",
						objective: "verify parse",
						expected: "tokens out",
					},
				],
				tcTrace: [{ tcId: "TC-1", targetKind: "af", targetId: "AF-1" }],
			});
			publishArtifact(db, "r1", "testplan");
		} finally {
			closeStoreDb(db);
		}
		const { ctx, messages } = mockCtx();
		await showTestplan(ctx, dir);
		const emitted = messages.map((m) => m.text).join("\n");
		assert.ok(emitted.includes("verify parse"));
		assert.ok(emitted.includes("tokens out"));
		assert.ok(emitted.includes("AF-1"));
	});
});
