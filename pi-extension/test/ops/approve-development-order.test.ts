/**
 * Development-order publish regression test (stageToArtifact gap fix).
 *
 * Checkpoint 2.2 of the freshness plan (B4 + A3) found a real latent bug:
 * `stageToArtifact` had no `ordering-development` case, so the development
 * order could never publish or advance in production ("No artifact mapping
 * for stage"). Every test walked state via advanceStage directly, so the
 * gap was invisible.
 *
 * This suite walks the REAL approve path (handleApprove — the same code
 * path the publish tool and /velpari-development-order-approve use) and
 * adds a table-driven guard: every publishable transition in
 * STAGE_TRANSITIONS must have a stageToArtifact mapping, so this bug
 * class cannot recur.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove, stageToArtifact } from "../../src/ops/approve.js";
import { advanceStage, createRun, loadState } from "../../src/core/state.js";
import { STAGE_TRANSITIONS } from "../../src/core/constants.js";
import { parseFrontmatterBlock } from "../../src/core/frontmatter.js";
import { hashFileContent } from "../../src/core/fingerprints.js";
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

/**
 * Declared inputs of the development-order stage (registry.ts). The
 * freshness publish gate refuses a publish when any is missing, so the
 * fixture seeds all of them as grouped Doc artifacts.
 */
const DECLARED_INPUTS: Array<{ dir: string; file: string; id: string }> = [
	{ dir: "design", file: "design_TestApp.md", id: "design:TestApp" },
	{ dir: "requirements", file: "PRD_TestApp.md", id: "prd:TestApp" },
	{ dir: "requirements", file: "RTM_TestApp.md", id: "rtm:TestApp" },
	{ dir: "feasibility", file: "feasibility-study_TestApp.md", id: "feasibility-study:TestApp" },
	{ dir: "atomic-functions", file: "atomic-functions_TestApp.md", id: "atomic-functions:TestApp" },
	{ dir: "pseudocode", file: "pseudocode_TestApp.md", id: "pseudocode:TestApp" },
	{ dir: "tests", file: "test-plan_TestApp.md", id: "test-plan:TestApp" },
	{ dir: "tests", file: "test-cases_TestApp.md", id: "test-cases:TestApp" },
];

function seedDeclaredInputs(): void {
	for (const input of DECLARED_INPUTS) {
		const dir = path.join(tmpDir, "Doc", input.dir);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, input.file), `# ${input.file}\n`, "utf8");
	}
}

/** Drive a fresh run into ordering-development and write the working copy. */
function enterOrderingDevelopment(): void {
	let state = createRun("TestApp", tmpDir);
	for (const cmd of [
		"/velpari-approve-brainstorm",
		"/velpari-prd",
		"/velpari-prd-approve",
		"/velpari-rtm",
		"/velpari-rtm-approve",
		"/velpari-feasibility",
		"/velpari-feasibility-approve",
		"/velpari-architecture-generator",
		"/velpari-architecture-generator-approve",
		"/velpari-atomic-function",
		"/velpari-atomic-function-approve",
		"/velpari-pseudocode",
		"/velpari-pseudocode-approve",
		"/velpari-testplan",
		"/velpari-testplan-approve",
		"/velpari-development-order",
	]) {
		state = advanceStage(state, cmd, tmpDir);
	}
	assert.equal(loadState(tmpDir).currentStage, "ordering-development");
	const runId = loadState(tmpDir).runId;
	const dir = path.join(
		tmpDir,
		".IDE_Plans",
		"velpari",
		"runs",
		runId,
		"development-order",
	);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "development-order_TestApp.md"),
		"# Development Order\n\n## Order\n\n- 1. AF-01\n\n## Change Log\n\n- 1.0.0 — initial.\n",
		"utf8",
	);
	// B3/D6+D8: the publish requires the YAML sidecar — the source of
	// truth the published markdown is re-rendered from.
	fs.writeFileSync(
		path.join(dir, "development-order_TestApp.yaml"),
		[
			"project: TestApp",
			"version: 1.0.0",
			"steps:",
			"  - id: DO-1",
			"    module: M-1 (core)",
			"    afs: [AF-1]",
			"    dependsOn: []",
			"    rationale: foundation",
			"changeLog:",
			"  - 1.0.0 — initial.",
			"",
		].join("\n"),
		"utf8",
	);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-approve-dev-order-"));
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TestApp" }),
		"utf8",
	);
	// v1.2.1 opt-out for minimal-cwd test fixtures.
	process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

describe("/velpari-development-order-approve — real publish path", () => {
	it("publishes the working copy with an inputs: stamp, records freshness.json, and advances", async () => {
		enterOrderingDevelopment();
		seedDeclaredInputs();

		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		const pubPath = path.join(
			tmpDir,
			"Doc",
			"development-order",
			"development-order_TestApp.md",
		);
		assert.ok(
			fs.existsSync(pubPath),
			`expected publish at ${pubPath}; messages: ${allMessages()}`,
		);

		// Frontmatter carries the B4 inputs: stamp — one entry per declared
		// input, each matching the on-disk hash.
		const fm = parseFrontmatterBlock(fs.readFileSync(pubPath, "utf8"));
		assert.ok(fm?.fields.inputs, "published artifact has no inputs: stamp");
		const stamped = JSON.parse(fm.fields.inputs!) as Record<string, string>;
		for (const input of DECLARED_INPUTS) {
			const expected = hashFileContent(path.join(tmpDir, "Doc", input.dir, input.file));
			assert.equal(stamped[input.id], expected, `stamp mismatch for ${input.id}`);
		}

		// The machine manifest records the publish under development-order:TestApp.
		const manifest = loadFreshnessManifest(tmpDir);
		const entry = manifest.artifacts["development-order:TestApp"];
		assert.ok(entry, "expected a freshness manifest entry for development-order:TestApp");
		assert.equal(entry.path, path.join("Doc", "development-order", "development-order_TestApp.md"));
		assert.deepEqual(entry.inputs, stamped);

		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "ordered-development", "approve did not advance");
	});

	it("table-driven guard: every publishable STAGE_TRANSITIONS row has a stageToArtifact mapping", () => {
		const publishable = STAGE_TRANSITIONS.filter((t) => t.command.endsWith("-approve"));
		assert.equal(publishable.length, 9, "expected the 9 per-stage approve transitions");
		for (const t of publishable) {
			assert.ok(
				stageToArtifact(t.from) !== null,
				`${t.command}: no stageToArtifact mapping for stage "${t.from}"`,
			);
			// The rest state right after the approve must map too — a
			// re-publish from the rest state goes through the same switch.
			assert.ok(
				stageToArtifact(t.to) !== null,
				`${t.command}: no stageToArtifact mapping for rest state "${t.to}"`,
			);
		}
	});
});
