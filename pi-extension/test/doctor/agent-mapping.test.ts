/**
 * Doctor agent-mapping tests (Phase 7).
 *
 * Asserts checkAgentMappingSection behaviour against a temp cwd:
 *   - missing agents.json → info item ("all defaults"), no errors
 *   - valid custom mapping with the custom agent file present → ok
 *   - mapping to a nonexistent agent → error per mapping
 *   - corrupt agents.json → single error item with the load message
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkAgentMappingSection } from "../../src/doctor/checks/agents.js";

let tmpDir: string;

function writeAgentsJson(config: unknown): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "agents.json"), JSON.stringify(config), "utf8");
}

function writeProjectAgent(name: string): void {
	const dir = path.join(tmpDir, ".pi", "agents");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, `${name}.md`),
		`---\nname: ${name}\ndescription: test agent\n---\n\nBody.\n`,
		"utf8",
	);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-agent-mapping-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("checkAgentMappingSection", () => {
	it("missing agents.json → info item, no errors", () => {
		const section = checkAgentMappingSection(tmpDir);
		assert.equal(section.title, "Agent mapping (agents.json)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /all 42 roles use bundled defaults/);
	});

	it("valid custom mapping with existing custom agent file → ok", () => {
		writeAgentsJson({ version: 1, agents: { "fr-extractor": "my-custom-fr" } });
		writeProjectAgent("my-custom-fr");

		const section = checkAgentMappingSection(tmpDir);
		const errors = section.items.filter((i) => i.status === "error");
		assert.equal(errors.length, 0);
		const ok = section.items.find((i) => i.status === "ok");
		assert.match(ok?.message ?? "", /1 custom mapping\(s\)/);
		// Custom mapping present → skill-markdown note is emitted.
		assert.ok(
			section.items.some(
				(i) => i.status === "info" && /Skill markdown references/.test(i.message),
			),
		);
	});

	it("mapping to a nonexistent agent → error item", () => {
		writeAgentsJson({
			version: 1,
			agents: { "fr-extractor": "nonexistent-agent-xyz-123" },
		});

		const section = checkAgentMappingSection(tmpDir);
		const errors = section.items.filter((i) => i.status === "error");
		assert.equal(errors.length, 1);
		assert.match(errors[0]?.message ?? "", /nonexistent-agent-xyz-123/);
		assert.match(errors[0]?.suggestion ?? "", /\/velpari-configure-agents/);
	});

	it("mapping to a bundled default name → ok (resolves without a file)", () => {
		writeAgentsJson({ version: 1, agents: { "fr-extractor": "consolidator" } });

		const section = checkAgentMappingSection(tmpDir);
		assert.ok(section.items.every((i) => i.status !== "error"));
	});

	it("corrupt agents.json → single error item with the load message", () => {
		const dir = path.join(tmpDir, ".pi", "velpari");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "agents.json"), "{ not json", "utf8");

		const section = checkAgentMappingSection(tmpDir);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "error");
		assert.match(section.items[0]?.message ?? "", /Invalid agent config/);
		assert.match(section.items[0]?.suggestion ?? "", /agents\.json/);
	});

	it("unknown role in agents.json → error item", () => {
		writeAgentsJson({ version: 1, agents: { "no-such-role": "extractor" } });

		const section = checkAgentMappingSection(tmpDir);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "error");
		assert.match(section.items[0]?.message ?? "", /Unknown role/);
	});
});
