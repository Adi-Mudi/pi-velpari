import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function skillPath(): string {
	const candidates = [
		resolve(__dirname, "..", "..", "skills", "velpari-discuss.md"),
		resolve(__dirname, "..", "..", "..", "skills", "velpari-discuss.md"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return candidates[0]!;
}

test("skills/velpari-discuss.md exists at the bundled path", () => {
	assert.ok(existsSync(skillPath()), `bundled skill file missing: ${skillPath()}`);
});

test("skills/velpari-discuss.md mentions all 4 agent names", () => {
	const content = readFileSync(skillPath(), "utf8");
	for (const agentName of ["extractor", "prd-checker", "rtm-checker", "web-search-agent"]) {
		assert.ok(
			content.includes(agentName),
			`skills/velpari-discuss.md must mention '${agentName}' so the parent LLM knows what to spawn`,
		);
	}
});

test("skills/velpari-discuss.md does NOT contain max_turns (removed v2.0 hallucination)", () => {
	const content = readFileSync(skillPath(), "utf8");
	assert.doesNotMatch(
		content,
		/max_turns/,
		"the subagent tool has no max_turns parameter; remove stale references",
	);
});

test("skills/velpari-discuss.md does NOT mention fake parameter names", () => {
	const content = readFileSync(skillPath(), "utf8");
	// Each of these is a parameter name that does NOT exist on the subagent tool.
	for (const fakeParam of ["system_prompt", "isolation:", "worktree:", "prompt:", "max_turns"]) {
		assert.doesNotMatch(
			content,
			new RegExp(fakeParam.replace(/[.+*?^${}()|[\]\\]/g, "\\$&")),
			`fake parameter '${fakeParam}' must not appear in skill markdown`,
		);
	}
});

test("skills/velpari-discuss.md references pi-interactive-subagents as the source of the subagent tool", () => {
	const content = readFileSync(skillPath(), "utf8");
	assert.match(content, /pi-interactive-subagents/, "skill must credit pi-interactive-subagents");
});

test("skills/velpari-discuss.md references AskUserQuestion for follow-up rounds + preview gate", () => {
	const content = readFileSync(skillPath(), "utf8");
	assert.match(content, /AskUserQuestion/, "skill must mention AskUserQuestion");
});

test("skills/velpari-discuss.md documents the zellij bug workaround (Issue #19)", () => {
	const content = readFileSync(skillPath(), "utf8");
	assert.match(content, /Issue #19|zellij.*bug|zellij.*close-pane/i, "skill must mention the zellij close-pane bug");
});

test("skills/velpari-discuss.md documents the working-copy path", () => {
	const content = readFileSync(skillPath(), "utf8");
	assert.match(content, /discussion-notes\.md/, "skill must reference discussion-notes.md as the working-copy");
});

test("skills/velpari-discuss.md documents caller_ping", () => {
	const content = readFileSync(skillPath(), "utf8");
	assert.match(content, /caller_ping/, "skill must document caller_ping for child-to-parent help requests");
});

test("skills/velpari-discuss.md documents the live widget status states", () => {
	const content = readFileSync(skillPath(), "utf8");
	// At minimum the 4 active states from the docs.
	for (const state of ["active", "waiting", "stalled", "starting"]) {
		assert.ok(
			content.includes(`\`${state}\``) || content.includes(state),
			`skill must mention widget state '${state}'`,
		);
	}
});

test("skills/velpari-discuss.md documents the cwd parameter", () => {
	const content = readFileSync(skillPath(), "utf8");
	assert.match(content, /cwd/, "skill must document the cwd parameter");
});

test("skills/velpari-discuss.md has YAML frontmatter with name and description", () => {
	const content = readFileSync(skillPath(), "utf8");
	const match = content.match(/^---\n([\s\S]*?)\n---\n/);
	assert.ok(match, "frontmatter block must be present");
	const block = match[1]!;
	assert.match(block, /^name: velpari-discuss/m, "frontmatter must include 'name: velpari-discuss'");
	assert.match(block, /^description:/m, "frontmatter must include a description");
});