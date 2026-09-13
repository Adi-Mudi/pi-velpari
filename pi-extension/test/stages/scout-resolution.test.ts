/**
 * Scout role → agent-name resolution tests (Phase 6 — custom agents).
 *
 * Asserts:
 *   - buildScoutSlots keeps `name` = ROLE id and `reportPath` role-keyed,
 *     while `agentName` carries the resolved spawn name from agents.json
 *     (identity when no mapping exists)
 *   - runStage end-to-end: the prompt renders the role-keyed report path
 *     plus a `(spawn agent: ...)` note for remapped roles, and bootstrap
 *     installs only default-named roles (the remapped role is skipped —
 *     the custom agent must already exist)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildScoutSlots, runStage, STAGE_REGISTRY } from "../../src/stages/registry.js";
import { saveAgentConfig } from "../../src/core/agents-config.js";
import { advanceStage, createRun } from "../../src/core/state.js";
import { slugify } from "../../src/core/paths.js";

let tmpDir: string;
let notices: Array<{ message: string; level: string }>;
let sentMessages: string[];

function makeCtx(): ExtensionCommandContext {
	notices = [];
	return {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
		},
	} as unknown as ExtensionCommandContext;
}

function makePi(): ExtensionAPI {
	sentMessages = [];
	return {
		sendUserMessage: (message: string) => {
			sentMessages.push(message);
		},
	} as unknown as ExtensionAPI;
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-scout-resolution-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildScoutSlots", () => {
	it("keeps name/reportPath role-keyed and resolves agentName from agents.json", () => {
		saveAgentConfig(tmpDir, { version: 1, agents: { "fr-extractor": "my-custom-fr" } });
		const scoutsDir = path.join(tmpDir, "run", "prd", "scouts");
		const slots = buildScoutSlots(STAGE_REGISTRY.prd, scoutsDir, tmpDir);
		assert.equal(slots.length, 4);
		const fr = slots.find((s) => s.name === "fr-extractor")!;
		assert.equal(fr.name, "fr-extractor");
		assert.ok(fr.reportPath.endsWith(path.join("scouts", "fr-extractor-report.json")));
		assert.equal(fr.agentName, "my-custom-fr");
		// Unmapped roles resolve to the identity.
		const nfr = slots.find((s) => s.name === "nfr-checker")!;
		assert.equal(nfr.agentName, "nfr-checker");
		assert.ok(nfr.reportPath.endsWith(path.join("scouts", "nfr-checker-report.json")));
	});

	it("resolves to the identity when agents.json is absent", () => {
		const scoutsDir = path.join(tmpDir, "run", "prd", "scouts");
		const slots = buildScoutSlots(STAGE_REGISTRY.prd, scoutsDir, tmpDir);
		for (const slot of slots) {
			assert.equal(slot.agentName, slot.name);
		}
	});
});

describe("runStage with a remapped role (end-to-end)", () => {
	function seedProject(): void {
		// State at "brainstormed" so the prd gate passes.
		const state = createRun("Test mission", tmpDir);
		advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		// files.json with projectName.
		const configPath = path.join(tmpDir, ".pi", "velpari", "files.json");
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				version: 3,
				projectName: "TestApp",
				framework: { language: "TypeScript" },
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			}),
			"utf8",
		);
		// The prd stage input: published brainstorm notes.
		const notesDir = path.join(tmpDir, "Doc", "brainstorm");
		fs.mkdirSync(notesDir, { recursive: true });
		fs.writeFileSync(
			path.join(notesDir, `brainstorm-${slugify("Test mission")}.md`),
			"# Brainstorm Notes\n",
			"utf8",
		);
	}

	it("renders role-keyed report paths + spawn note, and skips bootstrap for the remapped role", async () => {
		seedProject();
		saveAgentConfig(tmpDir, { version: 1, agents: { "fr-extractor": "my-custom-fr" } });

		await runStage("prd", makeCtx(), makePi(), tmpDir);

		assert.equal(sentMessages.length, 1, "expected a stage prompt handoff");
		const prompt = sentMessages[0]!;
		// Report paths stay role-keyed; the remapped role carries a spawn note.
		assert.match(prompt, /fr-extractor-report\.json: .*fr-extractor-report\.json \(spawn agent: my-custom-fr\)/);
		// Unmapped roles render without a spawn note.
		assert.match(prompt, /nfr-checker-report\.json: .*nfr-checker-report\.json\n/);
		assert.ok(!prompt.includes("spawn agent: nfr-checker"));

		// Bootstrap installed only the default-named roles.
		const agentsDir = path.join(tmpDir, ".pi", "agents");
		assert.ok(fs.existsSync(path.join(agentsDir, "nfr-checker.md")));
		assert.ok(!fs.existsSync(path.join(agentsDir, "fr-extractor.md")));
		assert.ok(!fs.existsSync(path.join(agentsDir, "my-custom-fr.md")));
	});
});
