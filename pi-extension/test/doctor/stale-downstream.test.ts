/**
 * Doctor stale-downstream + gate-wiring tests (living documents).
 *
 * Asserts:
 *   - fresh project (no artifacts) → ok item, no errors
 *   - stamped RTM whose PRD input changed → stale error naming /velpari-rtm
 *   - deprecated FR referenced live in the RTM → error per ID
 *   - deprecated RTM row for a deprecated FR → no error
 *   - gate wiring: all stage keys gated, stage folders locked, lock free
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkGateWiringSection, checkStaleDownstreamSection } from "../../src/doctor/checks/stale-downstream.js";
import { hashFileContent } from "../../src/core/fingerprints.js";
import { recordPublish } from "../../src/core/freshness.js";

let tmpDir: string;

function publish(rel: string, content: string): string {
	const abs = path.join(tmpDir, "Doc", rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf8");
	return abs;
}

/** Publish PRD + RTM and stamp the RTM with the current PRD hash (B4). */
function publishStampedRtm(): { prdPath: string } {
	const prdPath = publish("requirements/PRD_TestApp.md", PRD_LIVE);
	publish("requirements/RTM_TestApp.md", RTM_LIVE);
	recordPublish(tmpDir, {
		artifact: "rtm",
		projectName: "TestApp",
		path: path.join("Doc", "requirements", "RTM_TestApp.md"),
		publishedAt: "2026-09-20T17:00:00.000Z",
		inputs: { "prd:TestApp": hashFileContent(prdPath)! },
	});
	return { prdPath };
}

const PRD_LIVE = `# PSRS

## Functional Requirements

| ID | Requirement | Priority | Acceptance | Verification | Status |
|---|---|---|---|---|---|
| FR-01 | Add expense | must | expense saved | Integration test | approved |
`;

const PRD_DEPRECATED = `# PSRS

## Functional Requirements

| ID | Requirement | Priority | Acceptance | Verification | Status |
|---|---|---|---|---|---|
| FR-01 | Add expense | must | expense saved | Integration test | deprecated |
`;

const RTM_LIVE = `# RTM

| Req ID | Requirement | Design Element | Implementation / Helper Function | Test Case(s) | Status |
|---|---|---|---|---|---|
| FR-01 | Add expense | ExpenseModule | addExpense | TC-01 | approved |
`;

const RTM_DEPRECATED = `# RTM

| Req ID | Requirement | Design Element | Implementation / Helper Function | Test Case(s) | Status |
|---|---|---|---|---|---|
| FR-01 | Add expense | ExpenseModule | addExpense | TC-01 | deprecated |
`;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-stale-downstream-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("checkStaleDownstreamSection", () => {
	it("fresh project (no artifacts) → ok, no errors", () => {
		const section = checkStaleDownstreamSection(tmpDir, "TestApp");
		assert.equal(section.title, "Stale downstream artifacts");
		assert.ok(section.items.every((i) => i.status !== "error"));
		assert.ok(section.items.some((i) => i.status === "ok"));
	});

	it("missing project name → info skip", () => {
		const section = checkStaleDownstreamSection(tmpDir, "");
		assert.equal(section.items[0]?.status, "info");
	});

	it("PRD content changed after the RTM was stamped → stale error naming /velpari-rtm", () => {
		const { prdPath } = publishStampedRtm();
		fs.writeFileSync(prdPath, PRD_LIVE.replace("Add expense", "Add expense v2"), "utf8");

		const section = checkStaleDownstreamSection(tmpDir, "TestApp");
		const stale = section.items.filter((i) => i.status === "error");
		assert.equal(stale.length, 1);
		assert.match(stale[0]!.message, /rtm:TestApp is stale/);
		assert.match(stale[0]!.message, /\/velpari-rtm/);
		assert.match(stale[0]!.suggestion ?? "", /update mode/);
	});

	it("touching the PRD without changing content → NOT stale (hash, not mtime)", () => {
		const { prdPath } = publishStampedRtm();
		const future = new Date(Date.now() + 60_000);
		fs.utimesSync(prdPath, future, future);

		const section = checkStaleDownstreamSection(tmpDir, "TestApp");
		assert.ok(section.items.every((i) => i.status !== "error"));
	});

	it("in-sync stamped pair → ok item", () => {
		publishStampedRtm();

		const section = checkStaleDownstreamSection(tmpDir, "TestApp");
		assert.ok(section.items.every((i) => i.status !== "error"));
		assert.match(section.items.at(-1)?.message ?? "", /in sync/);
	});

	it("deprecated FR referenced live in the RTM → error per ID", () => {
		publish("requirements/PRD_TestApp.md", PRD_DEPRECATED);
		publish("requirements/RTM_TestApp.md", RTM_LIVE);

		const section = checkStaleDownstreamSection(tmpDir, "TestApp");
		const errors = section.items.filter((i) => i.status === "error");
		assert.equal(errors.length, 1);
		assert.match(errors[0]!.message, /FR-01 is deprecated in the PRD/);
	});

	it("deprecated RTM row for a deprecated FR → no error", () => {
		publish("requirements/PRD_TestApp.md", PRD_DEPRECATED);
		publish("requirements/RTM_TestApp.md", RTM_DEPRECATED);

		const section = checkStaleDownstreamSection(tmpDir, "TestApp");
		assert.ok(section.items.every((i) => i.status !== "error"));
	});
});

describe("checkGateWiringSection", () => {
	it("reports all stage commands gated and the lock free", () => {
		const section = checkGateWiringSection(tmpDir);
		assert.equal(section.title, "Sequence hardening");
		assert.ok(section.items.every((i) => i.status === "ok"));
		assert.match(section.items[0]?.message ?? "", /9\/9 stage commands gated/);
		assert.match(section.items[1]?.message ?? "", /tool_call stage guard/);
		assert.match(section.items[2]?.message ?? "", /Run lock: free/);
	});

	it("flags a stale run lock as a warning (never an error)", () => {
		const lockDir = path.join(tmpDir, ".pi", "velpari", ".lock");
		fs.mkdirSync(lockDir, { recursive: true });
		const old = new Date(Date.now() - 120_000).toISOString();
		fs.writeFileSync(
			path.join(lockDir, "meta.json"),
			JSON.stringify({
				pid: 2_000_000_000,
				host: "other-host",
				command: "crashed",
				startedAt: old,
				heartbeatAt: old,
			}),
			"utf8",
		);

		const section = checkGateWiringSection(tmpDir);
		const lockItem = section.items.find((i) => i.message.startsWith("Run lock:"));
		assert.equal(lockItem?.status, "warning");
		assert.match(lockItem?.message ?? "", /STALE/);
	});
});
