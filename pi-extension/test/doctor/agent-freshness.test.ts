/**
 * Doctor check: Generated agent freshness (generator v2 — C2).
 *
 * Covers:
 *   - empty project → info per phase (bundled fallback), no errors
 *   - phase fully generated + fresh → ok item
 *   - generated agents older than a phase input's publish → warning per
 *     stale role ("regenerate Phase N", suggestion carries --phase N)
 *   - reviewer-per-tier presence: advanced tier with no reviewer agents
 *     → error per reviewer role; bundled reviewer files present → ok;
 *     reviewerMode "never" → policy info, no errors
 *   - custom-mapped reviewer resolved through agents.json
 *   - summary item counts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkAgentFreshnessSection } from "../../src/doctor/checks/agent-freshness.js";
import { GENERATION_PHASES, REVIEWER_ROLES, type GenerationPhase } from "../../src/core/agents-config.js";
import { getProjectSlug } from "../../src/core/agents-generator.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-doctor-fresh-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeState(mission: string): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ version: 1, mission }), "utf8");
}

/** Stamp a brainstorm publish in the freshness manifest
 *  (mission "My App" → key "brainstorm:my-app"). */
function stampBrainstormPublish(publishedAt: string): void {
	writeState("My App");
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "freshness.json"),
		JSON.stringify({
			version: 1,
			artifacts: {
				"brainstorm:my-app": {
					artifact: "brainstorm",
					slug: "my-app",
					path: "Doc/brainstorm/brainstorm-my-app.md",
					publishedAt,
				},
			},
		}),
		"utf8",
	);
}

function writeFilesJson(atomic: Record<string, unknown>): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "files.json"), JSON.stringify({ version: 4, projectName: "demo", atomic }), "utf8");
}

function writeAgentsJson(agents: Record<string, string>): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "agents.json"), JSON.stringify({ version: 1, agents }), "utf8");
}

/** Write generated agent files for every role of the phase. */
function writeGeneratedAgents(phase: GenerationPhase, mtime?: Date): void {
	const slug = getProjectSlug(tmpDir);
	for (const role of GENERATION_PHASES[phase].roles) {
		const p = path.join(tmpDir, ".pi", "agents", `${slug}-${role}.md`);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, `# ${role}\n`, "utf8");
		if (mtime) fs.utimesSync(p, mtime, mtime);
	}
}

/** Write a plain (bundled-style) agent file under .pi/agents/. */
function writeAgentFile(name: string): void {
	const p = path.join(tmpDir, ".pi", "agents", `${name}.md`);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, `# ${name}\n`, "utf8");
}

const ADVANCED_ATOMIC = {
	tier: "advanced",
	safetyClass: "A",
	sil: "none",
	overlayId: null,
	reviewerMode: "tier-default",
};

describe("checkAgentFreshnessSection", () => {
	it("returns the section title 'Generated agent freshness'", () => {
		const section = checkAgentFreshnessSection(tmpDir);
		assert.equal(section.title, "Generated agent freshness");
	});

	it("empty project → one info per phase (bundled fallback), no errors or warnings", () => {
		const section = checkAgentFreshnessSection(tmpDir);
		const missingInfos = section.items.filter((i) => i.status === "info" && /have no generated agent/.test(i.message));
		assert.equal(missingInfos.length, 4, "one bundled-fallback info per phase");
		assert.ok(missingInfos[0]!.details && missingInfos[0]!.details.length > 0);
		assert.equal(section.items.filter((i) => i.status === "error").length, 0);
		assert.equal(section.items.filter((i) => i.status === "warning").length, 0);
		// Reviewer not required at the default basic tier → policy info.
		assert.ok(section.items.some((i) => i.status === "info" && /Reviewer presence not required/.test(i.message)));
	});

	it("phase 1 fully generated → ok item naming the phase", () => {
		writeGeneratedAgents(1);
		const section = checkAgentFreshnessSection(tmpDir);
		const okItems = section.items.filter(
			(i) => i.status === "ok" && /Phase 1: all 4 generated agent\(s\) fresh/.test(i.message),
		);
		assert.equal(okItems.length, 1);
	});

	it("phase 2 agents older than the brainstorm publish → warning per stale role", () => {
		stampBrainstormPublish("2026-09-20T10:00:00.000Z");
		writeGeneratedAgents(2, new Date("2026-09-20T09:00:00.000Z")); // 1h BEFORE publish
		const section = checkAgentFreshnessSection(tmpDir);
		const staleWarnings = section.items.filter((i) => i.status === "warning" && /regenerate Phase 2/.test(i.message));
		assert.equal(staleWarnings.length, GENERATION_PHASES[2].roles.length);
		for (const warning of staleWarnings) {
			assert.match(warning.suggestion ?? "", /--phase 2/);
		}
	});

	it("phase 2 agents newer than the brainstorm publish → no stale warnings", () => {
		stampBrainstormPublish("2026-09-20T10:00:00.000Z");
		writeGeneratedAgents(2, new Date("2026-09-20T11:00:00.000Z"));
		const section = checkAgentFreshnessSection(tmpDir);
		const staleWarnings = section.items.filter((i) => i.status === "warning" && /regenerate Phase 2/.test(i.message));
		assert.equal(staleWarnings.length, 0);
		assert.ok(
			section.items.some(
				(i) =>
					i.status === "ok" &&
					new RegExp(`Phase 2: all ${GENERATION_PHASES[2].roles.length} generated agent\\(s\\) fresh`).test(i.message),
			),
		);
	});

	it("staleness is advisory (warning), never an error (D6)", () => {
		stampBrainstormPublish("2026-09-20T10:00:00.000Z");
		writeGeneratedAgents(2, new Date("2026-09-20T09:00:00.000Z"));
		const section = checkAgentFreshnessSection(tmpDir);
		assert.equal(section.items.filter((i) => i.status === "error").length, 0);
		assert.ok(section.items.some((i) => i.status === "warning"));
	});

	it("advanced tier + no reviewer agents → error per reviewer role", () => {
		writeFilesJson(ADVANCED_ATOMIC);
		const section = checkAgentFreshnessSection(tmpDir);
		const reviewerErrors = section.items.filter(
			(i) => i.status === "error" && /reviewer role/.test(i.message) && /MISSING/.test(i.message),
		);
		assert.equal(reviewerErrors.length, REVIEWER_ROLES.length);
		assert.match(reviewerErrors[0]!.message, /tier=advanced/);
	});

	it("advanced tier + bundled reviewer agents present → ok, no errors", () => {
		writeFilesJson(ADVANCED_ATOMIC);
		for (const role of REVIEWER_ROLES) writeAgentFile(role);
		const section = checkAgentFreshnessSection(tmpDir);
		assert.equal(section.items.filter((i) => i.status === "error").length, 0);
		const reviewerOks = section.items.filter((i) => i.status === "ok" && /reviewer role/.test(i.message));
		assert.equal(reviewerOks.length, REVIEWER_ROLES.length);
	});

	it("advanced tier + custom-mapped reviewer present → resolved through agents.json", () => {
		writeFilesJson(ADVANCED_ATOMIC);
		writeAgentsJson({ reviewer: "my-reviewer" });
		for (const role of REVIEWER_ROLES) writeAgentFile(role);
		writeAgentFile("my-reviewer");
		// Remove the bundled default so ONLY the custom mapping can satisfy it.
		fs.rmSync(path.join(tmpDir, ".pi", "agents", "reviewer.md"));
		const section = checkAgentFreshnessSection(tmpDir);
		assert.equal(section.items.filter((i) => i.status === "error").length, 0);
		assert.ok(
			section.items.some((i) => i.status === "ok" && /my-reviewer\.md \(reviewer role reviewer\)/.test(i.message)),
		);
	});

	it("reviewerMode 'never' at advanced tier → policy info, no reviewer errors", () => {
		writeFilesJson({ ...ADVANCED_ATOMIC, reviewerMode: "never" });
		const section = checkAgentFreshnessSection(tmpDir);
		assert.equal(section.items.filter((i) => i.status === "error").length, 0);
		assert.ok(section.items.some((i) => i.status === "info" && /Reviewer presence not required/.test(i.message)));
	});

	it("summary item reports generated/stale counts", () => {
		stampBrainstormPublish("2026-09-20T10:00:00.000Z");
		writeGeneratedAgents(1);
		writeGeneratedAgents(2, new Date("2026-09-20T09:00:00.000Z")); // stale
		const section = checkAgentFreshnessSection(tmpDir);
		const summary = section.items.find((i) => /Agent freshness summary/.test(i.message));
		assert.ok(summary, "summary item present");
		const generatedTotal = GENERATION_PHASES[1].roles.length + GENERATION_PHASES[2].roles.length;
		assert.match(
			summary!.message,
			new RegExp(
				`${generatedTotal} generated agent\\(s\\) on disk across 4 phase\\(s\\); ` +
					`${GENERATION_PHASES[2].roles.length} stale, 0 error\\(s\\), ` +
					`${GENERATION_PHASES[2].roles.length} warning\\(s\\)`,
			),
		);
	});
});
