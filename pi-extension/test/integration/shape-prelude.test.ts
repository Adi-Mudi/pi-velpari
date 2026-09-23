/**
 * Arch-confirm prelude shape wiring tests (v1.2.2).
 *
 * Confirms the shape verdict appears in the prelude summary that
 * confirmWithDeveloper shows the developer.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { confirmWithDeveloper } from "../../src/core/arch-confirm.js";
import { loadArchContext, type ArchContext } from "../../src/core/arch-context.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-shape-prelude-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface Notice {
	message: string;
	level: string;
}

function makeCtx(): { ui: { notify: (m: string, l: string) => void; setStatus: () => void; select: unknown } } {
	return {
		ui: {
			notify: (_m: string, _l: string) => {},
			setStatus: () => {},
			select: undefined,
		},
	};
}

function setupProject(version: string, sectionCount: number): ArchContext {
	// .pi/velpari/files.json
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TodoApp" }),
		"utf8",
	);
	// .pi/velpari/state.json
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "state.json"),
		JSON.stringify({ runId: "run-test", mission: "Test mission" }),
		"utf8",
	);
	// Doc/design/design_TodoApp.md
	fs.mkdirSync(path.join(tmpDir, "Doc", "design"), { recursive: true });
	const md =
		`---\nversion: ${version}\n---\n\n` + Array.from({ length: sectionCount }, (_, i) => `## ${i}. S`).join("\n");
	fs.writeFileSync(path.join(tmpDir, "Doc", "design", "design_TodoApp.md"), md, "utf8");
	return loadArchContext("run-test", "Test mission", tmpDir);
}

describe("arch-confirm prelude shape wiring", () => {
	it("no published design → summary includes 'Path: fresh'", async () => {
		// Build a project WITHOUT the design file.
		fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: "TodoApp" }),
			"utf8",
		);
		fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "velpari", "state.json"),
			JSON.stringify({ runId: "run-test", mission: "Test mission" }),
			"utf8",
		);
		const ctx = loadArchContext("run-test", "Test mission", tmpDir);

		const ctxUi = makeCtx();
		// No UI → outcome = "no-ui", summaryShown still returned.
		const result = await confirmWithDeveloper(ctxUi as never, ctx, tmpDir);
		assert.equal(result.outcome, "no-ui");
		assert.match(result.summaryShown, /Path: fresh/);
	});

	it("legacy shape v1.0.2 with 8 sections → summary includes 'Path: migration recommended'", async () => {
		const ctx = setupProject("1.0.2", 8);
		const ctxUi = makeCtx();
		const result = await confirmWithDeveloper(ctxUi as never, ctx, tmpDir);
		assert.equal(result.outcome, "no-ui");
		assert.match(result.summaryShown, /Path: migration recommended/);
	});

	it("current shape v1.1.0 with 14 sections → summary includes 'Path: upgrade'", async () => {
		const ctx = setupProject("1.1.0", 14);
		const ctxUi = makeCtx();
		const result = await confirmWithDeveloper(ctxUi as never, ctx, tmpDir);
		assert.equal(result.outcome, "no-ui");
		assert.match(result.summaryShown, /Path: upgrade/);
	});
});
