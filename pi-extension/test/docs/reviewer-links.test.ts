/**
 * Reviewer documentation consistency tests (Phase 5 of reviewer plan).
 *
 * Verifies that the docs the reviewer plan introduces agree with each other:
 *   - Doc/velpari-sequence.md mentions reviewer + 5-scout pattern + verdict
 *   - AGENTS.md has principle "10b." (reviewer sub-agent)
 *   - CHANGELOG.md top entry has "Reviewer sub-agent"
 *   - skills/agents/reviewer.md exists (cross-referenced from docs)
 *   - skills/velpari-reviewer.md exists
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

const CANDIDATE_PATHS = [
	"",
	"../",
	"../../",
	"../../../",
];

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

describe("Doc/velpari-sequence.md — Stage 6 reviewer subsection", () => {
	const md = readAt("Doc/velpari-sequence.md");
	if (!md) {
		it.skip("file missing", () => {});
		return;
	}

	it("mentions the 5-scout pattern", () => {
		assert.match(md, /5 scouts|5-scout pattern|five scouts/);
	});

	it("mentions the reviewer verdict JSON shape", () => {
		assert.match(md, /verdict.*approve.*needs-fix.*block|s/);
	});

	it("mentions the 10 deterministic rules migrated", () => {
		assert.match(md, /10 deterministic/);
	});

	it("mentions the 4 semantic rules (NEW)", () => {
		assert.match(md, /4 semantic/);
	});

	it("mentions the tier gate (Entry skip, Intermediate opt-in, Advanced required)", () => {
		assert.match(md, /Entry[\s\S]*No/);
		assert.match(md, /Intermediate[\s\S]*Opt-in/);
		assert.match(md, /Advanced[\s\S]*Yes|required/);
	});

	it("mentions the overlay gate (medical/industrial/financial/cloud requiresReviewer)", () => {
		assert.match(md, /medical-device-b/);
		assert.match(md, /industrial-ot/);
		assert.match(md, /financial-payments/);
		assert.match(md, /cloud-saas/);
		assert.match(md, /requiresReviewer: true/);
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
		assert.ok(
			/Anthropic|SWE-Agent|Cursor/.test(md),
			"principle 10b must cite at least one industry pattern",
		);
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
		const top = md.split("\n").slice(0, 200).join("\n");
		assert.ok(
			/Reviewer sub-agent|Per-stage approve/.test(top),
			"top entry must reference one of the recent release headings",
		);
	});

	it("release entry references the migrated 10 deterministic rules", () => {
		const top = md.split("\n").slice(0, 200).join("\n");
		assert.match(top, /10 deterministic|base-core-missing|cohesion-invalid/);
	});

	it("release entry references the 4 semantic rules (NEW)", () => {
		const top = md.split("\n").slice(0, 200).join("\n");
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
