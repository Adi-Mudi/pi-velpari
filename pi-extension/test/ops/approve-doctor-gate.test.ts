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

interface Notice {
	message: string;
	level: string;
}

let tmpDir: string;
let notices: Notice[];

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

function runDir(): string {
	return path.join(tmpDir, ".IDE_Plans", "velpari", "runs", loadState(tmpDir).runId);
}

function enterDraftingPrd(workingContent: string): void {
	const run = createRun("TestApp", tmpDir);
	saveState({ ...run, currentStage: "drafting-prd" }, tmpDir);
	const dir = path.join(runDir(), "prd");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "PRD_TestApp.md"), workingContent, "utf8");
}

function enterBuildingRtm(json: string): void {
	const run = createRun("TestApp", tmpDir);
	saveState({ ...run, currentStage: "building-rtm" }, tmpDir);
	// Seed the published PSRS directly — the gate under test is the RTM one.
	const docDir = path.join(tmpDir, "Doc", "requirements");
	fs.mkdirSync(docDir, { recursive: true });
	fs.writeFileSync(path.join(docDir, "PRD_TestApp.md"), PSRS, "utf8");
	const dir = path.join(runDir(), "rtm");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "RTM_TestApp.md"), "# RTM preview\n", "utf8");
	fs.writeFileSync(path.join(dir, "RTM_TestApp.json"), json, "utf8");
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
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.match(allMessages(), /Publish gate blocked the publish/);
		assert.match(allMessages(), /psrs-section-missing|psrs-frontmatter-missing/);
		assert.equal(fs.existsSync(path.join(tmpDir, "Doc", "requirements", "PRD_TestApp.md")), false);
		assert.equal(loadState(tmpDir).currentStage, "drafting-prd", "stage must not advance");
	});

	it("blocks an RTM sidecar with an unknown id", async () => {
		enterBuildingRtm(rtmJson(["FR-01", "FR-02", "NFR-01", "FR-99"]));
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.match(allMessages(), /Publish gate blocked the publish/);
		assert.match(allMessages(), /FR-99: no such requirement in the PSRS/);
		assert.equal(fs.existsSync(path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.md")), false);
		assert.equal(loadState(tmpDir).currentStage, "building-rtm");
	});

	it("blocks an RTM sidecar that misses a PSRS requirement (orphan)", async () => {
		enterBuildingRtm(rtmJson(["FR-01", "NFR-01"]));
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.match(allMessages(), /Publish gate blocked the publish/);
		assert.match(allMessages(), /FR-02: PSRS requirement has no RTM row/);
		assert.equal(fs.existsSync(path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.md")), false);
	});

	it("blocks an RTM row whose phase differs from the PRD Phase column", async () => {
		enterBuildingRtm(rtmJson(["FR-01", "FR-02", "NFR-01"], { "FR-02": 5 }));
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.match(allMessages(), /Publish gate blocked the publish/);
		assert.match(allMessages(), /FR-02: RTM phase 5 does not match the PRD phase 1/);
		assert.equal(fs.existsSync(path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.md")), false);
		assert.equal(loadState(tmpDir).currentStage, "building-rtm");
	});

	it("publishes a clean RTM: regenerated markdown + YAML sidecar with fingerprints (legacy .json working sidecar accepted, .yaml written — D4)", async () => {
		enterBuildingRtm(rtmJson(["FR-01", "FR-02", "NFR-01"]));
		await handleApprove(makeCtx(), undefined, tmpDir);

		const mdPath = path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.md");
		const yamlPath = path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.yaml");
		assert.ok(fs.existsSync(mdPath), "markdown published");
		assert.ok(fs.existsSync(yamlPath), "YAML sidecar published (writes are always .yaml)");
		assert.ok(
			!fs.existsSync(path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.json")),
			"no .json copy is published",
		);

		// Markdown is regenerated from the data — not the LLM's preview file.
		const md = fs.readFileSync(mdPath, "utf8");
		assert.match(md, /# Requirements Traceability Matrix — TestApp/);
		assert.match(md, /\| FR-01 \| FR-01 title \|/);
		assert.ok(!md.includes("# RTM preview"), "preview content must not be published");

		// Fingerprints were stamped from the published PSRS.
		const data = readYamlFile(yamlPath) as { rows: { fingerprint?: string }[] };
		assert.ok(data.rows.every((r) => typeof r.fingerprint === "string" && r.fingerprint.length === 64));
		assert.equal(loadState(tmpDir).currentStage, "built-rtm");

		// B4 freshness stamps: the published markdown carries an `inputs:`
		// JSON scalar hashing the declared input (the published PRD), and
		// `.pi/velpari/freshness.json` records the rtm:TestApp entry with
		// the YAML sidecar hash in extraPaths (D3/D5).
		const prdHash = hashFileContent(path.join(tmpDir, "Doc", "requirements", "PRD_TestApp.md"))!;
		const fm = parseFrontmatterBlock(md)!;
		assert.deepEqual(JSON.parse(fm.fields.inputs!), { "prd:TestApp": prdHash });
		const manifest = loadFreshnessManifest(tmpDir);
		const entry = manifest.artifacts["rtm:TestApp"];
		assert.ok(entry, "expected a freshness manifest entry for rtm:TestApp");
		assert.equal(entry.path, path.join("Doc", "requirements", "RTM_TestApp.md"));
		assert.deepEqual(entry.inputs, { "prd:TestApp": prdHash });
		const sidecarHash = hashFileContent(yamlPath)!;
		assert.deepEqual(entry.extraPaths, {
			[path.join("Doc", "requirements", "RTM_TestApp.yaml")]: sidecarHash,
		});
	});
});
