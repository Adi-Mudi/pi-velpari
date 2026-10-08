/**
 * Design stage entry path tests (gap #8 from coverage baseline).
 *
 * Tests the two exported building blocks of `stages/design.ts`:
 *   - `confirmWithDeveloper` (core/arch-confirm.ts) — the confirm dialog
 *   - `loadArchContext` (core/arch-context.ts) — the context loader
 *
 * The `handleDesign` orchestrator is thin glue on top of these (it just
 * loads state + calls `runStage`). Exercising the two building blocks
 * covers the new lines the orchestrator introduces.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { confirmWithDeveloper, type ConfirmOutcome } from "../../src/core/arch-confirm.js";
import { loadArchContext } from "../../src/core/arch-context.js";

let tmpDir: string;

function writeFilesConfig(projectName: string) {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "files.json"), JSON.stringify({ version: 4, projectName }));
}

function writeRequirementsProfile(projectName = "TestApp") {
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "requirements-profile.json"),
		JSON.stringify({
			profileId: "core-psrs-v1",
			profileKind: "common-core",
			version: "1.1.0",
			createdAt: new Date().toISOString(),
			requiredSections: [],
			applicationType: "web",
			domain: "general",
			developmentMethod: "agile",
			regulated: false,
			securityLevel: "medium",
			outputVariant: "standard",
			conditionalQuestions: [],
			researchConsent: false,
			researchSources: [],
		}),
	);
}

function makeCtx(respond: {
	select: (title: string, options: string[]) => Promise<string | number | undefined>;
}): ExtensionCommandContext {
	return {
		ui: {
			select: respond.select,
			notify: () => {},
			setStatus: () => {},
		},
	} as unknown as ExtensionCommandContext;
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-design-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("confirmWithDeveloper (Step 2 of sub-life cycle)", () => {
	const baseCtx = {
		runId: "2026-09-15-test",
		mission: "Build a test app",
		projectName: "TestApp",
		filesConfig: null,
		requirementsProfile: null,
		standardsProfile: null,
		prd: null,
		rtm: null,
		feasibility: null,
		agentsConfig: null,
		missingInputs: [],
	};

	it("returns outcome=proceed + confirmed=true when user picks Proceed", async () => {
		const ctx = makeCtx({
			select: async () => "Proceed — generate the architecture",
		});
		const res = await confirmWithDeveloper(ctx, baseCtx, tmpDir);
		assert.equal(res.outcome, "proceed");
		assert.equal(res.confirmed, true);
		assert.match(res.summaryShown, /Build a test app/);
	});

	it("returns outcome=adjust + confirmed=false when user picks Adjust", async () => {
		const ctx = makeCtx({
			select: async () => "Adjust scope — I'll edit the context first",
		});
		const res = await confirmWithDeveloper(ctx, baseCtx, tmpDir);
		assert.equal(res.outcome, "adjust");
		assert.equal(res.confirmed, false);
	});

	it("returns outcome=profile + confirmed=false when user picks profile", async () => {
		const ctx = makeCtx({
			select: async () => "Pick a different profile — run /velpari-configure-standards",
		});
		const res = await confirmWithDeveloper(ctx, baseCtx, tmpDir);
		assert.equal(res.outcome, "profile");
		assert.equal(res.confirmed, false);
	});

	it("returns outcome=no-ui + confirmed=false when ctx.ui.select is missing", async () => {
		const ctx = { ui: {} } as unknown as ExtensionCommandContext;
		const res = await confirmWithDeveloper(ctx, baseCtx, tmpDir);
		assert.equal(res.outcome, "no-ui");
		assert.equal(res.confirmed, false);
	});

	it("returns outcome=no-ui + confirmed=false when user dismisses (Esc)", async () => {
		const ctx = makeCtx({ select: async () => undefined });
		const res = await confirmWithDeveloper(ctx, baseCtx, tmpDir);
		assert.equal(res.outcome, "no-ui");
		assert.equal(res.confirmed, false);
	});

	it("always returns a non-empty summaryShown", async () => {
		const cases: Array<{ picked: string | undefined; expected: ConfirmOutcome }> = [
			{ picked: "Proceed — generate the architecture", expected: "proceed" },
			{ picked: "Adjust scope — I'll edit the context first", expected: "adjust" },
			{ picked: "Pick a different profile — run /velpari-configure-standards", expected: "profile" },
			{ picked: undefined, expected: "no-ui" },
		];
		for (const c of cases) {
			const ctx = makeCtx({ select: async () => c.picked });
			const res = await confirmWithDeveloper(ctx, baseCtx, tmpDir);
			assert.equal(res.outcome, c.expected);
			assert.ok(res.summaryShown.length > 0, `summaryShown empty for outcome ${c.expected}`);
		}
	});
});

describe("loadArchContext (Step 1 of sub-life cycle)", () => {
	it("loads files.json + requirements profile into a complete ArchContext", () => {
		writeFilesConfig("TestApp");
		writeRequirementsProfile("TestApp");

		const ctx = loadArchContext("2026-09-15-test", "Build a test app", tmpDir);

		assert.equal(ctx.runId, "2026-09-15-test");
		assert.equal(ctx.mission, "Build a test app");
		assert.equal(ctx.projectName, "TestApp");
		assert.ok(ctx.filesConfig, "filesConfig should be loaded");
		assert.equal(ctx.filesConfig?.projectName, "TestApp");
		assert.ok(ctx.requirementsProfile, "profile should be loaded");
		assert.equal(ctx.requirementsProfile?.profileId, "core-psrs-v1");
		// Some inputs (PRD/RTM/feasibility) will be missing because the
		// fixture doesn't seed the Doc/ artifacts — that's expected for a
		// partial-cwd test. We just verify config files loaded.
		assert.equal(
			ctx.missingInputs.every((m) => m.kind !== "filesConfig" && m.kind !== "requirementsProfile"),
			true,
			"filesConfig and requirementsProfile should NOT be in missingInputs",
		);
	});

	it("returns a populated missingInputs list when files.json is absent", () => {
		// No writeFilesConfig — files.json does not exist.
		const ctx = loadArchContext("2026-09-15-test", "m", tmpDir);

		assert.equal(ctx.filesConfig, null);
		assert.ok(
			ctx.missingInputs.some((m) => m.kind === "filesConfig"),
			"missingInputs should flag filesConfig",
		);
	});

	it("returns a populated missingInputs list when requirements profile is absent", () => {
		writeFilesConfig("TestApp");
		// No writeRequirementsProfile — profile does not exist.
		const ctx = loadArchContext("2026-09-15-test", "m", tmpDir);

		assert.equal(ctx.requirementsProfile, null);
		assert.ok(
			ctx.missingInputs.some((m) => m.kind === "requirementsProfile"),
			"missingInputs should flag requirementsProfile",
		);
	});

	it("v1.3.0+ multi-design: projectNames array surfaces all design subjects", () => {
		// Multi-design files.json with both projectName (for fallback) and projectNames array.
		const dir = path.join(tmpDir, ".pi", "velpari");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, "files.json"),
			JSON.stringify({
				version: 4,
				projectName: "alpha",
				projectNames: ["alpha", "beta"],
			}),
		);

		const ctx = loadArchContext("2026-09-15-test", "m", tmpDir);

		assert.deepEqual(ctx.projectNames, ["alpha", "beta"], "projectNames survives the loader");
		assert.equal(ctx.projectName, "alpha", "projectName falls back to legacy single-design field");
	});
});
