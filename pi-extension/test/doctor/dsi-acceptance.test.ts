/**
 * Doctor sub-agent integrity (DSI, P0–P3 + PH) — consolidated end-to-end
 * acceptance (subphase P3.4).
 *
 * ONE deterministic test that runs the real `runDoctor(cwd)` against a
 * fixture project whose `.pi/agents/` tree carries four agents, one per
 * DSI outcome:
 *
 *   (a) a correct agent (`reviewer`)            → no tool-contract error;
 *   (b) an agent missing a contract tool
 *       (`fr-extractor`, missing `write`)       → a tool-contract ERROR;
 *   (c) an agent with a short body
 *       (`nfr-checker`, < 200 chars)            → a body WARNING;
 *   (d) an agent with a bad `model:`
 *       (`consolidator`, `model: bad-model`)    → a format ERROR.
 *
 * It also asserts the two new sections render: `"Agent tool contract"`
 * (P1) and `"Agent format fields"` (P2b). The body check (P2a) renders in
 * the existing `"Agent file integrity"` section.
 *
 * Modeled on `doctor-optimization-acceptance.test.ts`. Deterministic and
 * self-contained: the bundled `skills/agents/<role>.md` templates are the
 * tool-contract source, so default role → agent-name resolution applies
 * (no `agents.json` needed).
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDoctor } from "../../src/doctor/index.js";
import { AGENT_FORMAT_FIELDS_TITLE } from "../../src/doctor/checks/agent-format-fields.js";

/** Stable section title owned by `checkAgentToolContract` (P1). */
const TOOL_CONTRACT_TITLE = "Agent tool contract";

/** Stable section title owned by `checkAgentFileIntegrity` (P2a body check). */
const BODY_SECTION_TITLE = "Agent file integrity";

/**
 * A unique body that clears the 200-char floor. The role name is embedded
 * so two roles never share a normalized body — otherwise the P2a
 * copy-paste detector would fire and pollute the fixture.
 *
 * @param name - The agent's role/file name.
 * @returns A body of > 200 characters, distinct per role.
 */
function longBodyFor(name: string): string {
	return `The ${name} agent owns its stage mandate and reports back to the parent session. `.repeat(5);
}

/** The frontmatter + body spec for one fixture agent. */
interface AgentSpec {
	/** Raw `tools:` value (comma string). */
	tools: string;
	/** Optional `model:` value. */
	model?: string;
	/** Body text (defaults to a unique long body). */
	body?: string;
}

/** Render one agent markdown file with all 7 required frontmatter fields. */
function agentMarkdown(name: string, spec: AgentSpec): string {
	const modelLine = spec.model !== undefined ? `model: ${spec.model}\n` : "";
	return [
		"---",
		`name: ${name}`,
		`description: ${name} test fixture agent`,
		`tools: ${spec.tools}`,
		"thinking: minimal",
		"session-mode: standalone",
		"auto-exit: true",
		"spawning: false",
		modelLine + "---",
		spec.body ?? longBodyFor(name),
		"",
	].join("\n");
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-dsi-acceptance-"));
	mkdirSync(join(tmpDir, ".pi", "agents"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

/** Write `.pi/agents/<name>.md` for one fixture agent. */
function writeAgent(name: string, spec: AgentSpec): void {
	writeFileSync(join(tmpDir, ".pi", "agents", `${name}.md`), agentMarkdown(name, spec));
}

describe("DSI (P0–P3) — consolidated acceptance", () => {
	it("pins the four DSI outcomes through the real runDoctor(cwd)", () => {
		// (a) correct agent — exact reviewer contract (read, write, bash).
		writeAgent("reviewer", { tools: "read, write, bash" });
		// (b) missing contract tool — fr-extractor contract is read, write, bash.
		writeAgent("fr-extractor", { tools: "read, bash" });
		// (c) short body — well-formed tools, body under 200 chars.
		writeAgent("nfr-checker", { tools: "read, write, bash", body: "Too short." });
		// (d) bad model — well-formed tools, malformed `model:` (no slash).
		writeAgent("consolidator", { tools: "read, write, bash", model: "bad-model" });

		const report = runDoctor(tmpDir);

		// The two new sections render.
		const toolSection = report.sections.find((s) => s.title === TOOL_CONTRACT_TITLE);
		assert.ok(toolSection, `expected the "${TOOL_CONTRACT_TITLE}" section to render`);
		const formatSection = report.sections.find((s) => s.title === AGENT_FORMAT_FIELDS_TITLE);
		assert.ok(formatSection, `expected the "${AGENT_FORMAT_FIELDS_TITLE}" section to render`);
		const bodySection = report.sections.find((s) => s.title === BODY_SECTION_TITLE);
		assert.ok(bodySection, `expected the "${BODY_SECTION_TITLE}" section to render`);

		// (a) the correct agent produces NO tool-contract error, and is ok.
		const reviewerErrors = toolSection.items.filter((i) => i.status === "error" && /reviewer\.md/.test(i.message));
		assert.equal(reviewerErrors.length, 0, "the correct reviewer agent must produce no tool-contract error");
		assert.ok(
			toolSection.items.some((i) => i.status === "ok" && /reviewer\.md .*tools match the contract/.test(i.message)),
			"the correct reviewer agent must be reported ok",
		);

		// (b) a missing contract tool is an ERROR naming the tool.
		const missingToolErrors = toolSection.items.filter(
			(i) => i.status === "error" && /fr-extractor\.md/.test(i.message),
		);
		assert.equal(missingToolErrors.length, 1, "fr-extractor must produce exactly one missing-tool error");
		assert.match(missingToolErrors[0]!.message, /missing contract tool\(s\): write/);
		assert.ok(missingToolErrors[0]!.suggestion, "the tool-contract error carries a fix suggestion");

		// (c) a short body is a WARNING in the integrity section.
		const shortBodyWarnings = bodySection.items.filter(
			(i) => i.status === "warning" && /nfr-checker\.md/.test(i.message),
		);
		assert.equal(shortBodyWarnings.length, 1, "nfr-checker must produce exactly one short-body warning");
		assert.match(shortBodyWarnings[0]!.message, /body is very short/);

		// (d) a bad `model:` is an ERROR in the format section.
		const modelErrors = formatSection.items.filter((i) => i.status === "error" && /consolidator\.md/.test(i.message));
		assert.equal(modelErrors.length, 1, "consolidator must produce exactly one model error");
		assert.match(modelErrors[0]!.message, /model:/);
		assert.ok(modelErrors[0]!.suggestion, "the format error carries a fix suggestion");
	});
});
