/**
 * Phase 5.3 — doctor wiring (N22): the Doctor v2 sections are registered in
 * `runDoctor`, and corrupt `files.json` / `state.json` RENDER as errors
 * instead of crashing the report (config hardening, Subphase 5.2 + the
 * Phase C render-hardening guards in the individual checks).
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../../src/doctor/index.js";
import { ensureStandardScaffold } from "../../src/ops/self-heal.js";
import type { DiagnosticSection, DiagnosticItem } from "../../src/doctor/_types.js";

/** The 8 Doctor v2 (N22) sections Phase C registers in `runDoctor`. */
const V2_TITLES = [
	"Environment",
	"Pi extension conformance",
	"Config tamper (drift vs recorded baseline + git intent)",
	"Newly generated files (generated-manifest validation)",
	"Worktree binding (N17)",
	"Soft locks (N19)",
	"Store digest vs git (foreign modification, N21 layer 4)",
	"Semver bump (N27)",
] as const;

/** Temp project root for one test. */
let d = "";

/**
 * Build a project fixture where the doctor is otherwise healthy.
 * @param {string} root - Temp directory to populate.
 * @returns {void}
 */
function healthyFixture(root: string): void {
	ensureStandardScaffold(root);
	cpSync(join(process.cwd(), "skills"), join(root, "skills"), { recursive: true });
	cpSync(join(process.cwd(), "package.json"), join(root, "package.json"));
	mkdirSync(join(root, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(root, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "V2App" }),
	);
	writeFileSync(
		join(root, ".pi", "velpari", "state.json"),
		JSON.stringify({ version: 1, runId: "", mission: "", currentStage: "none", history: [] }),
	);
}

beforeEach(() => {
	d = mkdtempSync(join(tmpdir(), "dr-v2-"));
	healthyFixture(d);
});

afterEach(() => {
	rmSync(d, { recursive: true, force: true });
});

test("healthy project: all 8 Doctor v2 sections registered, no errors in them", () => {
	const report = runDoctor(d);
	const titles = new Set(report.sections.map((s: DiagnosticSection) => s.title));
	for (const t of V2_TITLES) assert.ok(titles.has(t), `missing v2 section: ${t}`);
	assert.equal(report.ok, true, "healthy fixture should be error-free");
	// No error items come from any of the 8 new sections.
	for (const t of V2_TITLES) {
		const sec = report.sections.find((s: DiagnosticSection) => s.title === t);
		for (const item of sec?.items ?? []) {
			assert.notEqual(item.status, "error", `${t}: unexpected error — ${item.message}`);
		}
	}
});

test("corrupt files.json renders Config: UNREADABLE with a Fix, never throws", () => {
	writeFileSync(join(d, ".pi", "velpari", "files.json"), "{broken");
	let report;
	assert.doesNotThrow(() => {
		report = runDoctor(d);
	});
	const cfg = report!.sections.find((s: DiagnosticSection) => s.title === "Config");
	assert.ok(cfg, "Config section must render");
	assert.match(cfg.items[0].message, /^Config: UNREADABLE/);
	assert.equal(cfg.items[0].status, "error");
	// Action items callout (report head) carries the error + its fix.
	const actions = report!.sections[0];
	assert.match(actions.title, /Action items/);
	assert.ok(
		actions.items.some((i: DiagnosticItem) => i.message.includes("Config: UNREADABLE")),
		"action items must surface Config: UNREADABLE",
	);
	assert.ok(
		actions.items.some((i: DiagnosticItem) => i.message.includes("→ Fix:")),
		"action items must carry fix suggestions",
	);
});

test("corrupt state.json renders Run state: UNREADABLE, never throws", () => {
	writeFileSync(join(d, ".pi", "velpari", "state.json"), "{bad");
	let report;
	assert.doesNotThrow(() => {
		report = runDoctor(d);
	});
	const st = report!.sections.find((s: DiagnosticSection) => s.title === "Run state");
	assert.ok(st, "Run state section must render");
	assert.equal(st.items[0].status, "error");
	assert.match(st.items[0].message, /Run state: UNREADABLE/);
});

test("double-corrupt (config + state) still renders a full report", () => {
	writeFileSync(join(d, ".pi", "velpari", "files.json"), "{broken");
	writeFileSync(join(d, ".pi", "velpari", "state.json"), "{bad");
	let report;
	assert.doesNotThrow(() => {
		report = runDoctor(d);
	});
	assert.ok(report!.sections.length > 10, "report keeps its full section list");
	assert.ok(report!.sections.some((s: DiagnosticSection) => s.title === "Config"));
	assert.ok(report!.sections.some((s: DiagnosticSection) => s.title === "Run state"));
});
