/**
 * E2E integration tests for Velpari's config systems (files.json v4 +
 * agents.json), running inside a real `pi --mode rpc` process.
 *
 * Mirrors the doctor suite's approach: every assertion drives the BUILT
 * modules (`dist/pi-extension/src/core/*.js`) through the RPC `bash`
 * channel with cwd = the synthetic temp project, so we exercise the same
 * compiled JS that Pi loads — no mocks, no LLM.
 *
 * Covered here:
 *   1. files.json v3 → v4 migration on load (`loadFilesConfig`)
 *   2. project file discovery (`discoverProjectFiles`)
 *   3. agents.json absent → all defaults, file never auto-created
 *   4. agents.json save → load → resolve → validate round-trip
 *   5. `discoverAgents` sees project agents + bundled defaults
 *
 * Tier 1 only. No LLM key required.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RpcClient } from "./helpers/rpc-client.js";
import {
	makeTestHome,
	distModuleUrl,
	shouldRunE2E,
	type TestHome,
} from "./helpers/test-home.js";
import {
	makeMinimalProjectFiles,
	seedVelpariConfigV3,
} from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

/** Run `script` (ESM source) in the temp project via the RPC bash
 *  channel and return the JSON payload it printed to stdout. */
async function runModuleScript<T>(
	client: RpcClient,
	script: string,
): Promise<T> {
	const result = await client.request<any>("bash", {
		command: ["node --input-type=module -e", JSON.stringify(script)].join(" "),
	});
	assert.ok(
		result.success === true,
		`subprocess failed: ${JSON.stringify(result.error ?? result)}`,
	);
	const output: string = result.data?.output ?? result.output ?? "";
	assert.ok(output.length > 0, "subprocess produced no output");
	return JSON.parse(output) as T;
}

describe("e2e/config", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("loadFilesConfig migrates a v3 files.json to v4", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");
		seedVelpariConfigV3(home, { projectName: "E2EFixture" });

		const cfg = await runModuleScript<any>(
			client,
			`import { loadFilesConfig } from ${JSON.stringify(distModuleUrl("core/config.js"))}; ` +
				`process.stdout.write(JSON.stringify(loadFilesConfig(process.cwd())));`,
		);

		assert.strictEqual(cfg.version, 4, "config not migrated to version 4");
		assert.strictEqual(cfg.projectName, "E2EFixture", "projectName lost in migration");
		assert.deepStrictEqual(
			cfg.framework,
			{ language: "typescript", runtime: "node" },
			"framework lost in migration",
		);
		assert.ok(Array.isArray(cfg.codePaths), "v4 codePaths missing");
		assert.ok(Array.isArray(cfg.testPaths), "v4 testPaths missing");
		assert.ok(
			cfg.excludedPaths.includes("node_modules/"),
			"v4 excludedPaths missing DEFAULT_EXCLUDED_PATHS entries",
		);
		// Migration is in-memory only — the on-disk file stays v3 until the
		// user re-saves via /velpari-configure-inputs.
	});

	it("discoverProjectFiles scans the fixture project and honours excludedPaths", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const found = await runModuleScript<any>(
			client,
			`import { discoverProjectFiles } from ${JSON.stringify(distModuleUrl("core/files-discovery.js"))}; ` +
				`import { DEFAULT_EXCLUDED_PATHS } from ${JSON.stringify(distModuleUrl("core/config.js"))}; ` +
				`process.stdout.write(JSON.stringify(discoverProjectFiles(process.cwd(), [...DEFAULT_EXCLUDED_PATHS])));`,
		);

		// By design, known code/test folders are suggested as folders
		// (their contents are not enumerated); only root-level files and
		// document-folder contents land in the *Files lists.
		const codeFolderPaths = found.codeFolders.map((f: { path: string }) => f.path);
		const testFolderPaths = found.testFolders.map((f: { path: string }) => f.path);
		assert.ok(codeFolderPaths.includes("src/"), `src/ not suggested as a code folder: ${JSON.stringify(found)}`);
		assert.ok(testFolderPaths.includes("test/"), `test/ not suggested as a test folder: ${JSON.stringify(found)}`);
		assert.ok(
			found.documentFiles.includes("README.md"),
			`README.md not classified as a document file: ${JSON.stringify(found.documentFiles)}`,
		);
		const flat = JSON.stringify(found);
		assert.ok(!flat.includes("node_modules"), "excludedPaths not honoured");
		assert.ok(!flat.includes(".git"), "excludedPaths not honouring .git");
	});

	it("absent agents.json means all defaults and no file is auto-created", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");
		const configPath = join(home.cwd, ".pi", "velpari", "agents.json");
		assert.ok(!existsSync(configPath), "agents.json unexpectedly present before test");

		const out = await runModuleScript<any>(
			client,
			`import { loadAgentConfig, resolveAgentName } from ${JSON.stringify(distModuleUrl("core/agents-config.js"))}; ` +
				`const cfg = loadAgentConfig(process.cwd()); ` +
				`process.stdout.write(JSON.stringify({ loaded: cfg, resolved: resolveAgentName(cfg, "extractor") }));`,
		);

		assert.strictEqual(out.loaded, null, "loadAgentConfig should return null when agents.json is absent");
		assert.strictEqual(out.resolved, "extractor", "absent config should resolve to the default (identity) mapping");
		assert.ok(!existsSync(configPath), "agents.json was auto-created by a read path");
	});

	it("agents.json save → load → resolve → validate round-trip", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		// A project-local custom agent the mapping will point at.
		const agentsDir = join(home.cwd, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "test-scout.md"),
			"---\nname: test-scout\ndescription: E2E fixture scout\n---\n\n# test-scout\n",
			"utf8",
		);

		const out = await runModuleScript<any>(
			client,
			`import { saveAgentConfig, loadAgentConfig, resolveAgentName, validateMappedAgents } from ${JSON.stringify(distModuleUrl("core/agents-config.js"))}; ` +
				`const cwd = process.cwd(); ` +
				`saveAgentConfig(cwd, { version: 1, agents: { extractor: "test-scout" } }); ` +
				`const cfg = loadAgentConfig(cwd); ` +
				`process.stdout.write(JSON.stringify({` +
				`  resolved: resolveAgentName(cfg, "extractor"),` +
				`  fallback: resolveAgentName(cfg, "consolidator"),` +
				`  okErrors: validateMappedAgents(cwd, cfg),` +
				`  ghostErrors: validateMappedAgents(cwd, { version: 1, agents: { extractor: "ghost-agent" } }),` +
				`}));`,
		);

		assert.strictEqual(out.resolved, "test-scout", "mapped role did not resolve to the custom agent");
		assert.strictEqual(out.fallback, "consolidator", "unmapped role did not fall back to its default");
		assert.deepStrictEqual(out.okErrors, [], "valid mapping reported validation errors");
		assert.strictEqual(out.ghostErrors.length, 1, "missing agent mapping should produce exactly one error");
		assert.ok(
			String(out.ghostErrors[0]).includes("ghost-agent"),
			"validation error should name the missing agent",
		);
	});

	it("discoverAgents sees project agents and bundled defaults", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const agents = await runModuleScript<any[]>(
			client,
			`import { discoverAgents } from ${JSON.stringify(distModuleUrl("core/agents-config.js"))}; ` +
				`process.stdout.write(JSON.stringify(discoverAgents(process.cwd())));`,
		);

		const project = agents.find((a) => a.name === "test-scout");
		assert.ok(project, "project agent test-scout not discovered");
		assert.strictEqual(project.source, "project", "test-scout should come from the project source");

		const bundled = agents.find((a) => a.name === "extractor");
		assert.ok(bundled, "bundled default extractor not discovered");
		assert.strictEqual(bundled.source, "bundled", "extractor should come from the bundled source");

		const names = agents.map((a) => a.name);
		assert.strictEqual(new Set(names).size, names.length, "duplicate agent names after dedup");
	});
});
