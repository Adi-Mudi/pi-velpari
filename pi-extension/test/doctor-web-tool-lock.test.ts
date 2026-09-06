/**
 * doctor/checks/web-tool-lock tests (Phase 4c).
 *
 * Locks the contract: only `web-search-agent` may carry websearch
 * or fetchurl; every other agent with web tools is an error.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWebToolLock } from "../src/discipline/doctor/checks/web-tool-lock.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-webtool-"));
}

function stageAgent(dir: string, filename: string, body: string): void {
	mkdirSync(join(dir, ".pi", "agents"), { recursive: true });
	writeFileSync(join(dir, ".pi", "agents", filename), body, "utf8");
}

const goodFrontmatter = (tools: string) => `---
name: ${"placeholder"}
description: stub
tools: ${tools}
thinking: medium
session-mode: standalone
auto-exit: true
spawning: false
---

body
`;

test("returns ok when .pi/agents/ does not exist", () => {
	const dir = tempDir();
	try {
		const section = checkWebToolLock(dir);
		assert.equal(section.title, "Web-tool lock");
		const ok = section.items.find((it) => it.status === "ok");
		assert.ok(ok);
		assert.match(ok.message, /nothing to lock/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("returns ok when no agents exist (empty .pi/agents/)", () => {
	const dir = tempDir();
	try {
		mkdirSync(join(dir, ".pi", "agents"), { recursive: true });
		const section = checkWebToolLock(dir);
		const ok = section.items.find((it) => it.status === "ok");
		assert.ok(ok);
		assert.match(ok.message, /nothing to lock/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("returns ok when all agents have only non-web tools", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "extractor.md", goodFrontmatter("read, write, bash").replace("placeholder", "extractor"));
		stageAgent(dir, "prd-checker.md", goodFrontmatter("read, write").replace("placeholder", "prd-checker"));
		const section = checkWebToolLock(dir);
		const ok = section.items.find((it) => it.status === "ok");
		assert.ok(ok, "expected an ok item");
		assert.match(ok.message, /no web tools declared anywhere/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("returns ok for compliant web-search-agent with websearch", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "web-search-agent.md", goodFrontmatter("websearch, fetchurl").replace("placeholder", "web-search-agent"));
		const section = checkWebToolLock(dir);
		const errs = section.items.filter((it) => it.status === "error");
		assert.equal(errs.length, 0, "web-search-agent with web tools must not trigger an error");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("returns error when a non-allowed agent carries websearch", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "rogue.md", goodFrontmatter("websearch, read").replace("placeholder", "rogue"));
		const section = checkWebToolLock(dir);
		const err = section.items.find(
			(it) => it.status === "error" && /rogue/.test(it.message),
		);
		assert.ok(err, "expected an error for rogue agent with websearch");
		assert.match(err.message, /Only the `web-search-agent` agent may reach the web/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("returns error when a non-allowed agent carries fetchurl", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "sneaky.md", goodFrontmatter("fetchurl, read, write").replace("placeholder", "sneaky"));
		const section = checkWebToolLock(dir);
		const err = section.items.find(
			(it) => it.status === "error" && /sneaky/.test(it.message),
		);
		assert.ok(err, "expected an error for sneaky agent with fetchurl");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("emits a final summary item with violation count", () => {
	const dir = tempDir();
	try {
		stageAgent(dir, "web-search-agent.md", goodFrontmatter("websearch").replace("placeholder", "web-search-agent"));
		stageAgent(dir, "rogue.md", goodFrontmatter("websearch").replace("placeholder", "rogue"));
		const section = checkWebToolLock(dir);
		const summary = section.items.find(
			(it) => /violation\(s\)/.test(it.message) && /across/.test(it.message),
		);
		assert.ok(summary, "expected a violation-count summary");
		assert.equal(summary.status, "error");
		assert.match(summary.message, /1 violation/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handles YAML list-style tools field", () => {
	const dir = tempDir();
	try {
		const listStyle = `---
name: listy
description: stub
tools:
  - read
  - websearch
thinking: medium
session-mode: standalone
auto-exit: true
spawning: false
---

body
`;
		stageAgent(dir, "listy.md", listStyle);
		const section = checkWebToolLock(dir);
		const err = section.items.find((it) => it.status === "error" && /listy/.test(it.message));
		assert.ok(err, "expected an error for YAML-list websearch");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
