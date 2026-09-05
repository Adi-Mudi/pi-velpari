import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	detectInteractiveSubagentsVersion,
	detectMultiplexer,
	handleDoctor,
	runDoctor,
} from "../src/discipline/doctor/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-doctor-"));
}

function bundledSkillPath(): string {
	const candidates = [
		resolve(__dirname, "..", "..", "skills", "velpari-discuss.md"),
		resolve(__dirname, "..", "..", "..", "skills", "velpari-discuss.md"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return candidates[0]!;
}

// ---------------------------------------------------------------------------
// detectMultiplexer
// ---------------------------------------------------------------------------

test("detectMultiplexer returns unknown when no env vars set", () => {
	const result = detectMultiplexer({});
	assert.equal(result.mux, "unknown");
	assert.match(result.source, /none/);
});

test("detectMultiplexer respects PI_SUBAGENT_MUX override", () => {
	for (const mux of ["cmux", "tmux", "zellij", "wezterm"] as const) {
		const result = detectMultiplexer({ PI_SUBAGENT_MUX: mux });
		assert.equal(result.mux, mux);
		assert.equal(result.source, "PI_SUBAGENT_MUX");
	}
});

test("detectMultiplexer detects tmux via TMUX env var", () => {
	const result = detectMultiplexer({ TMUX: "/tmp/tmux-1000/default,12345,0" });
	assert.equal(result.mux, "tmux");
	assert.equal(result.source, "TMUX");
});

test("detectMultiplexer detects zellij via ZELLIJ_PANE_ID", () => {
	const result = detectMultiplexer({ ZELLIJ_PANE_ID: "5" });
	assert.equal(result.mux, "zellij");
	assert.equal(result.source, "ZELLIJ_PANE_ID");
});

test("detectMultiplexer detects zellij via ZELLIJ_SESSION_NAME (fallback)", () => {
	const result = detectMultiplexer({ ZELLIJ_SESSION_NAME: "my-session" });
	assert.equal(result.mux, "zellij");
	assert.equal(result.source, "ZELLIJ_SESSION_NAME");
});

test("detectMultiplexer detects wezterm via WEZTERM_PANE", () => {
	const result = detectMultiplexer({ WEZTERM_PANE: "0" });
	assert.equal(result.mux, "wezterm");
	assert.equal(result.source, "WEZTERM_PANE");
});

test("detectMultiplexer detects cmux via CMUX_PANE_ID", () => {
	const result = detectMultiplexer({ CMUX_PANE_ID: "1" });
	assert.equal(result.mux, "cmux");
	assert.equal(result.source, "CMUX_PANE_ID");
});

test("detectMultiplexer PI_SUBAGENT_MUX overrides any other env var", () => {
	const result = detectMultiplexer({
		PI_SUBAGENT_MUX: "wezterm",
		TMUX: "/tmp/tmux-1000/default,12345,0",
		ZELLIJ_PANE_ID: "5",
	});
	assert.equal(result.mux, "wezterm");
	assert.equal(result.source, "PI_SUBAGENT_MUX");
});

// ---------------------------------------------------------------------------
// detectInteractiveSubagentsVersion
// ---------------------------------------------------------------------------

test("detectInteractiveSubagentsVersion returns undefined when package not found", () => {
	const dir = tempDir();
	const version = detectInteractiveSubagentsVersion(dir);
	assert.equal(version, undefined);
	rmSync(dir, { recursive: true, force: true });
});

test("detectInteractiveSubagentsVersion returns version when package.json exists in cwd/node_modules", () => {
	const dir = tempDir();
	const pkgDir = join(dir, "node_modules", "@earendil-works", "pi-interactive-subagents");
	mkdirSync(pkgDir, { recursive: true });
	writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ version: "3.7.5" }), "utf8");
	const version = detectInteractiveSubagentsVersion(dir);
	assert.equal(version, "3.7.5");
	rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// runDoctor new sections
// ---------------------------------------------------------------------------

test("runDoctor includes the Multiplexer section", () => {
	const dir = tempDir();
	const report = runDoctor(dir);
	assert.match(report, /## Multiplexer \(required for \/velpari-discuss v2\.0\)/);
	assert.match(report, /Detected:/);
	assert.match(report, /pi-interactive-subagents:/);
	rmSync(dir, { recursive: true, force: true });
});

test("runDoctor warns when no multiplexer is detected", () => {
	const dir = tempDir();
	const origMux = process.env.PI_SUBAGENT_MUX;
	const origTmux = process.env.TMUX;
	const origZellijPane = process.env.ZELLIJ_PANE_ID;
	const origZellijSession = process.env.ZELLIJ_SESSION_NAME;
	const origWezterm = process.env.WEZTERM_PANE;
	const origCmuxPane = process.env.CMUX_PANE_ID;
	const origCmuxSession = process.env.CMUX_SESSION_NAME;
	delete process.env.PI_SUBAGENT_MUX;
	delete process.env.TMUX;
	delete process.env.ZELLIJ_PANE_ID;
	delete process.env.ZELLIJ_SESSION_NAME;
	delete process.env.WEZTERM_PANE;
	delete process.env.WEZTERM_EXECUTABLE;
	delete process.env.CMUX_PANE_ID;
	delete process.env.CMUX_SESSION_NAME;
	try {
		const report = runDoctor(dir);
		assert.match(report, /Detected: unknown/);
		assert.match(report, /\/velpari-discuss requires a supported multiplexer/);
	} finally {
		if (origMux !== undefined) process.env.PI_SUBAGENT_MUX = origMux;
		if (origTmux !== undefined) process.env.TMUX = origTmux;
		if (origZellijPane !== undefined) process.env.ZELLIJ_PANE_ID = origZellijPane;
		if (origZellijSession !== undefined) process.env.ZELLIJ_SESSION_NAME = origZellijSession;
		if (origWezterm !== undefined) process.env.WEZTERM_PANE = origWezterm;
		if (origCmuxPane !== undefined) process.env.CMUX_PANE_ID = origCmuxPane;
		if (origCmuxSession !== undefined) process.env.CMUX_SESSION_NAME = origCmuxSession;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runDoctor includes zellij Issue #19 warning when ZELLIJ_PANE_ID is set", () => {
	const dir = tempDir();
	const origZellij = process.env.ZELLIJ_PANE_ID;
	process.env.ZELLIJ_PANE_ID = "5";
	try {
		const report = runDoctor(dir);
		assert.match(report, /Detected: zellij/);
		assert.match(report, /Issue #19/);
		assert.match(report, /do NOT manually focus a subagent pane/);
	} finally {
		if (origZellij !== undefined) {
			process.env.ZELLIJ_PANE_ID = origZellij;
		} else {
			delete process.env.ZELLIJ_PANE_ID;
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runDoctor includes Scout agents section", () => {
	const dir = tempDir();
	const report = runDoctor(dir);
	assert.match(report, /## Scout agents \(\.pi\/agents\/\)/);
	assert.match(report, /extractor\.md MISSING/);
	assert.match(report, /prd-checker\.md MISSING/);
	assert.match(report, /rtm-checker\.md MISSING/);
	assert.match(report, /web-search-agent\.md MISSING/);
	rmSync(dir, { recursive: true, force: true });
});

test("runDoctor warns when .pi/agents/extractor.md has bad frontmatter", () => {
	const dir = tempDir();
	const agentsDir = join(dir, ".pi", "agents");
	mkdirSync(agentsDir, { recursive: true });
	// Missing fields
	writeFileSync(
		join(agentsDir, "extractor.md"),
		"---\nname: extractor\ndescription: bad\n---\nbody\n",
		"utf8",
	);
	const report = runDoctor(dir);
	assert.match(report, /extractor\.md frontmatter missing/);
	rmSync(dir, { recursive: true, force: true });
});

test("runDoctor includes Stage skills section", () => {
	const dir = tempDir();
	// Copy the real skill markdown into the temp dir so the check finds it.
	const realPath = bundledSkillPath();
	const skillsDir = join(dir, "skills");
	mkdirSync(skillsDir, { recursive: true });
	copyFileSync(realPath, join(skillsDir, "velpari-discuss.md"));
	const report = runDoctor(dir);
	assert.match(report, /## Stage skills/);
	assert.match(report, /skills\/velpari-discuss\.md: OK/);
	rmSync(dir, { recursive: true, force: true });
});

test("runDoctor warns when skill markdown contains max_turns (regression)", () => {
	const dir = tempDir();
	const skillsDir = join(dir, "skills");
	mkdirSync(skillsDir, { recursive: true });
	const bad = `---
name: velpari-discuss
description: bad
---

# Skill with max_turns hallucination
Set max_turns: 15 for each scout.
`;
	writeFileSync(join(skillsDir, "velpari-discuss.md"), bad, "utf8");
	const report = runDoctor(dir);
	assert.match(report, /skills\/velpari-discuss\.md: \d+ issue/);
	assert.match(report, /removed v2\.0 hallucination 'max_turns'/);
	rmSync(dir, { recursive: true, force: true });
});

test("runDoctor warns when skill markdown is missing pi-interactive-subagents reference", () => {
	const dir = tempDir();
	const skillsDir = join(dir, "skills");
	mkdirSync(skillsDir, { recursive: true });
	const bad = `---
name: velpari-discuss
description: bad
---

# No mention of the dependency
`;
	writeFileSync(join(skillsDir, "velpari-discuss.md"), bad, "utf8");
	const report = runDoctor(dir);
	assert.match(report, /missing reference to pi-interactive-subagents/);
	rmSync(dir, { recursive: true, force: true });
});

test("runDoctor warns when skill markdown is missing", () => {
	const dir = tempDir();
	const report = runDoctor(dir);
	assert.match(report, /skills\/velpari-discuss\.md MISSING/);
	rmSync(dir, { recursive: true, force: true });
});

test("runDoctor passes all v2.0 checks on the actual repo (skills/agents in expected location)", () => {
	// This test exercises the full doctor against the actual repo state.
	// We expect the actual repo to pass all v2.0 checks because we shipped it that way.
	// From dist/pi-extension/test/ we need to go up 3 levels to reach repo root.
	const cwd = resolve(__dirname, "..", "..", "..");
	const report = runDoctor(cwd);
	assert.match(report, /## Multiplexer/);
	assert.match(report, /## Scout agents \(\.pi\/agents\/\)/);
	assert.match(report, /## Stage skills/);
	// At minimum, the bundled skill markdown should pass the integrity gate.
	assert.match(report, /skills\/velpari-discuss\.md: OK/);
});

// ---------------------------------------------------------------------------
// All-stages Doctor coverage (Phase 6)
// ---------------------------------------------------------------------------

test("runDoctor enumerates Scout agents for all 9 stages (Phase 6)", () => {
	const cwd = resolve(__dirname, "..", "..", "..");
	const report = runDoctor(cwd);
	// Every stage should have its own subsection in the Scout agents section.
	for (const stage of [
		"discuss",
		"prd",
		"rtm",
		"feasibility",
		"design",
		"pseudocode",
		"testplan",
		"atomic-function",
		"development-order",
	]) {
		assert.match(
			report,
			new RegExp(`/velpari-${stage.replace(/[-]/g, "-")} \\(`),
			`Scout agents section should list /velpari-${stage}`,
		);
	}
});

test("runDoctor checks Stage skills for all 10 stages (Phase 7: adds configure-requirements)", () => {
	const cwd = resolve(__dirname, "..", "..", "..");
	const report = runDoctor(cwd);
	// Every stage's skill markdown should be checked.
	for (const stage of [
		"discuss",
		"prd",
		"rtm",
		"feasibility",
		"design",
		"pseudocode",
		"testplan",
		"atomic-function",
		"development-order",
		"configure-requirements",
	]) {
		assert.ok(
			report.includes(`skills/velpari-${stage}.md`),
			`Stage skills section should reference skills/velpari-${stage}.md`,
		);
	}
});

test("runDoctor Scout agents summary counts all 36 scouts (9 stages × 4)", () => {
	const cwd = resolve(__dirname, "..", "..", "..");
	const report = runDoctor(cwd);
	assert.match(report, /36 scouts expected across 9 stages/);
});

test("runDoctor Stage skills summary covers all 10 skills (Phase 7)", () => {
	const cwd = resolve(__dirname, "..", "..", "..");
	const report = runDoctor(cwd);
	assert.match(report, /10 stage skills checked/);
});

// ---------------------------------------------------------------------------
// Profile reporting (research-based profile workflow, 2026-09-05)
// ---------------------------------------------------------------------------

import { mkdirSync as _mkdirSync } from "node:fs";
import { REQUIREMENTS_PROFILE_VERSION } from "../src/core/profile.js";
import { composeProfile, findBuiltInProfile } from "../src/core/profiles-library.js";

test("runDoctor reports Profile MISSING when no profile JSON exists", () => {
	const dir = tempDir();
	try {
		const report = runDoctor(dir);
		assert.match(report, /## Requirements profile/);
		assert.match(report, /Profile: MISSING/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runDoctor reports Profile VALID with id + version + mode", () => {
	const dir = tempDir();
	try {
		const built = findBuiltInProfile("banking-web-v1")!;
		const profile = composeProfile(built, {
			what: "x",
			who: "y",
			problem: "z",
			novelty: "new-product",
			platforms: [],
			sensitiveData: false,
			externalSystems: false,
			existingCodebase: false,
			applicationType: built.applicationType,
			domain: built.domain,
			developmentMethod: built.developmentMethod,
			securityLevel: built.securityLevel,
			regulated: built.regulated,
		}, false, []);
		const cfgDir = join(dir, ".pi", "velpari");
		_mkdirSync(cfgDir, { recursive: true });
		writeFileSync(join(cfgDir, "requirements-profile.json"), JSON.stringify(profile, null, 2), "utf8");
		const report = runDoctor(dir);
		assert.match(report, /## Requirements profile/);
		assert.match(report, /Profile: VALID mode=built-in id=banking-web-v1/);
		assert.match(report, /version=/);
		assert.match(report, new RegExp(`expected ${REQUIREMENTS_PROFILE_VERSION}`));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runDoctor reports common-core profile as a real, valid choice", () => {
	const dir = tempDir();
	try {
		const profile = composeProfile(findBuiltInProfile("core-psrs-v1")!, {
			what: "x",
			who: "y",
			problem: "z",
			novelty: "new-product",
			platforms: [],
			sensitiveData: false,
			externalSystems: false,
			existingCodebase: false,
			applicationType: "other",
			domain: "general",
			developmentMethod: "agile",
			securityLevel: "medium",
			regulated: false,
		}, false, []);
		const cfgDir = join(dir, ".pi", "velpari");
		_mkdirSync(cfgDir, { recursive: true });
		writeFileSync(join(cfgDir, "requirements-profile.json"), JSON.stringify(profile, null, 2), "utf8");
		const report = runDoctor(dir);
		assert.match(report, /Profile: VALID mode=common-core id=core-psrs-v1/);
		assert.match(report, /Common PSRS core selected/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runDoctor reports research consent + source count + report-only stance", () => {
	const dir = tempDir();
	try {
		const built = findBuiltInProfile("banking-web-v1")!;
		const profile = composeProfile(built, {
			what: "x",
			who: "y",
			problem: "z",
			novelty: "new-product",
			platforms: [],
			sensitiveData: false,
			externalSystems: false,
			existingCodebase: false,
			applicationType: built.applicationType,
			domain: built.domain,
			developmentMethod: built.developmentMethod,
			securityLevel: built.securityLevel,
			regulated: built.regulated,
		}, true, ["https://example.com/a", "https://example.com/b"]);
		const cfgDir = join(dir, ".pi", "velpari");
		_mkdirSync(cfgDir, { recursive: true });
		writeFileSync(join(cfgDir, "requirements-profile.json"), JSON.stringify(profile, null, 2), "utf8");
		const report = runDoctor(dir);
		assert.match(report, /Research consent: yes/);
		assert.match(report, /Research source count: 2/);
		assert.match(report, /Doctor is report-only/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runDoctor still shows MISSING when profile JSON is malformed", () => {
	const dir = tempDir();
	try {
		const cfgDir = join(dir, ".pi", "velpari");
		_mkdirSync(cfgDir, { recursive: true });
		writeFileSync(join(cfgDir, "requirements-profile.json"), "{bad json", "utf8");
		const report = runDoctor(dir);
		assert.match(report, /Profile: MISSING/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// handleDoctor — Phase D follow-up. Previously no test covered the handler
// that wraps runDoctor + writeDoctorReport + ctx.ui.notify. This test pins
// the truncation path: a synthetic oversized report must end with the
// "\n... [truncated]" marker when MAX_NOTIFY_LENGTH (8000) is exceeded.
// ---------------------------------------------------------------------------

test("handleDoctor truncates the TUI notify when the report exceeds MAX_NOTIFY_LENGTH", async () => {
	const dir = tempDir();
	try {
		// Stage a stub `files.json` and a `state.json` so runDoctor doesn't
		// fall through the "no state" branch (smaller output).
		const cfgDir = join(dir, ".pi", "velpari");
		mkdirSync(cfgDir, { recursive: true });
		writeFileSync(join(cfgDir, "files.json"), JSON.stringify({
			version: 3, projectName: "T", framework: {}, inputDocuments: [], outputPaths: {}, excludedPaths: [],
		}));
		// Write a minimal run state so runDoctor enters the "state present"
		// branch. Avoids the import-of-createRun dependency.
		mkdirSync(join(dir, ".IDE_Plans", "velpari"), { recursive: true });
		writeFileSync(
			join(dir, ".IDE_Plans", "velpari", "state.json"),
			JSON.stringify({
				version: 1,
				runId: "test-run",
				mission: "mission",
				currentStage: "discussed",
				history: [],
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);

		// Build a ctx that records notify calls. We then synthesize a large
		// report by writing many artifacts, growing runDoctor's output well
		// past MAX_NOTIFY_LENGTH (8000 chars). The notify that exceeds 8000
		// must end with "\n... [truncated]".
		const notifyCalls: Array<{ msg: string; level: string }> = [];
		const ctx = {
			ui: {
				notify: (msg: string, level: string) => { notifyCalls.push({ msg, level }); },
				input: async () => undefined,
				confirm: async () => true,
				select: async () => undefined,
			},
			cwd: dir,
		} as never;

		// Force the report past 8000 chars by writing many doc artifacts plus
		// all 36 scout agent files with bad frontmatter. The MISSING/error
		// lines for the scout files are the longest printed section;
		// combined with 100 doc artifacts the report reliably exceeds
		// MAX_NOTIFY_LENGTH.
		mkdirSync(join(dir, "Doc"), { recursive: true });
		const fill = "x".repeat(300);
		for (let i = 0; i < 100; i++) {
			writeFileSync(join(dir, "Doc", `artifact_${i}.md`), `# ${fill}\n\n${fill.repeat(20)}\n`, "utf8");
		}
		// Write every scout agent file with deliberately-bad frontmatter
		// so the doctor prints the long "missing required fields" line.
		const agentsDir = join(dir, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		const allScouts: ReadonlyArray<string> = [
			"extractor", "prd-checker", "rtm-checker", "web-search-agent",
			"fr-extractor", "nfr-checker", "helper-detector", "consolidator",
			"rtm-requirement-tracer", "rtm-test-case-linker", "rtm-coverage-analyzer", "rtm-consolidator",
			"feasibility-tech", "feasibility-schedule", "feasibility-cost", "feasibility-risk",
			"design-module-decomposer", "design-contract-definer", "design-data-flow-mapper", "design-error-definer",
			"pseudo-algorithm-extractor", "pseudo-edge-case-handler", "pseudo-complexity-analyzer", "pseudo-consolidator",
			"testplan-strategy-designer", "testplan-unit-test-generator", "testplan-integration-test-generator", "testplan-coverage-tracer",
			"af-source-rtm", "af-source-pseudocode", "af-source-prd", "af-source-testcases",
			"do-topology", "do-risk", "do-test", "do-value",
		];
		for (const id of allScouts) {
			// Empty frontmatter-only stub; doctor will report all required fields as missing.
			writeFileSync(join(agentsDir, `${id}.md`), "---\n---\n", "utf8");
		}

		await handleDoctor(ctx, dir);

		assert.ok(notifyCalls.length >= 1, "handleDoctor must call notify at least once");
		// First notify is the report; second is the "report written" line.
		const reportNotify = notifyCalls[0]!;
		assert.ok(reportNotify.msg.length > 8000, "test setup must produce a report > MAX_NOTIFY_LENGTH");
		assert.match(
			reportNotify.msg,
			/\n\.\.\. \[truncated\]$/,
			"oversized report must end with the truncation marker",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});