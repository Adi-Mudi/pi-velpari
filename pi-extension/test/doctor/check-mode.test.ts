/**
 * Check-mode + JSON report tests (Doctor upgrade Phase 1 — lane a2,
 * subphase 1.6; contract T1/T2).
 *
 * Covers:
 *   - `exitCodeFor` maps the report verdict to 0 / 1.
 *   - `isCheckMode` / `isJsonMode` read the registered `--velpari-*` flags.
 *   - `/velpari-doctor --velpari-json` writes the versioned JSON report.
 *   - `/velpari-doctor --velpari-check` reports PASS/FAIL, sets the process
 *     exit code, and suppresses the interactive `--velpari-fix` picker.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { registerDoctorCommand } from "../../src/commands/doctor.js";
import { exitCodeFor, isCheckMode, isJsonMode } from "../../src/doctor/check-mode.js";
import type { DiagnosticReport } from "../../src/doctor/_types.js";

const OK_REPORT: DiagnosticReport = {
	ok: true,
	summary: { ok: 1, warning: 0, error: 0, info: 0 },
	sections: [],
};

const ERROR_REPORT: DiagnosticReport = {
	ok: false,
	summary: { ok: 0, warning: 0, error: 2, info: 0 },
	sections: [],
};

type DoctorHandler = (_args: unknown, ctx: ExtensionContext) => Promise<void>;

interface FakePi {
	pi: ExtensionAPI;
	flags: Map<string, unknown>;
	handler: DoctorHandler;
}

/**
 * Build a fake ExtensionAPI that captures the registered `/velpari-doctor`
 * handler and reads flags from a mutable map.
 * @returns {FakePi} The fake API, its flag map, and the captured handler.
 */
function makePi(): FakePi {
	const commands = new Map<string, DoctorHandler>();
	const flags = new Map<string, unknown>();
	const pi = {
		/** Capture the handler registered under the command name. */
		registerCommand(name: string, spec: { handler: DoctorHandler }) {
			commands.set(name, spec.handler);
		},
		/** Flag lookup backed by the mutable map. */
		getFlag(name: string) {
			return flags.get(name);
		},
	} as unknown as ExtensionAPI;
	registerDoctorCommand(pi);
	const handler = commands.get("velpari-doctor");
	if (!handler) throw new Error("velpari-doctor handler was not registered");
	return { pi, flags, handler };
}

interface FakeCtx {
	ctx: ExtensionContext;
	notifications: { message: string; severity: string }[];
	pickerCalls: () => number;
}

/**
 * Build a fake command context that records notifications and counts every
 * interactive picker call (`select` / `confirm`).
 * @returns {FakeCtx} The fake context plus its recorders.
 */
function makeCtx(): FakeCtx {
	const notifications: { message: string; severity: string }[] = [];
	let picker = 0;
	const ctx = {
		ui: {
			/** Record one notification with its severity (defaults to "info"). */
			notify(message: string, severity?: string) {
				notifications.push({ message, severity: severity ?? "info" });
			},
			/** Any interactive selection counts as a picker call. */
			async select() {
				picker++;
				return undefined;
			},
			/** Any confirmation counts as a picker call. */
			async confirm() {
				picker++;
				return false;
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, notifications, pickerCalls: () => picker };
}

/** Write an invalid `files.json` so the audit reliably reports config errors. */
function writeBrokenConfig(dir: string): void {
	mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(dir, ".pi", "velpari", "files.json"), "{}");
}

let tmpDir: string;
let prevCwd: string;

beforeEach(() => {
	prevCwd = process.cwd();
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-check-mode-"));
});

afterEach(() => {
	// The handler sets process.exitCode in check mode — clear it so the
	// test process still exits 0 when every test passes.
	process.exitCode = undefined;
	process.chdir(prevCwd);
	rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// exitCodeFor
// ---------------------------------------------------------------------------

describe("exitCodeFor", () => {
	it("returns 0 for a clean report", () => {
		assert.equal(exitCodeFor(OK_REPORT), 0);
	});

	it("returns 1 for a report with errors", () => {
		assert.equal(exitCodeFor(ERROR_REPORT), 1);
	});
});

// ---------------------------------------------------------------------------
// isCheckMode / isJsonMode
// ---------------------------------------------------------------------------

describe("isCheckMode / isJsonMode", () => {
	it("isCheckMode reads the velpari-check flag", () => {
		assert.equal(isCheckMode({ getFlag: (name) => name === "velpari-check" }), true);
		assert.equal(isCheckMode({ getFlag: () => false }), false);
		assert.equal(isCheckMode(undefined), false);
	});

	it("isJsonMode reads the velpari-json flag", () => {
		assert.equal(isJsonMode({ getFlag: (name) => name === "velpari-json" }), true);
		assert.equal(isJsonMode({ getFlag: () => false }), false);
		assert.equal(isJsonMode(undefined), false);
	});
});

// ---------------------------------------------------------------------------
// /velpari-doctor --velpari-json
// ---------------------------------------------------------------------------

describe("/velpari-doctor --velpari-json", () => {
	it("writes the versioned JSON report beside the markdown report", async () => {
		writeBrokenConfig(tmpDir);
		process.chdir(tmpDir);
		const { flags, handler } = makePi();
		flags.set("velpari-json", true);
		const { ctx, notifications } = makeCtx();

		await handler({}, ctx);

		const jsonPath = join(tmpDir, ".IDE_Plans", "velpari", "doctor-report.json");
		assert.ok(existsSync(jsonPath), "doctor-report.json must be written");
		const json = JSON.parse(readFileSync(jsonPath, "utf8"));
		assert.equal(typeof json.schemaVersion, "number");
		assert.equal(json.verdict, "error");
		assert.ok(
			notifications.some((n) => n.message.includes("doctor-report.json")),
			"expected a notify naming the JSON path",
		);
	});

	it("does not write the JSON report without the flag", async () => {
		process.chdir(tmpDir);
		const { handler } = makePi();
		const { ctx } = makeCtx();

		await handler({}, ctx);

		assert.ok(!existsSync(join(tmpDir, ".IDE_Plans", "velpari", "doctor-report.json")));
	});
});

// ---------------------------------------------------------------------------
// /velpari-doctor --velpari-check
// ---------------------------------------------------------------------------

describe("/velpari-doctor --velpari-check", () => {
	it("sets the exit code to 1 and suppresses the picker on errors", async () => {
		writeBrokenConfig(tmpDir);
		process.chdir(tmpDir);
		const { flags, handler } = makePi();
		flags.set("velpari-check", true);
		flags.set("velpari-fix", true);
		const { ctx, notifications, pickerCalls } = makeCtx();

		await handler({}, ctx);

		assert.equal(process.exitCode, 1);
		assert.ok(
			notifications.some((n) => /^Doctor: FAIL \(\d+ errors\)$/.test(n.message)),
			"expected a FAIL verdict notify",
		);
		assert.equal(pickerCalls(), 0, "the --velpari-fix picker must be suppressed in check mode");
	});

	it("reports PASS and exit code 0 when the report has no errors", async () => {
		process.chdir(tmpDir);
		const { flags, handler } = makePi();
		flags.set("velpari-check", true);
		flags.set("velpari-fix", true);
		const { ctx, notifications, pickerCalls } = makeCtx();

		await handler({}, ctx);

		assert.equal(process.exitCode, 0);
		assert.ok(
			notifications.some((n) => n.message === "Doctor: PASS"),
			"expected a PASS verdict notify",
		);
		assert.equal(pickerCalls(), 0, "the --velpari-fix picker must be suppressed in check mode");
	});
});
