/**
 * Fix-plan artifact tests (DGR P1 — lane 1a, D3).
 *
 * Covers:
 *   - `buildFixPlan` mirrors the actionable set 1:1 (ok items excluded);
 *   - each item carries the D7 impact and the D8 action;
 *   - the summary counts actions;
 *   - `writeFixPlan` writes the `.md` + `.json` pair, `schemaVersion === 1`.
 */

import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiagnosticReport } from "../../src/doctor/_types.js";
import { listActionableItems } from "../../src/doctor/fix-dispatch.js";
import {
	FIX_PLAN_JSON_PATH,
	FIX_PLAN_MD_PATH,
	FIX_PLAN_SCHEMA_VERSION,
	buildFixPlan,
	writeFixPlan,
	type FixPlanJson,
} from "../../src/doctor/fix-plan.js";

/** Temp dirs created in this file; removed at module teardown. */
const tempDirs: string[] = [];

after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const REPORT: DiagnosticReport = {
	ok: false,
	summary: { ok: 1, warning: 1, error: 1, info: 0 },
	sections: [
		{
			id: "config",
			title: "Config",
			items: [{ status: "error", message: "Config broken", suggestion: "Run /velpari-configure-inputs" }],
		},
		{
			id: "store-db-integrity",
			title: "Store DB integrity",
			items: [{ status: "warning", message: "Hash chain broken", suggestion: "Restore from backup" }],
		},
		{ id: "environment", title: "Environment", items: [{ status: "ok", message: "Fine" }] },
	],
};

const VIEW = { items: listActionableItems(REPORT) };

// ---------------------------------------------------------------------------
// buildFixPlan
// ---------------------------------------------------------------------------

describe("buildFixPlan", () => {
	const plan = buildFixPlan(VIEW, { projectName: "demo", generatedAt: "2026-10-13T00:00:00.000Z" });

	it("mirrors the actionable set (ok items excluded)", () => {
		assert.equal(plan.json.items.length, 2);
		assert.deepEqual(
			plan.json.items.map((item) => item.message),
			["Config broken", "Hash chain broken"],
		);
	});

	it("stamps schemaVersion 1 and the injected metadata", () => {
		assert.equal(plan.json.schemaVersion, FIX_PLAN_SCHEMA_VERSION);
		assert.equal(plan.json.projectName, "demo");
		assert.equal(plan.json.generatedAt, "2026-10-13T00:00:00.000Z");
	});

	it("carries the D7 impact and the D8 action per item", () => {
		for (const item of plan.json.items) {
			assert.ok(item.impact.trim().length > 0, "every plan item must carry an impact");
			assert.ok(
				["auto-safe", "agentic", "manual", "escalate"].includes(item.action),
				`unexpected action ${item.action}`,
			);
			assert.equal(item.include, true, "items default to included");
		}
		assert.equal(plan.json.items[0]?.action, "manual", "config-broken defaults to manual");
		assert.equal(plan.json.items[1]?.action, "escalate", "store-integrity escalates to a human");
	});

	it("counts actions in the summary", () => {
		assert.equal(plan.json.summary.total, 2);
		assert.equal(plan.json.summary.manual, 1);
		assert.equal(plan.json.summary.escalate, 1);
		assert.equal(plan.json.summary.include, 2);
	});

	it("renders the impact and action into the markdown body", () => {
		assert.match(plan.markdown, /^# Velpari Doctor — Fix Plan/m);
		assert.match(plan.markdown, /- \*\*Impact:\*\* /);
		assert.match(plan.markdown, /- \*\*Action:\*\* escalate/);
	});
});

// ---------------------------------------------------------------------------
// writeFixPlan
// ---------------------------------------------------------------------------

describe("writeFixPlan", () => {
	it("writes the markdown + JSON pair under .IDE_Plans/velpari/", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-fix-plan-"));
		tempDirs.push(cwd);
		const plan = buildFixPlan(VIEW, { projectName: "demo", generatedAt: "2026-10-13T00:00:00.000Z" });
		const result = writeFixPlan(cwd, plan);

		assert.equal(result.markdownPath, join(cwd, FIX_PLAN_MD_PATH));
		assert.equal(result.jsonPath, join(cwd, FIX_PLAN_JSON_PATH));
		assert.ok(existsSync(result.markdownPath), "markdown twin must exist");
		assert.ok(existsSync(result.jsonPath), "json twin must exist");

		const onDisk = JSON.parse(readFileSync(result.jsonPath, "utf8")) as FixPlanJson;
		assert.equal(onDisk.schemaVersion, 1);
		assert.equal(onDisk.items.length, 2);
		assert.match(readFileSync(result.markdownPath, "utf8"), /# Velpari Doctor — Fix Plan/);
	});

	it("handles a view with no actionable items", () => {
		const plan = buildFixPlan({ items: [] }, { projectName: "demo", generatedAt: "2026-10-13T00:00:00.000Z" });
		assert.equal(plan.json.items.length, 0);
		assert.match(plan.markdown, /_No actionable items\._/);
	});
});
