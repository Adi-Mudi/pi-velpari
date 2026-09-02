import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, buildOutputPath, buildDiscussionPath, buildRunDir } from "../src/paths.js";

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
