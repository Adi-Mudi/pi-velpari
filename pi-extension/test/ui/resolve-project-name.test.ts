/**
 * Phase I10.4 — the shared `ui/resolve-project-name.ts` helper. Covers the
 * five documented cases: single configured project (no picker shown),
 * multi-project picker selection, cancel → undefined, fallback to
 * state.mission, empty-string mission → "Project".
 *
 * The mock ctx has no `ui.custom`/`mode: "tui"`, so runSimplePicker takes
 * its non-TUI `ctx.ui.select` path (is-tui.ts).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveProjectName } from "../../src/ui/resolve-project-name.js";
import { createRun, saveState } from "../../src/core/state.js";

const OPTS = { title: "Test — pick project", subtitle: "Pick one." };

let tmpDir: string;

/** Write `.pi/velpari/files.json` with the given config keys merged in. */
function writeConfig(config: Record<string, unknown>): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "files.json"), JSON.stringify({ version: 4, ...config }));
}

/**
 * Mock ExtensionContext whose ui.select records every picker call.
 * @param {string | undefined} choice - What select returns (undefined = cancelled).
 * @returns {{ ctx: ExtensionContext; calls: Array<{ title: string; labels: string[] }> }} The mock + recorded calls.
 */
function mockCtx(choice?: string | undefined): {
	ctx: ExtensionContext;
	calls: Array<{ title: string; labels: string[] }>;
} {
	const calls: Array<{ title: string; labels: string[] }> = [];
	const ctx = {
		ui: {
			select: async (title: string, labels: string[]) => {
				calls.push({ title, labels });
				return choice;
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, calls };
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-resolveproj-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ui/resolve-project-name (Phase I10.4)", () => {
	it("single configured project: no picker is shown", async () => {
		writeConfig({ projectName: "alpha" });
		const { ctx, calls } = mockCtx();
		const name = await resolveProjectName(ctx, tmpDir, OPTS);
		assert.equal(name, "alpha");
		assert.equal(calls.length, 0, "a single project must not open the picker");
	});

	it("multi-project picker: the selection is returned, labels in config order", async () => {
		writeConfig({ projectNames: ["alpha", "beta"] });
		const { ctx, calls } = mockCtx("beta");
		const name = await resolveProjectName(ctx, tmpDir, OPTS);
		assert.equal(name, "beta");
		assert.equal(calls.length, 1, "exactly one picker shown");
		assert.equal(calls[0]!.title, OPTS.title);
		assert.deepEqual(calls[0]!.labels, ["alpha", "beta"]);
	});

	it("picker cancel returns undefined", async () => {
		writeConfig({ projectNames: ["alpha", "beta"] });
		const { ctx } = mockCtx(undefined);
		assert.equal(await resolveProjectName(ctx, tmpDir, OPTS), undefined);
	});

	it("no configured project falls back to state.mission", async () => {
		writeConfig({});
		createRun("My mission", tmpDir);
		const { ctx, calls } = mockCtx();
		const name = await resolveProjectName(ctx, tmpDir, OPTS);
		assert.equal(name, "My mission");
		assert.equal(calls.length, 0);
	});

	it('an empty-string mission falls through to "Project"', async () => {
		writeConfig({});
		const run = createRun("ignored", tmpDir);
		saveState({ ...run, mission: "" }, tmpDir);
		const { ctx } = mockCtx();
		assert.equal(await resolveProjectName(ctx, tmpDir, OPTS), "Project");
	});
});
