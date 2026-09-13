/**
 * Brainstorm scan dispatcher tests (Phase 3).
 *
 * Covers: scan-type → scout role mapping, per-type cap (2), total cap (3),
 * read-only tool stripping (code/doc → read,grep,glob; community keeps
 * websearch+fetchurl), FR-52 enforcement (web-search-agent rejected for
 * non-community scans), unknown scout rejection, timeouts (30s/90s),
 * artifact path containment, and the prepared payload shape.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { saveAgentConfig } from "../../../src/core/agents-config.js";
import {
	BRAINSTORM_COMMUNITY_DISPATCH_TIMEOUT_MS,
	BRAINSTORM_DISPATCH_TIMEOUT_MS,
	DEFAULT_SCANS,
	enforceReadOnlyTools,
	formatPreparedDispatch,
	formatScanPlanLines,
	prepareDispatch,
	SCAN_TYPE_DISPATCH_CAP,
	SCAN_TYPE_ROLES,
} from "../../../src/stages/brainstorm/dispatcher.js";

const RUN_DIR = path.resolve("/tmp/velpari-dispatcher-test/runs/run-1");

describe("SCAN_TYPE_ROLES + DEFAULT_SCANS", () => {
	it("maps scan types to velpari scouts", () => {
		assert.deepEqual(SCAN_TYPE_ROLES.code, ["extractor", "prd-checker"]);
		assert.deepEqual(SCAN_TYPE_ROLES.doc, ["prd-checker", "rtm-checker"]);
		assert.deepEqual(SCAN_TYPE_ROLES.community, ["web-search-agent"]);
	});

	it("defaults to code+doc (community only with user consent — FR-52)", () => {
		assert.deepEqual(DEFAULT_SCANS, ["code", "doc"]);
	});
});

describe("enforceReadOnlyTools", () => {
	it("strips write/edit/bash for code and doc scans", () => {
		assert.deepEqual(
			enforceReadOnlyTools(["read", "write", "grep", "bash", "glob"], "code"),
			["read", "grep", "glob"],
		);
		assert.deepEqual(enforceReadOnlyTools(["write", "edit"], "doc"), []);
	});

	it("keeps websearch+fetchurl for community scans only", () => {
		assert.deepEqual(
			enforceReadOnlyTools(["read", "websearch", "fetchurl"], "community"),
			["read", "websearch", "fetchurl"],
		);
		assert.deepEqual(enforceReadOnlyTools(["read", "websearch"], "code"), ["read"]);
	});

	it("rejects unknown tools", () => {
		assert.deepEqual(enforceReadOnlyTools(["read", "mcp/foo"], "code"), ["read"]);
	});
});

describe("prepareDispatch", () => {
	it("prepares a code-scan dispatch (30s timeout, read-only tools)", () => {
		const res = prepareDispatch(
			{ agent: "extractor", task: "Scan the codebase", scanType: "code" },
			RUN_DIR,
			0,
		);
		assert.equal(res.ok, true);
		if (!res.ok) return;
		assert.equal(res.prepared.agent, "extractor");
		assert.equal(res.prepared.scanType, "code");
		assert.deepEqual(res.prepared.tools, ["read", "grep", "glob"]);
		assert.equal(res.prepared.subagentArgs.timeoutMs, BRAINSTORM_DISPATCH_TIMEOUT_MS);
		assert.equal(BRAINSTORM_DISPATCH_TIMEOUT_MS, 30_000);
	});

	it("gives community scans the 90s timeout", () => {
		const res = prepareDispatch(
			{ agent: "web-search-agent", task: "Research prior art", scanType: "community" },
			RUN_DIR,
			0,
		);
		assert.equal(res.ok, true);
		if (!res.ok) return;
		assert.equal(res.prepared.subagentArgs.timeoutMs, BRAINSTORM_COMMUNITY_DISPATCH_TIMEOUT_MS);
		assert.equal(BRAINSTORM_COMMUNITY_DISPATCH_TIMEOUT_MS, 90_000);
	});

	it("returns the prepared payload shape (subagentArgs: agent/cwd/task/timeoutMs)", () => {
		const res = prepareDispatch(
			{ agent: "prd-checker", task: "Check PRD delta", scanType: "doc" },
			RUN_DIR,
			1,
		);
		assert.equal(res.ok, true);
		if (!res.ok) return;
		assert.deepEqual(Object.keys(res.prepared.subagentArgs).sort(), [
			"agent",
			"cwd",
			"task",
			"timeoutMs",
		]);
		assert.equal(res.prepared.subagentArgs.agent, "prd-checker");
		assert.equal(res.prepared.subagentArgs.cwd, RUN_DIR);
		assert.equal(res.prepared.subagentArgs.task, "Check PRD delta");
		assert.equal(res.prepared.dispatchNumber, 2);
		assert.ok(!Number.isNaN(Date.parse(res.prepared.startedAt)));
	});

	it("rejects an unknown scout", () => {
		const res = prepareDispatch(
			{ agent: "secret-agent", task: "x", scanType: "code" },
			RUN_DIR,
			0,
		);
		assert.equal(res.ok, false);
		if (res.ok) return;
		assert.match(res.reason, /not a velpari scout/);
	});

	it("rejects web-search-agent for non-community scans (FR-52)", () => {
		for (const scanType of ["code", "doc"] as const) {
			const res = prepareDispatch(
				{ agent: "web-search-agent", task: "x", scanType },
				RUN_DIR,
				0,
			);
			assert.equal(res.ok, false);
			if (res.ok) return;
			assert.match(res.reason, /community/);
		}
	});

	it("rejects a scout that does not serve the scan type", () => {
		const res = prepareDispatch(
			{ agent: "extractor", task: "x", scanType: "doc" },
			RUN_DIR,
			0,
		);
		assert.equal(res.ok, false);
		if (res.ok) return;
		assert.match(res.reason, /does not serve/);
	});

	it("enforces the per-type cap (2)", () => {
		const res = prepareDispatch(
			{ agent: "extractor", task: "x", scanType: "code" },
			RUN_DIR,
			0,
			SCAN_TYPE_DISPATCH_CAP,
		);
		assert.equal(res.ok, false);
		if (res.ok) return;
		assert.match(res.reason, /Scan-type cap/);
		assert.equal(SCAN_TYPE_DISPATCH_CAP, 2);
	});

	it("enforces the total dispatch cap (3)", () => {
		const res = prepareDispatch(
			{ agent: "extractor", task: "x", scanType: "code" },
			RUN_DIR,
			3,
			0,
		);
		assert.equal(res.ok, false);
		if (res.ok) return;
		assert.match(res.reason, /cap reached \(3\)/);
	});

	it("rejects artifact paths outside the run dir", () => {
		const res = prepareDispatch(
			{
				agent: "extractor",
				task: "x",
				scanType: "code",
				artifactPaths: [path.join(RUN_DIR, "brainstorm", "report.json")],
			},
			RUN_DIR,
			0,
		);
		assert.equal(res.ok, true);

		const bad = prepareDispatch(
			{
				agent: "extractor",
				task: "x",
				scanType: "code",
				artifactPaths: [path.join(RUN_DIR, "..", "state.json")],
			},
			RUN_DIR,
			0,
		);
		assert.equal(bad.ok, false);
		if (bad.ok) return;
		assert.match(bad.reason, /escapes the run dir/);
	});

	it("rejects when no read-only tools survive stripping", () => {
		const res = prepareDispatch(
			{ agent: "extractor", task: "x", scanType: "code", tools: ["write", "bash"] },
			RUN_DIR,
			0,
		);
		assert.equal(res.ok, false);
		if (res.ok) return;
		assert.match(res.reason, /no read-only tools/);
	});
});

describe("formatScanPlanLines + formatPreparedDispatch", () => {
	it("renders per-scan lines with roles and timeouts", () => {
		const lines = formatScanPlanLines(["code", "doc", "community"]);
		assert.match(lines[0] ?? "", /code — scouts: extractor, prd-checker \(timeout 30s\)/);
		assert.match(lines[1] ?? "", /doc — scouts: prd-checker, rtm-checker \(timeout 30s\)/);
		assert.match(lines[2] ?? "", /community — scouts: web-search-agent \(timeout 90s\)/);
	});

	it("renders the skipped-scans line for an empty selection", () => {
		assert.match(formatScanPlanLines([])[0] ?? "", /skipped scans/);
	});

	it("formats a prepared dispatch prompt block", () => {
		const res = prepareDispatch(
			{ agent: "extractor", task: "Scan it", scanType: "code", expectedOutput: "JSON report" },
			RUN_DIR,
			0,
		);
		assert.equal(res.ok, true);
		if (!res.ok) return;
		const block = formatPreparedDispatch(res.prepared);
		assert.match(block, /## Prepared dispatch/);
		assert.match(block, /subagent\(\{/);
		assert.match(block, /Expected output: JSON report/);
	});
});

describe("role → agent-name resolution (agents.json)", () => {
	function tmpCwd(): string {
		return mkdtempSync(path.join(tmpdir(), "velpari-dispatcher-agents-"));
	}

	it("resolves subagentArgs.agent to the custom name while prepared.agent stays the role", () => {
		const cwd = tmpCwd();
		saveAgentConfig(cwd, { version: 1, agents: { extractor: "my-extractor" } });
		const res = prepareDispatch(
			{ agent: "extractor", task: "Scan the codebase", scanType: "code" },
			RUN_DIR,
			0,
			0,
			cwd,
		);
		assert.equal(res.ok, true);
		if (!res.ok) return;
		assert.equal(res.prepared.agent, "extractor");
		assert.equal(res.prepared.subagentArgs.agent, "my-extractor");
		const block = formatPreparedDispatch(res.prepared);
		assert.match(block, /`extractor` → spawn `my-extractor`/);
	});

	it("defaults to the identity mapping when agents.json is absent", () => {
		const res = prepareDispatch(
			{ agent: "extractor", task: "x", scanType: "code" },
			RUN_DIR,
			0,
			0,
			tmpCwd(),
		);
		assert.equal(res.ok, true);
		if (!res.ok) return;
		assert.equal(res.prepared.subagentArgs.agent, "extractor");
	});

	it("keeps the FR-52 anchor on the role: a remapped web-search-agent is still refused for non-community scans", () => {
		const cwd = tmpCwd();
		saveAgentConfig(cwd, { version: 1, agents: { "web-search-agent": "my-web-scout" } });
		for (const scanType of ["code", "doc"] as const) {
			const res = prepareDispatch(
				{ agent: "web-search-agent", task: "x", scanType },
				RUN_DIR,
				0,
				0,
				cwd,
			);
			assert.equal(res.ok, false);
			if (res.ok) return;
			assert.match(res.reason, /community/);
		}
		// …and the community scan spawns the custom agent.
		const ok = prepareDispatch(
			{ agent: "web-search-agent", task: "Research", scanType: "community" },
			RUN_DIR,
			0,
			0,
			cwd,
		);
		assert.equal(ok.ok, true);
		if (!ok.ok) return;
		assert.equal(ok.prepared.agent, "web-search-agent");
		assert.equal(ok.prepared.subagentArgs.agent, "my-web-scout");
	});

	it("formatScanPlanLines renders `role → custom` only with a mapping", () => {
		const cwd = tmpCwd();
		saveAgentConfig(cwd, { version: 1, agents: { extractor: "my-extractor" } });
		const lines = formatScanPlanLines(["code", "community"], cwd);
		assert.match(lines[0] ?? "", /code — scouts: extractor → my-extractor, prd-checker \(timeout 30s\)/);
		assert.match(lines[1] ?? "", /community — scouts: web-search-agent \(timeout 90s\)/);
		// Without a mapping the format stays byte-identical to the role-only form.
		const plain = formatScanPlanLines(["code"], tmpCwd());
		assert.equal(plain[0], "- code — scouts: extractor, prd-checker (timeout 30s)");
	});
});
