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
	BRAINSTORM_ROLES,
	DEFAULT_AGENTS,
	GENERATION_PHASES,
	REVIEWER_ROLES,
	STAGE_SCOUT_ROLES,
	VELPARI_ROLES,
	ROLE_LABELS,
	discoverAgents,
	getAgentConfigPath,
	loadAgentConfig,
	phaseForStage,
	resolveAgentName,
	saveAgentConfig,
	validateMappedAgents,
	type AgentConfig,
	type VelpariRole,
} from "../../src/core/agents-config.js";
import { STAGE_TRANSITIONS } from "../../src/core/constants.js";
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

		const onDisk = JSON.parse(readFileSync(getAgentConfigPath(cwd), "utf8")) as Record<string, unknown>;
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
			assert.ok((VELPARI_ROLES as readonly string[]).includes(name), `scan role "${name}" missing from VELPARI_ROLES`);
		}
	});
});

describe("GENERATION_PHASES (generator v2)", () => {
	it("P1 = the 4 brainstorm roles with no artifact inputs", () => {
		assert.deepEqual([...GENERATION_PHASES[1].roles], [...BRAINSTORM_ROLES]);
		assert.deepEqual([...GENERATION_PHASES[1].inputs], []);
	});

	it("phase role counts match the per-phase mapping (4 / 14 / 17 / 12)", () => {
		assert.equal(GENERATION_PHASES[1].roles.length, 4);
		assert.equal(GENERATION_PHASES[2].roles.length, 14);
		assert.equal(GENERATION_PHASES[3].roles.length, 17);
		assert.equal(GENERATION_PHASES[4].roles.length, 12);
	});

	it("phase roles derive from STAGE_REGISTRY (registry/phase drift fails this test)", () => {
		// P2 = prd + rtm + feasibility scouts + the 2 conditional roles,
		// in registry order.
		const p2 = [
			...STAGE_REGISTRY.prd.scouts,
			...STAGE_REGISTRY.rtm.scouts,
			...STAGE_REGISTRY.feasibility.scouts,
			...(STAGE_REGISTRY.feasibility.conditionalAgents ?? []),
		];
		assert.deepEqual([...GENERATION_PHASES[2].roles], p2);

		// P3 = design + atomic-function + pseudocode scouts (each registry
		// scout list already carries its own reviewer) + the testplan
		// reviewer — all 4 reviewers generate at the Phase-3 boundary by
		// design (the tier gate decides at spawn time, not at generation).
		const p3 = new Set([
			...STAGE_REGISTRY["architecture-generator"].scouts,
			...STAGE_REGISTRY["atomic-function"].scouts,
			...STAGE_REGISTRY.pseudocode.scouts,
			"testplan-reviewer",
		]);
		assert.deepEqual(new Set(GENERATION_PHASES[3].roles), p3);

		// P4 = testplan scouts minus the reviewer + dev-order + final-design,
		// in registry order.
		const p4 = [
			...STAGE_REGISTRY.testplan.scouts.filter((s) => s !== "testplan-reviewer"),
			...STAGE_REGISTRY["development-order"].scouts,
			...STAGE_REGISTRY["final-design"].scouts,
		];
		assert.deepEqual([...GENERATION_PHASES[4].roles], p4);
	});

	it("every phase role is a known Velpari role", () => {
		for (const phase of [1, 2, 3, 4] as const) {
			for (const role of GENERATION_PHASES[phase].roles) {
				assert.ok(
					(VELPARI_ROLES as readonly string[]).includes(role),
					`phase ${phase} role "${role}" missing from VELPARI_ROLES`,
				);
			}
		}
	});

	it("logging scouts stay bundled-only (not phase-mapped)", () => {
		const allPhaseRoles = [1, 2, 3, 4].flatMap((p) => [...GENERATION_PHASES[p as 1 | 2 | 3 | 4].roles]);
		for (const loggingRole of [
			"logging-standards-researcher",
			"logging-architecture-designer",
			"logging-compliance-mapper",
		]) {
			assert.ok(!allPhaseRoles.includes(loggingRole), `${loggingRole} must not be phase-mapped`);
		}
	});
});

describe("phaseForStage", () => {
	it("maps pre-brainstorm and in-flight brainstorm to phase 1", () => {
		assert.equal(phaseForStage("none"), 1);
		assert.equal(phaseForStage("brainstorming"), 1);
	});

	it("maps completed stages to the phase of their successor (boundary crossings)", () => {
		assert.equal(phaseForStage("brainstormed"), 2);
		assert.equal(phaseForStage("analyzed-feasibility"), 3);
		assert.equal(phaseForStage("wrote-pseudocode"), 4);
	});

	it("maps in-progress and same-phase-completed stages to their own phase", () => {
		assert.equal(phaseForStage("drafting-prd"), 2);
		assert.equal(phaseForStage("built-rtm"), 2);
		assert.equal(phaseForStage("designing"), 3);
		assert.equal(phaseForStage("analyzed-atomic-functions"), 3);
		assert.equal(phaseForStage("planning-tests"), 4);
		assert.equal(phaseForStage("ordered-development"), 4);
	});

	it("maps terminal stages to phase 4", () => {
		assert.equal(phaseForStage("finalized-design"), 4);
		assert.equal(phaseForStage("handoff-ready"), 4);
	});

	it("returns a valid phase for every Stage value in STAGE_TRANSITIONS", () => {
		for (const t of STAGE_TRANSITIONS) {
			for (const stage of [t.from, t.to]) {
				const phase = phaseForStage(stage);
				assert.ok(phase >= 1 && phase <= 4, `stage "${stage}" mapped to ${phase}`);
			}
		}
	});
});
