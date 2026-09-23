/**
 * session_start hook tests (RTM traceability upgrade, Phase 6).
 *
 * Covers:
 *   - clears the leftover status bar on every session start (unchanged)
 *   - no run open → bar stays cleared
 *   - open run + suspect/orphan trace links → bar shows the count and
 *     points at /velpari-doctor
 *   - open run + clean links → bar stays cleared
 *
 * The hook reads process.cwd() (loadState/loadFilesConfig defaults), so
 * the test chdir()s into the fixture dir — safe because node --test runs
 * each test file in its own process.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerSessionStartHook } from "../../src/hooks/session-start.js";
import { createRun } from "../../src/core/state.js";
import { extractRequirementFingerprints, stampFingerprints } from "../../src/core/fingerprints.js";

const PSRS = [
	"# PSRS",
	"",
	"## Functional Requirements",
	"",
	"| ID | Requirement | Priority | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|",
	"| FR-01 | The system SHALL save expenses | must | expense saved | Integration test | proposed |",
	"",
].join("\n");

type Handler = (event: unknown, ctx: unknown) => Promise<void>;

function makePi(): { handlers: Handler[] } & Record<string, unknown> {
	const handlers: Handler[] = [];
	return {
		handlers,
		on: (_name: string, fn: Handler) => {
			handlers.push(fn);
		},
		events: { emit: () => {} },
	};
}

function makeCtx(): { ctx: unknown; statuses: Array<unknown> } {
	const statuses: Array<unknown> = [];
	return {
		statuses,
		ctx: { ui: { setStatus: (_key: string, text?: string) => statuses.push(text) } },
	};
}

let tmpDir: string;
let prevCwd: string;

function seedProject(rows: unknown[]): void {
	createRun("TestApp", tmpDir);
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TestApp" }),
	);
	const docDir = path.join(tmpDir, "Doc", "requirements");
	fs.mkdirSync(docDir, { recursive: true });
	fs.writeFileSync(path.join(docDir, "PRD_TestApp.md"), PSRS);
	fs.writeFileSync(path.join(docDir, "RTM_TestApp.md"), "# RTM\n");
	fs.writeFileSync(
		path.join(docDir, "RTM_TestApp.json"),
		JSON.stringify({ project: "TestApp", version: "1.0.0", rows }),
	);
}

function cleanRows(): unknown[] {
	return stampFingerprints(
		[
			{
				id: "FR-01",
				title: "t",
				phase: 1,
				design: "",
				implementation: "",
				tests: [],
				status: "proposed",
				coverage: "covered",
			},
		],
		extractRequirementFingerprints(PSRS),
	);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-session-start-"));
	prevCwd = process.cwd();
});

afterEach(() => {
	process.chdir(prevCwd);
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("session_start hook — trace-link notice", () => {
	it("clears the leftover bar and stays cleared when no run is open", async () => {
		process.chdir(tmpDir);
		const pi = makePi();
		registerSessionStartHook(pi as never);
		const { ctx, statuses } = makeCtx();
		await pi.handlers[0]!({}, ctx);
		assert.deepEqual(statuses, [undefined]);
	});

	it("shows the suspect/orphan count when a run is open and links are stale", async () => {
		seedProject([
			{
				id: "FR-01",
				title: "t",
				phase: 1,
				design: "",
				implementation: "",
				tests: [],
				status: "proposed",
				coverage: "covered",
				fingerprint: "0".repeat(64),
			},
		]);
		process.chdir(tmpDir);
		const pi = makePi();
		registerSessionStartHook(pi as never);
		const { ctx, statuses } = makeCtx();
		await pi.handlers[0]!({}, ctx);
		const last = statuses[statuses.length - 1] as string;
		assert.match(last, /trace: 1 suspect\/orphan link\(s\)/);
		assert.match(last, /\/velpari-doctor/);
		assert.match(last, /stage: brainstorming/);
	});

	it("stays cleared when a run is open and all links are clean", async () => {
		seedProject(cleanRows());
		process.chdir(tmpDir);
		const pi = makePi();
		registerSessionStartHook(pi as never);
		const { ctx, statuses } = makeCtx();
		await pi.handlers[0]!({}, ctx);
		assert.deepEqual(statuses, [undefined]);
	});
});
