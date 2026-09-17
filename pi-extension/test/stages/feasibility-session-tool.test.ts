/**
 * velpari_feasibility_session tool tests (feasibility v2, Phase 3).
 *
 * Covers stages/feasibility-session-tool.ts:
 *   - registration + stage gating (only analyzing-feasibility)
 *   - set-consent / set-decision / set-candidates / add-spike-result /
 *     select-language actions, persistence, and entry mirroring
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerFeasibilitySessionTool } from "../../src/stages/feasibility-session-tool.js";
import { advanceStage, createRun, loadState } from "../../src/core/state.js";

interface ToolDef {
	name: string;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: undefined,
		onUpdate: undefined,
		ctx: { cwd: string },
	) => Promise<{ content: Array<{ text: string }>; details: unknown; isError?: boolean }>;
}

let tmpDir: string;
let tool: ToolDef;
let entries: Array<{ customType: string; data: unknown }>;

function makePi(): ExtensionAPI {
	entries = [];
	const pi = {
		registerTool: (def: ToolDef) => {
			tool = def;
		},
		appendEntry: (customType: string, data: unknown) => {
			entries.push({ customType, data });
		},
	};
	return pi as unknown as ExtensionAPI;
}

function exec(params: Record<string, unknown>) {
	return tool.execute("tc-1", params, undefined, undefined, { cwd: tmpDir });
}

/** Drive a fresh run into analyzing-feasibility through the transition table. */
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
	assert.equal(loadState(tmpDir).currentStage, "analyzing-feasibility");
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-feasibility-tool-"));
	registerFeasibilitySessionTool(makePi());
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("velpari_feasibility_session tool", () => {
	it("registers under the velpari_feasibility_session name", () => {
		assert.equal(tool.name, "velpari_feasibility_session");
	});

	it("errors when no feasibility stage is active", async () => {
		const res = await exec({ action: "set-consent", consent: true });
		assert.equal(res.isError, true);
		assert.match(res.content[0]!.text, /\/velpari-feasibility/);
		assert.equal(entries.length, 0);
	});

	it("set-consent + set-decision persist and return a snapshot", async () => {
		enterFeasibility();
		const res1 = await exec({ action: "set-consent", consent: true });
		assert.equal(res1.isError, undefined);
		const res2 = await exec({
			action: "set-decision",
			decision: "build",
			reuseSummary: ["| acme/x | 12% | MIT | low |"],
		});
		const snap = res2.details as { feasibilitySession: Record<string, unknown> };
		assert.equal(snap.feasibilitySession.decision, "build");
		assert.deepEqual(snap.feasibilitySession.reuseSummary, ["| acme/x | 12% | MIT | low |"]);

		const loaded = loadState(tmpDir).feasibilitySession;
		assert.equal(loaded?.reuseConsent, true);
		assert.equal(loaded?.decision, "build");
		assert.equal(entries.length, 2);
		assert.equal(entries[1]!.customType, "velpari-feasibility");
	});

	it("set-candidates dedupes and rejects an empty list", async () => {
		enterFeasibility();
		const bad = await exec({ action: "set-candidates", languageCandidates: [] });
		assert.equal(bad.isError, true);
		const res = await exec({
			action: "set-candidates",
			languageCandidates: ["go", "typescript", "go"],
		});
		const snap = res.details as { feasibilitySession: { languageCandidates: string[] } };
		assert.deepEqual(snap.feasibilitySession.languageCandidates, ["go", "typescript"]);
	});

	it("add-spike-result validates structure and replaces per language", async () => {
		enterFeasibility();
		const invalid = await exec({ action: "add-spike-result", spike: { language: "go" } });
		assert.equal(invalid.isError, true);
		assert.match(invalid.content[0]!.text, /Invalid spike result/);

		const mk = (runOk: boolean) => ({
			language: "go",
			coreFunction: "FR-01",
			buildOk: true,
			runOk,
			notes: "n",
			evidencePath: "spikes/go/main.go",
		});
		await exec({ action: "add-spike-result", spike: mk(false) });
		const res = await exec({ action: "add-spike-result", spike: mk(true) });
		const snap = res.details as { feasibilitySession: { spikeResults: Array<{ runOk: boolean }> } };
		assert.equal(snap.feasibilitySession.spikeResults.length, 1);
		assert.equal(snap.feasibilitySession.spikeResults[0]!.runOk, true);
	});

	it("select-language requires both fields and persists them", async () => {
		enterFeasibility();
		const bad = await exec({ action: "select-language", selectedLanguage: "go" });
		assert.equal(bad.isError, true);
		const res = await exec({
			action: "select-language",
			selectedLanguage: "go",
			selectedBy: "user",
		});
		const snap = res.details as {
			feasibilitySession: { selectedLanguage: string; selectedBy: string };
		};
		assert.equal(snap.feasibilitySession.selectedLanguage, "go");
		assert.equal(snap.feasibilitySession.selectedBy, "user");
		assert.equal(loadState(tmpDir).feasibilitySession?.selectedLanguage, "go");
	});
});
