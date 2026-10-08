/**
 * Reviewer sub-agent tests (Phase 1 of reviewer plan).
 *
 * Verifies the taxonomy + bundled agent definition for the new
 * `reviewer` role added in v1.x. Does NOT test runtime behavior —
 * Phase 3 (registry wiring + tier gate) covers that.
 *
 * Covers:
 *   - `reviewer` is in VELPARI_ROLES
 *   - `ROLE_LABELS.reviewer` is a non-empty string
 *   - `DEFAULT_AGENTS.reviewer === "reviewer"` (identity map)
 *   - `VELPARI_REVIEWER_GENERATED_ROLES` contains the reviewer role
 *   - `REVIEWER_ROLES === ["reviewer"]`
 *   - bundled `skills/agents/reviewer.md` exists with valid frontmatter
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DEFAULT_AGENTS,
	ROLE_LABELS,
	VELPARI_REVIEWER_GENERATED_ROLES,
	VELPARI_ROLES,
	type VelpariRole,
} from "../../src/core/agents-config.js";

describe("reviewer sub-agent — taxonomy", () => {
	it("is in VELPARI_ROLES", () => {
		assert.ok((VELPARI_ROLES as readonly string[]).includes("reviewer"), "reviewer missing from VELPARI_ROLES");
	});

	it("has a non-empty ROLE_LABELS entry", () => {
		const label = ROLE_LABELS["reviewer" as VelpariRole];
		assert.ok(label, "ROLE_LABELS.reviewer missing");
		assert.ok(label.length > 10, `label too short: ${label}`);
		assert.match(label, /reviewer/i);
	});

	it("has an identity-map default (DEFAULT_AGENTS.reviewer === 'reviewer')", () => {
		assert.equal(DEFAULT_AGENTS["reviewer" as VelpariRole], "reviewer");
	});

	it("appears in VELPARI_REVIEWER_GENERATED_ROLES (v2 generator placeholder)", () => {
		// Plan D — reviewer-generalization to 4 stages adds the 3 new
		// reviewer roles (pseudocode, testplan, design) on top of the
		// original atomic-function reviewer. Total: 4.
		assert.equal(VELPARI_REVIEWER_GENERATED_ROLES.length, 4);
		const entry = VELPARI_REVIEWER_GENERATED_ROLES[0]!;
		assert.equal(entry.role, "reviewer");
		assert.ok(entry.label.length > 0);
		assert.ok(entry.mandate.length > 0);
		assert.ok(entry.invocationHint.length > 0);
		assert.ok(Array.isArray(entry.outOfScope) && entry.outOfScope.length > 0);
	});
});

describe("reviewer sub-agent — bundled frontmatter", () => {
	// Walk up to find the package root (the dist layout puts the test under
	// dist/pi-extension/test/, so the source layout is at the cwd root).
	const CANDIDATE_PATHS = [
		"skills/agents/reviewer.md",
		"../skills/agents/reviewer.md",
		"../../skills/agents/reviewer.md",
		"../../../skills/agents/reviewer.md",
	];

	function readReviewerFile(): string {
		for (const candidate of CANDIDATE_PATHS) {
			try {
				return readFileSync(candidate, "utf8");
			} catch {
				// continue
			}
		}
		throw new Error(`Could not locate skills/agents/reviewer.md from any of: ${CANDIDATE_PATHS.join(", ")}`);
	}

	it("exists at skills/agents/reviewer.md", () => {
		const content = readReviewerFile();
		assert.ok(content.length > 100, "file is suspiciously short");
	});

	it("has valid YAML frontmatter (name, description, tools, thinking, session-mode, auto-exit, spawning)", () => {
		const content = readReviewerFile();
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
		assert.ok(fmMatch, "missing --- frontmatter block ---");
		const fm = fmMatch![1]!;
		for (const field of ["name:", "description:", "tools:", "thinking:", "session-mode:", "auto-exit:", "spawning:"]) {
			assert.ok(fm.includes(field), `frontmatter missing field "${field}"`);
		}
		assert.match(fm, /^name:\s*reviewer$/m);
	});

	it("declares the 10 deterministic rules (migrated from doctor)", () => {
		const content = readReviewerFile();
		const rules = [
			"base-core-missing",
			"tier-specific-missing",
			"cohesion-invalid",
			"verification-invalid",
			"testable-invalid",
			"complexity-exceeded",
			"ears-pattern-invalid",
			"arg-count-high",
			"coupling-high",
			"risk-empty",
		];
		for (const rule of rules) {
			assert.ok(content.includes(rule), `missing deterministic rule "${rule}"`);
		}
	});

	it("declares the 4 semantic rules (NEW)", () => {
		const content = readReviewerFile();
		const rules = ["cross-scout-contradiction", "missing-merge", "tier-mismatch", "standards-mapping-missing"];
		for (const rule of rules) {
			assert.ok(content.includes(rule), `missing semantic rule "${rule}"`);
		}
	});

	it("declares the verdict JSON schema (verdict, issues, summary, timestamp)", () => {
		const content = readReviewerFile();
		assert.match(content, /"verdict":\s*"approve"\s*\|\s*"needs-fix"\s*\|\s*"block"/);
		assert.match(content, /"issues":/);
		assert.match(content, /"summary":/);
		assert.match(content, /"timestamp":\s*"ISO-8601"/);
	});

	it("declares session-mode: standalone and auto-exit: true and spawning: false", () => {
		const content = readReviewerFile();
		assert.match(content, /^session-mode:\s*standalone$/m);
		assert.match(content, /^auto-exit:\s*true$/m);
		assert.match(content, /^spawning:\s*false$/m);
	});
});

describe("reviewer sub-agent — orchestration skill", () => {
	const CANDIDATE_PATHS = [
		"skills/velpari-reviewer.md",
		"../skills/velpari-reviewer.md",
		"../../skills/velpari-reviewer.md",
		"../../../skills/velpari-reviewer.md",
	];

	function readOrchestrationSkill(): string {
		for (const candidate of CANDIDATE_PATHS) {
			try {
				return readFileSync(candidate, "utf8");
			} catch {
				// continue
			}
		}
		throw new Error(`Could not locate skills/velpari-reviewer.md from any of: ${CANDIDATE_PATHS.join(", ")}`);
	}

	it("exists at skills/velpari-reviewer.md", () => {
		const content = readOrchestrationSkill();
		assert.ok(content.length > 100);
	});

	it("documents the verdict decision rule (approve / needs-fix / block)", () => {
		const content = readOrchestrationSkill();
		assert.match(content, /approve/);
		assert.match(content, /needs-fix/);
		assert.match(content, /block/);
	});

	it("documents the tier gate (Entry skip / Intermediate opt-in / Advanced required)", () => {
		const content = readOrchestrationSkill();
		// Markdown table has "Entry" in one column and "Skip" in another — match loosely
		assert.match(content, /Entry/);
		assert.match(content, /Intermediate/);
		assert.match(content, /Advanced/);
		// Either explicit "skip" wording or the table "No" cell
		assert.ok(/skip|No/.test(content), "tier gate must mark Entry as skipped/disabled");
	});

	it("documents the overlay gate (requiresReviewer: true)", () => {
		const content = readOrchestrationSkill();
		assert.match(content, /requiresReviewer/);
	});

	it("states the max-iteration rule for needs-fix (2 iterations)", () => {
		const content = readOrchestrationSkill();
		assert.match(content, /2 iterations|Maximum 2/);
	});
});

// Suppress unused-import warning when the test file is bundled
void join;
