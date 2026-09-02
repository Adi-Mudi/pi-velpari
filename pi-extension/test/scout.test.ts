import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTimeout, readScoutSkill, runScout } from "../src/scout.js";
import type { ScoutInput, ScoutOutput } from "../src/contracts.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-scout-"));
}

test("withTimeout resolves when promise resolves", async () => {
	const result = await withTimeout(Promise.resolve("ok"), 1000);
	assert.equal(result, "ok");
});

test("withTimeout rejects when promise rejects", async () => {
	await assert.rejects(async () => {
		await withTimeout(Promise.reject(new Error("boom")), 1000);
	}, /boom/);
});

test("withTimeout rejects with timeout error when promise hangs", async () => {
	const slow = new Promise(() => {
		/* never resolves */
	});
	await assert.rejects(async () => {
		await withTimeout(slow, 50);
	}, /timed out after 50ms/);
});

test("readScoutSkill returns empty string when file missing", () => {
	const dir = tempDir();
	try {
		const result = readScoutSkill("extractor", dir);
		assert.equal(result, "");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("readScoutSkill returns file content when present", () => {
	const dir = tempDir();
	try {
		const scoutDir = join(dir, "skills", "discuss-subagents");
		mkdirSync(scoutDir, { recursive: true });
		writeFileSync(join(scoutDir, "extractor.md"), "# EXTRACTOR\n", "utf8");
		const result = readScoutSkill("extractor", dir);
		assert.match(result, /EXTRACTOR/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runScout returns empty ScoutOutput when scout throws", async () => {
	const input: ScoutInput = {
		mission: "test",
		interviewAnswers: [],
		framework: undefined,
		existingPrd: undefined,
		existingRtm: undefined,
		webSearchAllowed: false,
	};
	const throwingScout = async (): Promise<ScoutOutput> => {
		throw new Error("scout crashed");
	};
	const result = await runScout("extractor", throwingScout, input);
	assert.equal(result.proposals.length, 0);
	assert.equal(result.source, "extractor");
});

test("runScout returns empty ScoutOutput when scout times out", async () => {
	const input: ScoutInput = {
		mission: "test",
		interviewAnswers: [],
		framework: undefined,
		existingPrd: undefined,
		existingRtm: undefined,
		webSearchAllowed: false,
	};
	const hangingScout = async (): Promise<ScoutOutput> => {
		return await new Promise(() => {
			/* never resolves */
		});
	};
	// Override timeout to 50ms for the test (default is 30s, would slow the suite).
	const result = await runScout("extractor", hangingScout, input, 50);
	assert.equal(result.proposals.length, 0);
});
