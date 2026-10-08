/**
 * Brainstorm notes module tests (Phase 4).
 *
 * Covers: validateNotesContent (each of the 7 required sections missing /
 * empty / _TBD_; valid full doc passes), amendBullet (strike-through +
 * append-when-missing), renderDecisionsBlock (all 5 question states),
 * syncDecisionsToNotes (creates block, idempotent re-sync, preserves
 * surrounding content).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	amendBullet,
	DECISIONS_BLOCK_END,
	DECISIONS_BLOCK_START,
	renderDecisionsBlock,
	REQUIRED_NOTES_SECTIONS,
	syncDecisionsToNotes,
	validateNotesContent,
} from "../../../src/stages/brainstorm/notes.js";
import type { BrainstormQuestion } from "../../../src/core/state.js";

const FULL_DOC = [
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
].join("\n");

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-notes-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("validateNotesContent", () => {
	it("passes a complete 7-section document", () => {
		assert.equal(validateNotesContent(FULL_DOC).ok, true);
	});

	it("requires all 7 sections (base 4 + ledger 3)", () => {
		assert.equal(REQUIRED_NOTES_SECTIONS.length, 7);
		for (const name of REQUIRED_NOTES_SECTIONS) {
			// Remove one section at a time (heading + body up to next heading).
			const re = new RegExp(`\\n## ${name}\\n[\\s\\S]*?(?=\\n## |$)`);
			const doc = FULL_DOC.replace(re, "");
			const res = validateNotesContent(doc);
			assert.equal(res.ok, false, `expected failure without ${name}`);
			assert.match(res.reason ?? "", new RegExp(`${name.replace(/ /g, "\\s")} \\(missing\\)`));
		}
	});

	it("rejects empty sections", () => {
		const doc = FULL_DOC.replace("## Mission\nTest mission", "## Mission");
		const res = validateNotesContent(doc);
		assert.equal(res.ok, false);
		assert.match(res.reason ?? "", /Mission \(empty\)/);
	});

	it("rejects _TBD_ placeholders", () => {
		const doc = FULL_DOC.replace("- new-fr: [FR-01]", "_TBD_");
		const res = validateNotesContent(doc);
		assert.equal(res.ok, false);
		assert.match(res.reason ?? "", /Decision Summary \(_TBD_ placeholder\)/);
	});
});

describe("amendBullet", () => {
	it("strikes through the old bullet and inserts the replacement", () => {
		const doc = "- old scope\n- other bullet";
		const out = amendBullet(doc, "old scope", "new scope");
		assert.equal(out, "- ~~old scope~~\n- new scope\n- other bullet");
	});

	it("appends the replacement when the old line is not found", () => {
		const doc = "- existing bullet";
		const out = amendBullet(doc, "missing line", "added line");
		assert.equal(out, "- existing bullet\n- added line");
	});

	it("only replaces the first matching bullet", () => {
		const doc = "- dup\n- dup";
		const out = amendBullet(doc, "dup", "new");
		assert.equal(out, "- ~~dup~~\n- new\n- dup");
	});
});

describe("renderDecisionsBlock", () => {
	const questions: BrainstormQuestion[] = [
		{ id: "Q1", text: "Scope?", state: "agreed", suggestedAnswer: "MVP only" },
		{ id: "Q2", text: "Mobile app?", state: "not-wanted", reason: "CLI only per user" },
		{ id: "Q3", text: "Old auth idea", state: "replaced", reason: "Superseded by Q1" },
		{ id: "Q4", text: "Sync?", state: "draft" },
		{ id: "Q5", text: "Storage?", state: "discussing" },
	];

	it("renders all 5 states into the right lists", () => {
		const block = renderDecisionsBlock(questions);
		assert.ok(block.startsWith(DECISIONS_BLOCK_START));
		assert.ok(block.trimEnd().endsWith(DECISIONS_BLOCK_END));
		assert.match(block, /## Agreed\n\n- Q1: Scope\? — MVP only/);
		assert.match(block, /## Not wanted\n\n- Q2: Mobile app\? — reason: CLI only per user/);
		// Replaced keeps the strikethrough so the superseded text survives.
		assert.match(block, /- Q3: ~~Old auth idea~~ \(superseded\) — reason: Superseded by Q1/);
		assert.match(block, /## Open\n\n- Q4: Sync\? \(state: draft\)\n- Q5: Storage\? \(state: discussing\)/);
	});

	it("renders empty-list fallbacks", () => {
		const block = renderDecisionsBlock([]);
		assert.match(block, /## Agreed\n\n- \(none yet\)/);
		assert.match(block, /## Not wanted\n\n- \(none\)/);
		assert.match(block, /## Open\n\n- \(none\)/);
	});
});

describe("syncDecisionsToNotes", () => {
	const questions: BrainstormQuestion[] = [
		{ id: "Q1", text: "Scope?", state: "agreed" },
		{ id: "Q2", text: "Sync?", state: "not-wanted", reason: "v2" },
	];

	it("creates the block at the end of an existing notes file", () => {
		const notesPath = path.join(tmpDir, "brainstorm-notes.md");
		fs.writeFileSync(notesPath, FULL_DOC, "utf8");
		syncDecisionsToNotes(notesPath, questions);
		const raw = fs.readFileSync(notesPath, "utf8");
		assert.ok(raw.startsWith("# Brainstorm Notes"));
		assert.ok(raw.includes(DECISIONS_BLOCK_START));
		assert.match(raw, /- Q2: Sync\? — reason: v2/);
	});

	it("creates the file when absent", () => {
		const notesPath = path.join(tmpDir, "sub", "brainstorm-notes.md");
		syncDecisionsToNotes(notesPath, questions);
		assert.ok(fs.existsSync(notesPath));
		assert.ok(fs.readFileSync(notesPath, "utf8").startsWith(DECISIONS_BLOCK_START));
	});

	it("is idempotent — re-sync replaces the block, never duplicates it", () => {
		const notesPath = path.join(tmpDir, "brainstorm-notes.md");
		fs.writeFileSync(notesPath, FULL_DOC, "utf8");
		syncDecisionsToNotes(notesPath, questions);
		syncDecisionsToNotes(notesPath, [...questions, { id: "Q3", text: "Storage?", state: "agreed" }]);
		const raw = fs.readFileSync(notesPath, "utf8");
		assert.equal(raw.split(DECISIONS_BLOCK_START).length - 1, 1);
		assert.equal(raw.split(DECISIONS_BLOCK_END).length - 1, 1);
		assert.match(raw, /- Q3: Storage\?/);
	});

	it("preserves surrounding content on re-sync", () => {
		const notesPath = path.join(tmpDir, "brainstorm-notes.md");
		fs.writeFileSync(notesPath, FULL_DOC, "utf8");
		syncDecisionsToNotes(notesPath, questions);
		syncDecisionsToNotes(notesPath, questions);
		const raw = fs.readFileSync(notesPath, "utf8");
		for (const section of ["## Mission", "## Scout Proposals", "## Decision Summary"]) {
			assert.ok(raw.includes(section), `lost ${section}`);
		}
	});
});
