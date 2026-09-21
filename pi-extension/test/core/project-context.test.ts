/**
 * project-context tests (Phase 2 + generator v2 per-phase inputs).
 *
 * Covers: emptyProjectContext, loadProjectContext with explicit
 * runState, loadProjectContext with on-disk state.json, the
 * TECH_HINTS extraction, and the v2 per-phase published-Doc collection
 * (brainstorm notes → P2, feasibility record + RTM sidecar → P3,
 * AF sidecar → P4).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	emptyProjectContext,
	loadProjectContext,
	type MinimalRunState,
} from "../../src/core/project-context.js";
import { buildGroupedPath, slugify } from "../../src/core/paths.js";
import { feasibilityRecordPath } from "../../src/core/feasibility-record.js";
import { writeYamlFile } from "../../src/core/yaml-data.js";

function freshTmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-ctx-"));
}

/** Write a minimal v4 files.json with the given projectName (+ framework). */
function writeFilesConfig(
	cwd: string,
	projectName: string,
	framework?: { language?: string; runtime?: string; libraries?: string[] },
): void {
	const dir = join(cwd, ".pi", "velpari");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "files.json"),
		JSON.stringify({ version: 4, projectName, ...(framework ? { framework } : {}) }),
		"utf8",
	);
}

/** Write a file, creating parent directories. */
function writeArtifact(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
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

		it("atomicFunctions and constraints stay empty at phase 1 (no document input yet)", () => {
			const state: MinimalRunState = { mission: "TypeScript project" };
			const ctx = loadProjectContext("/tmp", state);
			assert.deepEqual(ctx.atomicFunctions, []);
			assert.deepEqual(ctx.constraints, []);
		});
	});

	describe("loadProjectContext with on-disk state.json", () => {
		it("loads mission from .pi/velpari/state.json when no runState is passed", () => {
			const cwd = freshTmp();
			try {
				const stateDir = join(cwd, ".pi", "velpari");
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
				const stateDir = join(cwd, ".pi", "velpari");
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
				const stateDir = join(cwd, ".pi", "velpari");
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

	describe("loadProjectContext per-phase inputs (v2)", () => {
		it("phase 1 reads mission + files.json framework only (ignores published artifacts)", () => {
			const cwd = freshTmp();
			try {
				writeFilesConfig(cwd, "demo", { language: "typescript" });
				// A feasibility record on disk that phase 1 must ignore.
				writeYamlFile(feasibilityRecordPath(cwd, "demo"), {
					project: "demo",
					verdict: "build",
					selectedLanguage: "rust",
					selectedBy: "user",
					languageCandidates: [],
					spikeResults: [],
					reuseSummary: [],
					recordedAt: "2026-09-21T00:00:00.000Z",
				});
				const state: MinimalRunState = { mission: "Define a process for the team" };
				const ctx = loadProjectContext(cwd, state, 1);
				assert.ok(ctx.techStack.includes("typescript"), "framework language expected");
				assert.ok(!ctx.techStack.includes("rust"), "phase 1 must not read the feasibility record");
				assert.deepEqual(ctx.constraints, []);
				assert.deepEqual(ctx.atomicFunctions, []);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("phase 2 adds tech hints from the published brainstorm notes", () => {
			const cwd = freshTmp();
			try {
				writeFilesConfig(cwd, "demo");
				const mission = "My Cool App";
				writeArtifact(
					join(cwd, "Doc", "brainstorm", `brainstorm-${slugify(mission)}.md`),
					"# Notes\n\nWe agreed on a python fastapi backend.\n",
				);
				const ctx = loadProjectContext(cwd, { mission }, 2);
				assert.ok(ctx.techStack.includes("python"), `got: ${JSON.stringify(ctx.techStack)}`);
				assert.ok(ctx.techStack.includes("fastapi"));
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("phase 2 without published notes falls back to mission + framework", () => {
			const cwd = freshTmp();
			try {
				writeFilesConfig(cwd, "demo");
				const ctx = loadProjectContext(cwd, { mission: "Rust CLI tool" }, 2);
				assert.ok(ctx.techStack.includes("rust"));
				assert.deepEqual(ctx.constraints, []);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("phase 3 reads the feasibility record (techStack) + RTM sidecar (constraints)", () => {
			const cwd = freshTmp();
			try {
				writeFilesConfig(cwd, "demo");
				writeYamlFile(feasibilityRecordPath(cwd, "demo"), {
					project: "demo",
					verdict: "build",
					selectedLanguage: "rust",
					selectedBy: "user",
					languageCandidates: [],
					spikeResults: [],
					reuseSummary: [],
					recordedAt: "2026-09-21T00:00:00.000Z",
				});
				const rtmMd = join(cwd, buildGroupedPath("RTM", "demo"));
				writeArtifact(rtmMd, "# RTM\n");
				writeYamlFile(rtmMd.replace(/\.md$/, ".yaml"), {
					project: "demo",
					version: "1.0.0",
					rows: [
						{ id: "FR-1", title: "First requirement", phase: 1, design: "", implementation: "", tests: [], status: "approved", coverage: "covered" },
						{ id: "NFR-1", title: "Dropped requirement", phase: 1, design: "", implementation: "", tests: [], status: "deprecated", coverage: "missing", reason: "dropped" },
					],
				});
				const ctx = loadProjectContext(cwd, { mission: "demo mission" }, 3);
				assert.ok(ctx.techStack.includes("rust"), `got: ${JSON.stringify(ctx.techStack)}`);
				assert.deepEqual(ctx.constraints, ["FR-1 — First requirement"]);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("phase 3 without record/sidecar degrades gracefully", () => {
			const cwd = freshTmp();
			try {
				writeFilesConfig(cwd, "demo");
				const ctx = loadProjectContext(cwd, { mission: "demo mission" }, 3);
				assert.deepEqual(ctx.constraints, []);
				assert.deepEqual(ctx.atomicFunctions, []);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("phase 4 adds key functions from the AF sidecar (cumulative with earlier inputs)", () => {
			const cwd = freshTmp();
			try {
				writeFilesConfig(cwd, "demo");
				const afMd = join(cwd, buildGroupedPath("atomic-functions", "demo"));
				writeArtifact(afMd, "# AF\n");
				writeYamlFile(afMd.replace(/\.md$/, ".yaml"), {
					project: "demo",
					version: "1.0.0",
					functions: [
						{ afId: "AF-1", name: "doThing", filePath: "src/a.ts" },
						{ afId: "AF-2", name: "oldThing", filePath: "src/b.ts", status: "deprecated", reason: "replaced" },
					],
				});
				const ctx = loadProjectContext(cwd, { mission: "demo mission" }, 4);
				assert.deepEqual(ctx.atomicFunctions, ["AF-1 — doThing"]);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});
});
