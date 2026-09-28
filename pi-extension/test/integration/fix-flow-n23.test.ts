/**
 * Phase 6.3 — integration: the N23 publish invariant gets its own
 * executable guard (plan §6.3).
 *
 *   1. The publish gate still refuses on a doctor-error fixture (the C
 *      side asserts the gate was never weakened by the fix-flow wiring).
 *   2. `runFixFlow` over a report whose items all suggest stage/approve
 *      commands performs NO state advance, NO store write, and creates
 *      NO `Doc/` artifact beyond what the (spied) safe batch would touch.
 *   3. Source scan: `fix-flow.ts` / `preflight.ts` / `self-heal.ts`
 *      import no approve/publish machinery (comments stripped first).
 *
 * Deviation (recorded): the plan says "spy on `advanceStage` + store
 * publish exports" — ESM live bindings cannot be spied without loader
 * hooks, so the invariant is asserted on OBSERVABLE STATE instead
 * (state.json bytes, store bytes, `Doc/` listing) plus injected
 * `runAuto`/`dispatchOne` spies for the flow's own side-effect paths.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPublishGate } from "../../src/doctor/gate.js";
import { runFixFlow, type PreflightUi } from "../../src/doctor/fix-flow.js";
import { SUGGESTIONS } from "../../src/doctor/checks/fix-suggestions.js";
import type { ActionableItem } from "../../src/doctor/fix-dispatch.js";
import type { DiagnosticReport } from "../../src/doctor/_types.js";
import { fileURLToPath } from "node:url";

let tmpDir = "";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-n23-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Write the minimal run state.
 * @param {string} currentStage - Stage flag to freeze for the assertion.
 * @returns {void} Nothing.
 */
function writeState(currentStage: string): void {
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "state.json"),
		JSON.stringify({
			version: 1,
			runId: "run-n23",
			mission: "n23 mission",
			currentStage,
			history: [],
			updatedAt: new Date().toISOString(),
		}),
		"utf8",
	);
}

/**
 * Strip block + line comments from TypeScript source (so prose that
 * NAMES a forbidden module does not trip the import scan).
 * @param {string} src - Raw source text.
 * @returns {string} The source with comments removed.
 */
function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("integration — N23: fix flow never approves or publishes", () => {
	it("1. runPublishGate still refuses on a doctor-error fixture", () => {
		// The fixture is a state the doctor would flag; the gate's own
		// content validation must still refuse an invalid working copy
		// (config kept valid — the gate parses it for tier-aware checks).
		writeFileSync(
			join(tmpDir, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: "N23App" }),
			"utf8",
		);
		const result = runPublishGate({
			artifact: "PRD",
			workingContent: "# not a PSRS document\n\nno required sections here\n",
			cwd: tmpDir,
			projectName: "N23App",
		});
		assert.ok(result.errors.length > 0, "the publish gate must still refuse with errors");
	});

	it("2. Fix all over stage/approve suggestions advances nothing, writes nothing", async () => {
		writeState("drafted-prd");
		const stateBefore = readFileSync(join(tmpDir, ".pi", "velpari", "state.json"), "utf8");
		// No store, no Doc/ — enumerate what exists before the flow.
		const docBefore = existsSync(join(tmpDir, "Doc")) ? readdirSync(join(tmpDir, "Doc")) : null;

		// Report items: one manual (stage command suggestion) + one whose
		// suggestion key is auto-safe (the batch runs the whitelisted fn).
		const report: DiagnosticReport = {
			ok: false,
			summary: { ok: 0, warning: 2, error: 0, info: 0 },
			sections: [
				{
					title: "N23 fixture",
					items: [
						{
							status: "warning",
							message: "artifact missing — run the stage command",
							suggestion: SUGGESTIONS["artifact-missing"],
						},
						{
							status: "warning",
							message: "tracked config unreadable",
							suggestion: SUGGESTIONS["config-restore-git"],
						},
					],
				},
			],
		};

		let autoCalls = 0;
		const dispatched: ActionableItem[] = [];
		const ui: PreflightUi = {
			notify: () => {},
			select: async () => "Fix all (Recommended)",
			confirm: async () => true,
		};
		const outcome = await runFixFlow({
			ui,
			cwd: tmpDir,
			projectName: "N23App",
			source: { kind: "doctor", report },
			// Re-audit is clean by fixture: the flow completes as "fixed".
			reRun: async () => ({ ok: true, actionableCount: 0 }),
			// Spies: the batch executor does nothing real; the manual
			// dispatch records but never invokes a /velpari-* command.
			runAuto: async () => {
				autoCalls += 1;
			},
			dispatchOne: async (item: ActionableItem) => {
				dispatched.push(item);
			},
		});
		assert.equal(outcome.action, "fixed");
		assert.equal(autoCalls, 1, "the auto batch runs exactly once");
		assert.equal(dispatched.length, 1, "the single manual item is dispatched to the caller's handler");

		// The invariant: observable state is byte-identical.
		const stateAfter = readFileSync(join(tmpDir, ".pi", "velpari", "state.json"), "utf8");
		assert.equal(stateAfter, stateBefore, "state.json must NOT change (no stage advance)");
		assert.equal(existsSync(join(tmpDir, "Doc")), docBefore === null ? false : true);
		const docAfter = existsSync(join(tmpDir, "Doc")) ? readdirSync(join(tmpDir, "Doc")) : null;
		assert.deepEqual(docAfter, docBefore, "no Doc/ artifact may appear");
		assert.equal(existsSync(join(tmpDir, "Doc", "store")), false, "no store DB may appear");
	});

	it("3. import scan: fix-flow / preflight / self-heal import no approve/publish machinery", () => {
		// Scan the COMPILED modules (same convention as the Phase 3
		// self-heal import scan): dist test → ../../src/<module>.js.
		const files = ["doctor/fix-flow.js", "doctor/preflight.js", "ops/self-heal.js"].map((rel) =>
			fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)),
		);
		for (const file of files) {
			assert.ok(existsSync(file), `missing source: ${file}`);
			const code = stripComments(readFileSync(file, "utf8"));
			for (const token of ["handleApprove", "stage-publish", "runPublishGate", "ops/approve"]) {
				assert.equal(
					code.includes(token),
					false,
					`${file} must not reference ${token} outside comments (N23)`,
				);
			}
		}
	});
});
