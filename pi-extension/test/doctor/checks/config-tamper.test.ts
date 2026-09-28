/**
 * config-tamper doctor check tests (Phase C, plan Subphase 2.6 — G3).
 *
 * Covers: no baseline → info config-baseline-missing; baseline + clean →
 * ok; edited file → warning config-drift with git intent detail; corrupt
 * JSON → error config-unreadable (hash match irrelevant — parse wins);
 * deleted file → warning; corrupt manifest file → info (fail-open load).
 *
 * Baselines are recorded through the real `recordConfigBaseline` (the
 * same writer the confirm-gated fix flow uses). Git fixtures use the
 * inline spawnSync pattern (init + `-c` identity commit).
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkConfigTamperSection } from "../../../src/doctor/checks/config-tamper.js";
import { recordConfigBaseline, loadConfigManifest } from "../../../src/doctor/config-manifest.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-config-tamper-"));
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a config file at `<tmpDir>/<rel>`. */
function put(rel: string, content: string): void {
	const abs = path.join(tmpDir, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf8");
}

/** git init + add + commit with inline identity (fail-hard). */
function gitCommitAll(message: string): void {
	/**
	 * Run one git command in the fixture repo; throws on spawn error or non-zero exit.
	 * @param {string[]} args - Arguments after `git` (e.g. `["init", "-q"]`).
	 * @returns {void} Nothing; success is silent, failure throws.
	 */
	const run = (args: string[]): void => {
		const r = spawnSync("git", args, { cwd: tmpDir, encoding: "utf8" });
		if (r.error) throw r.error;
		if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
	};
	run(["init", "-q"]);
	run(["add", "-A"]);
	run(["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "-m", message]);
}

describe("checkConfigTamperSection", () => {
	it("no baseline → info config-baseline-missing (doctor never writes it)", () => {
		const section = checkConfigTamperSection(tmpDir);
		assert.equal(section.title, "Config tamper (drift vs recorded baseline + git intent)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /config-baseline-missing/);
		assert.match(section.items[0]!.suggestion ?? "", /velpari-doctor --velpari-fix/);
		// Read-only guarantee: nothing was created by the check itself.
		assert.equal(loadConfigManifest(tmpDir), null);
	});

	it("baseline + clean files → ok", () => {
		put(".pi/velpari/files.json", JSON.stringify({ version: 4, projectName: "TamperApp" }));
		recordConfigBaseline(tmpDir);
		const section = checkConfigTamperSection(tmpDir);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]!.message, /1 config file\(s\) match the recorded baseline/);
	});

	it("edited file → warning config-drift with hash + git details", () => {
		put(".pi/velpari/files.json", JSON.stringify({ version: 4, projectName: "TamperApp" }));
		recordConfigBaseline(tmpDir);
		gitCommitAll("baseline");
		put(".pi/velpari/files.json", JSON.stringify({ version: 4, projectName: "HijackedApp" }));

		const section = checkConfigTamperSection(tmpDir);
		const warn = section.items.find((i) => i.status === "warning");
		assert.ok(warn, "expected a warning");
		assert.match(warn!.message, /config-drift/);
		assert.match(warn!.message, /git: modified/);
		assert.ok(warn!.details?.some((d) => d.startsWith("baseline sha256:")));
		assert.ok(warn!.details?.some((d) => d.startsWith("current  sha256:")));
		assert.match(warn!.suggestion ?? "", /git diff/);
	});

	it("JSON-invalid config → error config-unreadable (parse wins over hash)", () => {
		put(".pi/velpari/files.json", JSON.stringify({ version: 4, projectName: "TamperApp" }));
		recordConfigBaseline(tmpDir);
		gitCommitAll("baseline");
		put(".pi/velpari/files.json", "{ not json !!");

		const section = checkConfigTamperSection(tmpDir);
		const err = section.items.find((i) => i.status === "error");
		assert.ok(err, "expected an error");
		assert.match(err!.message, /config-unreadable/);
		assert.match(err!.message, /not valid JSON/);
	});

	it("deleted config → warning naming the file", () => {
		put(".pi/velpari/files.json", JSON.stringify({ version: 4, projectName: "TamperApp" }));
		recordConfigBaseline(tmpDir);
		fs.rmSync(path.join(tmpDir, ".pi", "velpari", "files.json"));

		const section = checkConfigTamperSection(tmpDir);
		const warn = section.items.find((i) => i.status === "warning");
		assert.ok(warn, "expected a warning");
		assert.match(warn!.message, /files\.json: deleted since the baseline/);
	});

	it("corrupt manifest file → info (fail-open load), never crashes", () => {
		put(".pi/velpari/config-manifest.json", "{ definitely not json");
		const section = checkConfigTamperSection(tmpDir);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /config-baseline-missing/);
	});

	it("staged edit → git intent 'staged'", () => {
		put(".pi/velpari/files.json", JSON.stringify({ version: 4, projectName: "TamperApp" }));
		recordConfigBaseline(tmpDir);
		gitCommitAll("baseline");
		put(".pi/velpari/files.json", JSON.stringify({ version: 4, projectName: "StagedApp" }));
		const r = spawnSync("git", ["add", ".pi/velpari/files.json"], { cwd: tmpDir, encoding: "utf8" });
		assert.equal(r.status, 0);

		const section = checkConfigTamperSection(tmpDir);
		const warn = section.items.find((i) => i.status === "warning");
		assert.ok(warn, "expected a warning");
		assert.match(warn!.message, /git: staged/);
	});
});
