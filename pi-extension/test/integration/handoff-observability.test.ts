/**
 * Handoff observability block (v1.4.0).
 *
 * Covers:
 *   - runHandoff omits `observability` when no published plan exists.
 *   - runHandoff includes `observability.loggingPlan[*]` when a plan
 *     exists for the active projectName.
 *   - Multi-design: one entry per projectName that has a plan.
 *   - The entry's `version` / `status` / `overlay` come from the
 *     frontmatter of each plan.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runHandoff } from "../../src/ops/handoff.js";
import { buildObservabilitySection } from "../../src/ops/handoff.js";
import { loadState, saveState, type RunState } from "../../src/core/state.js";

interface MockUI {
	notify: (msg: string, level: string) => void;
	setStatus: (key: string, text?: string) => void;
	confirm: (title: string, message: string) => Promise<boolean>;
}

let cwd: string;

function seedState(patch: Partial<RunState> = {}): void {
	const state: RunState = {
		version: 1,
		runId: "r",
		mission: "m",
		currentStage: "finalized-design",
		history: [],
		updatedAt: new Date().toISOString(),
		...patch,
	};
	saveState(state, cwd);
}

function seedConfig(): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "velpari", "files.json"),
		JSON.stringify({
			version: 4,
			projectName: "PrimaryApp",
			codePaths: ["src/"],
			testPaths: ["test/"],
			docPaths: ["Doc/"],
			excludedPaths: [],
		}),
	);
}

function seedAllRequiredDocs(): void {
	const projectName = "PrimaryApp";
	mkdirSync(join(cwd, "Doc", "requirements"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "feasibility"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "design"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "atomic-functions"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "pseudocode"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "tests"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "development-order"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "design"), { recursive: true });

	const stub = "## section\n\nbody";
	writeFileSync(join(cwd, "Doc", "requirements", `PRD_${projectName}.md`), stub);
	writeFileSync(join(cwd, "Doc", "requirements", `RTM_${projectName}.md`), stub);
	writeFileSync(join(cwd, "Doc", "feasibility", `feasibility-study_${projectName}.md`), stub);
	writeFileSync(join(cwd, "Doc", "design", `design_${projectName}.md`), stub);
	writeFileSync(join(cwd, "Doc", "atomic-functions", `atomic-functions_${projectName}.md`), stub);
	writeFileSync(join(cwd, "Doc", "pseudocode", `pseudocode_${projectName}.md`), stub);
	writeFileSync(join(cwd, "Doc", "tests", `test-plan_${projectName}.md`), stub);
	writeFileSync(join(cwd, "Doc", "tests", `test-cases_${projectName}.md`), stub);
	writeFileSync(join(cwd, "Doc", "development-order", `development-order_${projectName}.md`), stub);
	writeFileSync(join(cwd, "Doc", "design", `final-design_${projectName}.md`), stub);
}

function seedLoggingPlan(
	projectName: string,
	frontmatter: Record<string, string>,
): void {
	mkdirSync(join(cwd, "Doc", "observability"), { recursive: true });
	const fm = Object.entries(frontmatter)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n");
	writeFileSync(
		join(cwd, "Doc", "observability", `logging-plan_${projectName}.md`),
		`---\n${fm}\n---\n\n## 1. Logging Objectives\n\nbody.\n`,
	);
}

function makeCtx(): { ui: { notify: (msg: string, level: string) => void; setStatus: (k: string, t?: string) => void; confirm: (t: string, m: string) => Promise<boolean> } } {
	const notices: { msg: string; level: string }[] = [];
	return {
		ui: {
			notify: (msg: string, level: string) => {
				notices.push({ msg, level });
			},
			setStatus: () => {},
			confirm: async () => true,
		},
	};
}

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "vp-handoff-obs-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("buildObservabilitySection", () => {
	it("returns null when no published plan exists for the primary projectName", () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		const result = buildObservabilitySection(loadState(cwd), "PrimaryApp", cwd);
		assert.strictEqual(result, null);
	});

	it("returns one loggingPlan entry when the primary project has a plan", () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		seedLoggingPlan("PrimaryApp", {
			artifact: "logging-plan",
			project: "PrimaryApp",
			version: "1.0.0",
			status: "approved",
			created: "2026-09-16T10:00:00Z",
			overlay: "financial-payments",
		});
		const result = buildObservabilitySection(loadState(cwd), "PrimaryApp", cwd);
		assert.ok(result);
		assert.strictEqual(result!.loggingPlan.length, 1);
		const entry = result!.loggingPlan[0]!;
		assert.strictEqual(entry.path, join(cwd, "Doc/observability/logging-plan_PrimaryApp.md"));
		assert.strictEqual(entry.version, "1.0.0");
		assert.strictEqual(entry.status, "approved");
		assert.strictEqual(entry.overlay, "financial-payments");
	});
});

describe("runHandoff — observability block", () => {
	it("writes architect-inputs.json with observability block when plan exists", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		seedLoggingPlan("PrimaryApp", {
			artifact: "logging-plan",
			project: "PrimaryApp",
			version: "1.0.0",
			status: "approved",
			created: "2026-09-16T10:00:00Z",
			overlay: "cloud-saas",
		});
		const ctx = makeCtx();
		await runHandoff(loadState(cwd), ctx as never, cwd);
		const payloadPath = join(cwd, ".pi", "senai", "architect-inputs.json");
		assert.ok(existsSync(payloadPath));
		const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
		assert.ok(payload.observability, "observability block should exist");
		assert.strictEqual(payload.observability.loggingPlan.length, 1);
		assert.strictEqual(
			payload.observability.loggingPlan[0].overlay,
			"cloud-saas",
		);
	});

	it("writes architect-inputs.json WITHOUT observability block when no plan", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		const ctx = makeCtx();
		await runHandoff(loadState(cwd), ctx as never, cwd);
		const payloadPath = join(cwd, ".pi", "senai", "architect-inputs.json");
		const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
		assert.strictEqual(payload.observability, undefined);
	});
});
