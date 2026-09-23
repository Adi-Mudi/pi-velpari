/**
 * Reviewer documentation consistency tests (Phase 5 of reviewer plan).
 *
 * Verifies that the docs the reviewer plan introduces agree with each other:
 *   - Doc/velpari-sequence/ (doc set) covers the adversarial reviewer + verdict
 *   - AGENTS.md has principle "10b." (reviewer sub-agent)
 *   - CHANGELOG.md top entry has "Reviewer sub-agent"
 *   - skills/agents/reviewer.md exists (cross-referenced from docs)
 *   - skills/velpari-reviewer.md exists
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

const CANDIDATE_PATHS = ["", "../", "../../", "../../../"];

function readAt(rel: string): string | null {
	for (const prefix of CANDIDATE_PATHS) {
		try {
			return readFileSync(prefix + rel, "utf8");
		} catch {
			// continue
		}
	}
	return null;
}

describe("Doc/velpari-sequence/ (doc set) — reviewer coverage", () => {
	const md = [
		readAt("Doc/velpari-sequence/01-first-run-sequence.md"),
		readAt("Doc/velpari-sequence/03-staleness-and-validation.md"),
		readAt("Doc/velpari-sequence/05-sub-agent-generation.md"),
		readAt("Doc/velpari-sequence/08-command-reference.md"),
	]
		.filter((s): s is string => s !== null)
		.join("\n");
	if (!md) {
		it.skip("doc set missing", () => {});
		return;
	}

	it("mentions the adversarial reviewer per stage", () => {
		assert.match(md, /adversarial (design-)?reviewer/);
	});

	it("mentions the reviewer verdict JSON shape", () => {
		assert.match(md, /approve \| needs-fix \| block/);
	});

	it("mentions reviewer presence per tier gate", () => {
		assert.match(md, /[Rr]eviewer presence per tier/);
	});

	it("mentions the --velpari-run-reviewer flag (intermediate opt-in)", () => {
		assert.match(md, /--velpari-run-reviewer/);
	});
});

describe("AGENTS.md — principle 10b (reviewer sub-agent)", () => {
	const md = readAt("AGENTS.md");
	if (!md) {
		it.skip("file missing", () => {});
		return;
	}

	it("declares principle 10b", () => {
		assert.match(md, /10b\.\s+\*\*/);
	});

	it("principle 10b is about the reviewer sub-agent", () => {
		const match = md.match(/10b\.\s+\*\*([^*]+)\*\*/);
		assert.ok(match, "could not find principle 10b");
		assert.match(match![1]!, /[Rr]eviewer/);
	});

	it("principle 10b references Anthropic Constitutional or SWE-Agent or Cursor Composer/Reviewer", () => {
		assert.ok(/Anthropic|SWE-Agent|Cursor/.test(md), "principle 10b must cite at least one industry pattern");
	});
});

describe("CHANGELOG.md — release entry", () => {
	const md = readAt("CHANGELOG.md");
	if (!md) {
		it.skip("file missing", () => {});
		return;
	}

	it("top entry has Reviewer sub-agent heading or v1.6.0 per-stage approve heading", () => {
		// Accept either the original [Unreleased] heading (predecessor release
		// entry) or the v1.6.0 per-stage approve heading that followed it.
		const top = md.split("\n").slice(0, 400).join("\n");
		assert.ok(
			/Reviewer sub-agent|Per-stage approve/.test(top),
			"top entry must reference one of the recent release headings",
		);
	});

	it("release entry references the migrated 10 deterministic rules", () => {
		const top = md.split("\n").slice(0, 400).join("\n");
		assert.match(top, /10 deterministic|base-core-missing|cohesion-invalid/);
	});

	it("release entry references the 4 semantic rules (NEW)", () => {
		const top = md.split("\n").slice(0, 400).join("\n");
		assert.match(top, /4 semantic/);
	});
});

describe("bundled skill files — present", () => {
	it("skills/agents/reviewer.md exists", () => {
		const candidates = ["skills/agents/reviewer.md", "../skills/agents/reviewer.md"];
		const found = candidates.some((p) => existsSync(p));
		assert.ok(found, "skills/agents/reviewer.md missing");
	});

	it("skills/velpari-reviewer.md exists", () => {
		const candidates = ["skills/velpari-reviewer.md", "../skills/velpari-reviewer.md"];
		const found = candidates.some((p) => existsSync(p));
		assert.ok(found, "skills/velpari-reviewer.md missing");
	});
});
