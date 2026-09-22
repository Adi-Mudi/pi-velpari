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
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
		publishSeed("rtm", "r1", { ...env(), stage: "building-rtm" }, {
			rtmRow: [{ id: "TR-1", frRef: "FR-1", afRef: null, tcRef: null, phase: 1, targetSha256: "aa" }],
		});
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
		publishSeed("prd", "r2", {
			version: 2,
			stage: "drafting-prd",
			generatedAt: "2026-09-22T12:00:00Z",
		}, PRD_PAYLOAD);
		// Draft for a third run — excluded.
		writeArtifact(db, "prd", "r3", env(), PRD_PAYLOAD);
		const versions = listPublishedVersions(db, "prd");
		assert.deepEqual(versions.map((v) => v.runId), ["r2", "r1"]);
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
			atomicFunction: [{ id: "AF-1", name: "ReadRow", signature: "(id) => row", tier: "basic", criticality: "A", sil: "none", isLeaf: 1 }],
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
		});
		assert.ok(md.includes("---\nartifact: prd\nrunId: r1\nstage: drafting-prd\nversion: 3\ngeneratedAt: 2026-09-22T00:00:00Z\n---"));
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
	{ kind: "rtm", envelope: env({ stage: "building-rtm" }), payload: {
		rtmRow: [{ id: "TR-1", frRef: "FR-1", afRef: null, tcRef: null, phase: 1, targetSha256: "aa" }],
	} },
	{ kind: "feasibility", envelope: env({ stage: "analyzing-feasibility" }), payload: {
		feasibilityDecision: { verdict: "build", language: "typescript", decidedBy: "user", at: "2026-09-22T00:00:00Z", webSearchConsent: null },
		feasibilitySpike: [{ language: "typescript", passed: 1, resultRef: null }],
		reuseScan: [],
	} },
	{ kind: "design", envelope: env({ stage: "designing" }), payload: {
		designModule: [{ id: "M-1", name: "Store" }],
		moduleSourceFr: [{ moduleId: "M-1", frId: "FR-1" }],
		adr: [{ id: "ADR-001", adrStatus: "accepted", options: "A;B", chosen: "B", rationale: "why" }],
		diagram: [{ id: "D-1", diagramKind: "context", mermaidText: "graph TD" }],
		approach: [{ moduleId: "M-1", tacticId: "t-wal" }],
	} },
	{ kind: "atomic-functions", envelope: env({ stage: "analyzing-atomic-functions" }), payload: {
		atomicFunction: [{ id: "AF-1", name: "ReadRow", signature: "(id)", tier: "basic", criticality: "A", sil: "none", isLeaf: 1 }],
	} },
	{ kind: "pseudocode", envelope: env({ stage: "writing-pseudocode" }), payload: {
		pseudocodeBlock: [{ id: "PB-1", afRef: "AF-1", contentHash: "ff00" }],
	} },
	{ kind: "testplan", envelope: env({ stage: "planning-tests" }), payload: {
		testCase: [{ id: "TC-1", tcKind: "TC", strategyRef: null }],
		tcTrace: [{ tcId: "TC-1", targetKind: "fr", targetId: "FR-1" }],
	} },
	{ kind: "development-order", envelope: env({ stage: "ordering-development" }), payload: {
		devStep: [{ id: "S-1", module: "Store" }],
		stepAf: [{ stepId: "S-1", afId: "AF-1" }],
		stepDep: [],
	} },
	{ kind: "final-design", envelope: env({ stage: "finalizing-design" }), payload: {
		finalSection: [{ no: 1, title: "Overview", sourceArtifact: "design", sourceIds: '["M-1"]' }],
	} },
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
		assert.equal(
			readFileSync(out, "utf8"),
			exportArtifactYaml(db, "r1", "rtm"),
		);
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
});
