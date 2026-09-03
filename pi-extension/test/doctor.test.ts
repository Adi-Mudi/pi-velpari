import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	detectInteractiveSubagentsVersion,
	detectMultiplexer,
	runDoctor,
} from "../src/doctor.js";

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
	const origZellij = process.env.ZELLIJ_PANE_ID;
	const origWezterm = process.env.WEZTERM_PANE;
	const origCmux = process.env.CMUX_PANE_ID;
	delete process.env.PI_SUBAGENT_MUX;
	delete process.env.TMUX;
	delete process.env.ZELLIJ_PANE_ID;
	delete process.env.WEZTERM_PANE;
	delete process.env.CMUX_PANE_ID;
	try {
		const report = runDoctor(dir);
		assert.match(report, /Detected: unknown/);
		assert.match(report, /\/velpari-discuss requires a supported multiplexer/);
	} finally {
		if (origMux !== undefined) process.env.PI_SUBAGENT_MUX = origMux;
		if (origTmux !== undefined) process.env.TMUX = origTmux;
		if (origZellij !== undefined) process.env.ZELLIJ_PANE_ID = origZellij;
		if (origWezterm !== undefined) process.env.WEZTERM_PANE = origWezterm;
		if (origCmux !== undefined) process.env.CMUX_PANE_ID = origCmux;
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