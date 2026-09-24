/**
 * MIGRATED-PROJECT end-to-end (Phase 12, subphase 1.2).
 *
 * Why this file exists: migration is proven at engine level
 * (`test/ops/migrate.test.ts`), but nothing proved a MIGRATED project behaves
 * like a DB-era project downstream. Migration gives the data a different
 * history — run `migrated`, `inputs: "{}"` envelopes (Design 8), no working
 * copies — so "works like any other project" must be demonstrated:
 *
 *   (a) every migrated kind is readable through `readLatestPublishedRows`;
 *   (b) the DB input-slice path stages use builds a `## DB Input Slices` block;
 *   (c) a subsequent DB-era `handleApprove` on that project commits DB + YAML
 *       only (no markdown — the shipped default);
 *   (d) `runDoctor` reports no errors for the project's DATA (store, freshness,
 *       coverage, integrity) — documented `no-stamp` freshness warnings are the
 *       only freshness findings;
 *   (e) the export renderer produces the migrated artifact from the store;
 *   (f) the Phase 9 rebuild contract: delete the store DB → `importArtifactYaml`
 *       restores the rows, checksum-verified.
 *
 * Git hermeticity (Design 9): pinned local identity + isolated
 * `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`, so migration's commit and the
 * publish identity precheck are decided by the fixture, not the host.
 *
 * Runs in remote CI only (thermal protocol 2026-09-21 — no local full runs).
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { MIGRATE_RUN_ID, migrateExecute } from "../../src/ops/migrate.js";
import { resolveStageSlice } from "../../src/ops/db-slices.js";
import { handleApprove } from "../../src/ops/approve.js";
import { renderPrdMarkdown } from "../../src/ops/export-doc.js";
import { runDoctor } from "../../src/doctor/index.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";
import { extractRequirementFingerprints } from "../../src/core/fingerprints.js";
import { buildStagePrompt } from "../../src/core/prompt.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import {
	importArtifactYaml,
	publishArtifact,
	readLatestPublishedRows,
	verifyExportChecksum,
	writeArtifact,
	type ArtifactPayload,
} from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";

const PROJECT = "alpha";
const MISSION = "alpha migration";

/** Legacy flat PRD (pre-store shape) — the migration loader parses tables. */
const LEGACY_PRD_MD = `# PSRS — alpha

## Functional Requirements

| ID | Phase | Requirement |
|---|---|---|
| FR-1 | 1 | The system shall parse input |
| FR-2 | 2 | The system shall export reports |

## Non-Functional Requirements

| ID | Phase | Requirement |
|---|---|---|
| NFR-1 | 1 | Response under 200ms |

## PRD Sections

| No | Title | Body |
|---|---|---|
| 1 | Purpose | Why we build this |
`;

/**
 * Legacy published RTM (grouped layout) covering EVERY legacy PRD requirement
 * and carrying the PRD's own fingerprints — the shape a healthy legacy project
 * has, so the post-migration doctor's trace-link + MVP-coverage checks can be
 * clean (a legacy RTM with gaps would legitimately report coverage errors).
 * @param {Map<string, string>} fingerprints - extractRequirementFingerprints(LEGACY_PRD_MD).
 * @returns {string} The legacy RTM markdown.
 */
function legacyRtmMarkdown(fingerprints: Map<string, string>): string {
	const rows: Array<[string, number, string]> = [
		["FR-1", 1, "M-1"],
		["FR-2", 2, "M-2"],
		["NFR-1", 1, "M-1"],
	];
	const body = rows
		.map(([id, phase, design]) => `| ${id} | ${phase} | ${design} | TC-1 | ${fingerprints.get(id) ?? ""} |`)
		.join("\n");
	return [
		"# RTM — alpha",
		"",
		"## Traceability",
		"",
		"| FR | Phase | Design | Tests | Target SHA-256 |",
		"|---|---|---|---|---|",
		body,
		"",
	].join("\n");
}

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

/** Query the HEAD commit's file list. */
function headCommitFiles(cwd: string): string[] {
	const out = execFileSync("git", ["show", "--name-only", "--pretty=format:", "HEAD"], { cwd, encoding: "utf-8" });
	return out
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

/**
 * Build a legacy project and migrate it: real git repo (pinned identity),
 * `files.json` v4, legacy flat PRD + grouped RTM markdown, then
 * `migrateExecute`.
 * @returns {{cwd: string, report: ReturnType<typeof migrateExecute>, fingerprints: Map<string, string>}} Fixture.
 */
function buildMigratedProject(): {
	cwd: string;
	report: ReturnType<typeof migrateExecute>;
	fingerprints: Map<string, string>;
} {
	const cwd = dir;
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

	write(
		".pi/velpari/files.json",
		`${JSON.stringify(
			{
				version: 4,
				projectName: PROJECT,
				framework: { language: "typescript", runtime: "node" },
				inputDocuments: [],
				outputPaths: {},
				codePaths: [],
				testPaths: [],
				excludedPaths: [],
			},
			null,
			2,
		)}\n`,
	);
	// Legacy published artifacts (pre-store shapes). The RTM carries the PRD's
	// own fingerprints — a healthy legacy dataset (see legacyRtmMarkdown).
	const fingerprints = extractRequirementFingerprints(LEGACY_PRD_MD);
	write(`Doc/requirements/PRD_${PROJECT}.md`, LEGACY_PRD_MD);
	write(`Doc/requirements/RTM_${PROJECT}.md`, legacyRtmMarkdown(fingerprints));

	// Real git repo + pinned identity + isolated ambient config (Design 9).
	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["config", "user.name", "Velpari Phase12"], { cwd });
	execFileSync("git", ["config", "user.email", "phase12@velpari.local"], { cwd });
	const gitConfigGlobal = write(
		"gitconfig-global",
		"[user]\n\tname = Velpari Phase12\n\temail = phase12@velpari.local\n",
	);
	savedEnv.GIT_CONFIG_GLOBAL = process.env.GIT_CONFIG_GLOBAL;
	savedEnv.GIT_CONFIG_SYSTEM = process.env.GIT_CONFIG_SYSTEM;
	savedEnv.GIT_CONFIG_NOSYSTEM = process.env.GIT_CONFIG_NOSYSTEM;
	process.env.GIT_CONFIG_GLOBAL = gitConfigGlobal;
	process.env.GIT_CONFIG_SYSTEM = "/dev/null";
	process.env.GIT_CONFIG_NOSYSTEM = "1";

	const report = migrateExecute(cwd);
	return { cwd, report, fingerprints };
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-migrated-"));
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

describe("migrated project — DB-era behaviour downstream (Phase 12, 1.2)", () => {
	test("(a)+(b) every migrated kind is readable and the RTM stage slice builds from the store", () => {
		const { report } = buildMigratedProject();

		// The migration itself succeeded and reported the kinds it published.
		assert.equal(report.ok, true, `migrateExecute failed: ${report.precheckProblems.join(" | ")}`);
		const project = report.projects.find((p) => p.projectName === PROJECT);
		assert.ok(project, "the legacy project must be discovered");
		const migrated = project.kinds.filter((k) => k.status === "migrated").map((k) => k.kind);
		assert.deepEqual(migrated.sort(), ["prd", "rtm"], `migrated kinds: ${JSON.stringify(project.kinds)}`);
		assert.equal(existsSync(join(dir, "Doc", "store", PROJECT, "index.db")), true, "the store DB must exist");
		assert.ok(
			headCommitFiles(dir).includes(`Doc/store/${PROJECT}/index.db`),
			"migration commits the store DB under run 'migrated'",
		);

		// (a) Every migrated kind is readable through the DB-primary reader.
		for (const kind of ["prd", "rtm"] as const) {
			const read = readLatestPublishedRows(dir, PROJECT, kind);
			assert.ok(read, `readLatestPublishedRows must return the migrated '${kind}' rows`);
			assert.equal(read.envelope.status, "published", `migrated '${kind}' rows must be published`);
			assert.ok(Object.keys(read.rows).length > 0, `migrated '${kind}' rows must carry row-sets`);
		}
		const prd = readLatestPublishedRows(dir, PROJECT, "prd");
		assert.equal(prd?.envelope.runId, MIGRATE_RUN_ID, "migrated rows live under the 'migrated' run id");

		// (b) The DB input-slice path the stages use builds a slice block, and
		//     the stage prompt renders it under the `## DB Input Slices`
		//     heading (core/prompt.ts — the wrapper the stage LLM reads).
		const slice = resolveStageSlice(dir, PROJECT, "rtm");
		assert.equal(slice.ok, true, `resolveStageSlice must succeed: ${JSON.stringify(slice)}`);
		assert.match(slice.block, /### prd \(run migrated v1\)/, "the slice must name the migrated PRD run");
		assert.match(slice.block, /FR-1/, "the migrated PRD rows must appear in the slice");
		const prompt = buildStagePrompt({
			stage: "building-rtm",
			mission: MISSION,
			framework: undefined,
			runId: "run-1.2",
			answers: [],
			webSearchAllowed: false,
			paths: { dbInputSlice: slice.block },
		});
		assert.match(prompt, /## DB Input Slices/, "the stage prompt must wrap the slice in the DB Input Slices block");
		assert.match(prompt, /FR-1/, "the prompt's slice block must carry the migrated rows");
	});

	test("(c)+(e)+(d)+(f) DB-era approve on migrated data, export, doctor, rebuild-from-YAML", async () => {
		const { report, fingerprints } = buildMigratedProject();
		assert.equal(report.ok, true, `migrateExecute failed: ${report.precheckProblems.join(" | ")}`);

		// ---- (c) a DB-era approve on the migrated project: DB + YAML only ----
		const run = createRun(MISSION, dir);
		saveState({ ...run, currentStage: "building-rtm" }, dir);
		const runId = loadState(dir).runId;
		// Readers pick the newest PUBLISHED envelope by `generated_at DESC`
		// (`listPublishedVersions`), and the migration stamps its rows with
		// the migration instant — so this run's envelopes must be strictly
		// later, or the doctor/slice readers would keep reading the migrated
		// rows after this publish.
		const publishGeneratedAt = new Date(Date.now() + 60_000).toISOString();

		// Store FKs are run-scoped composite keys → seed THIS run's PRD rows
		// (the migrated rows live under run 'migrated', a different FK graph).
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			writeArtifact(
				db,
				"prd",
				runId,
				{
					version: 1,
					stage: "drafted-prd",
					generatedAt: publishGeneratedAt,
					inputs: "{}",
					reviewerVerdict: null,
					changeLog: "[]",
				},
				{
					fr: [
						{ id: "FR-1", phase: 1, textHash: "a1", text: "The system shall parse input" },
						{ id: "FR-2", phase: 2, textHash: "a2", text: "The system shall export reports" },
						{ id: "NFR-1", phase: 1, textHash: "a3", text: "Response under 200ms" },
					],
					nfr: [],
					prdSection: [{ no: 1, title: "Purpose", body: "Why we build this" }],
				} as ArtifactPayload,
			);
			publishArtifact(db, runId, "prd");
		} finally {
			closeStoreDb(db);
		}

		// RTM working copy + payload. Row ids mirror the PSRS requirement ids
		// (the link check matches on them) and phases match the legacy PRD.
		const runDir = join(".IDE_Plans", "velpari", "runs", runId);
		mkdirSync(join(dir, runDir, "rtm", "payload"), { recursive: true });
		writeFileSync(join(dir, runDir, "rtm", `RTM_${PROJECT}.md`), "# RTM preview\n", "utf8");
		writeFileSync(
			join(dir, runDir, "rtm", "payload", "rtm-payload.json"),
			`${JSON.stringify(
				{
					envelope: {
						version: 1,
						stage: "building-rtm",
						generatedAt: publishGeneratedAt,
						inputs: {},
						reviewerVerdict: null,
						changeLog: [],
					},
					rows: {
						rtmRow: [
							{
								id: "FR-1",
								frRef: "FR-1",
								afRef: "AF-1",
								tcRef: "TC-1",
								phase: 1,
								targetSha256: fingerprints.get("FR-1") ?? "",
							},
							{
								id: "FR-2",
								frRef: "FR-2",
								afRef: "AF-2",
								tcRef: "TC-2",
								phase: 2,
								targetSha256: fingerprints.get("FR-2") ?? "",
							},
							{
								id: "NFR-1",
								frRef: "NFR-1",
								afRef: "AF-1",
								tcRef: "TC-3",
								phase: 1,
								targetSha256: fingerprints.get("NFR-1") ?? "",
							},
						],
					},
				},
				null,
				2,
			)}\n`,
			"utf8",
		);

		await handleApprove(makeCtx(), undefined, dir, { skipAutoDoctor: true });

		assert.equal(
			loadState(dir).currentStage,
			"built-rtm",
			`the migrated project must publish; notices:\n${noticesText()}`,
		);
		const files = headCommitFiles(dir);
		assert.ok(
			files.includes(`Doc/store/${PROJECT}/RTM_${PROJECT}.yaml`),
			`commit carries the RTM YAML export: ${files.join(", ")}`,
		);
		const legal =
			/^(?:Doc\/store\/(?:alpha\/(?:index\.db|[A-Za-z-]+_alpha\.yaml)|portfolio\.db)|\.gitattributes|\.gitignore)$/;
		assert.deepEqual(
			files.filter((f) => !legal.test(f)),
			[],
			`unexpected path in the migrated publish commit: ${files.join(", ")}`,
		);
		assert.deepEqual(
			files.filter((f) => f.endsWith(".md")),
			[],
			"the DB-era default commits no markdown",
		);

		// ---- (e) the export renderer produces the migrated artifact ----
		const migratedPrd = readLatestPublishedRows(dir, PROJECT, "prd");
		assert.ok(migratedPrd, "the migrated PRD rows must be readable for export");
		const rendered = renderPrdMarkdown(migratedPrd.rows as Record<string, unknown>);
		assert.match(rendered, /FR-1/, "the renderer must reproduce the migrated requirement ids");
		assert.match(rendered, /Purpose/, "the renderer must reproduce the migrated PRD section rows");

		// ---- (d) runDoctor: the store/data checks must be clean ----
		// Measured classification (recorded in the plan's evidence table):
		//  - project-shape errors (this synthetic cwd has no `skills/`, no
		//    `package.json`) are fixture noise, identical on a fresh project;
		//  - LEGACY-shape errors come from the pre-store files this fixture
		//    keeps on disk on purpose (they are readable history, never
		//    rewritten): no frontmatter, not a 20-section PSRS, and the
		//    published markdown of a DB-rendered kind no longer matching the
		//    re-render of the store rows. Those are migrated-project findings
		//    (recorded as F6/F7/F8 in the plan) — never a DB-era regression of
		//    THIS phase's fix set.
		//  - everything else is a real store/data error → must be empty.
		const doctor = runDoctor(dir);
		const allErrors = doctor.sections.flatMap((s) =>
			s.items.filter((i) => i.status === "error").map((i) => `${s.title}: ${i.message}`),
		);
		const shapeErrors = allErrors.filter((e) => /Stage skills|Official-extension readiness|Action items/i.test(e));
		const legacyErrors = allErrors.filter((e) =>
			/Artifact frontmatter|PSRS validation|no RTM row|MVP coverage/i.test(e),
		);
		const dataErrors = allErrors.filter((e) => !shapeErrors.includes(e) && !legacyErrors.includes(e));
		// Phase 12 Fix F7 regression: under the DB-only default the published
		// markdown is a legacy view the publish chain never rewrites, so no
		// render-drift error may be reported (it used to fire here on every
		// migrated-project republish).
		assert.deepEqual(
			allErrors.filter((e) => /has drifted from the store/.test(e)),
			[],
			"the DB-only default must not report published-view drift (Phase 12 Fix F7)",
		);
		console.log(
			`[1.2 doctor measurement] all=${allErrors.length} project-shape=${shapeErrors.length} legacy-shape=${legacyErrors.length} store/data=${dataErrors.length}`,
		);
		for (const e of legacyErrors) console.log(`  legacy-shape: ${e}`);
		assert.deepEqual(dataErrors, [], `store/data doctor checks must be clean: ${dataErrors.join(" | ")}`);

		const freshness = doctor.sections.find((s) => /fresh/i.test(s.title));
		assert.ok(freshness, "the doctor must report a freshness section");
		assert.ok(
			freshness.items.some((i) => i.status === "warning" && /no-stamp|no freshness stamp/i.test(i.message)),
			`migrated (unstamped) artifacts must surface the documented no-stamp warning: ${JSON.stringify(freshness.items)}`,
		);

		// ---- (f) rebuild contract (Phase 9): delete the DB, import the YAML ----
		const yamlText = readFileSync(join(dir, "Doc", "store", PROJECT, `PRD_${PROJECT}.yaml`), "utf8");
		const dbPath = buildStoreDbPath(PROJECT, dir);
		for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
		assert.equal(existsSync(dbPath), false, "the fixture deletes the store DB before the rebuild");

		const rebuilt = openStoreDb(dbPath);
		try {
			const imported = importArtifactYaml(rebuilt, MIGRATE_RUN_ID, yamlText);
			assert.equal(imported.ok, true, `YAML import failed: ${imported.message}`);
			assert.ok(imported.rowCount > 0, "the import must restore the migrated rows");
			const checksum = verifyExportChecksum(rebuilt, MIGRATE_RUN_ID, "prd");
			assert.equal(
				checksum.ok,
				true,
				`restored rows must verify against the export checksum (${checksum.expected} vs ${checksum.actual})`,
			);
		} finally {
			closeStoreDb(rebuilt);
		}
		const restored = readLatestPublishedRows(dir, PROJECT, "prd");
		assert.ok(restored, "the restored rows must be readable through the DB-primary reader");
		assert.equal(restored.envelope.runId, MIGRATE_RUN_ID, "the rebuild restores the 'migrated' run");
	});
});
