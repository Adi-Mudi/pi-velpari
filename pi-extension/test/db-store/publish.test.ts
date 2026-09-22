// Unit tests — the Phase-4 DB publish chain (RES-1, Q6) + the stage
// payload validator (ops/stage-payloads.ts) + ops/db-publish.ts.
// Covers (plan 4.6): payload validation (missing/malformed/schema-violating
// → refused, nothing written); happy-path publish for a markdown kind
// (design) and a sidecar kind (RTM): rows published, YAML beside the DB,
// checksum ok, git commit contains DB + YAML + markdown; git-commit-failure
// rollback (fake git wrapper fails on `commit` → rows reverted to draft,
// YAML deleted); G8 PRD mirror ok + tamper abort; dual feasibility
// vocabulary (reuse/partial/build) lands verbatim; per-run coexistence
// through the chain; checkpoint-before-commit observable (wal 0 bytes);
// multi-design two projectNames → two separate DB files.
// Conventions: temp dirs + real openStoreDb/closeStoreDb + REAL git repos
// — no mocks for the store; the git-failure path uses a PATH-pinned fake
// `git` wrapper that delegates everything except `commit`.
// Runs in remote CI only (thermal protocol 2026-09-21 — no local runs).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
	loadStagePayload,
	kindForWorkingDir,
	buildFeasibilityRowsFromSession,
} from "../../src/ops/stage-payloads.js";
import {
	precheckGitForPublish,
	runDbPublish,
} from "../../src/ops/db-publish.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { readArtifact, writeArtifact, type ArtifactPayload } from "../../src/io/store.js";
import { buildStoreDbPath, buildStoreYamlPath } from "../../src/core/paths.js";
import type { FeasibilitySession } from "../../src/core/state.js";
import type { DatabaseSync } from "node:sqlite";

let dir: string;
const dirs: string[] = [];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-publish-test-"));
	dirs.push(dir);
});

after(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Envelope with deterministic defaults. */
function env(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		version: 1,
		stage: "designing",
		generatedAt: "2026-09-22T00:00:00Z",
		inputs: {},
		reviewerVerdict: null,
		changeLog: [],
		...overrides,
	};
}

/** Design payload rows (markdown kind, no sidecar). */
function designRows(): Record<string, unknown> {
	return {
		designModule: [{ id: "M-1", name: "core" }],
		moduleSourceFr: [{ moduleId: "M-1", frId: "FR-1" }],
		adr: [
			{
				id: "ADR-1",
				adrStatus: "accepted",
				options: "layered|flat",
				chosen: "layered",
				rationale: "matches repo layout",
			},
		],
		diagram: [{ id: "D-1", diagramKind: "context", mermaidText: "graph TD; A-->B" }],
		approach: [{ moduleId: "M-1", tacticId: "T-01" }],
	};
}

/** RTM payload rows (sidecar kind). */
function rtmRows(): Record<string, unknown> {
	return {
		rtmRow: [{ id: "RTM-1", frRef: "FR-1", afRef: null, tcRef: null, phase: 1, targetSha256: "a1b2c3" }],
	};
}

/** Write a payload file for a working dir + kind. */
function writePayload(
	workingDirName: string,
	kind: string,
	rows: Record<string, unknown>,
	envelopeOverrides: Record<string, unknown> = {},
): string {
	const workingDir = join(dir, workingDirName);
	mkdirSync(join(workingDir, "payload"), { recursive: true });
	const path = join(workingDir, "payload", `${kind}-payload.json`);
	writeFileSync(
		path,
		JSON.stringify({ envelope: env(envelopeOverrides), rows }, null, 2),
		"utf-8",
	);
	return workingDir;
}

/** Initialize a real git repo inside `dir` with a local identity. */
function initGitRepo(): void {
	execFileSync("git", ["init"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "Velpari Test"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "test@velpari.local"], { cwd: dir });
}

/** Create a fake published markdown target (content irrelevant to the chain). */
function fakeMarkdown(relPath: string): string {
	const abs = join(dir, relPath);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, "# Published\n", "utf-8");
	return abs;
}

/** Resolve the real git binary so the fake wrapper can delegate. */
function realGit(): string {
	return execFileSync("sh", ["-c", "command -v git"]).toString().trim();
}

/** Install a PATH-pinned fake git that fails ONLY on `commit`. */
function fakeGitPath(): string {
	const bin = join(dir, "fakebin");
	mkdirSync(bin, { recursive: true });
	const script = "#!/bin/sh\n" +
		'if [ "$1" = "commit" ]; then echo "simulated commit failure" >&2; exit 1; fi\n' +
		'exec "' + realGit() + '" "$@"\n';
	writeFileSync(join(bin, "git"), script, "utf-8");
	// make executable via spawnSync chmod equivalent
	execFileSync("chmod", ["+x", join(bin, "git")]);
	return bin;
}

/** Run the chain with the fake git wrapper first on PATH. */
function withFakeGit<T>(fn: () => T): T {
	const prev = process.env.PATH;
	process.env.PATH = fakeGitPath() + ":" + prev;
	try {
		return fn();
	} finally {
		process.env.PATH = prev;
	}
}

/** Open the run's DB directly for assertions. */
function openRunDb(projectName: string): DatabaseSync {
	return openStoreDb(buildStoreDbPath(projectName, dir));
}

/**
 * Seed the PRD artifact (fr row) in the same run BEFORE publishing design
 * / rtm — mirrors the real pipeline (PRD publishes before design). The
 * composite FK fr(run_id, id) is referenced by module_source_fr.fr_id and
 * rtm_row.fr_ref; without the parent rows the child publish fails.
 * @param {string} projectName - files.json projectName (DB file owner).
 * @param {string} runId - Owning run.
 * @param {string} frId - Fr id the child rows reference.
 */
function seedPrd(projectName: string, runId: string, frId: string): void {
	const db = openRunDb(projectName);
	try {
		writeArtifact(
			db,
			"prd",
			runId,
			{
				version: 1,
				stage: "drafting-prd",
				generatedAt: "2026-09-22T00:00:00Z",
			},
			{ fr: [{ id: frId, phase: 1, textHash: "a1b2c3", text: `Seeded prose for ${frId}.` }] } as ArtifactPayload,
		);
	} finally {
		closeStoreDb(db);
	}
}

// ---------------------------------------------------------------------------
// 1. Payload validation (loadStagePayload)
// ---------------------------------------------------------------------------

describe("stage payload validation (4.3)", () => {
	test("missing payload file is refused with the exact path", () => {
		const workingDir = join(dir, "prd");
		mkdirSync(workingDir, { recursive: true });
		const result = loadStagePayload(workingDir, "prd");
		assert.equal(result.ok, false);
		assert.ok(result.problems.some((p) => p.includes("prd-payload.json")));
	});

	test("malformed JSON is refused", () => {
		const workingDir = join(dir, "prd2");
		mkdirSync(join(workingDir, "payload"), { recursive: true });
		writeFileSync(join(workingDir, "payload", "prd-payload.json"), "{not json", "utf-8");
		const result = loadStagePayload(workingDir, "prd");
		assert.equal(result.ok, false);
		assert.ok(result.problems.some((p) => p.includes("not valid JSON")));
	});

	test("schema violations are refused: unknown field, bad enum, missing field, bad phase", () => {
		const workingDir = writePayload("rtm-bad", "rtm", {
			rtmRow: [
				{ id: "RTM-1", frRef: "FR-1", phase: 1, targetSha256: "a1b2c3", bogus: "x" }, // unknown field
				{ id: "RTM-2", frRef: "FR-1", phase: 0, targetSha256: "a1b2c3" }, // phase < 1
				{ id: "RTM-3", phase: 1, targetSha256: "a1b2c3" }, // missing frRef
			],
		});
		const result = loadStagePayload(workingDir, "rtm");
		assert.equal(result.ok, false);
		assert.ok(result.problems.some((p) => p.includes('unknown field "bogus"')));
		assert.ok(result.problems.some((p) => p.includes(">= 1")));
		assert.ok(result.problems.some((p) => p.includes('missing field "frRef"')));
	});

	test("unknown row-set key is refused; valid payload normalizes inputs/changeLog", () => {
		const workingDir = writePayload("rtm-weird", "rtm", {
			notAKey: [],
			rtmRow: [{ id: "RTM-1", frRef: "FR-1", phase: 1, targetSha256: "a1b2c3" }],
		});
		assert.equal(loadStagePayload(workingDir, "rtm").ok, false);

		const good = writePayload("rtm-good", "rtm", rtmRows(), {
			inputs: { RTM: "0".repeat(64) },
			changeLog: ["rev1: initial"],
		});
		const ok = loadStagePayload(good, "rtm");
		assert.equal(ok.ok, true);
		assert.deepEqual(JSON.parse(ok.envelope!.inputs as string), { RTM: "0".repeat(64) });
		assert.deepEqual(JSON.parse(ok.envelope!.changeLog as string), ["rev1: initial"]);
	});

	test("G8: prd payload without a 64-hex inputs['prd-file'] is refused", () => {
		const workingDir = writePayload("prd-bad", "prd", {
			fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "ok prose for FR-1." }],
		});
		const result = loadStagePayload(workingDir, "prd");
		assert.equal(result.ok, false);
		assert.ok(result.problems.some((p) => p.includes("prd-file")));
	});

	test("kindForWorkingDir maps tests→testplan and rejects unknown dirs", () => {
		assert.equal(kindForWorkingDir("tests"), "testplan");
		assert.equal(kindForWorkingDir("atomic-functions"), "atomic-functions");
		assert.equal(kindForWorkingDir("brainstorm"), null);
	});
});

// ---------------------------------------------------------------------------
// 2. Happy-path publish chain (Q6 3–7)
// ---------------------------------------------------------------------------

describe("runDbPublish happy path (design + rtm)", () => {
	test("design: rows published, YAML beside DB, checksum ok, git commit lands", () => {
		initGitRepo();
		seedPrd("Demo", "r1", "FR-1");
		const workingDir = writePayload("design", "design", designRows());
		const payload = loadStagePayload(workingDir, "design");
		assert.equal(payload.ok, true);
		const markdown = fakeMarkdown("Doc/design/design_Demo.md");

		const outcome = runDbPublish({
			cwd: dir,
			projectName: "Demo",
			runId: "r1",
			kind: "design",
			yamlArtifact: "design",
			envelope: payload.envelope!,
			payload: payload.payload!,
			publishedPaths: [markdown],
		});
		assert.deepEqual(outcome.problems, []);

		// DB rows published
		const db = openRunDb("Demo");
		try {
			const read = readArtifact(db, "r1", "design");
			assert.ok(read);
			assert.equal(read!.envelope.status, "published");
			const module = read!.rows.designModule as Array<Record<string, unknown>>;
			assert.ok(module[0]);
			assert.equal(module[0]!.id, "M-1");
		} finally {
			closeStoreDb(db);
		}

		// YAML beside the DB
		const yamlPath = buildStoreYamlPath("Demo", "design", dir);
		assert.ok(existsSync(yamlPath));
		assert.ok(readFileSync(yamlPath, "utf-8").includes("designModule"));

		// Git commit contains DB + YAML + markdown
		const log = execFileSync("git", ["log", "--name-only", "--pretty=format:"], { cwd: dir })
			.toString();
		assert.ok(log.includes("index.db"), "commit must include the DB");
		assert.ok(log.includes("design_Demo.yaml"), "commit must include the YAML");
		assert.ok(log.includes("design_Demo.md"), "commit must include the markdown");

		// G1: checkpoint truncated the WAL (0 bytes or gone)
		const wal = buildStoreDbPath("Demo", dir) + "-wal";
		if (existsSync(wal)) assert.equal(statSync(wal).size, 0);
	});

	test("rtm (sidecar kind): publish works; second run coexists in the same DB", () => {
		initGitRepo();
		seedPrd("Demo", "r1", "FR-1");
		seedPrd("Demo", "r2", "FR-1");
		const workingDir = writePayload("rtm", "rtm", rtmRows());
		const payload = loadStagePayload(workingDir, "rtm");
		assert.equal(payload.ok, true);
		const markdown = fakeMarkdown("Doc/requirements/RTM_Demo.md");

		const first = runDbPublish({
			cwd: dir,
			projectName: "Demo",
			runId: "r1",
			kind: "rtm",
			yamlArtifact: "RTM",
			envelope: payload.envelope!,
			payload: payload.payload!,
			publishedPaths: [markdown],
		});
		assert.deepEqual(first.problems, []);

		// Same artifact id, different run — per-run PKs must coexist.
		const second = runDbPublish({
			cwd: dir,
			projectName: "Demo",
			runId: "r2",
			kind: "rtm",
			yamlArtifact: "RTM",
			envelope: payload.envelope!,
			payload: payload.payload!,
			publishedPaths: [markdown],
		});
		assert.deepEqual(second.problems, []);

		const db = openRunDb("Demo");
		try {
			assert.equal(readArtifact(db, "r1", "rtm")!.envelope.status, "published");
			assert.equal(readArtifact(db, "r2", "rtm")!.envelope.status, "published");
		} finally {
			closeStoreDb(db);
		}
	});
});

// ---------------------------------------------------------------------------
// 3. Failure paths (Q6d rollback + G8 tamper)
// ---------------------------------------------------------------------------

describe("failure paths", () => {
	test("git commit failure → rows reverted to draft, YAML deleted, problems reported", () => {
		initGitRepo();
		seedPrd("Fail", "r1", "FR-1");
		const workingDir = writePayload("design-fail", "design", designRows());
		const payload = loadStagePayload(workingDir, "design");
		const markdown = fakeMarkdown("Doc/design/design_Fail.md");

		const outcome = withFakeGit(() =>
			runDbPublish({
				cwd: dir,
				projectName: "Fail",
				runId: "r1",
				kind: "design",
				yamlArtifact: "design",
				envelope: payload.envelope!,
				payload: payload.payload!,
				publishedPaths: [markdown],
			}),
		);
		assert.equal(outcome.ok, false);
		assert.ok(outcome.problems.some((p) => p.includes("git commit failed")));

		// DB rows are back to draft (Q6d revertPublish)
		const db = openRunDb("Fail");
		try {
			assert.equal(readArtifact(db, "r1", "design")!.envelope.status, "draft");
		} finally {
			closeStoreDb(db);
		}
		// YAML deleted
		assert.equal(existsSync(buildStoreYamlPath("Fail", "design", dir)), false);
		// Markdown NOT rolled back (accepted risk R1)
		assert.ok(existsSync(markdown));
	});

	test("G8 mirror check: matching hash publishes; tampered hash aborts", () => {
		initGitRepo();
		// --- ok case ---
		const prdMarkdown = fakeMarkdown("Doc/requirements/PRD_Ok.md");
		const fileHash = createHash("sha256").update(readFileSync(prdMarkdown)).digest("hex");
		// --- ok case ---
		const okDir = writePayload("prd-ok", "prd", { fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "Greeting user flow FR." }] }, {
			inputs: { "prd-file": fileHash },
		});
		const okPayload = loadStagePayload(okDir, "prd");
		assert.equal(okPayload.ok, true);
		const okOutcome = runDbPublish({
			cwd: dir,
			projectName: "Ok",
			runId: "r1",
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: okPayload.envelope!,
			payload: okPayload.payload!,
			publishedPaths: [prdMarkdown],
			prdPublishedPath: prdMarkdown,
		});
		assert.deepEqual(okOutcome.problems, []);

		// --- tamper case ---
		const prdTamper = fakeMarkdown("Doc/requirements/PRD_Tamper.md");
		const tamperDir = writePayload(
			"prd-tamper",
			"prd",
			{ fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "Tamper fixture FR." }] },
			{ inputs: { "prd-file": "f".repeat(64) } },
		);
		const tamperPayload = loadStagePayload(tamperDir, "prd");
		const tamperOutcome = runDbPublish({
			cwd: dir,
			projectName: "Tamper",
			runId: "r1",
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: tamperPayload.envelope!,
			payload: tamperPayload.payload!,
			publishedPaths: [prdTamper],
			prdPublishedPath: prdTamper,
		});
		assert.equal(tamperOutcome.ok, false);
		assert.ok(tamperOutcome.problems.some((p) => p.includes("G8 mirror check failed")));
		// rows reverted to draft (G8 runs after the flip)
		const db2 = openRunDb("Tamper");
		try {
			assert.equal(readArtifact(db2, "r1", "prd")!.envelope.status, "draft");
		} finally {
			closeStoreDb(db2);
		}
	});

	test("git pre-check refuses outside a work tree", () => {
		// dir has no git repo → refuse
		const result = precheckGitForPublish(dir);
		assert.equal(result.ok, false);
		assert.ok(result.problems.some((p) => p.includes("work tree")));
	});

	test("git pre-check refuses without a configured identity (no silent fallback)", () => {
		execFileSync("git", ["init"], { cwd: dir });
		// Isolate from any machine-level global/system git config (git ≥ 2.32).
		const prevGlobal = process.env.GIT_CONFIG_GLOBAL;
		const prevSystem = process.env.GIT_CONFIG_SYSTEM;
		process.env.GIT_CONFIG_GLOBAL = "/dev/null";
		process.env.GIT_CONFIG_SYSTEM = "/dev/null";
		try {
			const result = precheckGitForPublish(dir);
			assert.equal(result.ok, false);
			assert.ok(result.problems.some((p) => p.includes("user.name")));
			assert.ok(result.problems.some((p) => p.includes("user.email")));
		} finally {
			if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
			else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
			if (prevSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
			else process.env.GIT_CONFIG_SYSTEM = prevSystem;
		}
	});
});

// ---------------------------------------------------------------------------
// 4. Feasibility dual vocabulary + multi-design
// ---------------------------------------------------------------------------

describe("feasibility vocabulary + multi-design", () => {
	for (const verdict of ["reuse", "partial", "build"] as const) {
		test(`decision verdict "${verdict}" lands verbatim in the store`, () => {
			initGitRepo();
			const session: FeasibilitySession = {
				reuseConsent: true,
				decision: verdict,
				selectedLanguage: "TypeScript",
				selectedBy: "user",
				spikeResults: [
					{
						language: "TypeScript",
						coreFunction: "add",
						buildOk: true,
						runOk: true,
						notes: "ok",
						evidencePath: "spikes/ts",
					},
				],
			};
			const now = "2026-09-22T00:00:00Z";
			const rows = buildFeasibilityRowsFromSession(session, now);
			assert.equal(rows.feasibilityDecision.verdict, verdict);
			assert.equal(rows.feasibilityDecision.language, "TypeScript");
			assert.equal(rows.feasibilitySpike[0]!.passed, 1);

			const workingDir = writePayload("feas-" + verdict, "feasibility", {
				reuseScan: [{ candidate: "lib-a", license: "MIT", repoFreshness: "fresh", verdict: "reuse" }],
			});
			const payload = loadStagePayload(workingDir, "feasibility");
			assert.equal(payload.ok, true);
			const merged = { ...payload.payload!, ...rows };
			const markdown = fakeMarkdown("Doc/feasibility/feasibility-study_Demo.md");
			const outcome = runDbPublish({
				cwd: dir,
				projectName: "Demo",
				runId: "r-" + verdict,
				kind: "feasibility",
				yamlArtifact: "feasibility-study",
				envelope: payload.envelope!,
				payload: merged,
				publishedPaths: [markdown],
			});
			assert.deepEqual(outcome.problems, []);
			const db = openRunDb("Demo");
			try {
				const read = readArtifact(db, "r-" + verdict, "feasibility")!;
				const decision = read.rows.feasibilityDecision as Record<string, unknown>;
				assert.equal(decision.verdict, verdict);
				const spike = (read.rows.feasibilitySpike as Array<Record<string, unknown>>)[0];
				assert.ok(spike);
				assert.equal(spike.passed, 1);
			} finally {
				closeStoreDb(db);
			}
		});
	}

	test("multi-design: two projectNames → two separate DB files", () => {
		initGitRepo();
		seedPrd("alpha", "r1", "FR-1");
		seedPrd("beta", "r1", "FR-1");
		const workingDir = writePayload("design-md", "design", designRows());
		const payload = loadStagePayload(workingDir, "design");
		const markdown = fakeMarkdown("Doc/design/design_alpha.md");
		for (const project of ["alpha", "beta"]) {
			const outcome = runDbPublish({
				cwd: dir,
				projectName: project,
				runId: "r1",
				kind: "design",
				yamlArtifact: "design",
				envelope: payload.envelope!,
				payload: payload.payload!,
				publishedPaths: [markdown],
			});
			assert.deepEqual(outcome.problems, []);
		}
		assert.ok(existsSync(buildStoreDbPath("alpha", dir)));
		assert.ok(existsSync(buildStoreDbPath("beta", dir)));
		const dbA = openRunDb("alpha");
		const dbB = openRunDb("beta");
		try {
			assert.equal(readArtifact(dbA, "r1", "design")!.envelope.status, "published");
			assert.equal(readArtifact(dbB, "r1", "design")!.envelope.status, "published");
		} finally {
			closeStoreDb(dbA);
			closeStoreDb(dbB);
		}
	});
});