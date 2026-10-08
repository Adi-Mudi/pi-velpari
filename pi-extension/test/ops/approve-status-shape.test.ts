/**
 * /velpari-status surface for ShapeCompatibility (v1.2.2).
 *
 * Confirms the `Architecture shape` section appears in the status
 * output for each of the three paths.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleStatus } from "../../src/ops/status.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";

interface Entry {
	key: string;
	body: string;
}

let tmpDir: string;
let entries: Entry[];

function makeCtxAndPi(): { ctx: unknown; pi: unknown } {
	entries = [];
	const pi = {
		appendEntry: (key: string, body: { body?: string } & Record<string, unknown>) => {
			entries.push({ key, body: typeof body.body === "string" ? body.body : "" });
		},
		setStatus: () => {},
	};
	const ctx = {
		ui: {
			notify: () => {},
			setStatus: () => {},
		},
	};
	return { ctx, pi };
}

function seedProject(name: string): void {
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: name }),
		"utf8",
	);
	const run = createRun(name, tmpDir);
	saveState({ ...run, currentStage: "designed" }, tmpDir);
}

function writePublishedDesign(content: string): void {
	fs.mkdirSync(path.join(tmpDir, "Doc", "design"), { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "Doc", "design", "design_TodoApp.md"), content, "utf8");
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-status-shape-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("/velpari-status surfaces ShapeCompatibility", () => {
	it("no published design → status shows 'Path: fresh'", async () => {
		seedProject("TodoApp");
		const { ctx, pi } = makeCtxAndPi();
		await handleStatus(ctx as never, pi as never, tmpDir);
		const status = entries.find((e) => e.key === "velpari-status");
		assert.ok(status, "expected velpari-status entry");
		assert.match(status.body, /## Architecture shape/);
		assert.match(status.body, /Path: fresh/);
	});

	it("v1.0.2 with 8 sections → status shows 'Path: migration recommended'", async () => {
		seedProject("TodoApp");
		const md = "---\nversion: 1.0.2\n---\n\n" + Array.from({ length: 8 }, (_, i) => `## ${i}. S`).join("\n");
		writePublishedDesign(md);
		const { ctx, pi } = makeCtxAndPi();
		await handleStatus(ctx as never, pi as never, tmpDir);
		const status = entries.find((e) => e.key === "velpari-status");
		assert.match(status?.body ?? "", /Path: migration recommended/);
	});

	it("v1.1.0 with 14 sections → status shows 'Path: upgrade'", async () => {
		seedProject("TodoApp");
		const md = "---\nversion: 1.1.0\n---\n\n" + Array.from({ length: 14 }, (_, i) => `## ${i}. S`).join("\n");
		writePublishedDesign(md);
		const { ctx, pi } = makeCtxAndPi();
		await handleStatus(ctx as never, pi as never, tmpDir);
		const status = entries.find((e) => e.key === "velpari-status");
		assert.match(status?.body ?? "", /Path: upgrade/);
	});
});
