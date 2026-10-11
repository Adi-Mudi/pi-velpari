/**
 * Doctor optimization (P0–P3) — consolidated end-to-end acceptance (subphase 3.4).
 *
 * ONE deterministic test file that pins the four optimization outcomes
 * together against the real `runDoctor(cwd)` plus the `safeSection` guard:
 *
 *   1. correctness (P0)  — the `Action items` callout is render-only
 *      (`--quiet` only, never in `report.sections`); `report.summary`
 *      counts each real section exactly once.
 *   2. scope (P1a)       — no dead-package-entry finding survives, and the
 *      `pi`-binary probe is gone (Velpari-only scope).
 *   3. strict (P1b)      — bundled-scout-missing contributes 0 warnings and
 *      at most one `info` line (custom mappings stay `error`).
 *   4. hardened (P2)     — `safeSection` turns a throwing check into a
 *      rendered `Check failed` error section, never a crash.
 *
 * Modeled on `doctor-upgrade-acceptance.test.ts`. Self-contained and
 * deterministic: an empty temp project root (no `.pi/agents/`) is the
 * fixture. See `.IDE_Plans/doctor-optimization_phase3_plan_20261011_1545_v1.0.md`.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDoctor } from "../../src/doctor/index.js";
import { renderReport } from "../../src/doctor/report.js";
import { sectionId } from "../../src/doctor/report-schema.js";
import { safeSection } from "../../src/doctor/safe-section.js";
import type { DiagnosticStatus } from "../../src/doctor/_types.js";

/** Every status the summary tallies. */
const STATUSES: DiagnosticStatus[] = ["ok", "warning", "error", "info"];

/** Stable section title owned by `checkScoutAgentsSection`. */
const SCOUT_SECTION_TITLE = "Scout agents (.pi/agents/)";

/** The one aggregated bundled-scout line (D3, R-STRICT). */
const BUNDLED_MISSING = /bundled scout agent\(s\) not yet installed/;

/** Scope regex — the removed dead-package-entry finding must not reappear. */
const DEAD_PACKAGE = /dead[- ]package|dead[- ]entry|package entry/i;

/** The removed `pi`-binary probe message. */
const PI_BINARY = /pi binary not found/i;

let tmpDir: string;
let prevCwd: string;

beforeEach(() => {
	prevCwd = process.cwd();
	// Empty project root: no agents.json, no .pi/agents/ → every bundled
	// scout is "not yet installed" (the aggregated-info path).
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-doctor-optimization-"));
});

afterEach(() => {
	process.chdir(prevCwd);
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("Doctor optimization (P0–P3) — consolidated acceptance", () => {
	it("1. correctness: summary counts real sections once; Action items is render-only", () => {
		const report = runDoctor(tmpDir);

		// The derived callout is never stored in the real sections.
		assert.ok(
			!report.sections.some((section) => sectionId(section) === "action-items"),
			"the derived Action-items callout must never be stored in report.sections",
		);

		// The summary is exactly the tally of the real sections, per status.
		const tally: Record<DiagnosticStatus, number> = { ok: 0, warning: 0, error: 0, info: 0 };
		for (const section of report.sections) {
			for (const item of section.items) tally[item.status]++;
		}
		for (const status of STATUSES) {
			assert.equal(
				report.summary[status],
				tally[status],
				`summary.${status} must equal the real-section tally (no double-count)`,
			);
		}

		// The callout exists only at render time, and only in the quiet view.
		const quiet = renderReport(report, { quiet: true });
		assert.match(quiet, /## Action items/, "the quiet render carries the Action-items callout");
		assert.ok(!quiet.includes("## Scout agents"), "the quiet render is header + summary + Action items only");
		const full = renderReport(report);
		assert.ok(!full.includes("## Action items"), "the default (full) render must not inject the derived callout");
	});

	it("2. scope: no dead-package-entry finding and no pi-binary probe", () => {
		const report = runDoctor(tmpDir);
		for (const section of report.sections) {
			for (const item of section.items) {
				assert.ok(!DEAD_PACKAGE.test(item.message), `stale dead-package finding: ${item.message}`);
				assert.ok(!PI_BINARY.test(item.message), `stale pi-binary finding: ${item.message}`);
			}
		}
	});

	it("3. strict: bundled scouts contribute 0 warnings and at most 1 info line", () => {
		const report = runDoctor(tmpDir);
		const section = report.sections.find((s) => s.title === SCOUT_SECTION_TITLE);
		assert.ok(section, `expected the "${SCOUT_SECTION_TITLE}" section`);

		const warnings = section.items.filter((item) => item.status === "warning");
		assert.equal(
			warnings.length,
			0,
			`bundled-scout-missing must not warn (got: ${warnings.map((w) => w.message).join(" | ")})`,
		);

		const bundledInfo = section.items.filter((item) => item.status === "info" && BUNDLED_MISSING.test(item.message));
		assert.ok(
			bundledInfo.length <= 1,
			`bundled-scout-missing must aggregate to at most one info line (got ${bundledInfo.length})`,
		);
	});

	it("4. hardened: safeSection renders one Check failed error section on a throw", () => {
		const section = safeSection(() => {
			throw new Error("boom");
		});
		assert.equal(section.title, "Check failed");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "error");
		assert.match(section.items[0]?.message ?? "", /boom/);
	});
});
