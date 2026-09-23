/**
 * arch-context.ts tests — Step 2 of the architecture sub-life cycle.
 *
 * Covers:
 *   - happy path: all inputs present
 *   - missing PRD / RTM / feasibility surfaced in `missingInputs`
 *   - missing files.json / requirements-profile / agents.json
 *   - parse error on a malformed JSON file
 *   - summarizeArchContext output contains key fields
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadArchContext, summarizeArchContext } from "../../src/core/arch-context.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-arch-ctx-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function writeFilesConfig(projectName: string, frameworkLanguage = "typescript"): void {
	const filesJson = {
		version: 4,
		projectName,
		framework: { language: frameworkLanguage },
		codePaths: ["src/**"],
		inputDocuments: [],
		testPaths: ["test/**"],
		outputPaths: {},
		excludedPaths: ["node_modules/**"],
	};
	writeFileSync(join(tmpDir, ".pi", "velpari", "files.json"), JSON.stringify(filesJson), "utf8");
}

function writeRequirementsProfile(profileId: string): void {
	const profile = {
		version: "1.1.0",
		profileId,
		profileKind: "common-core",
		applicationType: "web",
		domain: "general",
		developmentMethod: "agile",
		regulated: false,
		securityLevel: "low",
		requiredSections: [],
		conditionalQuestions: [],
		outputVariant: "standard",
		createdAt: "2026-09-13T00:00:00.000Z",
		researchConsent: false,
		researchSources: [],
	};
	writeFileSync(join(tmpDir, ".pi", "velpari", "requirements-profile.json"), JSON.stringify(profile), "utf8");
}

function writePublishedDoc(category: string, name: string, body: string): void {
	const dir = join(tmpDir, "Doc", category);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${name}.md`), body, "utf8");
}

describe("loadArchContext — happy path", () => {
	it("returns a complete ArchContext when every input is present", () => {
		writeFilesConfig("TodoApp");
		writeRequirementsProfile("core-psrs-v1");
		writePublishedDoc("requirements", "PRD_TodoApp", "# PRD");
		writePublishedDoc("requirements", "RTM_TodoApp", "# RTM");
		writePublishedDoc("feasibility", "feasibility-study_TodoApp", "# Feasibility");
		writeFileSync(
			join(tmpDir, ".pi", "velpari", "agents.json"),
			JSON.stringify({ roles: { "design-checker": "my-checker" } }),
			"utf8",
		);

		const ctx = loadArchContext("2026-09-13-test", "Build a todo app", tmpDir);
		assert.strictEqual(ctx.runId, "2026-09-13-test");
		assert.strictEqual(ctx.mission, "Build a todo app");
		assert.strictEqual(ctx.projectName, "TodoApp");
		assert.ok(ctx.filesConfig, "filesConfig loaded");
		assert.strictEqual(ctx.filesConfig?.framework?.language, "typescript");
		assert.ok(ctx.requirementsProfile, "requirementsProfile loaded");
		assert.strictEqual(ctx.requirementsProfile?.profileId, "core-psrs-v1");
		assert.ok(ctx.prd, "PRD loaded");
		assert.ok(ctx.rtm, "RTM loaded");
		assert.ok(ctx.feasibility, "feasibility loaded");
		assert.ok(ctx.agentsConfig, "agentsConfig loaded");
		assert.deepEqual(ctx.missingInputs, [], "no missing inputs");
	});

	it("returns empty projectName when files.json is absent", () => {
		const ctx = loadArchContext("r", "m", tmpDir);
		assert.strictEqual(ctx.projectName, "");
		assert.ok(
			ctx.missingInputs.some((m) => m.kind === "filesConfig"),
			"filesConfig missing surfaced",
		);
	});
});

describe("loadArchContext — missing published artifacts", () => {
	it("reports missing PRD, RTM, and feasibility", () => {
		writeFilesConfig("TodoApp");
		const ctx = loadArchContext("r", "m", tmpDir);
		const kinds = ctx.missingInputs.map((m) => m.kind);
		assert.ok(kinds.includes("PRD"), "PRD missing");
		assert.ok(kinds.includes("RTM"), "RTM missing");
		assert.ok(kinds.includes("feasibility"), "feasibility missing");
	});

	it("loads the doc when the published artifact exists", () => {
		writeFilesConfig("TodoApp");
		writePublishedDoc("requirements", "PRD_TodoApp", "# PRD content");
		const ctx = loadArchContext("r", "m", tmpDir);
		assert.ok(ctx.prd);
		assert.strictEqual(ctx.prd?.content, "# PRD content");
	});
});

describe("loadArchContext — parse error resilience", () => {
	it("returns null filesConfig and surfaces it in missingInputs on malformed JSON", () => {
		writeFileSync(join(tmpDir, ".pi", "velpari", "files.json"), "{not-json", "utf8");
		const ctx = loadArchContext("r", "m", tmpDir);
		assert.strictEqual(ctx.filesConfig, null);
		assert.ok(ctx.missingInputs.some((m) => m.kind === "filesConfig"));
	});
});

describe("loadArchContext — optional standards profile", () => {
	it("returns null standardsProfile when the file is absent", () => {
		writeFilesConfig("TodoApp");
		const ctx = loadArchContext("r", "m", tmpDir);
		assert.strictEqual(ctx.standardsProfile, null);
	});

	it("returns null standardsProfile when the JSON is malformed", () => {
		writeFileSync(join(tmpDir, ".pi", "velpari", "standards-profile.json"), "{not-json", "utf8");
		writeFilesConfig("TodoApp");
		const ctx = loadArchContext("r", "m", tmpDir);
		assert.strictEqual(ctx.standardsProfile, null);
	});

	it("loads a valid standards profile", () => {
		writeFileSync(
			join(tmpDir, ".pi", "velpari", "standards-profile.json"),
			JSON.stringify({
				id: "medical-device-b",
				version: "1.0.0",
				selectedAt: "2026-09-13T00:00:00.000Z",
				selectedBy: "user",
			}),
			"utf8",
		);
		writeFilesConfig("TodoApp");
		const ctx = loadArchContext("r", "m", tmpDir);
		assert.ok(ctx.standardsProfile);
		assert.strictEqual(ctx.standardsProfile?.id, "medical-device-b");
	});
});

describe("summarizeArchContext", () => {
	it("includes project, mission, framework, overlay, and artifact paths", () => {
		writeFilesConfig("TodoApp", "next");
		writePublishedDoc("requirements", "PRD_TodoApp", "# PRD");
		const ctx = loadArchContext("run-1", "build todo", tmpDir);
		const summary = summarizeArchContext(ctx);
		assert.match(summary, /Project: TodoApp/);
		assert.match(summary, /Mission: build todo/);
		assert.match(summary, /Run: run-1/);
		assert.match(summary, /Framework: next/);
		assert.match(summary, /Standards overlay: \(none\)/);
		assert.match(summary, /PRD: .*PRD_TodoApp\.md/);
		assert.match(summary, /RTM: missing/);
		assert.match(summary, /Feasibility: missing/);
	});

	it("lists missing inputs when present", () => {
		writeFilesConfig("TodoApp");
		const ctx = loadArchContext("r", "m", tmpDir);
		const summary = summarizeArchContext(ctx);
		assert.match(summary, /Missing inputs: .*PRD/);
	});
});
