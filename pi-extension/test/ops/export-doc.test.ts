// Unit tests — ops/export-doc.ts (Phase 5 on-demand export, D4).
// Covers: all 9 kind renderers (expected rows/sections), G5 byte-identical
// re-render, yaml byte-identity with exportArtifactYaml (RES-1), mdToHtml
// bounded subset + escaping, runExport happy path + refusals (missing DB,
// absent artifact, draft-only, version mismatch, overwrite contract),
// listExportableKinds KIND_ORDER + listPublishedVersions newest-first
// (Phase 1 helpers via seeded DB), buildExportDefaultPath.
// Conventions: temp dirs + real openStoreDb/closeStoreDb — no mocks
// (tests written from driver behavior per Phase 1/2 retrospective lesson).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import type { DatabaseSync } from "node:sqlite";
import {
	writeArtifact,
	publishArtifact,
	exportArtifactYaml,
	listExportableKinds,
	listPublishedVersions,
	KIND_ORDER,
	type ArtifactKind,
	type ArtifactEnvelopeInput,
	type ArtifactPayload,
} from "../../src/io/store.js";
import {
	buildExportDefaultPath,
	renderPrdMarkdown,
	renderRtmMarkdown,
	renderFeasibilityMarkdown,
	renderDesignMarkdown,
	renderAtomicFunctionsMarkdown,
	renderPseudocodeMarkdown,
	renderTestplanMarkdown,
	renderDevelopmentOrderMarkdown,
	renderFinalDesignMarkdown,
	renderEnvelopeHeader,
	mdToHtml,
	runExport,
	type ExportFormat,
} from "../../src/ops/export-doc.js";
import { buildStoreDbPath } from "../../src/core/paths.js";

/** Envelope input with deterministic defaults; overrides per test. */
function env(overrides: Partial<ArtifactEnvelopeInput> = {}): ArtifactEnvelopeInput {
	return {
		version: 1,
		stage: "drafting-prd",
		generatedAt: "2026-09-22T00:00:00Z",
		...overrides,
	};
}

const PRD_PAYLOAD: ArtifactPayload = {
	fr: [
		{ id: "FR-1", phase: 1, textHash: "a1b2c3" },
		{ id: "FR-2", phase: 1, textHash: "d4e5f6" },
	],
	nfr: [{ id: "NFR-1", phase: 1, textHash: "0f1e2d" }],
	prdSection: [{ no: 1, title: "Purpose", bodyRef: null }],
};

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-export-"));
	db = openStoreDb(join(dir, "index.db"));
});

after(() => {
	closeStoreDb(db);
	rmSync(dir, { recursive: true, force: true });
});

/** Write + publish one artifact with a deterministic payload. */
function publishSeed(
	kind: ArtifactKind,
	runId: string,
	envelope: ArtifactEnvelopeInput,
	payload: ArtifactPayload,
): void {
	writeArtifact(db, kind, runId, envelope, payload);
	publishArtifact(db, runId, kind);
}

// ---------------------------------------------------------------------------
// listExportableKinds / listPublishedVersions (Phase 1 helpers)
// ---------------------------------------------------------------------------

describe("listExportableKinds", () => {
	test("returns only kinds with published rows, in KIND_ORDER", () => {
		publishSeed("prd", "r1", env(), PRD_PAYLOAD);
		publishSeed(
			"rtm",
			"r1",
			{ ...env(), stage: "building-rtm" },
			{
				rtmRow: [{ id: "TR-1", frRef: "FR-1", afRef: null, tcRef: null, phase: 1, targetSha256: "aa" }],
			},
		);
		// Draft-only kind must NOT appear (Q2 — drafts never listed).
		writeArtifact(db, "design", "r1", env({ stage: "designing" }), {
			designModule: [{ id: "M-1", name: "Module One" }],
		});
		const kinds = listExportableKinds(db);
		const expected = KIND_ORDER.filter((k) => k === "prd" || k === "rtm");
		assert.deepEqual(kinds, expected);
		assert.ok(kinds.indexOf("prd") < kinds.indexOf("rtm"));
	});

	test("empty DB → empty list", () => {
		assert.deepEqual(listExportableKinds(db), []);
	});
});

describe("listPublishedVersions", () => {
	test("newest first, drafts never listed", () => {
		publishSeed("prd", "r1", env({ generatedAt: "2026-09-22T00:00:00Z" }), PRD_PAYLOAD);
		publishSeed(
			"prd",
			"r2",
			{
				version: 2,
				stage: "drafting-prd",
				generatedAt: "2026-09-22T12:00:00Z",
			},
			PRD_PAYLOAD,
		);
		// Draft for a third run — excluded.
		writeArtifact(db, "prd", "r3", env(), PRD_PAYLOAD);
		const versions = listPublishedVersions(db, "prd");
		assert.deepEqual(
			versions.map((v) => v.runId),
			["r2", "r1"],
		);
		assert.equal(versions[0]!.version, 2);
		assert.equal(versions[0]!.stage, "drafting-prd");
		assert.equal(versions[0]!.generatedAt, "2026-09-22T12:00:00Z");
	});

	test("no published versions → empty list", () => {
		// Draft-only prd (prd rows carry no cross-table FKs).
		writeArtifact(db, "prd", "draft-only", env(), PRD_PAYLOAD);
		assert.deepEqual(listPublishedVersions(db, "prd"), []);
	});
});

// ---------------------------------------------------------------------------
// Per-kind renderers (deterministic tables from seeded rows)
// ---------------------------------------------------------------------------

describe("kind renderers", () => {
	test("prd renders FR + NFR + section tables", () => {
		const md = renderPrdMarkdown(PRD_PAYLOAD);
		assert.ok(md.includes("## Functional Requirements"));
		assert.ok(md.includes("## Non-Functional Requirements"));
		assert.ok(md.includes("| FR-1 | 1 | a1b2c3 |"));
		assert.ok(md.includes("## Sections"));
		assert.ok(md.includes("| 1 | Purpose |  |"));
	});

	test("rtm renders traceability rows", () => {
		const md = renderRtmMarkdown({
			rtmRow: [{ id: "TR-1", frRef: "FR-1", afRef: "AF-1", tcRef: "TC-1", phase: 1, targetSha256: "abc" }],
		});
		assert.ok(md.includes("| TR-1 | FR-1 | AF-1 | TC-1 | 1 | abc |"));
	});

	test("feasibility renders decision, spikes, reuse scan", () => {
		const md = renderFeasibilityMarkdown({
			feasibilityDecision: {
				verdict: "build",
				language: "typescript",
				decidedBy: "user",
				at: "2026-09-22T00:00:00Z",
				webSearchConsent: 1,
			},
			feasibilitySpike: [
				{ language: "typescript", passed: 1, resultRef: null },
				{ language: "python", passed: 0, resultRef: null },
			],
			reuseScan: [{ candidate: "lib-x", license: "MIT", repoFreshness: "fresh", verdict: "reuse" }],
		});
		assert.ok(md.includes("| build | typescript | user |"));
		assert.ok(md.includes("| python | no |  |"));
		assert.ok(md.includes("| lib-x | MIT | fresh | reuse |"));
	});

	test("design renders modules, ADRs, diagram fences, approaches", () => {
		const md = renderDesignMarkdown({
			designModule: [{ id: "M-1", name: "Store" }],
			adr: [{ id: "ADR-001", adrStatus: "accepted", options: "A;B", chosen: "B", rationale: "why" }],
			diagram: [{ id: "D-1", diagramKind: "context", mermaidText: "graph TD; A-->B" }],
			approach: [{ moduleId: "M-1", tacticId: "t-wal" }],
			moduleSourceFr: [{ moduleId: "M-1", frId: "FR-1" }],
		});
		assert.ok(md.includes("| M-1 | Store |"));
		assert.ok(md.includes("| ADR-001 | accepted | A;B | B | why |"));
		assert.ok(md.includes("```mermaid"));
		assert.ok(md.includes("graph TD"));
		assert.ok(md.includes("| M-1 | t-wal |"));
	});

	test("atomic-functions renders tier/criticality/SIL columns", () => {
		const md = renderAtomicFunctionsMarkdown({
			atomicFunction: [
				{
					id: "AF-1",
					name: "ReadRow",
					signature: "(id) => row",
					tier: "basic",
					criticality: "A",
					sil: "none",
					isLeaf: 1,
				},
			],
		});
		assert.ok(md.includes("| AF-1 | ReadRow | (id) => row | basic | A | none | yes |"));
	});

	test("pseudocode renders blocks", () => {
		const md = renderPseudocodeMarkdown({
			pseudocodeBlock: [{ id: "PB-1", afRef: "AF-1", contentHash: "ff00" }],
		});
		assert.ok(md.includes("| PB-1 | AF-1 | ff00 |"));
	});

	test("testplan renders cases + traces", () => {
		const md = renderTestplanMarkdown({
			testCase: [{ id: "TC-1", tcKind: "TC", strategyRef: null }],
			tcTrace: [{ tcId: "TC-1", targetKind: "fr", targetId: "FR-1" }],
		});
		assert.ok(md.includes("| TC-1 | TC |  |"));
		assert.ok(md.includes("| TC-1 | fr | FR-1 |"));
	});

	test("development-order renders steps, AFs, dependencies", () => {
		const md = renderDevelopmentOrderMarkdown({
			devStep: [{ id: "S-1", module: "Store" }],
			stepAf: [{ stepId: "S-1", afId: "AF-1" }],
			stepDep: [{ stepId: "S-2", dependsOnId: "S-1" }],
		});
		assert.ok(md.includes("| S-1 | Store |"));
		assert.ok(md.includes("| S-1 | AF-1 |"));
		assert.ok(md.includes("| S-2 | S-1 |"));
	});

	// --- Phase 7 / N16 — lane sections (plan 7.5.2) -------------------------

	/** Golden captured from the PRE-Phase-7 renderer (legacy byte-stability). */
	const LEGACY_GOLDEN =
		"## Development Steps\n" +
		"\n" +
		"| ID | Module |\n" +
		"| --- | --- |\n" +
		"| S-1 | Store |\n" +
		"## Step Atomic Functions\n" +
		"\n" +
		"| Step | AF |\n" +
		"| --- | --- |\n" +
		"| S-1 | AF-1 |\n" +
		"## Step Dependencies\n" +
		"\n" +
		"| Step | Depends On |\n" +
		"| --- | --- |\n" +
		"| S-2 | S-1 |\n";

	/** The worked example: A,B independent → C → D,E → F, canonical 2 lanes. */
	const LANED_ROWS = {
		devStep: [
			{ id: "A", module: "core" },
			{ id: "B", module: "core" },
			{ id: "C", module: "shared" },
			{ id: "D", module: "api" },
			{ id: "E", module: "api" },
			{ id: "F", module: "edge" },
		],
		stepDep: [
			{ stepId: "C", dependsOnId: "A" },
			{ stepId: "C", dependsOnId: "B" },
			{ stepId: "D", dependsOnId: "C" },
			{ stepId: "E", dependsOnId: "C" },
			{ stepId: "F", dependsOnId: "D" },
			{ stepId: "F", dependsOnId: "E" },
		],
		devLane: [
			{
				laneId: "lane-1",
				stepId: "A",
				position: 0,
				worktree: "testapp/lane-1-core",
				branch: "testapp/lane-1-core",
				status: "active",
			},
			{
				laneId: "lane-1",
				stepId: "C",
				position: 1,
				worktree: "testapp/lane-1-core",
				branch: "testapp/lane-1-core",
				status: "active",
			},
			{
				laneId: "lane-1",
				stepId: "D",
				position: 2,
				worktree: "testapp/lane-1-core",
				branch: "testapp/lane-1-core",
				status: "active",
			},
			{
				laneId: "lane-1",
				stepId: "F",
				position: 3,
				worktree: "testapp/lane-1-core",
				branch: "testapp/lane-1-core",
				status: "active",
			},
			{
				laneId: "lane-2",
				stepId: "B",
				position: 0,
				worktree: "testapp/lane-2-edge",
				branch: "testapp/lane-2-edge",
				status: "active",
			},
			{
				laneId: "lane-2",
				stepId: "E",
				position: 1,
				worktree: "testapp/lane-2-edge",
				branch: "testapp/lane-2-edge",
				status: "active",
			},
		],
	};

	test("development-order legacy: no devLane renders byte-identical to the pre-Phase-7 golden", () => {
		const rows = {
			devStep: [{ id: "S-1", module: "Store" }],
			stepAf: [{ stepId: "S-1", afId: "AF-1" }],
			stepDep: [{ stepId: "S-2", dependsOnId: "S-1" }],
		};
		assert.equal(renderDevelopmentOrderMarkdown(rows), LEGACY_GOLDEN, "legacy shape must not gain sections");
		// An EMPTY devLane array is legacy too (absent/empty ⇒ omit entirely).
		assert.equal(renderDevelopmentOrderMarkdown({ ...rows, devLane: [] }), LEGACY_GOLDEN);
	});

	test("development-order lanes: Execution Lanes, Integration Plan, Lock Rules, Lane Shape", () => {
		const md = renderDevelopmentOrderMarkdown(LANED_ROWS);
		// 1. Execution Lanes — table + per-lane worktree/branch (name-match)
		//    + the git worktree line.
		assert.ok(md.includes("## Execution Lanes"), "missing Execution Lanes section");
		assert.ok(
			md.includes("| lane-1 | active | A, C, D, F | testapp/lane-1-core | testapp/lane-1-core |"),
			"missing lane-1 row with in-order steps and name-match pair",
		);
		assert.ok(
			md.includes("| lane-2 | active | B, E | testapp/lane-2-edge | testapp/lane-2-edge |"),
			"missing lane-2 row",
		);
		assert.ok(
			md.includes("- `git worktree add ../testapp/lane-1-core -b testapp/lane-1-core`"),
			"missing git worktree line",
		);
		// 2. Integration Plan — merge order from the DAG (lane-2 feeds C at
		//    level 1 ⇒ order 1; lane-1 next) + gates + the parked note.
		assert.ok(md.includes("## Integration Plan"), "missing Integration Plan section");
		assert.ok(md.includes("| 1 | lane-2 | 1 | tests green + doctor audit |"), "missing merge order row 1");
		assert.ok(md.includes("| 2 | lane-1 | 2 | tests green + doctor audit |"), "missing merge order row 2");
		assert.ok(md.includes("⇒ `parked` (locked for edit)"), "missing the parked/re-gate note");
		// 3. Lock Rules — the dev-lanes.ts constants, verbatim.
		assert.ok(md.includes("## Lock Rules"), "missing Lock Rules section");
		assert.ok(md.includes("A lane is locked for edit once its merge starts"), "missing the edit-lock rule text");
		// 4. Lane Shape — the level narrative for the worked example.
		assert.ok(md.includes("## Lane Shape"), "missing Lane Shape section");
		assert.ok(
			md.includes(
				"Shape: parallel (2 lanes) → series (1 step) → parallel (2 lanes) → series (1 step) — derived from the step dependency graph, not a template.",
			),
			"wrong shape narrative",
		);
		assert.ok(
			md.includes(
				"Steps at the same level run in parallel across lanes; dependent steps stay sequential inside one lane.",
			),
			"missing the worked-example sentence",
		);
		// The base three tables still come first.
		assert.ok(md.indexOf("## Development Steps") < md.indexOf("## Execution Lanes"));
	});

	test("development-order lanes: per-lane status renders (parked)", () => {
		const rows = {
			...LANED_ROWS,
			devLane: LANED_ROWS.devLane.map((r) => (r.laneId === "lane-2" ? { ...r, status: "parked" } : r)),
		};
		const md = renderDevelopmentOrderMarkdown(rows);
		assert.ok(md.includes("| lane-2 | parked |"), "parked status must reach the lane table");
		assert.ok(md.includes("| lane-1 | active |"), "other lanes keep their status");
	});

	test("G5: lane sections render byte-identically twice", () => {
		const first = renderDevelopmentOrderMarkdown(LANED_ROWS);
		const second = renderDevelopmentOrderMarkdown(LANED_ROWS);
		assert.equal(first, second, "lane rendering must be deterministic");
	});

	test("final-design renders consolidated sections", () => {
		const md = renderFinalDesignMarkdown({
			finalSection: [{ no: 1, title: "Overview", sourceArtifact: "design", sourceIds: '["M-1"]' }],
		});
		assert.ok(md.includes("| 1 | Overview | design |"));
		assert.ok(md.includes("M-1"));
	});

	test("G5: empty row sets render as (none), never crash", () => {
		assert.ok(renderRtmMarkdown({}).includes("_(none)_"));
		assert.ok(renderPrdMarkdown({}).includes("_(none)_"));
	});
});

// ---------------------------------------------------------------------------
// Envelope header
// ---------------------------------------------------------------------------

describe("renderEnvelopeHeader", () => {
	test("frontmatter + title + fingerprint + verdict + change log", () => {
		const md = renderEnvelopeHeader({
			runId: "r1",
			kind: "prd",
			version: 3,
			stage: "drafting-prd",
			generatedAt: "2026-09-22T00:00:00Z",
			sha256Fingerprint: "cafe".repeat(16),
			inputs: "{}",
			reviewerVerdict: "pass",
			changeLog: '[{"action":"create"}]',
			status: "published",
			headRevisionId: null,
			frozen: false,
			freezeReason: null,
		});
		assert.ok(
			md.includes(
				"---\nartifact: prd\nrunId: r1\nstage: drafting-prd\nversion: 3\ngeneratedAt: 2026-09-22T00:00:00Z\n---",
			),
		);
		assert.ok(md.includes("# PRD (version 3)"));
		assert.ok(md.includes("- **Fingerprint:** `cafe"));
		assert.ok(md.includes("pass"));
		assert.ok(md.includes('{"action":"create"}'));
	});

	test("null verdict + empty change log render placeholders", () => {
		const md = renderEnvelopeHeader({
			runId: "r1",
			kind: "rtm",
			version: 1,
			stage: "building-rtm",
			generatedAt: "2026-09-22T00:00:00Z",
			sha256Fingerprint: "beef",
			inputs: "{}",
			reviewerVerdict: null,
			changeLog: "[]",
			status: "published",
			headRevisionId: null,
			frozen: false,
			freezeReason: null,
		});
		assert.ok(md.includes("_none recorded_"));
		assert.ok(md.includes("_no changes recorded_"));
	});
});

// ---------------------------------------------------------------------------
// mdToHtml — bounded subset + escaping
// ---------------------------------------------------------------------------

describe("mdToHtml", () => {
	test("headings, bold, italic, code spans", () => {
		const html = mdToHtml("# Title\n\n**bold** and *italic* and `code`\n");
		assert.ok(html.includes("<h1>Title</h1>"));
		assert.ok(html.includes("<strong>bold</strong>"));
		assert.ok(html.includes("<em>italic</em>"));
		assert.ok(html.includes("<code>code</code>"));
	});

	test("pipe tables convert to <table>", () => {
		const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		const html = mdToHtml(md);
		assert.ok(html.includes("<th>A</th>"));
		assert.ok(html.includes("<td>1</td>"));
		assert.ok(html.includes("<tbody>"));
	});

	test("escaped pipes in a cell stay one cell (Phase I9.5)", () => {
		// The md renderer escapes `|` → `\|`; the HTML parser must not
		// treat that as a column separator or the row misaligns.
		const md = "| Req | Notes |\n| --- | --- |\n| FR-01 | A \\\| B and C |";
		const html = mdToHtml(md);
		const tbody = html.slice(html.indexOf("<tbody>"));
		const tds = tbody.match(/<td>/g) ?? [];
		assert.equal(tds.length, 2, "escaped pipe must not split the cell into two <td>s");
		assert.ok(html.includes("A | B and C"), "cell text un-escapes \\| to |");
	});

	test("fenced code blocks escape content, keep language class", () => {
		const md = "```mermaid\ngraph TD; A-->B\n```";
		const html = mdToHtml(md);
		assert.ok(html.includes('<pre><code class="language-mermaid">'));
		assert.ok(html.includes("graph TD; A--&gt;B"));
	});

	test("bullet and ordered lists", () => {
		const html = mdToHtml("- one\n- two\n\n1. first\n2. second");
		assert.ok(html.includes("<ul>"));
		assert.ok(html.includes("<li>one</li>"));
		assert.ok(html.includes("<li>two</li>"));
		assert.ok(html.includes("<ol>"));
		assert.ok(html.includes("<li>first</li>"));
		assert.ok(html.includes("<li>second</li>"));
	});

	test("HTML-unsafe input is escaped, never executed", () => {
		const html = mdToHtml("text with <script>alert(1)</script> inside");
		assert.ok(!html.includes("<script>"));
		assert.ok(html.includes("&lt;script&gt;"));
	});
});

// ---------------------------------------------------------------------------
// buildExportDefaultPath
// ---------------------------------------------------------------------------

describe("buildExportDefaultPath", () => {
	test("Doc/export/<project>/<Artifact>_<project>.<ext>", () => {
		assert.equal(
			buildExportDefaultPath("TodoApp", "prd", "md", "/tmp/x"),
			join("/tmp/x", "Doc", "export", "TodoApp", "PRD_TodoApp.md"),
		);
		assert.equal(
			buildExportDefaultPath("TodoApp", "testplan", "html", "/tmp/x"),
			join("/tmp/x", "Doc", "export", "TodoApp", "test-plan_TodoApp.html"),
		);
	});
});

// ---------------------------------------------------------------------------
// runExport — refusals + happy paths
// ---------------------------------------------------------------------------

const SEEDS: ReadonlyArray<{
	kind: ArtifactKind;
	envelope: ArtifactEnvelopeInput;
	payload: ArtifactPayload;
}> = [
	{ kind: "prd", envelope: env(), payload: PRD_PAYLOAD },
	{
		kind: "rtm",
		envelope: env({ stage: "building-rtm" }),
		payload: {
			rtmRow: [{ id: "TR-1", frRef: "FR-1", afRef: null, tcRef: null, phase: 1, targetSha256: "aa" }],
		},
	},
	{
		kind: "feasibility",
		envelope: env({ stage: "analyzing-feasibility" }),
		payload: {
			feasibilityDecision: {
				verdict: "build",
				language: "typescript",
				decidedBy: "user",
				at: "2026-09-22T00:00:00Z",
				webSearchConsent: null,
			},
			feasibilitySpike: [{ language: "typescript", passed: 1, resultRef: null }],
			reuseScan: [],
		},
	},
	{
		kind: "design",
		envelope: env({ stage: "designing" }),
		payload: {
			designModule: [{ id: "M-1", name: "Store" }],
			moduleSourceFr: [{ moduleId: "M-1", frId: "FR-1" }],
			adr: [{ id: "ADR-001", adrStatus: "accepted", options: "A;B", chosen: "B", rationale: "why" }],
			diagram: [{ id: "D-1", diagramKind: "context", mermaidText: "graph TD" }],
			approach: [{ moduleId: "M-1", tacticId: "t-wal" }],
		},
	},
	{
		kind: "atomic-functions",
		envelope: env({ stage: "analyzing-atomic-functions" }),
		payload: {
			atomicFunction: [
				{ id: "AF-1", name: "ReadRow", signature: "(id)", tier: "basic", criticality: "A", sil: "none", isLeaf: 1 },
			],
		},
	},
	{
		kind: "pseudocode",
		envelope: env({ stage: "writing-pseudocode" }),
		payload: {
			pseudocodeBlock: [{ id: "PB-1", afRef: "AF-1", contentHash: "ff00" }],
		},
	},
	{
		kind: "testplan",
		envelope: env({ stage: "planning-tests" }),
		payload: {
			testCase: [{ id: "TC-1", tcKind: "TC", strategyRef: null }],
			tcTrace: [{ tcId: "TC-1", targetKind: "fr", targetId: "FR-1" }],
		},
	},
	{
		kind: "development-order",
		envelope: env({ stage: "ordering-development" }),
		payload: {
			devStep: [{ id: "S-1", module: "Store" }],
			stepAf: [{ stepId: "S-1", afId: "AF-1" }],
			stepDep: [],
		},
	},
	{
		kind: "final-design",
		envelope: env({ stage: "finalizing-design" }),
		payload: {
			finalSection: [{ no: 1, title: "Overview", sourceArtifact: "design", sourceIds: '["M-1"]' }],
		},
	},
];

/**
 * Write + publish one deterministic seed per kind under run "r1".
 * @returns {void}
 */
function seedAll(): void {
	for (const seed of SEEDS) publishSeed(seed.kind, "r1", seed.envelope, seed.payload);
}

describe("runExport", () => {
	test("missing DB → refusal", () => {
		const result = runExport({
			dbPath: join(dir, "nope", "index.db"),
			runId: "r1",
			kind: "prd",
			version: 1,
			format: "md",
			outputPath: join(dir, "out.md"),
		});
		assert.equal(result.ok, false);
		assert.ok(result.problem!.includes("not found"));
	});

	test("absent artifact → refusal", () => {
		const result = runExport({
			dbPath: join(dir, "index.db"),
			runId: "ghost",
			kind: "prd",
			version: 1,
			format: "md",
			outputPath: join(dir, "out.md"),
		});
		assert.equal(result.ok, false);
		assert.ok(result.problem!.includes("no artifact"));
	});

	test("draft-only artifact → refusal (drafts never exported)", () => {
		writeArtifact(db, "prd", "draft-run", env(), PRD_PAYLOAD);
		const result = runExport({
			dbPath: join(dir, "index.db"),
			runId: "draft-run",
			kind: "prd",
			version: 1,
			format: "md",
			outputPath: join(dir, "out-design.md"),
		});
		assert.equal(result.ok, false);
		assert.ok(result.problem!.includes("not published"));
	});

	test("version mismatch → refusal", () => {
		seedAll();
		const result = runExport({
			dbPath: join(dir, "index.db"),
			runId: "r1",
			kind: "prd",
			version: 99,
			format: "md",
			outputPath: join(dir, "out9.md"),
		});
		assert.equal(result.ok, false);
		assert.ok(result.problem!.includes("version changed"));
	});

	test("md export: happy path + counts + deterministic bytes", () => {
		seedAll();
		const out = join(dir, "PRD_r1.md");
		const result = runExport({
			dbPath: join(dir, "index.db"),
			runId: "r1",
			kind: "prd",
			version: 1,
			format: "md",
			outputPath: out,
		});
		assert.equal(result.ok, true, result.problem);
		assert.equal(result.path, out);
		assert.ok(result.counts!.fr === 2);
		assert.ok(result.counts!.nfr === 1);
		const bytes1 = readFileSync(out, "utf8");
		const bytes2 = readFileSync(
			runExport({
				dbPath: join(dir, "index.db"),
				runId: "r1",
				kind: "prd",
				version: 1,
				format: "md",
				outputPath: join(dir, "PRD_r1_copy.md"),
			}).path!,
			"utf8",
		);
		assert.equal(bytes1, bytes2, "G5: two runs → identical bytes");
		assert.ok(bytes1.includes("version: 1"));
	});

	test("yaml export is byte-identical to exportArtifactYaml (RES-1)", () => {
		seedAll();
		const out = join(dir, "RTM_r1.yaml");
		const result = runExport({
			dbPath: join(dir, "index.db"),
			runId: "r1",
			kind: "rtm",
			version: 1,
			format: "yaml",
			outputPath: out,
		});
		assert.equal(result.ok, true, result.problem);
		assert.equal(readFileSync(out, "utf8"), exportArtifactYaml(db, "r1", "rtm"));
	});

	test("html export contains converted tables", () => {
		seedAll();
		const out = join(dir, "TR_r1.html");
		const result = runExport({
			dbPath: join(dir, "index.db"),
			runId: "r1",
			kind: "rtm",
			version: 1,
			format: "html",
			outputPath: out,
		});
		assert.equal(result.ok, true, result.problem);
		const html = readFileSync(out, "utf8");
		assert.ok(html.includes("<!DOCTYPE html>"));
		assert.ok(html.includes("<table>"));
		assert.ok(html.includes("<h1>RTM (version 1)</h1>"));
	});

	test("overwrite contract: existing file refused without overwrite:true", () => {
		seedAll();
		const out = join(dir, "exists.md");
		const first = runExport({
			dbPath: join(dir, "index.db"),
			runId: "r1",
			kind: "prd",
			version: 1,
			format: "md",
			outputPath: out,
		});
		assert.equal(first.ok, true, first.problem);
		const second = runExport({
			dbPath: join(dir, "index.db"),
			runId: "r1",
			kind: "prd",
			version: 1,
			format: "md",
			outputPath: out,
		});
		assert.equal(second.ok, false);
		assert.ok(second.problem!.includes("already exists"));
		const third = runExport({
			dbPath: join(dir, "index.db"),
			runId: "r1",
			kind: "prd",
			version: 1,
			format: "md",
			outputPath: out,
			overwrite: true,
		});
		assert.equal(third.ok, true, third.problem);
		assert.ok(existsSync(out));
	});

	test("per-kind smoke: every kind exports md without error", () => {
		seedAll();
		for (const kind of KIND_ORDER) {
			const out = join(dir, `smoke_${kind}.md`);
			const result = runExport({
				dbPath: join(dir, "index.db"),
				runId: "r1",
				kind,
				version: 1,
				format: "md",
				outputPath: out,
			});
			assert.equal(result.ok, true, `${kind}: ${result.problem}`);
			assert.ok(readFileSync(out, "utf8").length > 0);
		}
	});

	test("every format is accepted by the type surface", () => {
		const formats: ExportFormat[] = ["md", "yaml", "html"];
		assert.equal(formats.length, 3);
	});

	test("v1.2 D3: runExport + cwd materializes the wireframe sidecar (fresh → no warnings)", () => {
		const storePath = buildStoreDbPath("HeadProj", dir);
		mkdirSync(dirname(storePath), { recursive: true });
		const sdb = openStoreDb(storePath);
		writeArtifact(
			sdb,
			"design",
			"r-design",
			env({ stage: "designing", version: 3 }),
			{ diagram: [{ id: "WF-1", diagramKind: "wireframe", mermaidText: "flowchart TD\n  A-->B" }] },
		);
		publishArtifact(sdb, "r-design", "design");
		closeStoreDb(sdb);

		const result = runExport({
			dbPath: storePath,
			runId: "r-design",
			kind: "design",
			version: 3,
			format: "yaml",
			outputPath: join(dir, "head-design.yaml"),
			cwd: dir,
		});
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.equal(result.warnings, undefined, "fresh sidecar → no warnings");
		const sidecar = join(dir, "Doc", "design", "wireframe_HeadProj.md");
		assert.ok(existsSync(sidecar), "sidecar materialized");
		const text = readFileSync(sidecar, "utf8");
		assert.ok(text.includes("artifact: wireframe"));
		assert.ok(text.includes("version: 3"));
		assert.ok(text.includes("```mermaid"));
	});

	test("v1.2 D3: existing sidecar → runExport ok with a skip warning (warnings propagation)", () => {
		const storePath = buildStoreDbPath("HeadProj2", dir);
		mkdirSync(dirname(storePath), { recursive: true });
		const sdb = openStoreDb(storePath);
		writeArtifact(
			sdb,
			"design",
			"r-design",
			env({ stage: "designing", version: 1 }),
			{ diagram: [{ id: "WF-1", diagramKind: "wireframe", mermaidText: "flowchart TD\n  A-->B" }] },
		);
		publishArtifact(sdb, "r-design", "design");
		closeStoreDb(sdb);
		const sidecar = join(dir, "Doc", "design", "wireframe_HeadProj2.md");
		mkdirSync(dirname(sidecar), { recursive: true });
		writeFileSync(sidecar, "MARKER", "utf8");

		const result = runExport({
			dbPath: storePath,
			runId: "r-design",
			kind: "design",
			version: 1,
			format: "yaml",
			outputPath: join(dir, "head-design2.yaml"),
			cwd: dir,
		});
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.ok(result.warnings && result.warnings.length > 0, "skip warning propagated");
		assert.match(result.warnings[0]!, /not overwritten/);
		assert.equal(readFileSync(sidecar, "utf8"), "MARKER", "existing file untouched");
	});
});
