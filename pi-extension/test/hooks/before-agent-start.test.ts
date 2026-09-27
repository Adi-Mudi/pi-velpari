/**
 * Phase I10.3 — the before_agent_start hook consumes the transition lock's
 * PRECOMPUTED stale set (`lock.staleSet`) instead of calling computeStaleSet
 * itself: one staleness computation per turn, reused by the status block.
 *
 * Drives the registered hook end-to-end: a git fixture whose PRD moved in a
 * foreign run must still print the `upstream-moved:` line inside
 * <velpari_status>, and `next:` must come from the lock. A fresh run renders
 * the block with no upstream-moved line.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBeforeAgentStartHook } from "../../src/hooks/before-agent-start.js";
import { hashFileContent } from "../../src/core/fingerprints.js";
import { recordPublish } from "../../src/core/freshness.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { createRun, saveState, type RunState } from "../../src/core/state.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { publishArtifactCas, writeArtifact, type ArtifactPayload } from "../../src/io/store.js";

const PROJECT = "TestApp";

type Hook = (event: { systemPrompt: string }, ctx: { cwd: string }) => { systemPrompt: string } | undefined;

/** Register the hook on a mock API and return its before_agent_start handler. */
function hookHandler(): Hook {
	let registered: Hook | undefined;
	const pi = {
		on: (name: string, fn: Hook) => {
			if (name === "before_agent_start") registered = fn;
		},
	} as unknown as ExtensionAPI;
	registerBeforeAgentStartHook(pi);
	assert.ok(registered, "the hook must register a before_agent_start handler");
	return registered!;
}

/**
 * Write a file under the fixture root, creating parent folders.
 * @param {string} root - Fixture project root.
 * @param {string} rel - Root-relative path of the file.
 * @param {string} content - Text to write (UTF-8).
 * @returns {string} The absolute path written.
 */
function writeAt(root: string, rel: string, content: string): string {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.join(abs, ".."), { recursive: true });
	fs.writeFileSync(abs, content);
	return abs;
}

/** Publish one minimal PRD revision for `runId` into the project store. */
function publishPrd(root: string, runId: string, textHash: string): void {
	const db = openStoreDb(buildStoreDbPath(PROJECT, root));
	try {
		writeArtifact(
			db,
			"prd",
			runId,
			{ version: 1, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" },
			{
				fr: [{ id: "FR-1", phase: 1, textHash, text: `Prose for ${textHash}.` }],
			} as ArtifactPayload,
		);
		publishArtifactCas(db, runId, "prd", null);
	} finally {
		closeStoreDb(db);
	}
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-agentstart-"));
	// The upstream-move block only renders inside a git work tree.
	execFileSync("git", ["init", "-q"], { cwd: tmpDir });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpDir });
	execFileSync("git", ["config", "user.name", "test"], { cwd: tmpDir });
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: PROJECT }),
	);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("before_agent_start — status block from the transition lock (Phase I10.3)", () => {
	it("upstream-moved: renders from the lock's precomputed stale set", () => {
		// A foreign run moved the PRD after the RTM consumed it → the RTM is
		// stale on a store-backed input whose published head is foreign.
		publishPrd(tmpDir, "run-A", "aaa111");
		publishPrd(tmpDir, "run-B", "bbb222");
		const prdPath = writeAt(tmpDir, path.join("Doc", "requirements", `PRD_${PROJECT}.md`), "# PRD\n");
		writeAt(tmpDir, path.join("Doc", "requirements", `RTM_${PROJECT}.md`), "# RTM\n");
		recordPublish(tmpDir, {
			artifact: "rtm",
			projectName: PROJECT,
			path: `Doc/requirements/RTM_${PROJECT}.md`,
			publishedAt: "2026-09-27T00:00:00.000Z",
			inputs: { [`prd:${PROJECT}`]: hashFileContent(prdPath)! },
		});
		fs.writeFileSync(prdPath, "# PRD\nedited after the RTM consumed it\n", "utf8");

		const run = createRun("report mission", tmpDir);
		saveState({ ...run, runId: "run-A", currentStage: "drafted-prd" as RunState["currentStage"] }, tmpDir);

		const out = hookHandler()({ systemPrompt: "BASE" }, { cwd: tmpDir });
		assert.ok(out, "the hook returns a prompt");
		const text = out!.systemPrompt;
		assert.match(text, /<velpari_status>/);
		assert.match(text, /stage: drafted-prd/);
		assert.match(text, /next: \/velpari-rtm/, "next: comes from the lock");
		assert.match(
			text,
			/upstream-moved: prd r2 by run-B/,
			"the stale move still renders from lock.staleSet (no recomputation)",
		);
	});

	it("a fresh run renders the status block with no upstream-moved line", () => {
		const run = createRun("report mission", tmpDir);
		saveState({ ...run, runId: "run-A" }, tmpDir);
		const out = hookHandler()({ systemPrompt: "BASE" }, { cwd: tmpDir });
		assert.ok(out, "the hook returns a prompt");
		assert.match(out!.systemPrompt, /<velpari_status>/);
		assert.doesNotMatch(out!.systemPrompt, /upstream-moved:/);
	});
});
