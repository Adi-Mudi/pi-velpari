/**
 * SCAN-gate picker tests (v2.1 lifecycle upgrade + small hardening).
 *
 * Covers every branch of the picker:
 *   - "Run all" branch → returns all available; community requires consent
 *   - "Run code+doc only" branch → returns subset
 *   - "Run community only" branch → requires consent
 *   - "Adjust" branch → asks one confirm per available scan
 *   - "Skip scans" branch → returns []
 *   - "Type something..." (freeform) branch → parses user input
 *   - Esc / cancel → returns cancelled:true sentinel
 *   - Empty pickers (no ui) → returns cancelled sentinel (test fallback)
 *   - Doc-only project shape (inputDocuments only) → code option hidden
 *
 * The widget lives in stages/brainstorm/ (L1), so this test mirrors that
 * path: test/stages/brainstorm/scan-gate.test.ts.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	runScanGatePicker,
	type ScanGateResult,
} from "../../../src/stages/brainstorm/scan-gate.js";
import type { FilesConfig } from "../../../src/core/config.js";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type ScanType = "code" | "doc" | "community";

interface Calls {
	select: { title: string; options: string[] };
	confirms: Array<{ title: string; message: string }>;
	inputs: Array<{ title: string; placeholder?: string }>;
}

interface MockCtx {
	ui: {
		select: (title: string, options: string[]) => Promise<string>;
		confirm: (title: string, message: string) => Promise<boolean>;
		input: (title: string, placeholder?: string) => Promise<string>;
		notify: (message: string, level: string) => void;
	};
	calls: Calls;
}

function makeCtx(
	selectResponder: (options: string[]) => string,
	confirmResponder: (title: string) => boolean,
	inputResponder: (title: string) => string = () => "",
): MockCtx {
	const calls: Calls = { select: { title: "", options: [] }, confirms: [], inputs: [] };
	return {
		calls,
		ui: {
			select: async (title: string, options: string[]) => {
				calls.select = { title, options };
				return selectResponder(options);
			},
			confirm: async (title: string, message: string) => {
				calls.confirms.push({ title, message });
				return confirmResponder(title);
			},
			input: async (title: string, placeholder?: string) => {
				calls.inputs.push({ title, placeholder });
				return inputResponder(title);
			},
			notify: () => {},
		},
	};
}

/** Run the picker with the mock ctx, returning the rich result. */
async function run(
	ctx: MockCtx,
	config: FilesConfig,
	cwd: string,
): Promise<ScanGateResult> {
	const extCtx = ctx as unknown as ExtensionCommandContext;
	return runScanGatePicker(extCtx, { config, cwd });
}

function baseConfig(): FilesConfig {
	return {
		version: 4,
		projectName: "TestApp",
		framework: {},
		codePaths: [],
		inputDocuments: [],
		testPaths: [],
		outputPaths: {},
		excludedPaths: [],
	};
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-scan-gate-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("runScanGatePicker — branches", () => {
	it("Run all → returns all available scans when community consent granted", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[0]!, // pick "Run all"
			() => true, // consent
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, ["code", "doc", "community"]);
		assert.equal(result.cancelled, false);
		assert.equal(result.freeform, false);
		assert.equal(ctx.calls.select.title, "Which scans should run for this brainstorm?");
	});

	it("Run all but community consent denied → falls through to Adjust", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[0]!, // Run all
			(title) => !/community/i.test(title), // deny every community prompt
		);

		const result = await run(ctx, config, tmpDir);
		// Adjust: code yes, doc yes, community no (per responder)
		assert.deepEqual(result.scans, ["code", "doc"]);
		assert.equal(result.cancelled, false);
		assert.equal(result.freeform, false);
	});

	it("Run code + doc only → returns subset, no community", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[1]!, // Run code + doc only
			() => true,
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, ["code", "doc"]);
	});

	it("Run community only with consent → returns [community]", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[2]!, // Run community only
			() => true,
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, ["community"]);
	});

	it("Run community only WITHOUT consent → falls through to Adjust (returns [])", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[2]!, // community only
			() => false, // no consent
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, []);
		assert.equal(result.cancelled, false);
	});

	it("Adjust branch → asks one confirm per available scan", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[3]!, // Adjust
			(title) => title === "Run CODE scan?", // only code
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, ["code"]);
		assert.equal(ctx.calls.confirms.length, 3);
		assert.equal(ctx.calls.confirms[0]!.title, "Run CODE scan?");
		assert.equal(ctx.calls.confirms[1]!.title, "Run DOC scan?");
		assert.equal(ctx.calls.confirms[2]!.title, "Run COMMUNITY scan? (FR-52 consent)");
	});

	it("Skip scans → returns [] with cancelled:false (second-to-last label)", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[opts.length - 2]!, // Skip scans (second-to-last, before freeform)
			() => true,
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, []);
		assert.equal(result.cancelled, false);
	});

	it("Empty select response (cancel) → returns cancelled:true sentinel", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			() => "", // cancel
			() => true,
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, []);
		assert.equal(result.cancelled, true);
		assert.equal(result.freeform, false);
	});
});

describe("runScanGatePicker — Type something... (freeform)", () => {
	it("freeform row is always the LAST option in the labels", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			() => "", // ignored
			() => true,
		);
		await run(ctx, config, tmpDir);
		const labels = ctx.calls.select.options;
		const last = labels[labels.length - 1]!;
		assert.match(last, /Type something/);
	});

	it("freeform parses comma-separated scans and filters to available", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[opts.length - 1]!, // pick "Type something..."
			() => true,
			() => "code, community", // user types these
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, ["code", "community"]);
		assert.equal(result.freeform, true);
		assert.equal(result.cancelled, false);
	});

	it("freeform filters out unknown scan names", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[opts.length - 1]!,
			() => true,
			() => "code, hack, doc, bobsscan",
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, ["code", "doc"]);
		assert.equal(result.freeform, true);
	});

	it("freeform is case-insensitive", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[opts.length - 1]!,
			() => true,
			() => "CODE, Doc, COMMUNITY",
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, ["code", "doc", "community"]);
	});

	it("freeform with empty input → returns cancelled:true (AskUserQuestion parity)", async () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[opts.length - 1]!,
			() => true,
			() => "", // empty
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, []);
		assert.equal(result.cancelled, true);
		assert.equal(result.freeform, false);
	});
});

describe("runScanGatePicker — config-aware labels", () => {
	it("DOC-ONLY project: Adjust branch only asks for doc + community (Phase C regression)", async () => {
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => {
				// "Adjust (pick per-scan)" is the 4th label (0-indexed 3)
				// After Run all / Run doc only / Run community only / Adjust
				return opts[3]!;
			},
			(title) => title === "Run DOC scan?",
		);

		const result = await run(ctx, config, tmpDir);
		assert.equal(ctx.calls.confirms.length, 2);
		assert.equal(ctx.calls.confirms[0]!.title, "Run DOC scan?");
		assert.equal(ctx.calls.confirms[1]!.title, "Run COMMUNITY scan? (FR-52 consent)");
		assert.ok(
			!ctx.calls.confirms.some((c) => c.title === "Run CODE scan?"),
			"code confirm must NOT be asked for a doc-only project",
		);
		assert.deepEqual(result.scans, ["doc"]);
	});

	it("DOC-ONLY project hides code option from Run all + Run subset", async () => {
		mkdirSync(join(tmpDir, "Doc"));
		const config: FilesConfig = {
			...baseConfig(),
			inputDocuments: ["Doc"],
		};

		const ctx = makeCtx(
			(opts) => opts[0]!, // Run all
			() => true,
		);

		const result = await run(ctx, config, tmpDir);
		assert.deepEqual(result.scans, ["doc", "community"]);
		assert.ok(!ctx.calls.select.options[0]!.includes("code +"));
	});

	it("EMPTY project: only community available; picker shows only community-only and skip", async () => {
		const config = baseConfig();

		const ctx = makeCtx(
			(opts) => opts[opts.length - 2]!, // Skip scans
			() => true,
		);

		await run(ctx, config, tmpDir);
		const labels = ctx.calls.select.options;
		const joined = labels.join(" | ");
		assert.ok(!joined.includes("code"), `labels must not mention "code": ${joined}`);
		assert.ok(!joined.includes("doc"), `labels must not mention "doc": ${joined}`);
		assert.ok(joined.includes("community"), "community must be in labels");
		assert.ok(joined.includes("Skip scans"), "Skip must be in labels");
		assert.ok(joined.includes("Type something"), "freeform row must be in labels");
	});
});

describe("runScanGatePicker — fallback when ui.select is missing", () => {
	it("returns cancelled:true sentinel when ctx.ui.select is not a function", async () => {
		const ctx = {
			ui: { select: undefined, confirm: undefined, input: undefined, notify: () => {} },
		} as unknown as ExtensionCommandContext;

		const config: FilesConfig = {
			...baseConfig(),
			codePaths: ["src"],
		};
		const result = await runScanGatePicker(ctx, { config, cwd: tmpDir });
		assert.deepEqual(result.scans, []);
		assert.equal(result.cancelled, true);
		assert.equal(result.freeform, false);
	});
});