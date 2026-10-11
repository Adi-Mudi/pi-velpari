/**
 * Repair audit-log tests (Doctor upgrade Phase 2 — T8).
 *
 * Covers `recordFixAudit` / `readFixAudit` (append-only JSONL, tolerant
 * read, best-effort write) and the `runRemediate` integration that writes
 * one row per run.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { recordFixAudit, readFixAudit, type FixAuditEntry } from "../../src/doctor/fix-audit.js";
import { runRemediate } from "../../src/doctor/remediate.js";

/** Project-root-relative journal path (mirrors fix-audit.ts). */
const JOURNAL = path.join(".IDE_Plans", "velpari", "doctor-fix-audit.jsonl");

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-fix-audit-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Build a sample entry.
 * @param {Partial<FixAuditEntry>} [over] - Field overrides.
 * @returns {FixAuditEntry} The sample entry.
 */
function entry(over: Partial<FixAuditEntry> = {}): FixAuditEntry {
	return {
		at: "2026-10-11T00:00:00.000Z",
		fingerprint: "working-published-drift",
		ok: true,
		changedFiles: ["/tmp/Doc/requirements/PRD_X.md"],
		...over,
	};
}

describe("recordFixAudit / readFixAudit", () => {
	it("appends entries in order and reads them back", () => {
		recordFixAudit(entry(), tmpDir);
		recordFixAudit(entry({ at: "2026-10-11T00:00:01.000Z", fingerprint: "frontmatter-missing", ok: false }), tmpDir);

		const read = readFixAudit(tmpDir);
		assert.equal(read.length, 2);
		assert.equal(read[0]?.fingerprint, "working-published-drift");
		assert.deepEqual(read[0]?.changedFiles, ["/tmp/Doc/requirements/PRD_X.md"]);
		assert.equal(read[1]?.fingerprint, "frontmatter-missing");
		assert.equal(read[1]?.ok, false);

		// One JSON object per physical line.
		const raw = fs.readFileSync(path.join(tmpDir, JOURNAL), "utf8");
		assert.equal(raw.trim().split("\n").length, 2);
	});

	it("returns [] when the journal does not exist", () => {
		assert.deepEqual(readFixAudit(tmpDir), []);
	});

	it("skips malformed lines instead of throwing", () => {
		const file = path.join(tmpDir, JOURNAL);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${JSON.stringify(entry())}\nnot json\n\n{"broken":\n`, "utf8");
		const read = readFixAudit(tmpDir);
		assert.equal(read.length, 1);
		assert.equal(read[0]?.fingerprint, "working-published-drift");
	});

	it("never throws when the journal path is unwritable (best-effort)", () => {
		// Point cwd at a regular file: mkdir/append under it must fail, and
		// recordFixAudit must swallow the error.
		const filePath = path.join(tmpDir, "not-a-dir");
		fs.writeFileSync(filePath, "x", "utf8");
		assert.doesNotThrow(() => recordFixAudit(entry(), filePath));
		assert.deepEqual(readFixAudit(filePath), []);
	});
});

describe("runRemediate audit integration (T8)", () => {
	it("writes one audit row per run (success path)", async () => {
		const result = await runRemediate({
			cwd: tmpDir,
			projectName: "TestApp",
			fingerprint: "frontmatter-missing",
		});
		assert.equal(result.ok, true);
		const read = readFixAudit(tmpDir);
		assert.equal(read.length, 1, "exactly one audit row");
		assert.equal(read[0]?.fingerprint, "frontmatter-missing");
		assert.equal(read[0]?.ok, true);
		assert.ok(typeof read[0]?.at === "string" && read[0].at.length > 0, "timestamp recorded");
	});
});
