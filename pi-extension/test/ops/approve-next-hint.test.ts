/**
 * /velpari-rtm-approve next-step hint tests (feasibility skip).
 *
 * After the RTM publish advances the run to built-rtm, the notification
 * depends on whether a published feasibility study already exists:
 *   - no doc  → suggests /velpari-feasibility only (the default next command)
 *   - doc     → suggests /velpari-architecture-generator OR
 *               /velpari-feasibility, with a feasibility-already-published
 *               note attached so the user knows the skip is available.
 *
 * v1.6.2: every stage boundary is now a manual confirm-then-write step.
 * The hint is always surfaced via `nextCommandsFor(next.currentStage,
 * { feasibilitySkip })` so the hint list is driven by STAGE_TRANSITIONS.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import { advanceStage, createRun, loadState, setFeasibilitySession } from "../../src/core/state.js";
import { GENERATION_PHASES } from "../../src/core/agents-config.js";
import { getProjectSlug } from "../../src/core/agents-generator.js";

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

/** Drive a fresh run into building-rtm and write the RTM working copy. */
function enterBuildingRtm(): void {
	let state = createRun("TestApp", tmpDir);
	for (const cmd of [
		"/velpari-approve-brainstorm",
		"/velpari-prd",
		"/velpari-prd-approve",
		"/velpari-rtm",
	]) {
		state = advanceStage(state, cmd, tmpDir);
	}
	// B4: the publish gate refuses an RTM publish when its declared input
	// (the published PRD) is missing.
	const prdDir = path.join(tmpDir, "Doc", "requirements");
	fs.mkdirSync(prdDir, { recursive: true });
	fs.writeFileSync(path.join(prdDir, "PRD_TestApp.md"), "# PRD\n", "utf8");
	const runId = loadState(tmpDir).runId;
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "rtm");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "RTM_TestApp.md"), "# RTM\n", "utf8");
	// B3/D6: an RTM publish requires the sidecar — it is the source of
	// truth. Empty rows pass the gate against the minimal PRD fixture.
	fs.writeFileSync(
		path.join(dir, "RTM_TestApp.yaml"),
		'project: TestApp\nversion: 1.0.0\nrows: []\n',
		"utf8",
	);
}

function seedPublishedFeasibility(): void {
	const dir = path.join(tmpDir, "Doc", "feasibility");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "feasibility-study_TestApp.md"), "# Feasibility\n", "utf8");
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-approve-hint-"));
	// v1.2.1 opt-out for minimal-cwd test fixtures.
	process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

describe("/velpari-architecture-generator-approve — built-rtm next-step hint", () => {
	it("suggests only /velpari-feasibility when no feasibility doc is published", async () => {
		enterBuildingRtm();
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.equal(loadState(tmpDir).currentStage, "built-rtm");
		// nextCommandsFor(built-rtm) without feasibilitySkip returns only
		// /velpari-feasibility (the feasibility-skip row is filtered out).
		assert.match(allMessages(), /Next: \/velpari-feasibility/);
		assert.ok(!allMessages().includes("skip ahead"));
	});

	it("suggests the design skip plus feasibility revise when a doc exists", async () => {
		enterBuildingRtm();
		seedPublishedFeasibility();
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.equal(loadState(tmpDir).currentStage, "built-rtm");
		// nextCommandsFor(built-rtm, { feasibilitySkip: true }) returns both
		// /velpari-feasibility and /velpari-architecture-generator (in
		// STAGE_TRANSITIONS order). The post-RTM branch appends a
		// "feasibility already published; you may skip ahead to architecture."
		// note so the user understands why both options are shown.
		assert.match(
			allMessages(),
			/Next: \/velpari-feasibility or \/velpari-architecture-generator/,
		);
		assert.match(
			allMessages(),
			/feasibility already published; you may skip ahead to architecture/,
		);
	});
});

// ---------------------------------------------------------------------------
// Generator v2 (D5) — phase-boundary generation hint. Feasibility-approve
// crosses Phase 2 → Phase 3, so the next-hint prepends the generation step
// while Phase 3 lacks fresh generated agents. Same-phase approves (e.g.
// the built-rtm cases above) never show it.
// ---------------------------------------------------------------------------

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

/** Drive a fresh run into analyzing-feasibility with a settled session. */
function enterSettledFeasibility(): void {
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
	const runId = loadState(tmpDir).runId;
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "feasibility");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "feasibility-study_TestApp.md"), STUDY, "utf8");
	// B4: the publish gate refuses a feasibility publish when its declared
	// input (the published RTM) is missing.
	const rtmDir = path.join(tmpDir, "Doc", "requirements");
	fs.mkdirSync(rtmDir, { recursive: true });
	fs.writeFileSync(path.join(rtmDir, "RTM_TestApp.md"), "# RTM\n", "utf8");
	setFeasibilitySession(
		loadState(tmpDir),
		{ decision: "build", selectedLanguage: "typescript", selectedBy: "user" },
		tmpDir,
	);
}

/** Write placeholder generated-agent files for every Phase 3 role. */
function writePhase3GeneratedAgents(): void {
	const slug = getProjectSlug(tmpDir);
	const agentsDir = path.join(tmpDir, ".pi", "agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	for (const role of GENERATION_PHASES[3].roles) {
		fs.writeFileSync(path.join(agentsDir, `${slug}-${role}.md`), `# ${role}\n`, "utf8");
	}
}

describe("phase-boundary generation hint (generator v2, D5)", () => {
	it("feasibility-approve crossing into Phase 3 prepends the generation hint", async () => {
		enterSettledFeasibility();
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.equal(loadState(tmpDir).currentStage, "analyzed-feasibility");
		assert.match(
			allMessages(),
			/Next: generate Phase 3 agents \(\/velpari-generate-sub-agents\), then \/velpari-architecture-generator/,
		);
	});

	it("same-phase approves never show the generation hint", async () => {
		enterBuildingRtm();
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.equal(loadState(tmpDir).currentStage, "built-rtm");
		assert.ok(!allMessages().includes("generate Phase"), "no generation hint on a same-phase advance");
	});

	it("fresh Phase 3 agents suppress the hint", async () => {
		enterSettledFeasibility();
		writePhase3GeneratedAgents();
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.equal(loadState(tmpDir).currentStage, "analyzed-feasibility");
		assert.ok(!allMessages().includes("generate Phase"), "hint suppressed when Phase 3 agents are fresh");
		assert.match(allMessages(), /Next: \/velpari-architecture-generator/);
	});
});
