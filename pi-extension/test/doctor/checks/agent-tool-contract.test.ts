/**
 * Tests for doctor/checks/agent-tool-contract.ts (DSI P1, D13).
 *
 * Fixtures live in a temp `.pi/agents/` tree; the real bundled templates
 * (package `skills/agents/<role>.md`) are the contract source, so the
 * `reviewer` role — contract `read, write, bash` — is the anchor role.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseToolsValue, roleToolContract } from "../../../src/core/agent-schema.js";
import { checkAgentToolContract } from "../../../src/doctor/checks/agent-tool-contract.js";

/** Contract for the bundled `reviewer` template (read, write, bash). */
const REVIEWER_CONTRACT = ["read", "write", "bash"];

/** Create a temp project root with `.pi/agents/`. */
function makeCwd(): string {
	const cwd = mkdtempSync(join(tmpdir(), "velpari-tool-contract-"));
	mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
	return cwd;
}

/** Write `.pi/agents/<name>.md` with a frontmatter `tools:` line. */
function writeAgent(cwd: string, name: string, tools: string): void {
	writeFileSync(join(cwd, ".pi", "agents", `${name}.md`), `---\nname: ${name}\ntools: ${tools}\n---\nbody\n`);
}

describe("doctor/checks/agent-tool-contract", () => {
	it("sanity: the bundled reviewer contract resolves", () => {
		assert.deepEqual(roleToolContract("reviewer"), REVIEWER_CONTRACT);
	});

	it("(a) a missing contract tool is exactly one error", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "reviewer", "read, bash");
			const section = checkAgentToolContract(cwd);
			assert.equal(section.title, "Agent tool contract");
			const errors = section.items.filter((i) => i.status === "error");
			assert.equal(errors.length, 1, "exactly one missing-tool error");
			assert.match(errors[0]!.message, /reviewer\.md/);
			assert.match(errors[0]!.message, /missing contract tool\(s\): write/);
			assert.ok(errors[0]!.suggestion, "error carries a fix suggestion");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("(b) an extra tool not in the contract is a warning", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "reviewer", "read, write, bash, edit");
			const section = checkAgentToolContract(cwd);
			const warnings = section.items.filter((i) => i.status === "warning");
			assert.equal(warnings.length, 1, "exactly one extra-tool warning");
			assert.match(warnings[0]!.message, /outside the contract: edit/);
			assert.equal(section.items.filter((i) => i.status === "error").length, 0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("(c) a correct agent is ok", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "reviewer", "bash, read, write");
			const section = checkAgentToolContract(cwd);
			const ok = section.items.filter((i) => i.status === "ok");
			assert.equal(ok.length, 2, "one ok item for the agent + one ok summary");
			assert.ok(ok.some((i) => /tools match the contract/.test(i.message)));
			assert.equal(section.items.filter((i) => i.status === "error").length, 0);
			assert.equal(section.items.filter((i) => i.status === "warning").length, 0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("(d) a role with no template is skipped (no item)", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "reviewer", "read, bash");
			const section = checkAgentToolContract(cwd, {
				roles: ["reviewer"],
				contractFor: () => null,
			});
			assert.equal(section.items.length, 1, "only the summary item");
			assert.match(section.items[0]!.message, /0 checked, 1 skipped/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("(e) a missing agent file is skipped (no item)", () => {
		const cwd = makeCwd();
		try {
			const section = checkAgentToolContract(cwd, { roles: ["reviewer"] });
			assert.equal(section.items.length, 1, "only the summary item");
			assert.match(section.items[0]!.message, /0 checked, 1 skipped/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("resolves the effective agent name through agents.json", () => {
		const cwd = makeCwd();
		try {
			mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
			writeFileSync(
				join(cwd, ".pi", "velpari", "agents.json"),
				JSON.stringify({ version: 1, agents: { reviewer: "my-reviewer" } }),
			);
			writeAgent(cwd, "my-reviewer", "read, bash");
			const section = checkAgentToolContract(cwd, { roles: ["reviewer"] });
			const errors = section.items.filter((i) => i.status === "error");
			assert.equal(errors.length, 1);
			assert.match(errors[0]!.message, /my-reviewer\.md/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("the summary closes the section and counts skipped roles", () => {
		const cwd = makeCwd();
		try {
			const section = checkAgentToolContract(cwd);
			const last = section.items.at(-1)!;
			assert.match(last.message, /^Agent tool contract summary: /);
			assert.match(last.message, /skipped/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("agent-schema parseToolsValue (P1.3 bracket-list hardening)", () => {
	it("parses the comma string form unchanged", () => {
		assert.deepEqual(parseToolsValue("read, write, bash"), ["read", "write", "bash"]);
	});

	it("parses the YAML bracket-list form", () => {
		assert.deepEqual(parseToolsValue("[read, write]"), ["read", "write"]);
	});

	it("parses whitespace-only separators", () => {
		assert.deepEqual(parseToolsValue("read write bash"), ["read", "write", "bash"]);
	});

	it("returns [] for undefined or blank values", () => {
		assert.deepEqual(parseToolsValue(undefined), []);
		assert.deepEqual(parseToolsValue("   "), []);
	});
});
