/**
 * Publish gate tests (RTM traceability upgrade, Phase 5).
 *
 * The doctor's artifact checks run INSIDE handleApprove (called by the
 * publish tool or the per-stage fall-back command):
 *   - an invalid PRD working copy (validatePsrs) is blocked — nothing
 *     is written, the stage does not advance
 *   - an RTM JSON sidecar with an unknown id is blocked
 *   - an RTM JSON sidecar missing a PSRS requirement (orphan, NFR-04)
 *     is blocked
 *   - a clean RTM sidecar publishes BOTH the regenerated markdown and
 *     the JSON (with fingerprints stamped)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";
import { parseFrontmatterBlock } from "../../src/core/frontmatter.js";
import { hashFileContent } from "../../src/core/fingerprints.js";
import { loadFreshnessManifest } from "../../src/core/freshness.js";
import { readYamlFile } from "../../src/core/yaml-data.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { writeArtifact, type ArtifactPayload } from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";

interface Notice {
	message: string;
	level: string;
}

let tmpDir: string;
let notices: Notice[];

/**
 * Build a minimal ExtensionCommandContext whose `ui.notify` captures
 * every message into the module-level `notices` array for assertions.
 * `ui.setStatus` is a no-op (footer status is irrelevant here).
 * @returns {ExtensionCommandContext} The mock context for handleApprove.
 */
function makeCtx(): ExtensionCommandContext {
	notices = [];
	return {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
			setStatus: () => {},
		},
	} as unknown as ExtensionCommandContext;
}

/**
 * Concatenate every captured `ui.notify` message into one string for
 * `assert.match` patterns.
 * @returns {string} All captured messages joined by `\n`.
 */
function allMessages(): string {
	return notices.map((n) => n.message).join("\n");
}

const PSRS = [
	"# PSRS",
	"",
	"## Functional Requirements",
	"",
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|---|",
	"| FR-01 | When a user submits an expense, the system SHALL save it | must | 1 | expense saved | Integration test | proposed |",
	"| FR-02 | The system SHALL list expenses | should | 1 | list shown | Unit test | proposed |",
	"",
	"## Non-Functional Requirements",
	"",
	"| ID | Category | Requirement | Phase | Verification | Status |",
	"|---|---|---|---|---|---|",
	"| NFR-01 | performance | p95 SHALL stay < 200ms | 1 | Performance test | proposed |",
	"",
].join("\n");

/**
 * Build the legacy RTM sidecar JSON text (used by the backward-compat
 * `rtmJsonAsPayload` helper). The publish path ignores this format in
 * Phase 6, but the helper stays so the test data flows through one
 * place — the payload adapter derives the v001-DDL rows from the same
 * `ids` list.
 * @param {string[]} ids - The requirement ids each row should cover.
 * @param {Record<string, number>} [phases={}] - Per-id phase overrides (for the phase-mismatch gate test).
 * @returns {string} The JSON text for a legacy RTM sidecar.
 */
function rtmJson(ids: string[], phases: Record<string, number> = {}): string {
	return JSON.stringify({
		project: "TestApp",
		version: "1.0.0",
		rows: ids.map((id) => ({
			id,
			title: `${id} title`,
			phase: phases[id] ?? 1,
			design: "",
			implementation: "",
			tests: [],
			status: "proposed",
			coverage: "covered",
		})),
	});
}

/**
 * Phase 6 (decision §14): RTM is DB-primary. The legacy sidecar JSON
 * is no longer the publish source — the working copy must carry a
 * `payload/rtm-payload.json`. Rows mirror the v001 DDL shape (`id`,
 * `frRef`, `phase`, `targetSha256`, ...). The publish gate's RTM
 * checks (fingerprint binding + phase consistency) read from the DB
 * rows after `writeArtifact` lands.
 */
function rtmPayload(ids: string[], phases: Record<string, number> = {}): string {
	return JSON.stringify({
		envelope: {
			version: 1,
			stage: "building-rtm",
			generatedAt: "2026-09-22T00:00:00Z",
			inputs: "{}",
			reviewerVerdict: null,
			changeLog: "[]",
		},
		rows: {
			rtmRow: ids.map((id) => ({
				id,
				frRef: id,
				phase: phases[id] ?? 1,
				targetSha256: "f".repeat(64),
			})),
		},
	});
}

/**
 * Absolute path of the active run folder under `.IDE_Plans/velpari/runs/`.
 * @returns {string} The runDir for the current run id.
 */
function runDir(): string {
	return path.join(tmpDir, ".IDE_Plans", "velpari", "runs", loadState(tmpDir).runId);
}

/**
 * Move the state machine into the PRD drafting stage and seed the
 * working copy with the supplied PSRS-style markdown + a valid payload.
 * Phase 6 (§14): PRD is DB-primary; the working copy must carry a
 * payload JSON. The legacy sidecar is RETIRED.
 * @param {string} workingContent - The full PRD markdown to write as the working copy.
 * @returns {void}
 */
function enterDraftingPrd(workingContent: string): void {
	const run = createRun("TestApp", tmpDir);
	saveState({ ...run, currentStage: "drafting-prd" }, tmpDir);
	const dir = path.join(runDir(), "prd");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "PRD_TestApp.md"), workingContent, "utf8");
	// Minimal valid PRD payload (G8 prd-file hash is required for PRD).
	fs.mkdirSync(path.join(dir, "payload"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "payload", "prd-payload.json"),
		JSON.stringify({
			envelope: {
				version: 1,
				stage: "drafting-prd",
				generatedAt: "2026-09-22T00:00:00Z",
				inputs: { "prd-file": "f".repeat(64) },
				reviewerVerdict: null,
				changeLog: "[]",
			},
			rows: { fr: [], nfr: [], prdSection: [] },
		}),
		"utf8",
	);
}

/**
 * Move the state machine into the RTM building stage, seed the
 * published PSRS, and write the RTM working copy + payload JSON.
 * @param {string} json - Legacy sidecar JSON text; the `rtmJsonAsPayload` adapter derives the v001-DDL payload rows from it.
 * @returns {void}
 */
function enterBuildingRtm(json: string): void {
	const run = createRun("TestApp", tmpDir);
	saveState({ ...run, currentStage: "building-rtm" }, tmpDir);
	// Seed the published PSRS directly — the gate under test is the RTM one.
	const docDir = path.join(tmpDir, "Doc", "requirements");
	fs.mkdirSync(docDir, { recursive: true });
	fs.writeFileSync(path.join(docDir, "PRD_TestApp.md"), PSRS, "utf8");
	const dir = path.join(runDir(), "rtm");
	fs.mkdirSync(dir, { recursive: true });
	// Phase 6: working copy carries the LLM-authored preview markdown
	// (still consumed for hybrid revision rules) + the payload JSON
	// (the publish source). The legacy sidecar JSON is RETIRED.
	fs.writeFileSync(path.join(dir, "RTM_TestApp.md"), "# RTM preview\n", "utf8");
	fs.mkdirSync(path.join(dir, "payload"), { recursive: true });
	fs.writeFileSync(path.join(dir, "payload", "rtm-payload.json"), rtmJsonAsPayload(json), "utf8");

	// Seed the DB with fr/nfr rows so RTM rtm_row FK chains resolve
	// (Phase 6 strict DB-primary reads). Phase 4's test-only
	// `skipDbPublish` escape hatch bypassed the chain; the new flow
	// writes the payload rows before the gate, so the FK must hold.
	seedFrNfrFromPsrs();
}

/**
 * Read the seeded PSRS, parse out FR + NFR ids, and write them into
 * the project store DB so the RTM payload's `rtm_row.fr_ref` FK
 * resolves. Test-only — the production flow has PRD publish write
 * the rows first.
 */
function seedFrNfrFromPsrs(): void {
	const db = openStoreDb(buildStoreDbPath("TestApp", tmpDir));
	try {
		const ids = Array.from(PSRS.matchAll(/\|\s*(FR-\d+|NFR-\d+)\s*\|/g)).map((m) => String(m[1]));
		const seen = new Set<string>();
		const frRows: ArtifactPayload = {
			fr: ids
				.filter((id) => id.startsWith("FR-") && !seen.has(id))
				.map((id) => {
					seen.add(id);
					return {
						id,
						phase: 1,
						textHash: "f".repeat(64),
						text: `seeded prose for ${id}`,
					};
				}),
			nfr: ids
				.filter((id) => id.startsWith("NFR-") && !seen.has(id))
				.map((id) => {
					seen.add(id);
					return {
						id,
						phase: 1,
						textHash: "f".repeat(64),
						text: `seeded prose for ${id}`,
					};
				}),
		};
		writeArtifact(
			db,
			"prd",
			loadState(tmpDir).runId!,
			{
				version: 1,
				stage: "drafting-prd",
				generatedAt: "2026-09-22T00:00:00Z",
				inputs: "{}",
				reviewerVerdict: null,
				changeLog: "[]",
			},
			frRows,
		);
	} finally {
		closeStoreDb(db);
	}
}

/** Backward-compat alias for the old `json` parameter (legacy sidecar shape). */
function rtmJsonAsPayload(json: string): string {
	const parsed = JSON.parse(json) as { rows: Array<{ id: string; phase?: number }> };
	const ids = parsed.rows.map((r) => r.id);
	const phases: Record<string, number> = {};
	for (const r of parsed.rows) if (r.phase !== undefined) phases[r.id] = r.phase;
	return rtmPayload(ids, phases);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-gate-"));
	// v1.2.1: the full doctor audit now runs after every approve. These
	// fixtures build minimal cwds (no `files.json`, no agent mapping,
	// etc.) by design; we set the test escape hatch so the existing
	// gate assertions stay focused. The auto-doctor stop path is
	// covered by `approve-doctor-stop.test.ts` (no env var).
	process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

describe("publish — publish gate", () => {
	it("blocks an invalid PRD working copy and writes nothing", async () => {
		enterDraftingPrd("# Just a title, no sections\n");
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.match(allMessages(), /Publish gate blocked the publish/);
		assert.match(allMessages(), /psrs-section-missing|psrs-frontmatter-missing/);
		assert.equal(fs.existsSync(path.join(tmpDir, "Doc", "requirements", "PRD_TestApp.md")), false);
		assert.equal(loadState(tmpDir).currentStage, "drafting-prd", "stage must not advance");
	});

	it("blocks an RTM sidecar with an unknown id", async () => {
		enterBuildingRtm(rtmJson(["FR-01", "FR-02", "NFR-01", "FR-99"]));
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.match(allMessages(), /Publish gate blocked the publish/);
		assert.match(allMessages(), /FR-99: no such requirement in the PSRS/);
		assert.equal(fs.existsSync(path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.md")), false);
		assert.equal(loadState(tmpDir).currentStage, "building-rtm");
	});

	it("blocks an RTM sidecar that misses a PSRS requirement (orphan)", async () => {
		enterBuildingRtm(rtmJson(["FR-01", "NFR-01"]));
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.match(allMessages(), /Publish gate blocked the publish/);
		assert.match(allMessages(), /FR-02: PSRS requirement has no RTM row/);
		assert.equal(fs.existsSync(path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.md")), false);
	});

	it("blocks an RTM row whose phase differs from the PRD Phase column", async () => {
		enterBuildingRtm(rtmJson(["FR-01", "FR-02", "NFR-01"], { "FR-02": 5 }));
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.match(allMessages(), /Publish gate blocked the publish/);
		assert.match(allMessages(), /FR-02: RTM phase 5 does not match the PRD phase 1/);
		assert.equal(fs.existsSync(path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.md")), false);
		assert.equal(loadState(tmpDir).currentStage, "building-rtm");
	});

	it("publishes a clean RTM: regenerated markdown + DB rows (Phase 6: sidecar files retire as sources, YAML is a download view)", async () => {
		enterBuildingRtm(rtmJson(["FR-01", "FR-02", "NFR-01"]));
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		const mdPath = path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.md");
		const yamlPath = path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.yaml");
		assert.ok(fs.existsSync(mdPath), "markdown published");
		assert.ok(!fs.existsSync(yamlPath), "Phase 6 §14.3: YAML sidecar is a download view, NOT a publish product");
		assert.ok(
			!fs.existsSync(path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.json")),
			"no .json copy is published",
		);

		// Markdown is regenerated from the DB rows — not the LLM's
		// preview file. Phase 6 renders a Phase 5 style table from the
		// RTM rows (DB is the source of truth).
		const md = fs.readFileSync(mdPath, "utf8");
		assert.ok(!md.includes("# RTM preview"), "preview content must not be published");
		assert.match(md, /FR-01/, "FR-01 row lands in the DB-rendered markdown");
		assert.match(md, /FR-02/, "FR-02 row lands in the DB-rendered markdown");
		assert.match(md, /NFR-01/, "NFR-01 row lands in the DB-rendered markdown");
		assert.equal(loadState(tmpDir).currentStage, "built-rtm");
	});
});
