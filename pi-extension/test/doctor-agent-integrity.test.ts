/**
 * doctor/checks/checkAgentFileIntegrity tests (Phase 4d).
 *
 * Locks the contract for agent file integrity:
 *   - filename matches name: frontmatter
 *   - tools: values are in KNOWN_TOOL_NAMES
 *   - thinking: is in VALID_THINKING_LEVELS
 *   - session-mode: is in VALID_SESSION_MODES
 *   - auto-exit: / spawning: are boolean strings
 *   - body is non-empty after frontmatter
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAgentFileIntegrity } from "../src/discipline/doctor/checks/agents.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-integrity-"));
}

function stageAgent(dir: string, filename: string, body: string): void {
	mkdirSync(join(dir, ".pi", "agents"), { recursive: true });
	writeFileSync(join(dir, ".pi", "agents", filename), body, "utf8");
}

const wellFormed = (name: string, body = "This is a real agent body.") => `---
name: ${name}
description: stub
tools: read, write
thinking: medium
session-mode: standalone
auto-exit: true
spawning: false
---

${body}
`;

test("returns ok when .pi/agents/ does not exist", () => {
	const dir = tempDir();
	try {
		const section = checkAgentFileIntegrity(dir);
		assert.equal(section.title, "Agent file integrity");
		const ok = section.items.find((it) => it.status === "ok");
		assert.ok(ok);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("returns ok for a well-formed agent", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "extractor.md", wellFormed("extractor"));
		const section = checkAgentFileIntegrity(dir);
		const errs = section.items.filter((it) => it.status === "error");
		assert.equal(errs.length, 0);
		const ok = section.items.find((it) => it.status === "ok" && /OK/.test(it.message));
		assert.ok(ok);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("flags filename vs name mismatch", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "wrong-name.md", wellFormed("correct-name"));
		const section = checkAgentFileIntegrity(dir);
		const err = section.items.find(
			(it) => it.status === "error" && /does not match filename/.test(it.message),
		);
		assert.ok(err);
		assert.match(err.message, /correct-name/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("flags unknown tool name", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "extractor.md", `---
name: extractor
description: stub
tools: reed, write
thinking: medium
session-mode: standalone
auto-exit: true
spawning: false
---

body
`);
		const section = checkAgentFileIntegrity(dir);
		const err = section.items.find(
			(it) => it.status === "error" && /unknown tool/.test(it.message),
		);
		assert.ok(err, "expected an unknown-tool error");
		assert.match(err.message, /reed/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("flags invalid thinking level", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "extractor.md", `---
name: extractor
description: stub
tools: read
thinking: insane
session-mode: standalone
auto-exit: true
spawning: false
---

body
`);
		const section = checkAgentFileIntegrity(dir);
		const err = section.items.find(
			(it) => it.status === "error" && /invalid .thinking/.test(it.message),
		);
		assert.ok(err);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("flags invalid session-mode", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "extractor.md", `---
name: extractor
description: stub
tools: read
thinking: medium
session-mode: parallel
auto-exit: true
spawning: false
---

body
`);
		const section = checkAgentFileIntegrity(dir);
		const err = section.items.find(
			(it) => it.status === "error" && /invalid .session-mode/.test(it.message),
		);
		assert.ok(err);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("flags empty body", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "extractor.md", `---
name: extractor
description: stub
tools: read
thinking: medium
session-mode: standalone
auto-exit: true
spawning: false
---

`);
		const section = checkAgentFileIntegrity(dir);
		const warn = section.items.find(
			(it) => it.status === "warning" && /body is empty/.test(it.message),
		);
		assert.ok(warn);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("emits summary item with error/warning counts", () => {
	const dir = tempDir();
	try {
		// One error (filename mismatch) + one warning (empty body).
		stageAgent(dir, "mismatch.md", `---
name: extractor
description: stub
tools: read
thinking: medium
session-mode: standalone
auto-exit: true
spawning: false
---

`);
		const section = checkAgentFileIntegrity(dir);
		const summary = section.items.find(
			(it) => /Agent file integrity: \d+ error/.test(it.message),
		);
		assert.ok(summary, "expected a summary item with counts");
		assert.match(summary.message, /1 error/);
		assert.match(summary.message, /1 warning/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("emits a non-boolean auto-exit warning", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "extractor.md", `---
name: extractor
description: stub
tools: read
thinking: medium
session-mode: standalone
auto-exit: yes-please
spawning: false
---

body
`);
		const section = checkAgentFileIntegrity(dir);
		const warn = section.items.find(
			(it) => it.status === "warning" && /auto-exit/.test(it.message),
		);
		assert.ok(warn);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("accepts both legacy standalone and lineage-only session-modes", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "lineage.md", `---
name: lineage
description: stub
tools: read
thinking: medium
session-mode: lineage-only
auto-exit: true
spawning: false
---

body
`);
		const section = checkAgentFileIntegrity(dir);
		const errs = section.items.filter((it) => it.status === "error");
		assert.equal(errs.length, 0, "lineage-only must be a valid session-mode");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
