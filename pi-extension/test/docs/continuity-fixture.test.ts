/**
 * Continuity fixture completeness (N25 / Phase E subphase 2.3).
 *
 * The dry-run driver (`scripts/e2e-continuity-dryrun.mjs`) assumes the
 * fixture under `Doc/test-fixtures/continuity/` is gate-shaped BEFORE any
 * chain run starts — a drift here would otherwise surface as a confusing
 * chain failure deep inside the driver. This test validates every fixture
 * contract statically, against the SAME validators the publish gate uses:
 *
 *   - config: shipped default (no `velpari` key → DB-only publish)
 *   - brainstorm notes: guardNotesContent (7 required sections)
 *   - PRD: validatePsrs (20 sections + FR/NFR tables)
 *   - RTM payload: targetSha256 == extractRequirementFingerprints(PRD)
 *     for every requirement id (suspect/orphan/unknown-id are errors)
 *   - feasibility: validateFeasibilityDoc (13 sections + verdict word)
 *   - design: gateADR + gateDesignReadiness (§0/§0.4/§5 + C4 + ADR-001)
 *   - payloads: loadStagePayload for all 9 kinds (rows mirror ROWS_BY_KIND)
 *   - id coverage: AF/FR tokens present downstream (pseudocode, test-cases,
 *     development-order)
 *   - ledger: expected-failures.json names N24-01 + N24-13
 *
 * READ-ONLY: no fixture file is modified.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePsrs } from "../../src/core/psrs.js";
import { extractRequirementFingerprints } from "../../src/core/fingerprints.js";
import { validateFeasibilityDoc } from "../../src/core/feasibility-doc.js";
import { guardNotesContent } from "../../src/stages/brainstorm/guard.js";
import { gateADR } from "../../src/doctor/checks/adr.js";
import { gateDesignReadiness } from "../../src/doctor/checks/design-readiness.js";
import { loadStagePayload, stagePayloadPath } from "../../src/ops/stage-payloads.js";
import type { ArtifactKind } from "../../src/io/store.js";
import { extractIds } from "../../src/core/id-coverage.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
	join(process.cwd(), "Doc", "test-fixtures", "continuity"),
	join(HERE, "..", "..", "..", "..", "Doc", "test-fixtures", "continuity"),
	join(HERE, "..", "..", "..", "Doc", "test-fixtures", "continuity"),
];

/** Absolute fixture root (repo checkout), or null when not found. */
function fixtureRoot(): string | null {
	for (const c of CANDIDATES) {
		if (existsSync(join(c, "README.md"))) return c;
	}
	return null;
}

const root = fixtureRoot();

/** Read one fixture file as UTF-8; asserts it exists first. */
function read(rel: string): string {
	assert.ok(root, `fixture root not found (cwd=${process.cwd()})`);
	const abs = join(root, rel);
	assert.ok(existsSync(abs), `fixture file missing: ${rel}`);
	return readFileSync(abs, "utf8");
}

/** workingDir → payload kind, mirroring ops/stage-payloads.ts KIND_BY_WORKING_DIR. */
const KINDS: ReadonlyArray<readonly [string, ArtifactKind]> = [
	["prd", "prd"],
	["rtm", "rtm"],
	["feasibility", "feasibility"],
	["design", "design"],
	["atomic-functions", "atomic-functions"],
	["pseudocode", "pseudocode"],
	["tests", "testplan"],
	["development-order", "development-order"],
	["final-design", "final-design"],
];

describe("fixture: continuity dry-run fixture is gate-shaped", () => {
	it("fixture root resolves and all expected files exist", () => {
		assert.ok(root, `fixture root not found; tried: ${CANDIDATES.join(", ")}`);
		const expected = [
			"README.md",
			"config/files.json",
			"expected-failures.json",
			"brainstorm/brainstorm-notes.md",
			"prd/PRD_ContinuityApp.md",
			"rtm/RTM_ContinuityApp.md",
			"feasibility/feasibility-study_ContinuityApp.md",
			"design/design_ContinuityApp.md",
			"atomic-functions/atomic-functions_ContinuityApp.md",
			"pseudocode/pseudocode_ContinuityApp.md",
			"tests/test-plan_ContinuityApp.md",
			"tests/test-cases_ContinuityApp.md",
			"development-order/development-order_ContinuityApp.md",
			"final-design/final-design_ContinuityApp.md",
		];
		for (const rel of expected) {
			assert.ok(existsSync(join(root!, rel)), `missing fixture file: ${rel}`);
		}
		for (const [workingDir, kind] of KINDS) {
			assert.ok(
				existsSync(join(root!, workingDir, "payload", `${kind}-payload.json`)),
				`missing payload: ${workingDir}/payload/${kind}-payload.json`,
			);
		}
	});

	it("config is the shipped default (DB-only; markdown writes OFF)", () => {
		const cfg = JSON.parse(read("config/files.json")) as Record<string, unknown>;
		assert.equal(cfg.version, 4);
		assert.equal(cfg.projectName, "ContinuityApp");
		assert.equal(cfg.velpari, undefined, "fixture must NOT set the velpari markdownWrites opt-in");
	});

	it("brainstorm notes pass guardNotesContent", () => {
		const notes = read("brainstorm/brainstorm-notes.md");
		const result = guardNotesContent(notes);
		assert.equal(result.ok, true, `notes guard failed: ${result.reason ?? ""}`);
	});

	it("PRD working copy passes validatePsrs", () => {
		const result = validatePsrs(read("prd/PRD_ContinuityApp.md"));
		assert.equal(result.ok, true, `PSRS issues: ${result.issues.map((i) => `${i.code}: ${i.message}`).join("; ")}`);
	});

	it("RTM payload fingerprints match the PRD requirement substance exactly", () => {
		const fingerprints = extractRequirementFingerprints(read("prd/PRD_ContinuityApp.md"));
		assert.equal(fingerprints.size, 5, "expected FR-01..03 + NFR-01..02 fingerprints");
		const payload = JSON.parse(read("rtm/payload/rtm-payload.json")) as {
			rows: { rtmRow: Array<{ id: string; phase: number; targetSha256: string }> };
		};
		const rowIds = payload.rows.rtmRow.map((r) => r.id).sort();
		assert.deepEqual(
			rowIds,
			["FR-01", "FR-02", "FR-03", "NFR-01", "NFR-02"],
			"RTM rows must cover every PRD requirement (orphan is a gate error)",
		);
		for (const row of payload.rows.rtmRow) {
			const expected = fingerprints.get(row.id);
			assert.ok(expected, `no fingerprint for ${row.id}`);
			assert.equal(
				row.targetSha256,
				expected,
				`targetSha256 mismatch for ${row.id} — PRD substance changed without updating the RTM payload`,
			);
		}
	});

	it("W4 dual-write: PRD payload mirrors NFR ids into rows.fr (rtm_row FK)", () => {
		const payload = JSON.parse(read("prd/payload/prd-payload.json")) as {
			rows: { fr: Array<{ id: string; textHash: string }>; nfr: Array<{ id: string; textHash: string }> };
		};
		for (const nfr of payload.rows.nfr) {
			const mirrored = payload.rows.fr.find((fr) => fr.id === nfr.id);
			assert.ok(
				mirrored,
				`W4: NFR id ${nfr.id} must also be in rows.fr — rtm_row.fr_ref FKs to fr, so NFR RTM rows need an fr parent (N24-16)`,
			);
			assert.equal(mirrored.textHash, nfr.textHash, `W4 mirror textHash mismatch for ${nfr.id}`);
		}
	});

	it("feasibility study passes validateFeasibilityDoc", () => {
		const result = validateFeasibilityDoc(read("feasibility/feasibility-study_ContinuityApp.md"));
		assert.equal(
			result.ok,
			true,
			`feasibility issues: ${result.issues.map((i) => `${i.code}: ${i.message}`).join("; ")}`,
		);
	});

	it("design passes gateADR + gateDesignReadiness", () => {
		const content = read("design/design_ContinuityApp.md");
		assert.deepEqual(gateADR(content), [], "ADR gate must be clean");
		assert.deepEqual(gateDesignReadiness(content), [], "design readiness gate (§0/§0.4/§5/C4) must be clean");
	});

	it("every payload validates against its kind schema", () => {
		for (const [workingDir, kind] of KINDS) {
			const workingDirPath = join(root!, workingDir);
			const result = loadStagePayload(workingDirPath, kind, {
				// DB-only default: no published PRD markdown exists yet, so the
				// G8 mirror hash is not required (approve passes the same flag).
				requirePrdFileHash: false,
			});
			assert.equal(result.ok, true, `payload invalid for ${workingDir}: ${result.problems.join("; ")}`);
			assert.ok(result.envelope, `${workingDir}: envelope missing`);
			assert.ok(result.envelope!.version >= 1, `${workingDir}: envelope.version must be >= 1`);
		}
	});

	it("payload files sit at the convention path stagePayloadPath() computes", () => {
		for (const [workingDir, kind] of KINDS) {
			const expected = stagePayloadPath(join(root!, workingDir), kind);
			assert.ok(existsSync(expected), `stagePayloadPath mismatch for ${workingDir}: ${expected}`);
		}
	});

	it("downstream id-coverage tokens are present (AF + FR ids)", () => {
		const pseudo = read("pseudocode/pseudocode_ContinuityApp.md");
		for (const af of ["AF-01", "AF-02", "AF-03"]) {
			assert.ok(pseudo.includes(af), `pseudocode must reference ${af}`);
		}
		const testCases = read("tests/test-cases_ContinuityApp.md");
		const refIds = new Set(extractIds(testCases, ["FR", "NFR", "AF"]));
		for (const id of ["FR-01", "FR-02", "FR-03", "AF-01", "AF-02", "AF-03"]) {
			assert.ok(refIds.has(id), `test-cases must reference ${id} (Traces coverage)`);
		}
		const devOrder = read("development-order/development-order_ContinuityApp.md");
		const afRefs = extractIds(devOrder, ["AF"]);
		for (const af of ["AF-01", "AF-02", "AF-03"]) {
			assert.ok(afRefs.includes(af), `development-order must list ${af}`);
		}
		assert.equal(afRefs.length, new Set(afRefs).size, "development-order must not duplicate AF refs (D2)");
	});

	it("design carries the id-coverage cells for every FR and NFR", () => {
		const design = read("design/design_ContinuityApp.md");
		const moduleBody = section(design, "Module Breakdown");
		const qaBody = section(design, "Quality Attribute Scenarios");
		const frRefs = new Set(extractIds(moduleBody, ["FR"]));
		for (const fr of ["FR-01", "FR-02", "FR-03"]) {
			assert.ok(frRefs.has(fr), `design §1 Source FRs must reference ${fr}`);
		}
		const nfrRefs = new Set(extractIds(qaBody, ["NFR"]));
		for (const nfr of ["NFR-01", "NFR-02"]) {
			assert.ok(nfrRefs.has(nfr), `design §5 QA table must reference ${nfr}`);
		}
	});

	it("expected-failures ledger lists the filed Phase-1 blockers", () => {
		const ledger = JSON.parse(read("expected-failures.json")) as {
			ledger: Array<{ id: string; summary: string }>;
		};
		const ids = ledger.ledger.map((e) => e.id);
		assert.deepEqual(ids.sort(), [
			"N24-01",
			"N24-13",
			"N24-14",
			"N24-15",
			"N24-16",
			"N24-17",
			"N24-18",
			"N24-19",
			"N24-20",
			"N24-21",
			"N24-22",
		]);
		for (const entry of ledger.ledger) {
			assert.ok(entry.summary.length > 20, `ledger entry ${entry.id} needs a summary`);
		}
	});
});

/** Body of the first `## … <name>` section (heading match, gate-style). */
function section(markdown: string, name: string): string {
	const re = new RegExp(`^##\\s+\\d*\\.?\\s*${name}\\b.*$`, "m");
	const match = re.exec(markdown);
	if (!match) return "";
	const rest = markdown.slice(match.index + match[0].length);
	const next = /^\n##\s/m.exec(rest);
	return next ? rest.slice(0, next.index) : rest;
}
