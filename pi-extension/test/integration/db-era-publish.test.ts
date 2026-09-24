/**
 * APPROVE-LEVEL test of the SHIPPED publish default (Phase 12, subphase 1.1).
 *
 * Why this file exists: every other approve-level test in the repo passes
 * `skipDbPublish: true` (or sets `VELPARI_SKIP_DB_PUBLISH=1`), and that escape
 * hatch ALSO implies markdown-writes ON (`core/config.ts:markdownWritesEnabled`).
 * So the mode every user actually gets — `files.json` with NO `velpari` key →
 * markdown OFF + DB publish ON — had never been executed through `handleApprove`
 * before. It was broken: the DB render overwrote `target.content`, which the
 * publish gate then validated with `validatePsrs` (21 errors → a PRD could never
 * publish). Phase 12 Fixes 1/2/2b changed `ops/approve.ts`; this suite is the
 * permanent regression proof.
 *
 * Three fixtures, one suite, real temp git repos:
 *   A — shipped default (no `velpari` key): DB + YAML + registry commit only,
 *       no new file outside `Doc/store/**`, working copy untouched, `hashv: 2`.
 *   B — rollback hatch (`"velpari": {"markdownWrites": true}`): the published
 *       markdown appears and joins the commit.
 *   C — G8 hardening: a PRD *revision* with a stale `inputs["prd-file"]` is
 *       refused; with the hash of the already-published file it publishes.
 *
 * Git hermeticity (Phase 11's burn, Design 9): every fixture pins a LOCAL repo
 * identity and isolates ambient config (`GIT_CONFIG_GLOBAL` → temp file,
 * `GIT_CONFIG_SYSTEM=/dev/null`) so the publish git-identity precheck is decided
 * by the fixture, never by the host machine.
 *
 * Runs in remote CI only (thermal protocol 2026-09-21 — no local full runs).
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { handleApprove } from "../../src/ops/approve.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";
import { slugify } from "../../src/core/paths.js";
import { hashFileContent } from "../../src/core/fingerprints.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { readArtifact } from "../../src/io/store.js";

const PROJECT = "Phase12App";
const MISSION = "Phase12 mission";

let dir: string;
const dirs: string[] = [];
let notices: Array<{ message: string; level: string }> = [];
const savedEnv: Record<string, string | undefined> = {};

/** Notice-capturing ctx (same idiom as test/ops/approve-*.test.ts). */
function makeCtx(): ExtensionCommandContext {
	notices = [];
	return {
		ui: {
			notify: (message: string, level?: string) => {
				notices.push({ message, level: level ?? "info" });
			},
			setStatus: () => {},
		},
	} as unknown as ExtensionCommandContext;
}

/** All notify text joined — assertions on the publish report. */
function noticesText(): string {
	return notices.map((n) => n.message).join("\n");
}

/** The 20 required PSRS section headings (core/psrs.ts REQUIRED_SECTIONS). */
const SECTION_TITLES = [
	"Objective",
	"Problem",
	"System Actors",
	"User Stories",
	"Scope",
	"MVP",
	"Success Metrics",
	"Phases",
	"Functional Requirements",
	"Non-Functional Requirements",
	"Data and Interfaces",
	"Errors and Edge Cases",
	"Constraints",
	"Dependencies and Risks",
	"Out of Scope",
	"Open Questions",
	"Acceptance Criteria",
	"Helper Function Candidates",
	"Glossary",
	"Change Log",
];

/**
 * A PSRS-shaped PRD the stage LLM would write (frontmatter metadata + all 20
 * sections; the FR/NFR tables carry the id/phase/status columns the checks need).
 * @param {number} version - Frontmatter version (revisions bump it).
 * @param {string} changeLog - Change Log body lines.
 * @returns {string} The PRD markdown.
 */
function prdMarkdown(version = 1, changeLog = "- 2026-09-24: initial draft."): string {
	const head = [
		"---",
		"documentType: PSRS",
		`version: ${version}`,
		"status: draft",
		"profile: core-psrs-v1",
		"profileVersion: 1",
		`mission: ${MISSION}`,
		`projectName: ${PROJECT}`,
		"---",
		"",
		`# PRD — ${PROJECT}`,
		"",
	];
	const body = SECTION_TITLES.map((title) => {
		if (title === "Functional Requirements") {
			return [
				"## Functional Requirements",
				"",
				"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
				"|---|---|---|---|---|---|---|",
				"| FR-01 | The system SHALL accept text input. | must | 1 | input stored | Integration test | proposed |",
				"",
			].join("\n");
		}
		if (title === "Non-Functional Requirements") {
			return [
				"## Non-Functional Requirements",
				"",
				"| ID | Category | Requirement | Phase | Verification | Status |",
				"|---|---|---|---|---|---|",
				"| NFR-01 | performance | p95 SHALL stay under 200 ms. | 1 | Performance test | proposed |",
				"",
			].join("\n");
		}
		if (title === "Change Log") return `## Change Log\n\n${changeLog}\n`;
		return `## ${title}\n\nProse for the ${title} section of the requirements package.\n`;
	});
	return [...head, ...body].join("\n");
}

/**
 * Build a fixture project parked at `drafting-prd`: valid PRD working copy,
 * payload, published brainstorm input and a real git repo (identity pinned).
 * @param {object} opts - Fixture options.
 * @param {boolean} opts.markdownWrites - Emit `velpari.markdownWrites: true`.
 * @param {Record<string, string>} opts.prdFileHash - Payload
 *   `inputs["prd-file"]` value ({} = omit the key entirely).
 * @param {boolean} opts.seedPublishedPrd - Plant a previously published PRD
 *   markdown (the revision case) before the approve runs.
 * @returns {{cwd: string, runId: string, workingCopy: string}} Fixture handles.
 */
function buildFixture(opts: {
	markdownWrites: boolean;
	prdFileHash: Record<string, string>;
	seedPublishedPrd: boolean;
}): { cwd: string; runId: string; workingCopy: string } {
	const cwd = dir;
	const filesJson = {
		version: 4,
		projectName: PROJECT,
		framework: { language: "typescript", runtime: "node" },
		inputDocuments: [],
		outputPaths: {},
		codePaths: [],
		testPaths: [],
		excludedPaths: [],
		...(opts.markdownWrites ? { velpari: { markdownWrites: true } } : {}),
	};
	/**
	 * Write one fixture file (creating parent directories).
	 * @param {string} rel - Repo-relative path.
	 * @param {string} content - UTF-8 content.
	 * @returns {string} Absolute path of the written file.
	 */
	const write = (rel: string, content: string): string => {
		const abs = join(cwd, rel);
		mkdirSync(join(abs, ".."), { recursive: true });
		writeFileSync(abs, content, "utf8");
		return abs;
	};

	write(".pi/velpari/files.json", JSON.stringify(filesJson, null, 2) + "\n");
	const run = createRun(MISSION, cwd);
	saveState({ ...run, currentStage: "drafting-prd" }, cwd);
	const runId = loadState(cwd).runId;

	// The PRD stage's declared (non-optional) input: the published brainstorm.
	write(`Doc/brainstorm/brainstorm-${slugify(MISSION)}.md`, "# Brainstorm\n\nPhase 12 fixture topic.\n");

	// Revision case: a PRD markdown already exists, so its hash is knowable
	// BEFORE the run (that is exactly what G8 mirrors).
	if (opts.seedPublishedPrd) {
		write(`Doc/requirements/PRD_${PROJECT}.md`, prdMarkdown(1, "- 2026-09-20: initial draft."));
	}

	const runDir = join(".IDE_Plans", "velpari", "runs", runId);
	const workingCopy = write(join(runDir, "prd", `PRD_${PROJECT}.md`), prdMarkdown(opts.seedPublishedPrd ? 2 : 1));
	const payload = {
		envelope: {
			version: opts.seedPublishedPrd ? 2 : 1,
			stage: "drafting-prd",
			generatedAt: "2026-09-24T00:00:00.000Z",
			inputs: opts.prdFileHash,
			reviewerVerdict: null,
			changeLog: ["2026-09-24: phase 12 fixture publish."],
		},
		rows: {
			fr: [{ id: "FR-01", phase: 1, textHash: "a1b2c3", text: "The system shall accept text input." }],
			nfr: [{ id: "NFR-01", phase: 1, textHash: "d4e5f6", text: "p95 latency shall stay under 200 ms." }],
			prdSection: SECTION_TITLES.map((title, i) => ({ no: i + 1, title, body: `Prose for ${title}.` })),
		},
	};
	write(join(runDir, "prd", "payload", "prd-payload.json"), JSON.stringify(payload, null, 2) + "\n");

	// Real git repo + pinned local identity + isolated ambient config (Design 9).
	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["config", "user.name", "Velpari Phase12"], { cwd });
	execFileSync("git", ["config", "user.email", "phase12@velpari.local"], { cwd });
	const gitConfigGlobal = join(cwd, "gitconfig-global");
	writeFileSync(gitConfigGlobal, "[user]\n\tname = Velpari Phase12\n\temail = phase12@velpari.local\n", "utf8");
	savedEnv.GIT_CONFIG_GLOBAL = process.env.GIT_CONFIG_GLOBAL;
	savedEnv.GIT_CONFIG_SYSTEM = process.env.GIT_CONFIG_SYSTEM;
	savedEnv.GIT_CONFIG_NOSYSTEM = process.env.GIT_CONFIG_NOSYSTEM;
	process.env.GIT_CONFIG_GLOBAL = gitConfigGlobal;
	process.env.GIT_CONFIG_SYSTEM = "/dev/null";
	process.env.GIT_CONFIG_NOSYSTEM = "1";

	return { cwd, runId, workingCopy };
}

/** Repo-relative paths in the HEAD commit. */
function headCommitFiles(cwd: string): string[] {
	const out = execFileSync("git", ["show", "--name-only", "--pretty=format:", "HEAD"], { cwd, encoding: "utf-8" });
	return out
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

/** Absolute paths of every file under `root` (recursive). */
function walkFiles(root: string): string[] {
	const out: string[] = [];
	if (!existsSync(root)) return out;
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const abs = join(root, entry.name);
		if (entry.isDirectory()) out.push(...walkFiles(abs));
		else out.push(abs);
	}
	return out;
}

/** Open the fixture's store DB for row assertions. */
function openFixtureDb(): ReturnType<typeof openStoreDb> {
	return openStoreDb(join(dir, "Doc", "store", PROJECT, "index.db"));
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-db-era-"));
	dirs.push(dir);
	delete process.env.VELPARI_SKIP_DB_PUBLISH;
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

after(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	for (const key of Object.keys(savedEnv)) {
		const before = savedEnv[key];
		if (before === undefined) delete process.env[key];
		else process.env[key] = before;
	}
});

describe("DB-era publish — shipped default, rollback hatch, G8 revision (Phase 12 Fix 1/2/2b)", () => {
	test("Fixture A — shipped default: DB + YAML + registry commit, no markdown, stage advances", async () => {
		const fx = buildFixture({ markdownWrites: false, prdFileHash: {}, seedPublishedPrd: false });
		const docBefore = new Set(walkFiles(join(dir, "Doc")));
		const workingHashBefore = hashFileContent(fx.workingCopy);

		await handleApprove(makeCtx(), undefined, dir, { skipAutoDoctor: true });

		// 1. The publish gate cleared → the stage advanced exactly one step.
		assert.equal(loadState(dir).currentStage, "drafted-prd", `publish must advance; notices:\n${noticesText()}`);
		assert.equal(noticesText().includes("Publish gate blocked"), false, "the shipped default must not be gate-blocked");

		// 2. Store rows published under this run.
		const db = openFixtureDb();
		try {
			const stored = readArtifact(db, fx.runId, "prd");
			assert.ok(stored, "prd rows must exist for the run");
			assert.equal(stored.envelope.status, "published");
			const rows = stored.rows as { fr?: unknown[]; prdSection?: unknown[] };
			assert.ok((rows.fr?.length ?? 0) >= 1, "fr rows land in the store");
			assert.ok((rows.prdSection?.length ?? 0) >= 20, "every PSRS section row lands");
		} finally {
			closeStoreDb(db);
		}

		// 3. The deterministic YAML export sits beside the DB (RES-1).
		assert.ok(
			existsSync(join(dir, "Doc", "store", PROJECT, `PRD_${PROJECT}.yaml`)),
			"the exported YAML must live beside the store DB",
		);

		// 4. Commit set = DB + YAML (+ portfolio + healed git files), NO markdown.
		const files = headCommitFiles(dir);
		const legal =
			/^(?:Doc\/store\/Phase12App\/(?:index\.db|PRD_Phase12App\.yaml)|Doc\/store\/portfolio\.db|\.gitattributes|\.gitignore)$/;
		assert.deepEqual(
			files.filter((f) => !legal.test(f)),
			[],
			`unexpected path in the default-mode commit: ${files.join(", ")}`,
		);
		assert.ok(files.includes(`Doc/store/${PROJECT}/index.db`), "commit carries the store DB");
		assert.ok(files.includes(`Doc/store/${PROJECT}/PRD_${PROJECT}.yaml`), "commit carries the YAML export");
		assert.equal(
			files.some((f) => f.endsWith(".md")),
			false,
			"the shipped default commits NO markdown",
		);

		// 5. Portfolio policy (Q2.10): in the commit iff the fail-open sync did
		//    not report a failure.
		const portfolioWarned = notices.some((n) => /portfolio registry: warning/i.test(n.message));
		if (!portfolioWarned) {
			assert.ok(
				files.includes("Doc/store/portfolio.db"),
				"registry joins the commit unless its sync reported a failure",
			);
		}

		// 6. Doc/ snapshot: the only new files are under Doc/store/**.
		const outside = walkFiles(join(dir, "Doc"))
			.filter((p) => !docBefore.has(p))
			.map((p) => p.slice(dir.length + 1))
			.filter((rel) => !rel.startsWith("Doc/store/"));
		assert.deepEqual(outside, [], `no new file outside Doc/store/**; got ${outside.join(", ")}`);

		// 7. The working copy stays the temp review surface — byte-identical.
		assert.equal(hashFileContent(fx.workingCopy), workingHashBefore, "the working copy must not be rewritten");

		// 8. Freshness stamp (B4/A3): hashv 2 + the declared input hash.
		const manifest = JSON.parse(readFileSync(join(dir, ".pi", "velpari", "freshness.json"), "utf8")) as {
			artifacts: Record<string, { hashv?: number; inputs?: Record<string, string> }>;
		};
		const entry = manifest.artifacts[`prd:${PROJECT}`];
		assert.ok(entry, "a freshness entry must be written for the published prd");
		assert.equal(entry.hashv, 2, "new publishes stamp hashv 2");
		assert.ok(entry.inputs?.[`brainstorm:${slugify(MISSION)}`], "the declared brainstorm input must be stamped");
	});

	test("Fixture B — rollback hatch (markdownWrites ON): the published markdown appears and joins the commit", async () => {
		buildFixture({ markdownWrites: true, prdFileHash: {}, seedPublishedPrd: false });

		await handleApprove(makeCtx(), undefined, dir, { skipAutoDoctor: true });

		const published = join(dir, "Doc", "requirements", `PRD_${PROJECT}.md`);
		assert.ok(existsSync(published), `the flag-ON publish must write ${published}; notices:\n${noticesText()}`);
		assert.ok(
			headCommitFiles(dir).includes(`Doc/requirements/PRD_${PROJECT}.md`),
			"the write-alongside markdown joins the commit",
		);
		assert.equal(loadState(dir).currentStage, "drafted-prd", "the flag-ON publish advances the stage");
	});

	test("Fixture C1 — revision with a STALE prd-file hash is refused by G8", async () => {
		buildFixture({ markdownWrites: false, prdFileHash: { "prd-file": "0".repeat(64) }, seedPublishedPrd: true });

		await handleApprove(makeCtx(), undefined, dir, { skipAutoDoctor: true });

		assert.match(noticesText(), /G8 mirror check failed/, "a payload mirroring the wrong revision must be refused");
		assert.equal(loadState(dir).currentStage, "drafting-prd", "a refused publish must not advance");
	});

	test("Fixture C2 — revision carrying the hash of the already-published PRD publishes", async () => {
		const fx = buildFixture({ markdownWrites: false, prdFileHash: {}, seedPublishedPrd: true });
		const publishedPath = join(dir, "Doc", "requirements", `PRD_${PROJECT}.md`);
		// Phase 12 Fix 2b: G8 mirrors the ALREADY-published file (pre-write
		// bytes) — exactly what a stage LLM can hash before approving.
		const publishedHash = hashFileContent(publishedPath);
		assert.ok(publishedHash, "the seeded published PRD must be hashable");
		const payloadPath = join(dir, ".IDE_Plans", "velpari", "runs", fx.runId, "prd", "payload", "prd-payload.json");
		const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as { envelope: { inputs: Record<string, string> } };
		payload.envelope.inputs = { "prd-file": publishedHash };
		writeFileSync(payloadPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

		await handleApprove(makeCtx(), undefined, dir, { skipAutoDoctor: true });

		assert.equal(
			noticesText().includes("G8 mirror check failed"),
			false,
			`G8 must accept the mirrored hash:\n${noticesText()}`,
		);
		assert.equal(loadState(dir).currentStage, "drafted-prd", "the honest revision publishes and advances");
	});
});
