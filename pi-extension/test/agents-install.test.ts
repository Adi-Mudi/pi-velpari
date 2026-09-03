import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SCOUT_AGENT_IDS,
	ensureScoutAgents,
	formatScoutAgentsInstalledMessage,
} from "../src/agents-install.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-agents-"));
}

test("ensureScoutAgents copies all 4 agents into .pi/agents/ on fresh dir", () => {
	const dir = tempDir();
	try {
		const result = ensureScoutAgents(dir);
		assert.equal(result.installed.length, 4);
		assert.equal(result.alreadyPresent.length, 0);
		const agentsDir = join(dir, ".pi", "agents");
		assert.ok(existsSync(agentsDir));
		for (const id of SCOUT_AGENT_IDS) {
			const target = join(agentsDir, `${id}.md`);
			assert.ok(existsSync(target), `${id}.md should be installed`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("ensureScoutAgents skips already-present agents", () => {
	const dir = tempDir();
	try {
		// Pre-create one agent file with custom content.
		const agentsDir = join(dir, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		const customContent = "# custom user-edited agent\n";
		writeFileSync(join(agentsDir, "extractor.md"), customContent, "utf8");

		const result = ensureScoutAgents(dir);
		assert.equal(result.alreadyPresent.length, 1);
		assert.equal(result.alreadyPresent[0], "extractor");
		assert.equal(result.installed.length, 3);
		// Custom content preserved (not overwritten).
		const after = readFileSync(join(agentsDir, "extractor.md"), "utf8");
		assert.equal(after, customContent, "user-edited agent must not be overwritten");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("ensureScoutAgents creates .pi/agents/ if missing", () => {
	const dir = tempDir();
	try {
		const agentsDir = join(dir, ".pi", "agents");
		assert.equal(existsSync(agentsDir), false);
		ensureScoutAgents(dir);
		assert.ok(existsSync(agentsDir));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("ensureScoutAgents is idempotent on second call", () => {
	const dir = tempDir();
	try {
		ensureScoutAgents(dir);
		const second = ensureScoutAgents(dir);
		assert.equal(second.installed.length, 0);
		assert.equal(second.alreadyPresent.length, 4);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("formatScoutAgentsInstalledMessage returns empty when nothing installed", () => {
	const msg = formatScoutAgentsInstalledMessage({ installed: [], alreadyPresent: [...SCOUT_AGENT_IDS] });
	assert.equal(msg, "");
});

test("formatScoutAgentsInstalledMessage lists installed agents", () => {
	const msg = formatScoutAgentsInstalledMessage({
		installed: ["extractor", "prd-checker"],
		alreadyPresent: ["rtm-checker", "web-search-agent"],
	});
	assert.match(msg, /extractor/);
	assert.match(msg, /prd-checker/);
	assert.match(msg, /Installed 2 scout agent/);
});

test("ensureScoutAgents returns consistent shape across calls", () => {
	const dir = tempDir();
	try {
		const first = ensureScoutAgents(dir);
		const second = ensureScoutAgents(dir);
		// Both calls return EnsureScoutAgentsResult with the same shape.
		assert.ok(Array.isArray(first.installed));
		assert.ok(Array.isArray(first.alreadyPresent));
		assert.ok(Array.isArray(second.installed));
		assert.ok(Array.isArray(second.alreadyPresent));
		// First call installed 4, second call saw 4 as present.
		assert.equal(first.installed.length, 4);
		assert.equal(second.alreadyPresent.length, 4);
		assert.equal(second.installed.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("ensureScoutAgents handles single-agent alreadyPresent case", () => {
	const dir = tempDir();
	try {
		const agentsDir = join(dir, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(join(agentsDir, "extractor.md"), "stub\n", "utf8");
		const result = ensureScoutAgents(dir);
		assert.deepEqual(result.alreadyPresent, ["extractor"]);
		assert.equal(result.installed.length, 3);
		const msg = formatScoutAgentsInstalledMessage(result);
		assert.match(msg, /Installed 3 scout agent/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});