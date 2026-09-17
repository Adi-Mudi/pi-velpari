/**
 * project-context tests (Phase 2).
 *
 * Covers: emptyProjectContext, loadProjectContext with explicit
 * runState, loadProjectContext with on-disk state.json, and the
 * TECH_HINTS extraction.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	emptyProjectContext,
	loadProjectContext,
	type MinimalRunState,
} from "../../src/core/project-context.js";

function freshTmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-ctx-"));
}

describe("project-context (Phase 2)", () => {
	it("emptyProjectContext returns a valid empty context", () => {
		const ctx = emptyProjectContext();
		assert.deepEqual(ctx, { techStack: [], atomicFunctions: [], constraints: [] });
	});

	describe("loadProjectContext with explicit runState", () => {
		it("returns empty when runState is null", () => {
			const cwd = freshTmp();
			try {
				const ctx = loadProjectContext(cwd, null);
				assert.deepEqual(ctx, { techStack: [], atomicFunctions: [], constraints: [] });
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("returns empty when runState is undefined", () => {
			const cwd = freshTmp();
			try {
				const ctx = loadProjectContext(cwd);
				assert.deepEqual(ctx, { techStack: [], atomicFunctions: [], constraints: [] });
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("returns empty when runState.mission is empty/undefined", () => {
			const state: MinimalRunState = { mission: "" };
			const ctx = loadProjectContext("/tmp", state);
			assert.deepEqual(ctx.techStack, []);
		});

		it("extracts typescript from mission", () => {
			const state: MinimalRunState = { mission: "Build a TypeScript REST API" };
			const ctx = loadProjectContext("/tmp", state);
			assert.ok(ctx.techStack.includes("typescript"), `got: ${JSON.stringify(ctx.techStack)}`);
		});

		it("extracts react + typescript from mission", () => {
			const state: MinimalRunState = { mission: "React + TypeScript dashboard" };
			const ctx = loadProjectContext("/tmp", state);
			assert.ok(ctx.techStack.includes("react"));
			assert.ok(ctx.techStack.includes("typescript"));
		});

		it("is case-insensitive (mission 'NODE.JS' → 'node')", () => {
			const state: MinimalRunState = { mission: "NODE.JS backend" };
			const ctx = loadProjectContext("/tmp", state);
			assert.ok(ctx.techStack.includes("node"), `got: ${JSON.stringify(ctx.techStack)}`);
		});

		it("dedupes overlapping hints (typescript + ts → typescript wins on substring)", () => {
			const state: MinimalRunState = { mission: "typescript-only project" };
			const ctx = loadProjectContext("/tmp", state);
			// 'ts' is a substring of 'typescript' so the haystack includes 'ts' too,
			// but dedupe keeps only the first match — should not duplicate.
			const occurrences = ctx.techStack.filter((t) => t === "typescript" || t === "ts").length;
			assert.ok(occurrences >= 1, "should extract at least typescript or ts");
			assert.equal(
				ctx.techStack.length,
				new Set(ctx.techStack).size,
				"no duplicate hints in techStack",
			);
		});

		it("returns empty for mission text with no tech hints", () => {
			const state: MinimalRunState = { mission: "Define a process for the team" };
			const ctx = loadProjectContext("/tmp", state);
			assert.equal(ctx.techStack.length, 0);
		});

		it("atomicFunctions and constraints are always empty in v1 (no false promises)", () => {
			const state: MinimalRunState = { mission: "TypeScript project" };
			const ctx = loadProjectContext("/tmp", state);
			assert.deepEqual(ctx.atomicFunctions, []);
			assert.deepEqual(ctx.constraints, []);
		});
	});

	describe("loadProjectContext with on-disk state.json", () => {
		it("loads mission from .IDE_Plans/velpari/state.json when no runState is passed", () => {
			const cwd = freshTmp();
			try {
				const stateDir = join(cwd, ".IDE_Plans", "velpari");
				mkdirSync(stateDir, { recursive: true });
				writeFileSync(
					join(stateDir, "state.json"),
					JSON.stringify({ mission: "Rust CLI tool" }),
					"utf8",
				);
				const ctx = loadProjectContext(cwd);
				assert.ok(ctx.techStack.includes("rust"), `got: ${JSON.stringify(ctx.techStack)}`);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("returns empty when state.json does not exist on disk", () => {
			const cwd = freshTmp();
			try {
				const ctx = loadProjectContext(cwd);
				assert.deepEqual(ctx, { techStack: [], atomicFunctions: [], constraints: [] });
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("returns empty when state.json is corrupt (does not throw)", () => {
			const cwd = freshTmp();
			try {
				const stateDir = join(cwd, ".IDE_Plans", "velpari");
				mkdirSync(stateDir, { recursive: true });
				writeFileSync(join(stateDir, "state.json"), "{ not json", "utf8");
				const ctx = loadProjectContext(cwd);
				assert.deepEqual(ctx, { techStack: [], atomicFunctions: [], constraints: [] });
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("explicit runState wins over on-disk state.json", () => {
			const cwd = freshTmp();
			try {
				const stateDir = join(cwd, ".IDE_Plans", "velpari");
				mkdirSync(stateDir, { recursive: true });
				writeFileSync(
					join(stateDir, "state.json"),
					JSON.stringify({ mission: "Rust CLI tool" }),
					"utf8",
				);
				const explicit: MinimalRunState = { mission: "Python data pipeline" };
				const ctx = loadProjectContext(cwd, explicit);
				assert.ok(ctx.techStack.includes("python"), "explicit state should win");
				assert.ok(!ctx.techStack.includes("rust"), "on-disk state should be ignored");
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});
});
