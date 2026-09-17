/**
 * agents.json config tests (Phase 5 — Senai parity).
 *
 * Covers:
 *   - loadAgentConfig returns null when agents.json is missing
 *   - save → load round-trip; `_comment` written to disk and stripped on load
 *   - throws on bad JSON, wrong version, unknown role, non-string value
 *   - resolveAgentName falls back to DEFAULT_AGENTS; custom mapping wins
 *   - validateMappedAgents: empty for defaults; flags missing custom agents;
 *     passes when the custom file exists in project .pi/agents/
 *   - discoverAgents: project agents found; bundled 36 always present;
 *     project shadows bundled on name collision
 *   - VELPARI_ROLES cross-check against STAGE_REGISTRY and SCAN_TYPE_ROLES
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AGENTS_CONFIG_COMMENT,
	AGENTS_CONFIG_FILE,
	DEFAULT_AGENTS,
	REVIEWER_ROLES,
	STAGE_SCOUT_ROLES,
	VELPARI_ROLES,
	ROLE_LABELS,
	discoverAgents,
	getAgentConfigPath,
	loadAgentConfig,
	resolveAgentName,
	saveAgentConfig,
	validateMappedAgents,
	type AgentConfig,
	type VelpariRole,
} from "../../src/core/agents-config.js";
import { STAGE_KEYS, STAGE_REGISTRY } from "../../src/stages/registry.js";
import { SCAN_TYPE_ROLES } from "../../src/stages/brainstorm/dispatcher.js";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-agents-config-"));
}

function writeRaw(cwd: string, raw: string): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "velpari", AGENTS_CONFIG_FILE), raw, "utf8");
}

function writeProjectAgent(cwd: string, name: string, description = "Custom test agent."): void {
	mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "agents", `${name}.md`),
		`---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`,
		"utf8",
	);
}

describe("loadAgentConfig", () => {
	it("returns null when agents.json is missing", () => {
		assert.equal(loadAgentConfig(tmp()), null);
	});

	it("throws on bad JSON", () => {
		const cwd = tmp();
		writeRaw(cwd, "{ not json");
		assert.throws(() => loadAgentConfig(cwd), /Invalid agent config at .*agents\.json/);
	});

	it("throws on wrong version", () => {
		const cwd = tmp();
		writeRaw(cwd, JSON.stringify({ version: 2, agents: {} }));
		assert.throws(() => loadAgentConfig(cwd), /version/);
	});

	it("throws on unknown role name", () => {
		const cwd = tmp();
		writeRaw(cwd, JSON.stringify({ version: 1, agents: { "not-a-role": "scout" } }));
		assert.throws(() => loadAgentConfig(cwd), /Unknown role "not-a-role"/);
	});

	it("throws on non-string value", () => {
		const cwd = tmp();
		writeRaw(cwd, JSON.stringify({ version: 1, agents: { extractor: 42 } }));
		assert.throws(() => loadAgentConfig(cwd), /agents\.extractor must be a string/);
	});
});

describe("saveAgentConfig → loadAgentConfig round-trip", () => {
	it("round-trips and strips _comment on load", () => {
		const cwd = tmp();
		const config: AgentConfig = {
			version: 1,
			agents: { extractor: "my-extractor", "do-value": "my-do-value" },
		};
		saveAgentConfig(cwd, config);

		const onDisk = JSON.parse(readFileSync(getAgentConfigPath(cwd), "utf8")) as Record<
			string,
			unknown
		>;
		assert.equal(onDisk._comment, AGENTS_CONFIG_COMMENT);

		const loaded = loadAgentConfig(cwd);
		assert.deepEqual(loaded, config);
		assert.equal((loaded as unknown as Record<string, unknown>)._comment, undefined);
	});
});

describe("resolveAgentName", () => {
	it("falls back to DEFAULT_AGENTS when config is null", () => {
		for (const role of VELPARI_ROLES) {
			assert.equal(resolveAgentName(null, role), DEFAULT_AGENTS[role]);
			assert.equal(resolveAgentName(null, role), role);
		}
	});

	it("falls back per-role when the config has no mapping", () => {
		const config: AgentConfig = { version: 1, agents: {} };
		assert.equal(resolveAgentName(config, "fr-extractor"), "fr-extractor");
	});

	it("custom mapping wins", () => {
		const config: AgentConfig = { version: 1, agents: { "fr-extractor": "custom-fr" } };
		assert.equal(resolveAgentName(config, "fr-extractor"), "custom-fr");
		assert.equal(resolveAgentName(config, "nfr-checker"), "nfr-checker");
	});
});

describe("validateMappedAgents", () => {
	it("returns no errors for the default (identity) mappings", () => {
		const config: AgentConfig = {
			version: 1,
			agents: Object.fromEntries(VELPARI_ROLES.map((r) => [r, r])),
		};
		assert.deepEqual(validateMappedAgents(tmp(), config), []);
	});

	it("flags a custom name with no file anywhere", () => {
		const cwd = tmp();
		const config: AgentConfig = {
			version: 1,
			agents: { extractor: "definitely-not-a-real-agent-xyz" },
		};
		const errors = validateMappedAgents(cwd, config);
		assert.equal(errors.length, 1);
		assert.match(errors[0]!, /definitely-not-a-real-agent-xyz/);
		assert.match(errors[0]!, /extractor/);
	});

	it("passes when the custom file exists in project .pi/agents/", () => {
		const cwd = tmp();
		writeProjectAgent(cwd, "my-custom-extractor");
		const config: AgentConfig = { version: 1, agents: { extractor: "my-custom-extractor" } };
		assert.deepEqual(validateMappedAgents(cwd, config), []);
	});
});

describe("discoverAgents", () => {
	it("finds a project agent written into .pi/agents/", () => {
		const cwd = tmp();
		writeProjectAgent(cwd, "my-scout", "My custom scout.");
		const found = discoverAgents(cwd).find((a) => a.name === "my-scout");
		assert.ok(found);
		assert.equal(found.source, "project");
		assert.equal(found.description, "My custom scout.");
		assert.ok(found.filePath?.endsWith(join(".pi", "agents", "my-scout.md")));
	});

	it("always includes the 39 bundled defaults", () => {
		const agents = discoverAgents(tmp());
		for (const role of VELPARI_ROLES) {
			const found = agents.find((a) => a.name === role);
			assert.ok(found, `bundled default "${role}" missing from discovery`);
			// A role may be shadowed by a user-level agent file (~/.pi/agent/agents/<role>.md).
			// Discovery still surfaces it — the source just becomes "user" instead of "bundled".
			// Both are valid discovery results for the test runner.
			assert.ok(
				found.source === "bundled" || found.source === "user",
				`unexpected source "${found.source}" for role "${role}"`,
			);
		}
	});

	it("project agent shadows a bundled default on name collision", () => {
		const cwd = tmp();
		writeProjectAgent(cwd, "fr-extractor", "Project override of the FR extractor.");
		const agents = discoverAgents(cwd);
		const matches = agents.filter((a) => a.name === "fr-extractor");
		assert.equal(matches.length, 1);
		assert.equal(matches[0]!.source, "project");
		assert.equal(matches[0]!.description, "Project override of the FR extractor.");
	});
});

describe("VELPARI_ROLES cross-check", () => {
	it("has exactly 54 entries (4 brainstorm + 41 stage scouts + 2 feasibility-conditional + 3 logging + 4 reviewer roles — reviewer roles are listed in BOTH STAGE_SCOUT_ROLES and REVIEWER_ROLES by design)", () => {
		// Plan D adds 3 reviewer roles (pseudocode / testplan / design) on top
		// of the original "reviewer" (atomic-function). STAGE_SCOUT_ROLES now
		// has 41 entries (was 38). REVIEWER_ROLES has 4 entries (was 1).
		// The reviewer roles intentionally appear in both arrays — once in
		// STAGE_SCOUT_ROLES (for the registry-order cross-check) and once
		// in REVIEWER_ROLES (for the reviewer-specific helpers). This is
		// the same pattern that existed before Plan D.
		assert.equal(VELPARI_ROLES.length, 54);
		assert.equal(STAGE_SCOUT_ROLES.length, 41);
		assert.equal(REVIEWER_ROLES.length, 4);
	});

	it("covers every SCAN_TYPE_ROLES entry", () => {
		const scanRoles = Object.values(SCAN_TYPE_ROLES).flat();
		for (const name of scanRoles) {
			assert.ok(
				(VELPARI_ROLES as readonly string[]).includes(name),
				`scan role "${name}" missing from VELPARI_ROLES`,
			);
		}
	});
});
