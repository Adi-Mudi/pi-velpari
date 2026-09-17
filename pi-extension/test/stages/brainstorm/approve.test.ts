/**
 * /velpari-approve-brainstorm handler tests (Phase 5 — gated approve).
 *
 * Drives handleApproveBrainstorm against mock ExtensionCommandContext /
 * ExtensionAPI in a tmp project dir. Asserts the hard-block ordering and the
 * clean-path side effects:
 *   1. stage checks (no run / not brainstorming) — unchanged behavior
 *   2. guardApproveReadiness blocks BEFORE publish (unconfirmed
 *      understanding, open draft/discussing questions)
 *   3. guardNotesContent blocks on missing/empty/_TBD_ sections
 *   4. clean path: publishes Doc/brainstorm/brainstorm-<slug>.md, writes the
 *      audit log, clears the 4 brainstorm session fields, advances the
 *      stage, and surfaces a "Next: /velpari-prd" hint (no auto-chain
 *      to the PRD handler — v1.6.2 dropped the auto-chain so each stage
 *      boundary is a manual confirm-then-write step)
 *   5. idempotency: a second approve call fails at the stage check
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApproveBrainstorm } from "../../../src/stages/brainstorm-approve.js";
import {
	confirmUnderstanding,
	createRun,
	incrementBrainstormDispatchCount,
	loadState,
	setScansSelected,
	upsertBrainstormQuestion,
	type RunState,
} from "../../../src/core/state.js";
import { buildRunDir, slugify } from "../../../src/core/paths.js";
import { AUDIT_LOG_MARKER, auditLogPath } from "../../../src/stages/brainstorm/audit.js";

let tmpDir: string;
let notifications: Array<{ message: string; level: string }>;
let statusUpdates: Array<{ key: string; text: string }>;
let appendedEntries: Array<{ customType: string; data: unknown }>;
let sentMessages: string[];

const MISSION = "Test mission";
const MISSION_SLUG = slugify(MISSION);

const VALID_NOTES = [
	"# Brainstorm Notes — Test mission",
	"",
	"## Mission",
	"Test mission",
	"",
	"## Interview Answers",
	"1. Q: Scope? A: MVP only",
	"",
	"## Scout Proposals",
	"",
	"### NEW EXTRACTOR",
	"- (new) extractor idea",
	"",
	"## Decision Summary",
	"- new-fr: [FR-01]",
	"",
	"## Agreed",
	"- Q1: Scope? — MVP only",
	"",
	"## Not wanted",
	"- (none)",
	"",
	"## Open",
	"- (none)",
	"",
].join("\n");

function makeCtx(): ExtensionCommandContext {
	const ctx = {
		ui: {
			notify: (message: string, level: string) => {
				notifications.push({ message, level });
			},
			setStatus: (key: string, text: string) => {
				statusUpdates.push({ key, text });
			},
		},
	};
	return ctx as unknown as ExtensionCommandContext;
}

function makePi(): ExtensionAPI {
	const pi = {
		appendEntry: (customType: string, data: unknown) => {
			appendedEntries.push({ customType, data });
		},
		getFlag: () => undefined,
		sendUserMessage: (message: string) => {
			sentMessages.push(message);
		},
	};
	return pi as unknown as ExtensionAPI;
}

function writeNotes(runId: string, content: string = VALID_NOTES): string {
	const notesPath = path.join(buildRunDir(runId, tmpDir), "brainstorm", "brainstorm-notes.md");
	fs.mkdirSync(path.dirname(notesPath), { recursive: true });
	fs.writeFileSync(notesPath, content, "utf8");
	return notesPath;
}

function writeFilesConfig(): void {
	const configPath = path.join(tmpDir, ".pi", "velpari", "files.json");
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(
		configPath,
		JSON.stringify({
			version: 3,
			projectName: "TestApp",
			framework: { language: "TypeScript" },
			inputDocuments: [],
			outputPaths: {},
			excludedPaths: [],
		}),
		"utf8",
	);
}

function publishedDir(): string {
	return path.join(tmpDir, "Doc", "brainstorm");
}

function publishedFiles(): string[] {
	return fs.existsSync(publishedDir()) ? fs.readdirSync(publishedDir()) : [];
}

function lastError(): string {
	const errors = notifications.filter((n) => n.level === "error");
	return errors.length > 0 ? errors[errors.length - 1]!.message : "";
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-approve-"));
	notifications = [];
	statusUpdates = [];
	appendedEntries = [];
	sentMessages = [];
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleApproveBrainstorm", () => {
	it("blocks when no run is active", async () => {
		await handleApproveBrainstorm(makeCtx(), makePi(), tmpDir);
		assert.match(lastError(), /No active brainstorm to approve/);
	});

	it("blocks when the current stage is not brainstorming", async () => {
		const state = createRun(MISSION, tmpDir);
		// Simulate an already-approved run.
		const past: RunState = { ...state, currentStage: "brainstormed" };
		fs.writeFileSync(
			path.join(tmpDir, ".IDE_Plans", "velpari", "state.json"),
			JSON.stringify(past),
			"utf8",
		);

		await handleApproveBrainstorm(makeCtx(), makePi(), tmpDir);
		assert.match(lastError(), /current stage is "brainstormed"/);
	});

	it("blocks when understanding is not confirmed (before publish)", async () => {
		const state = createRun(MISSION, tmpDir);
		writeNotes(state.runId);

		await handleApproveBrainstorm(makeCtx(), makePi(), tmpDir);
		assert.match(lastError(), /Understanding is not confirmed/);
		assert.equal(publishedFiles().length, 0);
		assert.equal(loadState(tmpDir).currentStage, "brainstorming");
	});

	it("blocks when a question is still draft (before publish)", async () => {
		let state = createRun(MISSION, tmpDir);
		state = confirmUnderstanding(state, tmpDir);
		upsertBrainstormQuestion(state, { id: "Q1", text: "Scope?", state: "draft" }, tmpDir);
		writeNotes(state.runId);

		await handleApproveBrainstorm(makeCtx(), makePi(), tmpDir);
		assert.match(lastError(), /still open: Q1/);
		assert.equal(publishedFiles().length, 0);
		assert.equal(loadState(tmpDir).currentStage, "brainstorming");
	});

	it("blocks when notes still have a _TBD_ section", async () => {
		let state = createRun(MISSION, tmpDir);
		state = confirmUnderstanding(state, tmpDir);
		writeNotes(state.runId, VALID_NOTES.replace("- new-fr: [FR-01]", "_TBD_"));

		await handleApproveBrainstorm(makeCtx(), makePi(), tmpDir);
		assert.match(lastError(), /not ready to approve/);
		assert.match(lastError(), /Decision Summary/);
		assert.equal(publishedFiles().length, 0);
		assert.equal(loadState(tmpDir).currentStage, "brainstorming");
	});

	it("clean path: publishes, writes audit log, clears session fields, advances, shows next-command hint (no auto-chain)", async () => {
		let state = createRun(MISSION, tmpDir);
		state = confirmUnderstanding(state, tmpDir);
		state = setScansSelected(state, ["code", "doc"], tmpDir);
		state = upsertBrainstormQuestion(
			state,
			{ id: "Q1", text: "Scope?", state: "agreed", suggestedAnswer: "MVP only" },
			tmpDir,
		);
		incrementBrainstormDispatchCount(state, tmpDir);
		writeNotes(state.runId);
		writeFilesConfig();

		await handleApproveBrainstorm(makeCtx(), makePi(), tmpDir);

		// Published copy exists with the notes content, stamped with the
		// uniform artifact frontmatter at publish time.
		const published = path.join(publishedDir(), `brainstorm-${MISSION_SLUG}.md`);
		assert.equal(fs.existsSync(published), true, "expected grouped publish file");
		const publishedContent = fs.readFileSync(published, "utf8");
		assert.ok(
			publishedContent.startsWith("---\nartifact: brainstorm\n"),
			"expected artifact frontmatter at the top of the published notes",
		);
		assert.ok(publishedContent.endsWith(VALID_NOTES), "published notes body changed");
		assert.ok(
			notifications.some((n) => n.message.startsWith("Published to ")),
			"expected a publish notification",
		);

		// Audit log written with the marker.
		const auditPath = auditLogPath(state.runId, tmpDir);
		assert.equal(fs.existsSync(auditPath), true, "expected audit log");
		const auditContent = fs.readFileSync(auditPath, "utf8");
		assert.ok(auditContent.startsWith(AUDIT_LOG_MARKER), "audit log missing marker");
		assert.match(auditContent, /Notes sections filled: 7 \/ 7/);

		// Session fields cleared; stage advanced.
		const loaded = loadState(tmpDir);
		assert.equal(loaded.currentStage, "brainstormed");
		assert.equal(loaded.understandingConfirmed, undefined);
		assert.equal(loaded.scansSelected, undefined);
		assert.equal(loaded.brainstormQuestions, undefined);
		assert.equal(loaded.brainstormDispatchCount, undefined);

		// Session entry + status bar reflect the cleared, advanced state.
		assert.equal(appendedEntries.length, 1);
		assert.equal(appendedEntries[0]!.customType, "velpari-state");
		assert.equal(
			(appendedEntries[0]!.data as Record<string, unknown>).stage,
			"brainstormed",
		);
		assert.ok(
			statusUpdates.some(
				(u) => u.key === "velpari" && u.text.includes("brainstormed"),
			),
		);

		// v1.6.2: NO auto-chain to PRD. The handler surfaces a clear
		// "Next: /velpari-prd" hint instead and stops — the user runs
		// the next command by hand.
		const nextHint = notifications.find((n) =>
			n.message.includes("Brainstorm notes published") &&
			n.message.includes("/velpari-prd"),
		);
		assert.ok(
			nextHint,
			"expected a 'Brainstorm notes published. Next: /velpari-prd' hint",
		);
		assert.equal(
			sentMessages.length,
			0,
			"v1.6.2 dropped auto-chain; no parent LLM message should be sent from brainstorm-approve",
		);
	});

	it("is idempotent: a second approve call fails at the stage check", async () => {
		let state = createRun(MISSION, tmpDir);
		state = confirmUnderstanding(state, tmpDir);
		writeNotes(state.runId);
		writeFilesConfig();

		await handleApproveBrainstorm(makeCtx(), makePi(), tmpDir);
		assert.equal(publishedFiles().length, 1);

		await handleApproveBrainstorm(makeCtx(), makePi(), tmpDir);
		assert.match(lastError(), /current stage is "brainstormed"/);
		assert.equal(publishedFiles().length, 1, "second call must not publish again");
	});
});
