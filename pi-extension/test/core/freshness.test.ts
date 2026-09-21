/**
 * Freshness tests (B4 + A3).
 *
 * Covers:
 *   - hashFileContent: hashes content, null on missing
 *   - manifest round-trip; recordPublish upsert (no growth)
 *   - computeStaleSet: clean / input-changed / input-missing / no-stamp
 *   - resolveDeclaredInputs + computeInputHashes
 *   - enumeratePublishedArtifacts: grouped + brainstorm, skips missing
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { hashFileContent, hashFileContentNormalized } from "../../src/core/fingerprints.js";
import {
	computeInputHashes,
	computeStaleSet,
	emptyFreshnessManifest,
	enumeratePublishedArtifacts,
	entryKey,
	loadFreshnessManifest,
	manifestKey,
	recordPublish,
	resolveDeclaredInputs,
	saveFreshnessManifest,
} from "../../src/core/freshness.js";
import { PATHS } from "../../src/core/constants.js";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-fresh-"));
}

function write(root: string, rel: string, content: string): string {
	const abs = join(root, rel);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content);
	return abs;
}

/** Publish a fake PRD whose declared input is the run's brainstorm. */
function setupPrdWithBrainstormInput(cwd: string): { brainstormPath: string; prdHashInputs: Record<string, string> } {
	const brainstormPath = write(cwd, "Doc/brainstorm/brainstorm-cli-todo.md", "# brainstorm\n");
	write(cwd, "Doc/requirements/PRD_TestApp.md", "# PRD\n");
	const inputs = { "brainstorm:cli-todo": hashFileContent(brainstormPath)! };
	recordPublish(cwd, {
		artifact: "prd",
		projectName: "TestApp",
		path: "Doc/requirements/PRD_TestApp.md",
		publishedAt: "2026-09-20T17:00:00.000Z",
		inputs,
	});
	return { brainstormPath, prdHashInputs: inputs };
}

describe("hashFileContent", () => {
	it("hashes file content and returns null on missing", () => {
		const cwd = tmp();
		const p = write(cwd, "a.txt", "hello");
		assert.match(hashFileContent(p)!, /^[0-9a-f]{64}$/);
		assert.equal(hashFileContent(join(cwd, "nope.txt")), null);
	});

	it("is content-sensitive", () => {
		const cwd = tmp();
		const a = write(cwd, "a.txt", "one");
		const b = write(cwd, "b.txt", "two");
		assert.notEqual(hashFileContent(a), hashFileContent(b));
	});
});

describe("manifest load/save", () => {
	it("returns an empty manifest when the file is absent or corrupt", () => {
		const cwd = tmp();
		assert.deepEqual(loadFreshnessManifest(cwd), emptyFreshnessManifest());
		write(cwd, PATHS.FRESHNESS_FILE, "not json");
		assert.deepEqual(loadFreshnessManifest(cwd), emptyFreshnessManifest());
	});

	it("round-trips a manifest", () => {
		const cwd = tmp();
		const manifest = emptyFreshnessManifest();
		manifest.artifacts["prd:TestApp"] = {
			artifact: "prd",
			projectName: "TestApp",
			path: "Doc/requirements/PRD_TestApp.md",
			publishedAt: "2026-09-20T17:00:00.000Z",
			inputs: {},
		};
		saveFreshnessManifest(cwd, manifest);
		assert.ok(existsSync(join(cwd, PATHS.FRESHNESS_FILE)));
		assert.deepEqual(loadFreshnessManifest(cwd), manifest);
	});
});

describe("recordPublish", () => {
	it("upserts — republishing the same artifact does not grow the manifest", () => {
		const cwd = tmp();
		for (const ts of ["2026-09-20T17:00:00.000Z", "2026-09-20T18:00:00.000Z"]) {
			recordPublish(cwd, {
				artifact: "prd",
				projectName: "TestApp",
				path: "Doc/requirements/PRD_TestApp.md",
				publishedAt: ts,
				inputs: {},
			});
		}
		const manifest = loadFreshnessManifest(cwd);
		assert.deepEqual(Object.keys(manifest.artifacts), ["prd:TestApp"]);
		assert.equal(manifest.artifacts["prd:TestApp"]!.publishedAt, "2026-09-20T18:00:00.000Z");
	});

	it("keys brainstorm entries by slug", () => {
		assert.equal(
			entryKey({ artifact: "brainstorm", slug: "cli-todo", path: "p", publishedAt: "t" }),
			"brainstorm:cli-todo",
		);
		assert.equal(manifestKey("PRD", "TestApp"), "prd:TestApp");
	});
});

describe("computeStaleSet", () => {
	it("is clean when nothing changed since publish", () => {
		const cwd = tmp();
		setupPrdWithBrainstormInput(cwd);
		assert.deepEqual(computeStaleSet(cwd), []);
	});

	it("reports input-changed after an input artifact is edited", () => {
		const cwd = tmp();
		const { brainstormPath } = setupPrdWithBrainstormInput(cwd);
		writeFileSync(brainstormPath, "# brainstorm\nedited\n");
		const stale = computeStaleSet(cwd);
		assert.equal(stale.length, 1);
		assert.equal(stale[0]!.key, "prd:TestApp");
		assert.equal(stale[0]!.reason, "input-changed");
		assert.deepEqual(stale[0]!.changedInputs, ["brainstorm:cli-todo"]);
	});

	it("reports input-missing after an input artifact is deleted", () => {
		const cwd = tmp();
		const { brainstormPath } = setupPrdWithBrainstormInput(cwd);
		rmSync(brainstormPath);
		const stale = computeStaleSet(cwd);
		assert.equal(stale.length, 1);
		assert.equal(stale[0]!.reason, "input-missing");
	});

	it("reports no-stamp for legacy entries without an inputs map", () => {
		const cwd = tmp();
		recordPublish(cwd, {
			artifact: "design",
			projectName: "TestApp",
			path: "Doc/design/design_TestApp.md",
			publishedAt: "2026-09-20T17:00:00.000Z",
		});
		const stale = computeStaleSet(cwd);
		assert.equal(stale.length, 1);
		assert.equal(stale[0]!.reason, "no-stamp");
	});

	it("reports no-stamp for disk artifacts with no manifest entry when enumerated", () => {
		const cwd = tmp();
		write(cwd, "Doc/requirements/PRD_Legacy.md", "# legacy PRD\n");
		const stale = computeStaleSet(cwd, { enumerated: enumeratePublishedArtifacts(cwd) });
		assert.equal(stale.length, 1);
		assert.equal(stale[0]!.key, "prd:Legacy");
		assert.equal(stale[0]!.reason, "no-stamp");
	});

	it("flags a changed RTM sidecar via extraPaths", () => {
		const cwd = tmp();
		write(cwd, "Doc/requirements/RTM_TestApp.md", "# RTM\n");
		const sidecar = write(cwd, "Doc/requirements/RTM_TestApp.json", "{}");
		recordPublish(cwd, {
			artifact: "rtm",
			projectName: "TestApp",
			path: "Doc/requirements/RTM_TestApp.md",
			extraPaths: { "Doc/requirements/RTM_TestApp.json": hashFileContent(sidecar)! },
			publishedAt: "2026-09-20T17:00:00.000Z",
			inputs: {},
		});
		assert.deepEqual(computeStaleSet(cwd), []);
		writeFileSync(sidecar, "{\"changed\":true}");
		const stale = computeStaleSet(cwd);
		assert.equal(stale.length, 1);
		assert.equal(stale[0]!.reason, "input-changed");
		assert.deepEqual(stale[0]!.changedInputs, ["Doc/requirements/RTM_TestApp.json"]);
	});
});

describe("resolveDeclaredInputs + computeInputHashes", () => {
	it("resolves doc and brainstorm inputs with found/missing status", () => {
		const cwd = tmp();
		write(cwd, "Doc/requirements/PRD_TestApp.md", "# PRD\n");
		const inputs = resolveDeclaredInputs(
			cwd,
			[
				{ kind: "brainstorm", label: "brainstorm" },
				{ kind: "doc", artifact: "PRD", label: "PRD" },
			],
			{ projectName: "TestApp", topicSlug: "cli-todo" },
		);
		assert.equal(inputs.length, 2);
		assert.equal(inputs[0]!.id, "brainstorm:cli-todo");
		assert.equal(inputs[0]!.status, "missing");
		assert.equal(inputs[1]!.id, "prd:TestApp");
		assert.equal(inputs[1]!.status, "found");
	});

	it("hashes found inputs and reports required missing ones", () => {
		const cwd = tmp();
		write(cwd, "Doc/requirements/PRD_TestApp.md", "# PRD\n");
		const inputs = resolveDeclaredInputs(
			cwd,
			[{ kind: "doc", artifact: "PRD", label: "PRD" }],
			{ projectName: "TestApp", topicSlug: "cli-todo" },
		);
		const hashes = computeInputHashes(cwd, inputs);
		assert.ok(hashes.ok);
		assert.match(hashes.hashes["prd:TestApp"]!, /^[0-9a-f]{64}$/);

		const missingInputs = resolveDeclaredInputs(
			cwd,
			[{ kind: "doc", artifact: "RTM", label: "RTM" }],
			{ projectName: "TestApp", topicSlug: "cli-todo" },
		);
		assert.deepEqual(computeInputHashes(cwd, missingInputs), {
			ok: false,
			missing: ["rtm:TestApp"],
		});
	});

	it("skips missing optional inputs", () => {
		const cwd = tmp();
		const inputs = resolveDeclaredInputs(
			cwd,
			[{ kind: "brainstorm", label: "brainstorm", optional: true }],
			{ projectName: "TestApp", topicSlug: "cli-todo" },
		);
		assert.deepEqual(computeInputHashes(cwd, inputs), { ok: true, hashes: {} });
	});
});

describe("enumeratePublishedArtifacts", () => {
	it("finds grouped and brainstorm artifacts, skips missing ones", () => {
		const cwd = tmp();
		write(cwd, "Doc/requirements/PRD_TestApp.md", "# PRD\n");
		write(cwd, "Doc/design/design_TestApp.md", "# design\n");
		write(cwd, "Doc/brainstorm/brainstorm-cli-todo.md", "# brainstorm\n");
		const found = enumeratePublishedArtifacts(cwd);
		const keys = found.map((f) => manifestKey(f.artifactKind, f.slug ?? f.projectName ?? ""));
		assert.deepEqual(keys, ["brainstorm:cli-todo", "design:TestApp", "prd:TestApp"]);
		for (const f of found) assert.ok(f.exists);
	});

	it("finds legacy flat brainstorm artifacts and dedupes against grouped", () => {
		const cwd = tmp();
		write(cwd, "Doc/brainstorm-legacy-topic.md", "# legacy brainstorm\n");
		write(cwd, "Doc/brainstorm/brainstorm-cli-todo.md", "# grouped\n");
		write(cwd, "Doc/brainstorm-cli-todo.md", "# legacy dupe\n");
		const found = enumeratePublishedArtifacts(cwd);
		const slugs = found.filter((f) => f.artifactKind === "brainstorm").map((f) => f.slug);
		assert.deepEqual(slugs.sort(), ["cli-todo", "legacy-topic"]);
	});

	it("returns an empty list when nothing is published", () => {
		assert.deepEqual(enumeratePublishedArtifacts(tmp()), []);
	});
});

describe("hashv schemes (A5/D3)", () => {
	const UPSTREAM = [
		"# PRD",
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

	function setupEntry(cwd: string, hashv?: 2): { upstreamPath: string } {
		const upstreamPath = write(cwd, "Doc/requirements/PRD_TestApp.md", UPSTREAM);
		write(cwd, "Doc/design/design_TestApp.md", "# design\n");
		const hash = (hashv === 2 ? hashFileContentNormalized : hashFileContent)(upstreamPath)!;
		recordPublish(cwd, {
			artifact: "design",
			projectName: "TestApp",
			path: "Doc/design/design_TestApp.md",
			publishedAt: "2026-09-20T17:00:00.000Z",
			inputs: { "prd:TestApp": hash },
			...(hashv === 2 ? { hashv: 2 } : {}),
		});
		return { upstreamPath };
	}

	function appendChangeLogLine(p: string): void {
		writeFileSync(
			p,
			readFileSync(p, "utf8").replace(
				"- v1.0.0 initial",
				"- v1.0.0 initial\nReviewed after `brainstorm:cli-todo` v1.0.0 — no changes required.",
			),
		);
	}

	it("v1 entries (no hashv) keep whole-file checking — no mass-staling, Change Log append still stales", () => {
		const cwd = tmp();
		const { upstreamPath } = setupEntry(cwd);
		assert.deepEqual(computeStaleSet(cwd), [], "v1 entry clean at stamp time");
		appendChangeLogLine(upstreamPath);
		const stale = computeStaleSet(cwd);
		assert.equal(stale.length, 1, "legacy whole-file checking must see the Change Log append");
		assert.equal(stale[0]!.reason, "input-changed");
	});

	it("v2 entries tolerate a Change Log append but still detect body edits", () => {
		const cwd = tmp();
		const { upstreamPath } = setupEntry(cwd, 2);
		appendChangeLogLine(upstreamPath);
		assert.deepEqual(computeStaleSet(cwd), [], "Change Log append must not stale a hashv:2 entry");
		writeFileSync(upstreamPath, readFileSync(upstreamPath, "utf8").replace("substance", "edited"));
		const stale = computeStaleSet(cwd);
		assert.equal(stale.length, 1, "a body edit must still stale a hashv:2 entry");
		assert.equal(stale[0]!.reason, "input-changed");
	});

	it("reconfirmedAt round-trips through recordPublish + loadFreshnessManifest", () => {
		const cwd = tmp();
		recordPublish(cwd, {
			artifact: "design",
			projectName: "TestApp",
			path: "Doc/design/design_TestApp.md",
			publishedAt: "2026-09-20T17:00:00.000Z",
			inputs: {},
			hashv: 2,
			reconfirmedAt: "2026-09-20T19:00:00.000Z",
		});
		const entry = loadFreshnessManifest(cwd).artifacts["design:TestApp"]!;
		assert.equal(entry.hashv, 2);
		assert.equal(entry.reconfirmedAt, "2026-09-20T19:00:00.000Z");
	});
});

describe("re-brainstorm staling (D8)", () => {
	const STAMP = "20260920-180000";
	const V2_REL = `Doc/brainstorm/brainstorm-cli-todo-${STAMP}.md`;

	function publishBrainstormV1(cwd: string, content = "# brainstorm v1\n"): string {
		const v1 = write(cwd, "Doc/brainstorm/brainstorm-cli-todo.md", content);
		recordPublish(cwd, {
			artifact: "brainstorm",
			slug: "cli-todo",
			path: "Doc/brainstorm/brainstorm-cli-todo.md",
			publishedAt: "2026-09-20T17:00:00.000Z",
			inputs: {},
		});
		return v1;
	}

	/** Mimic brainstorm-approve on a re-run: suffixed file, BASE-slug
	 *  manifest upsert pointing at the new file. */
	function republishBrainstormV2(cwd: string): string {
		const v2 = write(cwd, V2_REL, "# brainstorm v2\n");
		recordPublish(cwd, {
			artifact: "brainstorm",
			slug: "cli-todo",
			path: V2_REL,
			publishedAt: "2026-09-20T18:00:00.000Z",
			inputs: {},
		});
		return v2;
	}

	it("resolveDeclaredInputs prefers the manifest path (latest file) over base-slug disk resolution", () => {
		const cwd = tmp();
		publishBrainstormV1(cwd);
		const v2 = republishBrainstormV2(cwd);
		const inputs = resolveDeclaredInputs(
			cwd,
			[{ kind: "brainstorm", label: "brainstorm" }],
			{ projectName: "TestApp", topicSlug: "cli-todo" },
		);
		assert.equal(inputs[0]!.status, "found");
		assert.equal(inputs[0]!.path, v2, "manifest path (suffixed latest file) must win");
	});

	it("falls back to base-slug disk resolution when no manifest entry exists", () => {
		const cwd = tmp();
		const v1 = write(cwd, "Doc/brainstorm/brainstorm-cli-todo.md", "# brainstorm v1\n");
		const inputs = resolveDeclaredInputs(
			cwd,
			[{ kind: "brainstorm", label: "brainstorm" }],
			{ projectName: "TestApp", topicSlug: "cli-todo" },
		);
		assert.equal(inputs[0]!.status, "found");
		assert.equal(inputs[0]!.path, v1);
	});

	it("recordPublish upserts the base key — a re-run does not grow the manifest", () => {
		const cwd = tmp();
		publishBrainstormV1(cwd);
		republishBrainstormV2(cwd);
		const manifest = loadFreshnessManifest(cwd);
		assert.deepEqual(Object.keys(manifest.artifacts), ["brainstorm:cli-todo"]);
		assert.equal(manifest.artifacts["brainstorm:cli-todo"]!.path, V2_REL);
	});

	it("computeStaleSet stales a downstream artifact after a re-brainstorm republish", () => {
		const cwd = tmp();
		setupPrdWithBrainstormInput(cwd); // PRD stamped against brainstorm v1
		// Manifest entry for the SAME v1 content the PRD was stamped against
		// (setupPrdWithBrainstormInput writes "# brainstorm\n").
		publishBrainstormV1(cwd, "# brainstorm\n");
		assert.deepEqual(computeStaleSet(cwd), [], "clean before the re-brainstorm");

		republishBrainstormV2(cwd);
		const stale = computeStaleSet(cwd);
		assert.equal(stale.length, 1);
		assert.equal(stale[0]!.key, "prd:TestApp");
		assert.equal(stale[0]!.reason, "input-changed");
		assert.deepEqual(stale[0]!.changedInputs, ["brainstorm:cli-todo"]);
	});

	it("enumeratePublishedArtifacts folds suffixed re-run files into the base slug (no spurious no-stamp)", () => {
		const cwd = tmp();
		publishBrainstormV1(cwd);
		republishBrainstormV2(cwd);
		// Both files on disk; one enumerated artifact under the base slug.
		const found = enumeratePublishedArtifacts(cwd).filter(
			(f) => f.artifactKind === "brainstorm",
		);
		assert.equal(found.length, 1);
		assert.equal(found[0]!.slug, "cli-todo");

		// And the enumerated check reports nothing stale for the brainstorm.
		const stale = computeStaleSet(cwd, { enumerated: enumeratePublishedArtifacts(cwd) });
		assert.ok(
			stale.every((s) => s.artifact !== "brainstorm"),
			`suffixed re-run files must not report no-stamp: ${JSON.stringify(stale)}`,
		);
	});
});
