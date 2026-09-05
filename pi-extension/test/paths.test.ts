import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	slugify,
	buildOutputPath,
	buildDiscussionPath,
	buildRunDir,
	buildGroupedPath,
	buildGroupedDiscussionPath,
	buildWorkingGroupedPath,
	categoryFor,
	GROUPED_CATEGORIES,
	resolveDocArtifact,
	resolveDiscussionArtifact,
} from "../src/core/paths.js";

test("slugify returns 'untitled' for empty input", () => {
	assert.equal(slugify(""), "untitled");
});

test("slugify lowercases and replaces spaces with hyphens", () => {
	assert.equal(slugify("Hello World"), "hello-world");
});

test("slugify strips special characters", () => {
	assert.equal(slugify("Discussion @#$%"), "discussion");
});

test("slugify transliterates unicode (basic)", () => {
	const result = slugify("Ünïcödé Tëst");
	assert.equal(typeof result, "string");
	assert.ok(result.length > 0);
	assert.ok(result.length <= 64);
});

test("slugify truncates at 64 characters", () => {
	const long = "a".repeat(200);
	const result = slugify(long);
	assert.ok(result.length <= 64, `expected <=64 chars, got ${result.length}`);
});

test("slugify strips leading/trailing hyphens", () => {
	assert.equal(slugify("---hello---"), "hello");
});

test("buildOutputPath returns Doc/<Artifact>_<ProjectName>.md", () => {
	assert.equal(buildOutputPath("PRD", "TodoApp"), "Doc/PRD_TodoApp.md");
	assert.equal(buildOutputPath("RTM", "TodoApp"), "Doc/RTM_TodoApp.md");
});

test("buildOutputPath handles empty projectName", () => {
	const result = buildOutputPath("PRD", "");
	assert.match(result, /^Doc\/PRD_.*\.md$/);
});

test("buildOutputPath sanitizes invalid characters in projectName", () => {
	const result = buildOutputPath("RTM", "My App!");
	assert.match(result, /^Doc\/RTM_My-App-?\.md$/);
});

test("buildDiscussionPath without suffix", () => {
	assert.equal(buildDiscussionPath("cli-todo"), "Doc/discussion-cli-todo.md");
});

test("buildDiscussionPath with suffix (FR-69)", () => {
	assert.equal(
		buildDiscussionPath("cli-todo", "20260902-224000"),
		"Doc/discussion-cli-todo-20260902-224000.md",
	);
});

test("buildRunDir sanitizes run id", () => {
	const result = buildRunDir("2026-09-02-22-40-cli-todo", "/tmp");
	assert.equal(result, "/tmp/.IDE_Plans/velpari/runs/2026-09-02-22-40-cli-todo");
});

test("buildRunDir strips invalid characters from run id", () => {
	const result = buildRunDir("bad/id with spaces!", "/tmp");
	assert.match(result, /^\/tmp\/.IDE_Plans\/velpari\/runs\/bad-id-with-spaces-$/);
});

test("buildOutputPath with only invalid characters in projectName returns a well-formed path", () => {
	const result = buildOutputPath("PRD", "@#$%");
	assert.match(result, /^Doc\/PRD_.*\.md$/, "must be a well-formed Doc/<artifact>_<name>.md path");
});

test("buildOutputPath preserves hyphens in artifact name (regression for Phase C bug)", () => {
	assert.equal(
		buildOutputPath("feasibility-study", "TodoApp"),
		"Doc/feasibility-study_TodoApp.md",
	);
	assert.equal(
		buildOutputPath("test-plan", "TodoApp"),
		"Doc/test-plan_TodoApp.md",
	);
	assert.equal(
		buildOutputPath("test-cases", "TodoApp"),
		"Doc/test-cases_TodoApp.md",
	);
});

// ---------------------------------------------------------------------------
// Phase 7: grouped category layout
// ---------------------------------------------------------------------------

test("buildGroupedPath produces Doc/<category>/<artifact>_<project>.md", () => {
	assert.equal(buildGroupedPath("PRD", "TodoApp"), "Doc/requirements/PRD_TodoApp.md");
	assert.equal(buildGroupedPath("RTM", "TodoApp"), "Doc/requirements/RTM_TodoApp.md");
	assert.equal(buildGroupedPath("feasibility-study", "TodoApp"), "Doc/feasibility/feasibility-study_TodoApp.md");
	assert.equal(buildGroupedPath("design", "TodoApp"), "Doc/design/design_TodoApp.md");
	assert.equal(buildGroupedPath("pseudocode", "TodoApp"), "Doc/pseudocode/pseudocode_TodoApp.md");
	assert.equal(buildGroupedPath("test-plan", "TodoApp"), "Doc/tests/test-plan_TodoApp.md");
	assert.equal(buildGroupedPath("test-cases", "TodoApp"), "Doc/tests/test-cases_TodoApp.md");
	assert.equal(buildGroupedPath("atomic-functions", "TodoApp"), "Doc/atomic-functions/atomic-functions_TodoApp.md");
	assert.equal(buildGroupedPath("development-order", "TodoApp"), "Doc/development-order/development-order_TodoApp.md");
});

test("buildGroupedDiscussionPath produces Doc/discussion/discussion-<slug>.md", () => {
	assert.equal(buildGroupedDiscussionPath("cli-todo"), "Doc/discussion/discussion-cli-todo.md");
	assert.equal(
		buildGroupedDiscussionPath("cli-todo", "20260902-224000"),
		"Doc/discussion/discussion-cli-todo-20260902-224000.md",
	);
});

test("buildWorkingGroupedPath produces a working-copy grouped path", () => {
	const result = buildWorkingGroupedPath("/tmp", "2026-09-02-22-40-cli-todo", "PRD", "TodoApp");
	assert.equal(result, "/tmp/.IDE_Plans/velpari/runs/2026-09-02-22-40-cli-todo/prd/PRD_TodoApp.md");
});

test("categoryFor maps known artifacts", () => {
	assert.equal(categoryFor("PRD"), "requirements");
	assert.equal(categoryFor("RTM"), "requirements");
	assert.equal(categoryFor("test-plan"), "tests");
	assert.equal(categoryFor("test-cases"), "tests");
});

test("categoryFor returns null for unknown artifact", () => {
	assert.equal(categoryFor("unknown"), null);
});

test("GROUPED_CATEGORIES lists all expected categories", () => {
	const values = Object.values(GROUPED_CATEGORIES);
	assert.ok(values.includes("requirements"));
	assert.ok(values.includes("feasibility"));
	assert.ok(values.includes("design"));
	assert.ok(values.includes("pseudocode"));
	assert.ok(values.includes("tests"));
	assert.ok(values.includes("atomic-functions"));
	assert.ok(values.includes("development-order"));
});

test("resolveDocArtifact prefers grouped layout, falls back to legacy", () => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-resolve-"));
	try {
		// Legacy layout only.
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "PRD_TodoApp.md"), "# legacy", "utf8");
		const r1 = resolveDocArtifact("PRD", "TodoApp", dir);
		assert.equal(r1?.layout, "legacy");
		assert.equal(r1?.path, join(dir, "Doc", "PRD_TodoApp.md"));

		// Add the grouped version; resolver should prefer it.
		mkdirSync(join(dir, "Doc", "requirements"), { recursive: true });
		writeFileSync(join(dir, "Doc", "requirements", "PRD_TodoApp.md"), "# grouped", "utf8");
		const r2 = resolveDocArtifact("PRD", "TodoApp", dir);
		assert.equal(r2?.layout, "grouped");
		assert.equal(r2?.path, join(dir, "Doc", "requirements", "PRD_TodoApp.md"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveDiscussionArtifact prefers grouped layout, falls back to legacy", () => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-resolve-disc-"));
	try {
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "discussion-cli-todo.md"), "# legacy", "utf8");
		const r1 = resolveDiscussionArtifact("cli-todo", dir);
		assert.equal(r1?.layout, "legacy");

		mkdirSync(join(dir, "Doc", "discussion"), { recursive: true });
		writeFileSync(join(dir, "Doc", "discussion", "discussion-cli-todo.md"), "# grouped", "utf8");
		const r2 = resolveDiscussionArtifact("cli-todo", dir);
		assert.equal(r2?.layout, "grouped");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveDocArtifact returns null when neither layout is present", () => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-resolve-empty-"));
	try {
		assert.equal(resolveDocArtifact("PRD", "TodoApp", dir), null);
		assert.equal(resolveDiscussionArtifact("cli-todo", dir), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
