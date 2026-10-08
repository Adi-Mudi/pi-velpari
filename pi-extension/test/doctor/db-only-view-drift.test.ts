/**
 * DB-only view-drift tests (Phase 12 Fix F7).
 *
 * The three DB-rendered data checks (RTM / atomic-functions /
 * development-order) compare a deterministic re-render of the store rows
 * against the published markdown to catch hand-edits. Under the shipped
 * DB-only default (markdown writes retired) that markdown is a legacy human
 * VIEW the publish chain never rewrites — so the comparison can only fail, and
 * it errored on every republish of a MIGRATED project (legacy markdown on
 * disk), blocking the post-publish auto-doctor.
 *
 * Fix: drift is compared only while the markdown is still maintained
 * (`files.json:velpari.markdownWrites` ON). Both directions are locked here:
 *   - OFF + stale view → no error (the view is noted as legacy, unchecked)
 *   - ON  + stale view → the original error still fires
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkRtmDataSection } from "../../src/doctor/checks/rtm-data.js";
import { checkAfDataSection } from "../../src/doctor/checks/af-data.js";
import { checkDevOrderDataSection } from "../../src/doctor/checks/dev-order-data.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import {
	publishArtifact,
	writeArtifact,
	type ArtifactEnvelopeInput,
	type ArtifactPayload,
} from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";

const PROJECT = "ViewDrift";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-view-drift-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Write `.pi/velpari/files.json` (v4) with the write-alongside flag ON/OFF.
 * @param {boolean} markdownWrites - Emit `velpari.markdownWrites: true`.
 */
function writeFilesConfig(markdownWrites: boolean): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	const config = {
		version: 4,
		projectName: PROJECT,
		framework: { language: "typescript" },
		inputDocuments: [],
		outputPaths: {},
		codePaths: [],
		testPaths: [],
		excludedPaths: [],
		...(markdownWrites ? { velpari: { markdownWrites: true } } : {}),
	};
	fs.writeFileSync(path.join(dir, "files.json"), JSON.stringify(config, null, 2), "utf8");
}

/**
 * Write a published markdown that can never match a DB re-render.
 * @param {string} rel - Repo-relative path under the fixture root.
 */
function writeStaleView(rel: string): void {
	const abs = path.join(tmpDir, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, "# Stale legacy view\n\nHand-written long ago.\n", "utf8");
}

/**
 * Publish one artifact's rows into the fixture store (run `run-viewdrift`).
 * @param {string} kind - Store kind to publish.
 * @param {ArtifactPayload} rows - Row-sets for that kind.
 */
function publishRows(kind: "prd" | "rtm" | "atomic-functions" | "development-order", rows: ArtifactPayload): void {
	const db = openStoreDb(buildStoreDbPath(PROJECT, tmpDir));
	try {
		const envelope: ArtifactEnvelopeInput = {
			version: 1,
			stage: "probe",
			generatedAt: "2026-09-24T00:00:00.000Z",
			inputs: "{}",
			reviewerVerdict: null,
			changeLog: "[]",
		};
		writeArtifact(db, kind, "run-viewdrift", envelope, rows);
		publishArtifact(db, "run-viewdrift", kind);
	} finally {
		closeStoreDb(db);
	}
}

/** True when a section carries at least one error item. */
function hasError(section: ReturnType<typeof checkRtmDataSection>): boolean {
	return section.items.some((i) => i.status === "error");
}

describe("DB-only view drift (Phase 12 Fix F7)", () => {
	it("RTM: markdown writes OFF → a stale published view is NOT an error", () => {
		writeFilesConfig(false);
		publishRows("prd", { fr: [{ id: "FR-1", phase: 1, textHash: "a1", text: "The system shall parse input" }] });
		publishRows("rtm", { rtmRow: [{ id: "FR-1", frRef: "FR-1", phase: 1, targetSha256: "a1" }] });
		writeStaleView(path.join("Doc", "requirements", `RTM_${PROJECT}.md`));

		const section = checkRtmDataSection(tmpDir, PROJECT);
		assert.equal(hasError(section), false, `no error expected: ${JSON.stringify(section.items)}`);
		assert.ok(
			section.items.some((i) => i.status === "ok" && /drift not checked/.test(i.message)),
			`the view must be reported as legacy/unchecked: ${JSON.stringify(section.items)}`,
		);
	});

	it("RTM: markdown writes ON → the same stale view still errors", () => {
		writeFilesConfig(true);
		publishRows("prd", { fr: [{ id: "FR-1", phase: 1, textHash: "a1", text: "The system shall parse input" }] });
		publishRows("rtm", { rtmRow: [{ id: "FR-1", frRef: "FR-1", phase: 1, targetSha256: "a1" }] });
		writeStaleView(path.join("Doc", "requirements", `RTM_${PROJECT}.md`));

		const section = checkRtmDataSection(tmpDir, PROJECT);
		assert.ok(
			section.items.some((i) => i.status === "error" && /has drifted from the store/.test(i.message)),
			`write-alongside drift must still error: ${JSON.stringify(section.items)}`,
		);
	});

	it("atomic-functions: OFF is tolerated, ON still errors", () => {
		const afRows: ArtifactPayload = {
			atomicFunction: [
				{
					id: "AF-1",
					name: "doThing",
					signature: "doThing(): void",
					tier: "basic",
					criticality: "A",
					sil: "none",
					isLeaf: 1,
				},
			],
		};
		writeFilesConfig(false);
		publishRows("atomic-functions", afRows);
		writeStaleView(path.join("Doc", "atomic-functions", `atomic-functions_${PROJECT}.md`));
		assert.equal(hasError(checkAfDataSection(tmpDir, PROJECT)), false, "OFF must not error");

		writeFilesConfig(true);
		assert.ok(
			checkAfDataSection(tmpDir, PROJECT).items.some(
				(i) => i.status === "error" && /has drifted from the store/.test(i.message),
			),
			"ON must still error",
		);
	});

	it("development-order: OFF is tolerated, ON still errors", () => {
		const doRows: ArtifactPayload = { devStep: [{ id: "S-1", module: "M-1" }] };
		writeFilesConfig(false);
		publishRows("development-order", doRows);
		writeStaleView(path.join("Doc", "development-order", `development-order_${PROJECT}.md`));
		assert.equal(hasError(checkDevOrderDataSection(tmpDir, PROJECT)), false, "OFF must not error");

		writeFilesConfig(true);
		assert.ok(
			checkDevOrderDataSection(tmpDir, PROJECT).items.some(
				(i) => i.status === "error" && /has drifted from the store/.test(i.message),
			),
			"ON must still error",
		);
	});
});
