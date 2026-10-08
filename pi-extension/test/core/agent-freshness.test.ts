/**
 * agent-freshness tests (generator v2 — C2 helper + D5 hint predicates).
 *
 * Covers: phaseAgentFreshness (missing / present / stale vs freshness
 * manifest publishedAt), phaseBoundaryCrossed, phaseEntryPhase, and
 * generationHintForPhase.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	generatedAgentPath,
	generationHintForPhase,
	phaseAgentFreshness,
	phaseBoundaryCrossed,
	phaseEntryPhase,
} from "../../src/core/agent-freshness.js";
import { GENERATION_PHASES, type GenerationPhase } from "../../src/core/agents-config.js";
import { getProjectSlug } from "../../src/core/agents-generator.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-agent-fresh-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeState(mission: string): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ version: 1, mission }), "utf8");
}

/** Stamp a freshness manifest with one brainstorm entry published at the
 *  given ISO time (mission "My App" → slug "my-app"). */
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

/** Write generated agent files for every role of the phase, all with the
 *  given mtime (defaults to now). Returns the written paths. */
function writeGeneratedAgents(phase: GenerationPhase, mtime?: Date): string[] {
	const slug = getProjectSlug(tmpDir);
	const written: string[] = [];
	for (const role of GENERATION_PHASES[phase].roles) {
		const p = generatedAgentPath(tmpDir, slug, role);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, `# ${role}\n`, "utf8");
		if (mtime) fs.utimesSync(p, mtime, mtime);
		written.push(p);
	}
	return written;
}

describe("phaseAgentFreshness", () => {
	it("reports every role missing when nothing is generated", () => {
		const status = phaseAgentFreshness(tmpDir, 1);
		assert.equal(status.fresh, false);
		assert.equal(status.generatedRoles.length, 0);
		assert.equal(status.missingRoles.length, GENERATION_PHASES[1].roles.length);
		assert.equal(status.staleRoles.length, 0);
		assert.equal(status.latestInputPublish, null);
	});

	it("phase 1 is fresh when all 4 agents exist (no document inputs)", () => {
		writeGeneratedAgents(1);
		const status = phaseAgentFreshness(tmpDir, 1);
		assert.equal(status.fresh, true);
		assert.equal(status.missingRoles.length, 0);
	});

	it("phase 2 is fresh when agents are newer than the brainstorm publish", () => {
		stampBrainstormPublish("2026-09-20T10:00:00.000Z");
		writeGeneratedAgents(2, new Date("2026-09-20T11:00:00.000Z"));
		const status = phaseAgentFreshness(tmpDir, 2);
		assert.equal(status.latestInputPublish, "2026-09-20T10:00:00.000Z");
		assert.equal(status.staleRoles.length, 0);
		assert.equal(status.fresh, true);
	});

	it("phase 2 flags agents older than the brainstorm publish as stale", () => {
		stampBrainstormPublish("2026-09-20T10:00:00.000Z");
		writeGeneratedAgents(2, new Date("2026-09-20T09:00:00.000Z")); // 1h BEFORE publish
		const status = phaseAgentFreshness(tmpDir, 2);
		assert.equal(status.staleRoles.length, GENERATION_PHASES[2].roles.length);
		assert.equal(status.fresh, false);
	});

	it("a missing agent makes the phase not-fresh even when the rest are fresh", () => {
		stampBrainstormPublish("2026-09-20T10:00:00.000Z");
		const written = writeGeneratedAgents(2, new Date("2026-09-20T11:00:00.000Z"));
		fs.rmSync(written[0]!); // remove one
		const status = phaseAgentFreshness(tmpDir, 2);
		assert.equal(status.fresh, false);
		assert.equal(status.missingRoles.length, 1);
		assert.equal(status.staleRoles.length, 0);
	});

	it("no freshness stamp on the input → no staleness (presence-only)", () => {
		writeState("My App"); // state but no freshness.json
		writeGeneratedAgents(2, new Date("2020-01-01T00:00:00.000Z")); // ancient mtime
		const status = phaseAgentFreshness(tmpDir, 2);
		assert.equal(status.latestInputPublish, null);
		assert.equal(status.staleRoles.length, 0);
		assert.equal(status.fresh, true);
	});
});

describe("phaseBoundaryCrossed", () => {
	it("detects the three approve-time crossings", () => {
		assert.equal(phaseBoundaryCrossed("brainstorming", "brainstormed"), 2);
		assert.equal(phaseBoundaryCrossed("analyzing-feasibility", "analyzed-feasibility"), 3);
		assert.equal(phaseBoundaryCrossed("writing-pseudocode", "wrote-pseudocode"), 4);
	});

	it("detects the feasibility-skip crossing (built-rtm → designing)", () => {
		assert.equal(phaseBoundaryCrossed("built-rtm", "designing"), 3);
	});

	it("returns null for same-phase transitions", () => {
		assert.equal(phaseBoundaryCrossed("drafting-prd", "drafted-prd"), null);
		assert.equal(phaseBoundaryCrossed("designing", "designed"), null);
		assert.equal(phaseBoundaryCrossed("finalizing-design", "finalized-design"), null);
	});
});

describe("phaseEntryPhase", () => {
	it("names the phase-entry stages", () => {
		assert.equal(phaseEntryPhase("brainstormed"), 2);
		assert.equal(phaseEntryPhase("analyzed-feasibility"), 3);
		assert.equal(phaseEntryPhase("wrote-pseudocode"), 4);
	});

	it("treats designing as a Phase 3 entry (feasibility-skip path)", () => {
		assert.equal(phaseEntryPhase("designing"), 3);
	});

	it("returns null for mid-phase and pre-run stages", () => {
		assert.equal(phaseEntryPhase("none"), null);
		assert.equal(phaseEntryPhase("brainstorming"), null);
		assert.equal(phaseEntryPhase("drafting-prd"), null);
		assert.equal(phaseEntryPhase("handoff-ready"), null);
	});
});

describe("generationHintForPhase", () => {
	it("returns the hint fragment when agents are missing", () => {
		const hint = generationHintForPhase(tmpDir, 2);
		assert.equal(hint, "generate Phase 2 agents (/velpari-generate-sub-agents)");
	});

	it("returns null when the phase is fully generated and fresh", () => {
		writeGeneratedAgents(1);
		assert.equal(generationHintForPhase(tmpDir, 1), null);
	});
});
