/**
 * /velpari-prd-approve feasibility session gate tests (feasibility v2, Phase 3).
 *
 * Asserts:
 *   - feasibility publish is BLOCKED when the session has no decision
 *   - blocked when a decision exists but no language was selected
 *   - a settled session (decision + language) publishes, advances the
 *     stage, and clears the session
 *   - non-feasibility stages are unaffected by the gate
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import {
	advanceStage,
	createRun,
	loadState,
	setFeasibilitySession,
} from "../../src/core/state.js";
import { loadFeasibilityRecord } from "../../src/core/feasibility-record.js";
import { loadFreshnessManifest } from "../../src/core/freshness.js";

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

const STUDY_SECTIONS = [
	"Executive Summary",
	"Options Analysis",
	"Build-vs-Reuse Comparison",
	"Language Selection",
	"Technical Feasibility",
	"Schedule Feasibility",
	"Cost Feasibility",
	"Risk Feasibility",
	"Overall Verdict",
	"Conditions",
	"Top 5 Risks",
	"Open Questions",
	"Change Log",
];

const STUDY =
	["# Feasibility Study — TestApp", ""]
		.concat(
			STUDY_SECTIONS.flatMap((s, i) => [
				`## ${i + 1}. ${s}`,
				s === "Overall Verdict" ? "All pass.\nFinal: Go" : `${s} content.`,
				"",
			]),
		)
		.join("\n");

function publishedStudyPath(): string {
	return path.join(tmpDir, "Doc", "feasibility", "feasibility-study_TestApp.md");
}

function writeWorkingStudy(): void {
	const runId = loadState(tmpDir).runId;
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "feasibility");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "feasibility-study_TestApp.md"), STUDY, "utf8");
}

/** Drive a fresh run into analyzing-feasibility and write the working copy. */
function enterFeasibility(): void {
	let state = createRun("TestApp", tmpDir);
	for (const cmd of [
		"/velpari-approve-brainstorm",
		"/velpari-prd",
		"/velpari-prd-approve",
		"/velpari-rtm",
		"/velpari-rtm-approve",
		"/velpari-feasibility",
	]) {
		state = advanceStage(state, cmd, tmpDir);
	}
	writeWorkingStudy();
	// B4: the publish gate refuses a feasibility publish when its declared
	// input (the published RTM) is missing.
	const rtmDir = path.join(tmpDir, "Doc", "requirements");
	fs.mkdirSync(rtmDir, { recursive: true });
	fs.writeFileSync(path.join(rtmDir, "RTM_TestApp.md"), "# RTM\n", "utf8");
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-approve-feasibility-"));
	// v1.2.1 opt-out for minimal-cwd test fixtures (see
	// approve-doctor-gate.test.ts for the same setup + rationale).
	process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

describe("/velpari-atomic-function-approve — feasibility session gate", () => {
	it("blocks when no session exists (no decision, no language)", async () => {
		enterFeasibility();
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.match(allMessages(), /Feasibility stage is not settled/);
		assert.match(allMessages(), /build-vs-reuse decision missing/);
		assert.match(allMessages(), /language not selected/);
		assert.ok(!fs.existsSync(publishedStudyPath()), "nothing published");
		assert.ok(
			!fs.existsSync(path.join(tmpDir, "Doc", "feasibility", "feasibility-decision_TestApp.yaml")),
			"no decision record when the session gate blocks",
		);
		assert.equal(loadState(tmpDir).currentStage, "analyzing-feasibility");
	});

	it("blocks when decision is set but language is missing", async () => {
		enterFeasibility();
		setFeasibilitySession(loadState(tmpDir), { decision: "build" }, tmpDir);
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.match(allMessages(), /language not selected/);
		assert.ok(!allMessages().includes("build-vs-reuse decision missing"));
		assert.ok(!fs.existsSync(publishedStudyPath()));
		assert.equal(loadState(tmpDir).currentStage, "analyzing-feasibility");
	});

	it("publishes, advances, and clears the session when settled", async () => {
		enterFeasibility();
		setFeasibilitySession(
			loadState(tmpDir),
			{
				decision: "build",
				selectedLanguage: "typescript",
				selectedBy: "user",
				languageCandidates: ["typescript", "go"],
				spikeResults: [
					{
						language: "typescript",
						coreFunction: "parse",
						buildOk: true,
						runOk: true,
						notes: "ok",
						evidencePath: "spikes/typescript",
					},
				],
				reuseSummary: ["no viable reuse candidate"],
			},
			tmpDir,
		);
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.ok(fs.existsSync(publishedStudyPath()), "study published");
		const state = loadState(tmpDir);
		assert.equal(state.currentStage, "analyzed-feasibility");
		assert.equal(state.feasibilitySession, undefined, "session cleared on approve");

		// B3/D9 — the decision record was serialized BEFORE the session
		// was cleared, carrying the D9 session fields.
		const recordPath = path.join(
			tmpDir,
			"Doc",
			"feasibility",
			"feasibility-decision_TestApp.yaml",
		);
		assert.ok(fs.existsSync(recordPath), "decision record written");
		const record = loadFeasibilityRecord(tmpDir, "TestApp")!;
		assert.equal(record.verdict, "build");
		assert.equal(record.selectedLanguage, "typescript");
		assert.equal(record.selectedBy, "user");
		assert.deepEqual(record.languageCandidates, ["typescript", "go"]);
		assert.equal(record.spikeResults.length, 1);
		assert.equal(record.spikeResults[0]!.language, "typescript");
		assert.deepEqual(record.reuseSummary, ["no viable reuse candidate"]);
		assert.ok(typeof record.recordedAt === "string" && record.recordedAt.length > 0);

		// The record joins the study's own freshness extraPaths (D5).
		const manifest = loadFreshnessManifest(tmpDir);
		const entry = manifest.artifacts["feasibility-study:TestApp"];
		assert.ok(entry, "freshness entry for the study");
		const recordRel = path.join("Doc", "feasibility", "feasibility-decision_TestApp.yaml");
		assert.ok(
			entry.extraPaths?.[recordRel],
			`extraPaths must hash the decision record; got ${JSON.stringify(entry.extraPaths)}`,
		);
	});

	it("does not gate non-feasibility stages", async () => {
		// Drafting-prd publish without any feasibility session must work.
		let state = createRun("TestApp", tmpDir);
		state = advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		advanceStage(state, "/velpari-prd", tmpDir);
		const runId = loadState(tmpDir).runId;
		const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "prd");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "PRD_TestApp.md"), "# draft\n", "utf8");

		await handleApprove(makeCtx(), undefined, tmpDir);
		assert.ok(!allMessages().includes("Feasibility stage is not settled"));
	});
});
