/**
 * /velpari-reconfirm tests (A5 — re-confirm path, D1-D7).
 *
 * Covers:
 *   - end-to-end: stale → re-confirm → mandated Change Log line (exact
 *     format, upstream version filled from frontmatter), manifest
 *     re-stamped (hashv: 2 + reconfirmedAt), stale set clean, history
 *     entry written (D5 audit triple)
 *   - RTM extraPaths sidecar re-stamped on re-confirm (D6)
 *   - input-missing / no-stamp refused (D4)
 *   - Change Log append does NOT stale downstream consumers (D3 end-to-end)
 *   - appendToChangeLog section handling (existing section / missing section)
 *   - L3 command: cancelled picker and declined confirm write nothing (D2)
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { hashFileContentNormalized } from "../../src/core/fingerprints.js";
import { computeStaleSet, loadFreshnessManifest, recordPublish, type StaleItem } from "../../src/core/freshness.js";
import { loadHistory } from "../../src/core/history.js";
import {
	appendToChangeLog,
	computeReconfirmSet,
	reconfirmArtifact,
	reconfirmChangeLogLine,
} from "../../src/ops/reconfirm.js";
import { registerReconfirmCommand } from "../../src/commands/reconfirm.js";

const NOW = "2026-09-20T23:30:00.000Z";

const PRD_V1 = [
	"---",
	"artifact: PRD",
	"project: TestApp",
	"version: 1.2.0",
	"---",
	"",
	"# PSRS",
	"",
	"## Body",
	"",
	"substance",
	"",
	"## Change Log",
	"",
	"- v1.0.0 initial",
	"",
].join("\n");

const DESIGN_V1 = [
	"---",
	"artifact: design",
	"version: 1.0.0",
	"---",
	"",
	"# Design",
	"",
	"## 1. Module Breakdown",
	"",
	"modules",
	"",
	"## Change Log",
	"",
	"- v1.0.0 initial",
	"",
].join("\n");

let tmpDir: string;

function write(rel: string, content: string): string {
	const abs = path.join(tmpDir, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf8");
	return abs;
}

function read(rel: string): string {
	return fs.readFileSync(path.join(tmpDir, rel), "utf8");
}

/** Publish PRD + design; the design declares the PRD as input (hashv: 2). */
function seedChain(): { prdAbs: string } {
	const prdAbs = write("Doc/requirements/PRD_TestApp.md", PRD_V1);
	write("Doc/design/design_TestApp.md", DESIGN_V1);
	recordPublish(tmpDir, {
		artifact: "design",
		projectName: "TestApp",
		path: "Doc/design/design_TestApp.md",
		publishedAt: "2026-09-20T17:00:00.000Z",
		inputs: { "prd:TestApp": hashFileContentNormalized(prdAbs)! },
		hashv: 2,
	});
	return { prdAbs };
}

/** Edit the PRD body so the design goes input-changed stale. */
function editPrdBody(): void {
	write("Doc/requirements/PRD_TestApp.md", PRD_V1.replace("substance", "edited substance"));
}

function staleItem(): StaleItem {
	const stale = computeStaleSet(tmpDir);
	assert.equal(stale.length, 1, "expected exactly one stale item");
	return stale[0]!;
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-reconfirm-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("computeReconfirmSet (D2/D4)", () => {
	it("splits input-changed (actionable) from input-missing/no-stamp (refused)", () => {
		seedChain();
		editPrdBody();
		// A legacy entry without inputs → no-stamp; a missing input → input-missing.
		recordPublish(tmpDir, {
			artifact: "pseudocode",
			projectName: "TestApp",
			path: "Doc/pseudocode/pseudocode_TestApp.md",
			publishedAt: "2026-09-20T17:00:00.000Z",
		});
		recordPublish(tmpDir, {
			artifact: "testplan",
			projectName: "TestApp",
			path: "Doc/tests/test-plan_TestApp.md",
			publishedAt: "2026-09-20T17:00:00.000Z",
			inputs: { "rtm:TestApp": "0".repeat(64) },
		});
		const { actionable, refused } = computeReconfirmSet(tmpDir);
		assert.deepEqual(
			actionable.map((s) => s.key),
			["design:TestApp"],
		);
		assert.deepEqual(refused.map((s) => s.key).sort(), ["pseudocode:TestApp", "testplan:TestApp"]);
	});
});

describe("reconfirmArtifact — audit triple (D5)", () => {
	it("appends the exact Change Log line with the upstream frontmatter version, re-stamps, and writes history", () => {
		seedChain();
		editPrdBody();
		const item = staleItem();

		const result = reconfirmArtifact(tmpDir, item, {
			now: NOW,
			history: { runId: "run-1", stage: "designed" },
		});

		// (a) exact Change Log line, version from upstream frontmatter.
		const expectedLine = "Reviewed after `prd:TestApp` v1.2.0 — no changes required.";
		assert.deepEqual(result.changeLogLines, [expectedLine]);
		const design = read("Doc/design/design_TestApp.md");
		assert.ok(design.includes(expectedLine), `Change Log line missing:\n${design}`);
		const changeLogStart = design.indexOf("## Change Log");
		assert.ok(design.indexOf(expectedLine) > changeLogStart, "line must be inside the Change Log section");

		// (b) manifest re-stamped: hashv 2, reconfirmedAt, current hashes.
		const entry = loadFreshnessManifest(tmpDir).artifacts["design:TestApp"]!;
		assert.equal(entry.hashv, 2);
		assert.equal(entry.reconfirmedAt, NOW);
		assert.equal(
			entry.inputs!["prd:TestApp"],
			hashFileContentNormalized(path.join(tmpDir, "Doc/requirements/PRD_TestApp.md"))!,
		);
		assert.equal(entry.publishedAt, "2026-09-20T17:00:00.000Z", "publish timestamp preserved");

		// Stale set is clean afterwards.
		assert.deepEqual(computeStaleSet(tmpDir), []);

		// (c) history entry.
		const history = loadHistory(tmpDir, "run-1");
		assert.equal(history.length, 1);
		assert.equal(history[0]!.command, "velpari-reconfirm");
		assert.equal(history[0]!.stage, "designed");
		assert.equal(history[0]!.timestamp, NOW);
	});

	it("falls back to unknown-version when the upstream has no frontmatter version (never blocks)", () => {
		write("Doc/requirements/PRD_TestApp.md", "# bare PRD, no frontmatter\n");
		write("Doc/design/design_TestApp.md", DESIGN_V1);
		recordPublish(tmpDir, {
			artifact: "design",
			projectName: "TestApp",
			path: "Doc/design/design_TestApp.md",
			publishedAt: "2026-09-20T17:00:00.000Z",
			inputs: { "prd:TestApp": "0".repeat(64) },
			hashv: 2,
		});
		const result = reconfirmArtifact(tmpDir, staleItem(), { now: NOW });
		assert.deepEqual(result.changeLogLines, ["Reviewed after `prd:TestApp` vunknown-version — no changes required."]);
	});

	it("re-stamps the RTM JSON sidecar via extraPaths (D6)", () => {
		const sidecarRel = "Doc/requirements/RTM_TestApp.json";
		write("Doc/requirements/RTM_TestApp.md", DESIGN_V1);
		const sidecarAbs = write(sidecarRel, '{"rows":[]}');
		recordPublish(tmpDir, {
			artifact: "rtm",
			projectName: "TestApp",
			path: "Doc/requirements/RTM_TestApp.md",
			extraPaths: { [sidecarRel]: hashFileContentNormalized(sidecarAbs)! },
			publishedAt: "2026-09-20T17:00:00.000Z",
			inputs: {},
			hashv: 2,
		});
		fs.writeFileSync(sidecarAbs, '{"rows":[1]}', "utf8");

		const item = staleItem();
		assert.deepEqual(item.changedInputs, [sidecarRel]);
		reconfirmArtifact(tmpDir, item, { now: NOW });

		const entry = loadFreshnessManifest(tmpDir).artifacts["rtm:TestApp"]!;
		assert.equal(entry.extraPaths![sidecarRel], hashFileContentNormalized(sidecarAbs)!);
		assert.equal(entry.reconfirmedAt, NOW);
		assert.deepEqual(computeStaleSet(tmpDir), []);
		// The sidecar line is named by path with unknown-version (JSON — no frontmatter).
		assert.ok(
			read("Doc/requirements/RTM_TestApp.md").includes(
				`Reviewed after \`${sidecarRel}\` vunknown-version — no changes required.`,
			),
		);
	});

	it("refuses input-missing and no-stamp items (D4)", () => {
		seedChain();
		fs.rmSync(path.join(tmpDir, "Doc/requirements/PRD_TestApp.md"));
		const missing = staleItem();
		assert.equal(missing.reason, "input-missing");
		assert.throws(() => reconfirmArtifact(tmpDir, missing, { now: NOW }), /republish/);

		recordPublish(tmpDir, {
			artifact: "pseudocode",
			projectName: "TestApp",
			path: "Doc/pseudocode/pseudocode_TestApp.md",
			publishedAt: "2026-09-20T17:00:00.000Z",
		});
		const noStamp = computeStaleSet(tmpDir).find((s) => s.reason === "no-stamp")!;
		assert.throws(() => reconfirmArtifact(tmpDir, noStamp, { now: NOW }), /republish/);
	});

	it("Change Log append on re-confirm does NOT stale downstream consumers (D3 end-to-end)", () => {
		seedChain();
		// pseudocode consumes the design (hashv: 2, normalized stamp).
		write("Doc/pseudocode/pseudocode_TestApp.md", "# Pseudocode\n");
		recordPublish(tmpDir, {
			artifact: "pseudocode",
			projectName: "TestApp",
			path: "Doc/pseudocode/pseudocode_TestApp.md",
			publishedAt: "2026-09-20T17:30:00.000Z",
			inputs: {
				"design:TestApp": hashFileContentNormalized(path.join(tmpDir, "Doc/design/design_TestApp.md"))!,
			},
			hashv: 2,
		});
		assert.deepEqual(computeStaleSet(tmpDir), [], "clean chain before the edit");

		editPrdBody();
		const item = staleItem();
		assert.equal(item.key, "design:TestApp");
		reconfirmArtifact(tmpDir, item, { now: NOW });

		assert.deepEqual(
			computeStaleSet(tmpDir),
			[],
			"the Change Log-only edit to the design must not stale the pseudocode",
		);
	});
});

describe("appendToChangeLog", () => {
	const LINE = reconfirmChangeLogLine("prd:TestApp", "1.2.0");

	it("appends at the end of an existing section, before the next ## heading", () => {
		const doc = "# D\n\n## Change Log\n\n- v1\n\n## 12. Appendix\n\ntail\n";
		const out = appendToChangeLog(doc, [LINE]);
		assert.equal(out, `# D\n\n## Change Log\n\n- v1\n${LINE}\n\n## 12. Appendix\n\ntail\n`);
	});

	it("creates the section at EOF when missing", () => {
		const doc = "# D\n\nbody\n";
		const out = appendToChangeLog(doc, [LINE]);
		assert.equal(out, `# D\n\nbody\n\n## Change Log\n\n${LINE}\n`);
	});

	it("the exact line format matches spec 02:97", () => {
		assert.equal(
			reconfirmChangeLogLine("rtm:TestApp", "2.0.1"),
			"Reviewed after `rtm:TestApp` v2.0.1 — no changes required.",
		);
	});
});

describe("/velpari-reconfirm command (L3, D2)", () => {
	interface Notice {
		message: string;
		level: string;
	}

	function makePi(): ExtensionAPI & {
		commands: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
	} {
		const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
		const fake = {
			commands,
			registerCommand(name: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) {
				commands.set(name, spec);
			},
		};
		return fake as unknown as ExtensionAPI & {
			commands: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
		};
	}

	function makeCtx(opts: {
		notices: Notice[];
		select?: (title: string, labels: string[]) => Promise<string | undefined>;
		confirm?: () => Promise<boolean>;
	}): ExtensionCommandContext {
		return {
			ui: {
				notify: (message: string, level: string) => {
					opts.notices.push({ message, level });
				},
				setStatus: () => {},
				select: opts.select ?? (async () => undefined),
				confirm: opts.confirm ?? (async () => false),
			},
		} as unknown as ExtensionCommandContext;
	}

	async function runCommand(ctx: ExtensionCommandContext): Promise<void> {
		const pi = makePi();
		registerReconfirmCommand(pi);
		const handler = pi.commands.get("velpari-reconfirm")!.handler;
		const prev = process.cwd();
		process.chdir(tmpDir);
		try {
			await handler("", ctx);
		} finally {
			process.chdir(prev);
		}
	}

	it("cancelled picker writes nothing (D2)", async () => {
		seedChain();
		editPrdBody();
		const notices: Notice[] = [];
		await runCommand(makeCtx({ notices, select: async () => undefined }));

		assert.ok(!read("Doc/design/design_TestApp.md").includes("Reviewed after"));
		assert.equal(loadFreshnessManifest(tmpDir).artifacts["design:TestApp"]!.reconfirmedAt, undefined);
		assert.equal(computeStaleSet(tmpDir).length, 1, "still stale — nothing written");
	});

	it("declined confirm writes nothing for that artifact (D2)", async () => {
		seedChain();
		editPrdBody();
		const notices: Notice[] = [];
		let selects = 0;
		await runCommand(
			makeCtx({
				notices,
				select: async (_t, labels) => (selects++ === 0 ? labels[0] : undefined),
				confirm: async () => false,
			}),
		);

		assert.ok(!read("Doc/design/design_TestApp.md").includes("Reviewed after"));
		assert.equal(loadFreshnessManifest(tmpDir).artifacts["design:TestApp"]!.reconfirmedAt, undefined);
	});

	it("picker + confirm re-confirms the selected artifact end-to-end", async () => {
		seedChain();
		editPrdBody();
		const notices: Notice[] = [];
		await runCommand(
			makeCtx({
				notices,
				select: async (_t, labels) => labels[0],
				confirm: async () => true,
			}),
		);

		assert.ok(
			read("Doc/design/design_TestApp.md").includes("Reviewed after `prd:TestApp` v1.2.0 — no changes required."),
		);
		assert.deepEqual(computeStaleSet(tmpDir), []);
		assert.ok(
			notices.some((n) => n.message.includes("Re-confirmed design:TestApp")),
			`success notice missing: ${JSON.stringify(notices)}`,
		);
	});

	it("reports input-missing/no-stamp items as republish-only and exits when nothing is actionable", async () => {
		recordPublish(tmpDir, {
			artifact: "pseudocode",
			projectName: "TestApp",
			path: "Doc/pseudocode/pseudocode_TestApp.md",
			publishedAt: "2026-09-20T17:00:00.000Z",
		});
		const notices: Notice[] = [];
		await runCommand(makeCtx({ notices }));

		assert.ok(
			notices.some((n) => n.level === "warning" && n.message.includes("NOT re-confirmable")),
			`refused warning missing: ${JSON.stringify(notices)}`,
		);
		assert.ok(notices.some((n) => n.message.includes("Nothing to re-confirm")));
	});
});
