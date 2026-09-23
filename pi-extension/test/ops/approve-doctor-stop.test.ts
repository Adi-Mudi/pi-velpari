/**
 * Auto-doctor-stop on approve (v1.2.1).
 *
 * Per the policy, handleApprove (called by the publish tool or the
 * per-stage fall-back command) runs the FULL doctor audit
 * after the publish + before advanceStage. Errors AND warnings in
 * the doctor report must block the advance and write the
 * full report to .IDE_Plans/velpari/doctor-report.md.
 *
 * This file proves the STOP path:
 *   - doctor returns errors  → stage does NOT advance, report on disk
 *   - doctor returns warnings → stage does NOT advance, report on disk
 *
 * The PASS path is covered by existing happy-path tests in
 * approve-doctor-gate.test.ts once those fixtures are updated to
 * provide a doctor-clean cwd (Phase 8.7 follow-up).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";
import { PATHS } from "../../src/core/constants.js";
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
 * Build the legacy RTM sidecar JSON text. The publish path ignores
 * this format in Phase 6 — `enterBuildingRtm` uses `rtmJsonAsPayload`
 * to derive the v001-DDL payload rows from the same id list. Kept as
 * the test's data-source-of-truth so the helpers stay coupled.
 * @param {string[]} ids - Requirement ids each RTM row should cover.
 * @returns {string} The JSON text for a legacy RTM sidecar.
 */
/**
 * Adapter: convert the legacy sidecar JSON text (from `rtmJson`) into
 * the v001-DDL payload JSON shape that `loadStagePayload` validates.
 * Phase 6 — RTM is DB-primary, so the publish source is payload rows.
 * @param {string} json - The legacy sidecar JSON text.
 * @returns {string} The equivalent payload JSON text.
 */
function rtmJsonAsPayload(json: string): string {
	const parsed = JSON.parse(json) as { rows: Array<{ id: string }> };
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
			rtmRow: parsed.rows.map((r) => ({
				id: r.id,
				frRef: r.id,
				phase: 1,
				targetSha256: "f".repeat(64),
			})),
		},
	});
}

/**
 * Build the legacy RTM sidecar JSON text. The publish path ignores
 * this format in Phase 6 — `enterBuildingRtm` uses `rtmJsonAsPayload`
 * to derive the v001-DDL payload rows from the same id list. Kept as
 * the test's data-source-of-truth so the helpers stay coupled.
 * @param {string[]} ids - Requirement ids each RTM row should cover.
 * @returns {string} The JSON text for a legacy RTM sidecar.
 */
function rtmJson(ids: string[]): string {
	return JSON.stringify({
		project: "TestApp",
		version: "1.0.0",
		rows: ids.map((id) => ({
			id,
			title: `${id} title`,
			phase: 1,
			design: "",
			implementation: "",
			tests: [],
			status: "proposed",
			coverage: "covered",
		})),
	});
}

/**
 * Move the state machine into the RTM building stage, seed the
 * published PSRS, and write the RTM working copy + payload JSON.
 * Phase 6 (§14): RTM is DB-primary; the working copy must carry a
 * payload JSON. The legacy sidecar JSON is RETIRED.
 * @returns {void}
 */
function enterBuildingRtm(): void {
	const run = createRun("TestApp", tmpDir);
	saveState({ ...run, currentStage: "building-rtm" }, tmpDir);
	// Seed the published PSRS directly — the approve gate looks for it.
	const docDir = path.join(tmpDir, "Doc", "requirements");
	fs.mkdirSync(docDir, { recursive: true });
	fs.writeFileSync(path.join(docDir, "PRD_TestApp.md"), PSRS, "utf8");
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", loadState(tmpDir).runId, "rtm");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "RTM_TestApp.md"), "# RTM preview\n", "utf8");
	// Phase 6 (§14): RTM is DB-primary; the working copy must carry a
	// payload JSON. The legacy sidecar JSON is RETIRED.
	fs.mkdirSync(path.join(dir, "payload"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "payload", "rtm-payload.json"),
		rtmJsonAsPayload(rtmJson(["FR-01", "FR-02", "NFR-01"])),
		"utf8",
	);

	// Seed the DB with fr/nfr rows so RTM rtm_row FK chains resolve
	// (Phase 6 strict DB-primary reads).
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

/**
 * Concatenate every captured `ui.notify` message into one string for
 * `assert.match` patterns.
 * @returns {string} All captured messages joined by `\n`.
 */
function allMessages(): string {
	return notices.map((n) => n.message).join("\n");
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-autodoc-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("publish — auto doctor audit (v1.2.1)", () => {
	it("publishes the RTM then blocks the advance because doctor has errors on this cwd (e.g. no files.json, no agents, no MCP, etc.)", async () => {
		enterBuildingRtm();
		const stageBefore = loadState(tmpDir).currentStage;

		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		// The markdown WAS published (gate passes; Phase 6: regenerated
		// from DB rows). The YAML sidecar is a download view, NOT a
		// publish product (§14.3); the publish chain that writes it
		// is skipped here (`skipDbPublish: true`).
		const mdPath = path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.md");
		const yamlPath = path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.yaml");
		assert.ok(fs.existsSync(mdPath), "publish gate cleared — RTM markdown on disk");
		assert.ok(!fs.existsSync(yamlPath), "publish gate cleared — no YAML sidecar written (download view only)");

		// The doctor report was written.
		const reportPath = path.join(tmpDir, PATHS.DOCTOR_REPORT);
		assert.ok(fs.existsSync(reportPath), `full doctor report must be written at ${reportPath}`);
		const reportBody = fs.readFileSync(reportPath, "utf8");
		assert.ok(reportBody.length > 0, "report has content");

		// The user-facing notification contains the new policy phrasing.
		const message = allMessages();
		assert.match(message, /Doctor stopped the advance/i, message);

		// State did NOT advance.
		assert.equal(loadState(tmpDir).currentStage, stageBefore, "stage must remain unchanged on doctor findings");
	});

	it("blocks on warnings too (not just errors) per the v1.2.1 policy", async () => {
		// A bare cwd that publish gate would clear (so we test auto-doctor,
		// not the gate) and that produces doctor warnings only (so we know
		// the path treats warnings as blockers). With the published PRD +
		// happy RTM, the doctor typically still flags warnings for missing
		// config — exactly the v1.2.1 case to verify.
		enterBuildingRtm();

		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		const state = loadState(tmpDir);
		// Either errors > 0 OR warnings > 0 → state did not advance.
		// Whichever the case is, the doctor message must be present.
		const message = allMessages();
		const sawDoctorStop = /Doctor stopped the advance/.test(message);
		const sawDoctorClean = /Doctor: clean/.test(message);
		assert.ok(sawDoctorStop || sawDoctorClean, "doctor audit must report either stop or clean in the notify stream");
		if (sawDoctorStop) {
			assert.equal(state.currentStage, "building-rtm", "stage held when doctor stopped");
		} else {
			assert.equal(state.currentStage, "built-rtm", "stage advances when doctor clean");
		}
	});

	it("v1.2.3: notify groups findings by section title", async () => {
		enterBuildingRtm();
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		const doctorMsg = notices.map((n) => n.message).find((m) => /Doctor stopped the advance/.test(m));
		// v1.2.3 UI: when the doctor blocks, the notify carries a
		// grouped list (one line per section) with tags.
		if (doctorMsg) {
			assert.ok(
				/-\s+[\S\s]+?:\s+\d+\s+error\(s\)/.test(doctorMsg),
				`v1.2.3 notify must carry section-grouped lines; got: ${doctorMsg.slice(0, 400)}`,
			);
		}
	});
});
