/**
 * v3 — Persistent agent bootstrap tests (Phase 4).
 *
 * Covers:
 *   - PERSISTENT_AGENT_IDS is the canonical list
 *   - bundledAgentPath accepts both ScoutAgentId and PersistentAgentId
 *   - ensurePersistentAgents copies the 2 .md files into .pi/agents/
 *     on first call; is idempotent on subsequent calls
 *   - formatPersistentAgentsInstalledMessage returns "" when nothing installed
 *   - spawn helper calls ensurePersistentAgents as step 0 (integration)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	bundledAgentPath,
	ensurePersistentAgents,
	formatPersistentAgentsInstalledMessage,
	PERSISTENT_AGENT_IDS,
	type EnsureStageAgentsResult,
} from "../../src/io/agents-install.js";
import { createRun } from "../../src/core/state.js";
import { spawnPersistentSessions } from "../../src/stages/brainstorm/spawn-sessions.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-persistent-install-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("PERSISTENT_AGENT_IDS", () => {
	it("lists the 2 v3 persistent sub-agent ids in canonical order", () => {
		assert.deepEqual([...PERSISTENT_AGENT_IDS], ["web-research", "doc-code-analyst"]);
	});
});

describe("bundledAgentPath — v3 accepts PersistentAgentId", () => {
	it("resolves the path for web-research", () => {
		const p = bundledAgentPath("web-research");
		assert.ok(p.endsWith("skills/agents/web-research.md"), `got: ${p}`);
	});

	it("resolves the path for doc-code-analyst", () => {
		const p = bundledAgentPath("doc-code-analyst");
		assert.ok(p.endsWith("skills/agents/doc-code-analyst.md"), `got: ${p}`);
	});
});

describe("ensurePersistentAgents", () => {
	it("installs both agents on first call", () => {
		const result = ensurePersistentAgents(tmpDir);
		assert.deepEqual(result.installed.sort(), ["doc-code-analyst", "web-research"]);
		assert.deepEqual(result.alreadyPresent, []);

		const agentsDir = path.join(tmpDir, ".pi", "agents");
		assert.ok(fs.existsSync(path.join(agentsDir, "web-research.md")));
		assert.ok(fs.existsSync(path.join(agentsDir, "doc-code-analyst.md")));
	});

	it("is idempotent — second call reports both as alreadyPresent", () => {
		ensurePersistentAgents(tmpDir);
		const second = ensurePersistentAgents(tmpDir);
		assert.deepEqual(second.installed, []);
		assert.deepEqual(second.alreadyPresent.sort(), ["doc-code-analyst", "web-research"]);
	});

	it("copies a non-empty file (the bundled .md is real, not stub)", () => {
		ensurePersistentAgents(tmpDir);
		const content = fs.readFileSync(path.join(tmpDir, ".pi", "agents", "web-research.md"), "utf8");
		assert.ok(content.length > 200, "bundled web-research.md should have real content");
		assert.match(content, /name: web-research/);
	});
});

describe("formatPersistentAgentsInstalledMessage", () => {
	it("returns empty string when nothing installed", () => {
		const empty: EnsureStageAgentsResult = {
			installed: [],
			alreadyPresent: [],
			missing: [],
		};
		assert.equal(formatPersistentAgentsInstalledMessage(empty), "");
	});

	it("returns one-line summary when some were installed", () => {
		const result: EnsureStageAgentsResult = {
			installed: ["web-research", "doc-code-analyst"],
			alreadyPresent: [],
			missing: [],
		};
		const msg = formatPersistentAgentsInstalledMessage(result);
		assert.match(msg, /Installed 2 persistent sub-agent/);
		assert.match(msg, /web-research/);
		assert.match(msg, /doc-code-analyst/);
	});
});

describe("spawnPersistentSessions — bootstrap step 0 (integration)", () => {
	it("installs the persistent agents on first call", () => {
		createRun("Test mission", tmpDir);
		spawnPersistentSessions({ cwd: tmpDir, mission: "Test mission" });

		const agentsDir = path.join(tmpDir, ".pi", "agents");
		assert.ok(fs.existsSync(path.join(agentsDir, "web-research.md")));
		assert.ok(fs.existsSync(path.join(agentsDir, "doc-code-analyst.md")));
	});

	it("fires the onInstallNotice callback when first install happens", () => {
		createRun("Test mission", tmpDir);
		let notice = "";
		spawnPersistentSessions({
			cwd: tmpDir,
			mission: "Test mission",
			onInstallNotice: (msg) => {
				notice = msg;
			},
		});
		assert.match(notice, /Installed 2 persistent sub-agent/);
	});

	it("does NOT fire the callback when agents already installed (rehydrate path)", () => {
		createRun("Test mission", tmpDir);
		// Pre-install via the helper directly.
		ensurePersistentAgents(tmpDir);

		let noticeFired = false;
		spawnPersistentSessions({
			cwd: tmpDir,
			mission: "Test mission",
			onInstallNotice: () => {
				noticeFired = true;
			},
		});
		assert.equal(noticeFired, false, "notice must not fire when nothing was installed");
	});
});
