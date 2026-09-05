import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const AGENT_IDS = ["extractor", "prd-checker", "rtm-checker", "web-search-agent"];

function bundledAgentPath(agentId: string): string {
	// Test file may run from source (pi-extension/test/) or dist (dist/pi-extension/test/).
	// Try both layouts and return the first that exists.
	const candidates = [
		resolve(__dirname, "..", "..", "skills", "agents", `${agentId}.md`),
		resolve(__dirname, "..", "..", "..", "skills", "agents", `${agentId}.md`),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return candidates[0]!;
}

/**
 * Lightweight YAML frontmatter parser. Splits on the first `---` ... `---`
 * pair and returns key: value pairs as a flat object. Supports scalar values
 * only (no nested objects, no lists) — sufficient for our agent frontmatter
 * which is all flat key: value lines.
 */
function parseFrontmatter(markdown: string): Record<string, string> {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match) {
		throw new Error("No YAML frontmatter found (expected leading `---` block).");
	}
	const block = match[1]!;
	const result: Record<string, string> = {};
	for (const line of block.split("\n")) {
		const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
		if (m) {
			result[m[1]!] = m[2]!.trim();
		}
	}
	return result;
}

for (const agentId of AGENT_IDS) {
	test(`agent ${agentId}.md exists at the bundled path`, () => {
		const path = bundledAgentPath(agentId);
		assert.ok(existsSync(path), `bundled agent file missing: ${path}`);
	});

	test(`agent ${agentId}.md has valid YAML frontmatter`, () => {
		const path = bundledAgentPath(agentId);
		const content = readFileSync(path, "utf8");
		const fm = parseFrontmatter(content);
		assert.ok(fm["name"], `frontmatter missing 'name' in ${agentId}.md`);
		assert.ok(fm["description"], `frontmatter missing 'description' in ${agentId}.md`);
		assert.ok(fm["tools"], `frontmatter missing 'tools' in ${agentId}.md`);
		assert.ok(fm["thinking"], `frontmatter missing 'thinking' in ${agentId}.md`);
		assert.ok(fm["session-mode"], `frontmatter missing 'session-mode' in ${agentId}.md`);
		assert.ok(fm["auto-exit"], `frontmatter missing 'auto-exit' in ${agentId}.md`);
		assert.ok(fm["spawning"], `frontmatter missing 'spawning' in ${agentId}.md`);
	});

	test(`agent ${agentId}.md frontmatter values are correct`, () => {
		const path = bundledAgentPath(agentId);
		const content = readFileSync(path, "utf8");
		const fm = parseFrontmatter(content);
		assert.equal(fm["name"], agentId, `'name' must match filename in ${agentId}.md`);
		assert.ok(fm["tools"]!.includes("write"), `'tools' must include 'write' so the agent can emit its report`);
		assert.equal(fm["session-mode"], "standalone", `'session-mode' must be 'standalone'`);
		assert.equal(fm["auto-exit"], "true", `'auto-exit' must be 'true'`);
		assert.equal(fm["spawning"], "false", `'spawning' must be 'false' (scouts do not spawn sub-subagents)`);
	});
}

test("all 4 agent names are unique", () => {
	const names = new Set<string>();
	for (const id of AGENT_IDS) {
		const path = bundledAgentPath(id);
		const fm = parseFrontmatter(readFileSync(path, "utf8"));
		const name = fm["name"];
		assert.ok(name, `${id}.md missing name`);
		assert.ok(!names.has(name), `duplicate agent name: ${name}`);
		names.add(name);
	}
	assert.equal(names.size, 4);
});