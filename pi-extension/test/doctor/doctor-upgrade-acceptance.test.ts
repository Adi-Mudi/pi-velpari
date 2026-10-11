/**
 * Doctor upgrade v1 — end-to-end acceptance (Phase 3, subphase 3.3).
 *
 * Exercises the `/velpari-doctor` command through a mock `pi` + mock `ctx`
 * (no real Pi runtime) and asserts the frozen acceptance anchors:
 *
 *   1. standalone (no flags) → `pi.sendUserMessage` gets the full chat
 *      report + "Report saved to …";
 *   2. `--velpari-quiet` → no `sendUserMessage`, a summary notify instead;
 *   3. `--velpari-json` → `.IDE_Plans/velpari/doctor-report.json` written
 *      with `schemaVersion: 1` and stable section ids;
 *   4. `--velpari-check` → PASS/FAIL notify + `process.exitCode`;
 *   5. embedded path unchanged → no `sendUserMessage` (SAFE-1).
 *
 * Covers master plan §9 (Q1 UX, Q2 machine-readable, Guards) — see
 * `.IDE_Plans/doctor-upgrade_phase3_plan_20261011_1203_v1.0.md`.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { registerDoctorCommand } from "../../src/commands/doctor.js";
import { handleDoctor, runDoctor } from "../../src/doctor/index.js";

/** The command handler shape captured from `registerCommand`. */
type DoctorHandler = (_args: unknown, ctx: ExtensionContext) => Promise<void>;

interface FakePi {
	/** The mock extension API handed to the command. */
	pi: ExtensionAPI;
	/** Mutable flag map — the single source for every `getFlag` call. */
	flags: Map<string, unknown>;
	/** Every message pushed to the chat via `sendUserMessage`. */
	sent: string[];
	/** The captured `/velpari-doctor` handler. */
	handler: DoctorHandler;
}

/**
 * Build a fake ExtensionAPI that captures the `/velpari-doctor` handler,
 * records `sendUserMessage` calls, and reads flags from a mutable map.
 * @returns {FakePi} The fake API, its flag map, the sent-message log, and the handler.
 */
function makePi(): FakePi {
	const commands = new Map<string, DoctorHandler>();
	const flags = new Map<string, unknown>();
	const sent: string[] = [];
	const pi = {
		/** Capture the handler registered under the command name. */
		registerCommand(name: string, spec: { handler: DoctorHandler }) {
			commands.set(name, spec.handler);
		},
		/** Flag lookup backed by the mutable map. */
		getFlag(name: string) {
			return flags.get(name);
		},
		/** Record a chat push (the standalone report delivery). */
		sendUserMessage(message: string) {
			sent.push(String(message));
		},
	} as unknown as ExtensionAPI;
	registerDoctorCommand(pi);
	const handler = commands.get("velpari-doctor");
	if (!handler) throw new Error("velpari-doctor handler was not registered");
	return { pi, flags, sent, handler };
}

interface FakeCtx {
	/** The mock command context. */
	ctx: ExtensionCommandContext;
	/** Every `ctx.ui.notify` call, in order. */
	notifications: { message: string; severity: string }[];
	/** Total interactive picker calls (`select` / `confirm`). */
	pickerCalls: () => number;
}

/**
 * Build a fake command context that records notifications and counts every
 * interactive picker call.
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
	} as unknown as ExtensionCommandContext;
	return { ctx, notifications, pickerCalls: () => picker };
}

/** Write an invalid `files.json` so the audit reliably reports config errors. */
function writeBrokenConfig(dir: string): void {
	mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(dir, ".pi", "velpari", "files.json"), "{}");
}

/** Project-root-relative JSON report path (mirrors report-schema.ts). */
const JSON_REPORT = join(".IDE_Plans", "velpari", "doctor-report.json");

/** Project-root-relative markdown report path (mirrors PATHS.DOCTOR_REPORT). */
const MD_REPORT = join(".IDE_Plans", "velpari", "doctor-report.md");

let tmpDir: string;
let prevCwd: string;

beforeEach(() => {
	prevCwd = process.cwd();
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-doctor-acceptance-"));
});

afterEach(() => {
	// Check mode writes process.exitCode — clear it so the test process
	// still exits 0 when every test passes.
	process.exitCode = undefined;
	process.chdir(prevCwd);
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("1. standalone /velpari-doctor (default)", () => {
	it("pushes the full chat report + 'Report saved to' and writes the markdown report", async () => {
		writeBrokenConfig(tmpDir); // force at least one error + a suggestion
		process.chdir(tmpDir);
		const { handler, sent } = makePi();
		const { ctx } = makeCtx();

		await handler({}, ctx);

		assert.equal(sent.length, 1, "exactly one chat push in standalone mode");
		const message = sent[0] ?? "";
		assert.match(message, /Doctor: \d+ OK \/ \d+ warnings \/ \d+ errors/, "full report header");
		assert.match(message, /### Recommended next steps/, "next-steps block present");
		assert.match(message, /Report saved to /, "report-path footer present");
		assert.ok(message.includes(join(tmpDir, MD_REPORT)), "footer names the markdown report path");
		assert.ok(existsSync(join(tmpDir, MD_REPORT)), "markdown report written");
	});
});

describe("2. --velpari-quiet", () => {
	it("pushes no chat report and notifies a summary instead", async () => {
		writeBrokenConfig(tmpDir);
		process.chdir(tmpDir);
		const { flags, handler, sent } = makePi();
		flags.set("velpari-quiet", true);
		const { ctx, notifications } = makeCtx();

		await handler({}, ctx);

		assert.equal(sent.length, 0, "quiet mode must not push the full chat report");
		assert.ok(
			notifications.some((n) => /^Doctor: \d+ OK \/ \d+ warnings \/ \d+ errors/.test(n.message)),
			"expected the summary-line notify",
		);
		assert.ok(
			notifications.some((n) => n.message.includes("Full report written to")),
			"expected the report-path notify",
		);
	});
});

describe("3. --velpari-json", () => {
	it("writes the versioned report with schemaVersion 1 and stable section ids", async () => {
		writeBrokenConfig(tmpDir);
		process.chdir(tmpDir);
		const { flags, handler, sent } = makePi();
		flags.set("velpari-json", true);
		const { ctx, notifications } = makeCtx();

		await handler({}, ctx);

		assert.equal(sent.length, 0, "json mode must not push the full chat report");
		const jsonPath = join(tmpDir, JSON_REPORT);
		assert.ok(existsSync(jsonPath), "doctor-report.json must be written");

		const json = JSON.parse(readFileSync(jsonPath, "utf8")) as {
			schemaVersion: number;
			verdict: string;
			sections: { id: string; title: string }[];
		};
		assert.equal(json.schemaVersion, 1, "versioned schema");
		assert.ok(json.verdict === "ok" || json.verdict === "error", "verdict is ok|error");
		assert.ok(Array.isArray(json.sections) && json.sections.length > 0, "sections present");

		// Every section carries a stable, non-empty machine id.
		for (const section of json.sections) {
			assert.equal(typeof section.id, "string", `section "${section.title}" id must be a string`);
			assert.ok(section.id.length > 0, `section "${section.title}" id must be non-empty`);
		}
		const ids = new Set(json.sections.map((s) => s.id));
		for (const stable of ["action-items", "config", "run-state"]) {
			assert.ok(ids.has(stable), `expected stable section id "${stable}" (got: ${[...ids].join(", ")})`);
		}

		assert.ok(
			notifications.some((n) => n.message.includes("doctor-report.json")),
			"expected a notify naming the JSON report",
		);
	});
});

describe("4. --velpari-check", () => {
	it("reports FAIL + exit code 1 on errors and suppresses the fix picker", async () => {
		writeBrokenConfig(tmpDir);
		process.chdir(tmpDir);
		const { flags, handler } = makePi();
		flags.set("velpari-check", true);
		flags.set("velpari-fix", true);
		const { ctx, notifications, pickerCalls } = makeCtx();

		await handler({}, ctx);

		assert.equal(process.exitCode, 1, "exitCodeFor maps an error report to 1");
		assert.ok(
			notifications.some((n) => /^Doctor: FAIL \(\d+ errors\)$/.test(n.message)),
			"expected the FAIL verdict notify",
		);
		assert.equal(pickerCalls(), 0, "the fix picker must be suppressed in check mode");
	});

	it("reports PASS + exit code 0 on a clean report", async () => {
		process.chdir(tmpDir); // empty project root → clean audit
		const { flags, handler } = makePi();
		flags.set("velpari-check", true);
		flags.set("velpari-fix", true);
		const { ctx, notifications, pickerCalls } = makeCtx();

		await handler({}, ctx);

		assert.equal(process.exitCode, 0, "exitCodeFor maps a clean report to 0");
		assert.ok(
			notifications.some((n) => n.message === "Doctor: PASS"),
			"expected the PASS verdict notify",
		);
		assert.equal(pickerCalls(), 0, "the fix picker must be suppressed in check mode");
	});
});

describe("5. embedded path unchanged (SAFE-1)", () => {
	it("runDoctor({ embedded: true }) never pushes a chat report", () => {
		process.chdir(tmpDir);
		const { sent } = makePi();

		const report = runDoctor(tmpDir, { embedded: true });

		assert.equal(sent.length, 0, "embedded audits must never reach the chat delivery path");
		assert.equal(typeof report.ok, "boolean");
		assert.ok(report.sections.length > 0, "embedded run still returns the full report");
	});

	it("handleDoctor falls back to the notify-only tail when pi is absent", async () => {
		process.chdir(tmpDir);
		const { ctx, notifications } = makeCtx();

		const result = await handleDoctor(ctx); // test rig / RPC mode: no pi

		assert.equal(result.skipped, false, "audit ran");
		assert.ok(
			notifications.some((n) => n.message.includes("Full report written to")),
			"expected the notify-only tail",
		);
		assert.ok(
			!notifications.some((n) => n.message.includes("### Recommended next steps")),
			"no full chat report in the notify-only tail",
		);
	});
});
