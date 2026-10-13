/**
 * Tests for doctor/checks/agent-format-fields.ts (DSI P2b, D16).
 *
 * Fixtures live in a temp `.pi/agents/` tree. The check validates the
 * real pi agent format fields (`model`, `interactive`, `disallowed_tools`,
 * `allowed_subagents`) only when present; absent fields and unknown
 * forward-compat keys must not produce an item.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AGENT_FORMAT_FIELDS_TITLE, checkAgentFormatFields } from "../../../src/doctor/checks/agent-format-fields.js";

/** Create a temp project root with `.pi/agents/`. */
function makeCwd(): string {
	const cwd = mkdtempSync(join(tmpdir(), "velpari-format-fields-"));
	mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
	return cwd;
}

/** Write `.pi/agents/<name>.md` with the given extra frontmatter lines. */
function writeAgent(cwd: string, name: string, fields: string): void {
	writeFileSync(join(cwd, ".pi", "agents", `${name}.md`), `---\nname: ${name}\n${fields}---\nbody\n`);
}

/** Run a fixture-building callback against a fresh temp root. */
function withCwd(fn: (cwd: string) => void): void {
	const cwd = makeCwd();
	try {
		fn(cwd);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

describe("doctor/checks/agent-format-fields", () => {
	it("uses the stable section title", () => {
		withCwd((cwd) => {
			const section = checkAgentFormatFields(cwd);
			assert.equal(section.title, "Agent format fields");
			assert.equal(section.title, AGENT_FORMAT_FIELDS_TITLE);
		});
	});

	it("(a) a malformed `model:` is exactly one error", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "scout", "model: claude-x\n");
			const section = checkAgentFormatFields(cwd);
			const errors = section.items.filter((i) => i.status === "error");
			assert.equal(errors.length, 1, "exactly one model error");
			assert.match(errors[0]!.message, /model:/);
			assert.match(errors[0]!.message, /scout\.md/);
			assert.ok(errors[0]!.suggestion, "error carries a fix suggestion");
		});
	});

	it("(b) a valid `model: anthropic/claude-x` is ok (no item)", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "scout", "model: anthropic/claude-x\n");
			const section = checkAgentFormatFields(cwd);
			assert.equal(section.items.length, 0, "no item for a valid model");
		});
	});

	it("(b2) tolerates the legacy `:thinking` suffix on `model:`", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "scout", "model: anthropic/claude-x:high\n");
			const section = checkAgentFormatFields(cwd);
			assert.equal(section.items.length, 0, "legacy thinking suffix is accepted");
		});
	});

	it("(c) `interactive: yes` is a warning", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "scout", "interactive: yes\n");
			const section = checkAgentFormatFields(cwd);
			const warnings = section.items.filter((i) => i.status === "warning");
			assert.equal(warnings.length, 1, "exactly one interactive warning");
			assert.match(warnings[0]!.message, /interactive:/);
			assert.equal(section.items.filter((i) => i.status === "error").length, 0);
		});
	});

	it("(c2) `interactive: false` is ok (no item)", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "scout", "interactive: false\n");
			const section = checkAgentFormatFields(cwd);
			assert.equal(section.items.length, 0);
		});
	});

	it("(d) an unknown `disallowed_tools:` token is an error", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "scout", "disallowed_tools: read, bogustool\n");
			const section = checkAgentFormatFields(cwd);
			const errors = section.items.filter((i) => i.status === "error");
			assert.equal(errors.length, 1, "exactly one unknown-tool error");
			assert.match(errors[0]!.message, /disallowed_tools:/);
			assert.match(errors[0]!.message, /bogustool/);
		});
	});

	it("(d2) a valid `disallowed_tools:` list is ok (no item)", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "scout", "disallowed_tools: read, write\n");
			const section = checkAgentFormatFields(cwd);
			assert.equal(section.items.length, 0);
		});
	});

	it("(e) a valid `allowed_subagents:` is ok (no item)", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "scout", "allowed_subagents: reviewer, verifier\n");
			const section = checkAgentFormatFields(cwd);
			assert.equal(section.items.length, 0);
		});
	});

	it("(e2) a blank `allowed_subagents:` is a warning", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "scout", "allowed_subagents:\n");
			const section = checkAgentFormatFields(cwd);
			const warnings = section.items.filter((i) => i.status === "warning");
			assert.equal(warnings.length, 1, "exactly one empty-subagents warning");
			assert.match(warnings[0]!.message, /allowed_subagents:/);
		});
	});

	it("(f) absent fields produce no item", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "scout", "");
			const section = checkAgentFormatFields(cwd);
			assert.equal(section.items.length, 0, "absent fields are not flagged");
		});
	});

	it("(f2) an unknown-but-valid forward-compat key is tolerated", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "scout", "future_key: some-value\n");
			const section = checkAgentFormatFields(cwd);
			assert.equal(section.items.length, 0, "unknown keys are never flagged");
		});
	});

	it("reports multiple problems across files independently", () => {
		withCwd((cwd) => {
			writeAgent(cwd, "bad-model", "model: no-slash\n");
			writeAgent(cwd, "bad-interactive", "interactive: maybe\n");
			const section = checkAgentFormatFields(cwd);
			assert.equal(section.items.length, 2, "one item per problem");
			assert.equal(section.items.filter((i) => i.status === "error").length, 1);
			assert.equal(section.items.filter((i) => i.status === "warning").length, 1);
		});
	});

	it("handles a missing `.pi/agents/` directory without throwing", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-format-fields-empty-"));
		try {
			const section = checkAgentFormatFields(cwd);
			assert.equal(section.title, "Agent format fields");
			assert.equal(section.items.length, 1);
			assert.equal(section.items[0]!.status, "ok");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
