/**
 * Doc-coverage pin (Phase 5 docs sweep, N30).
 *
 * The 2026-10-06 audit (final-report deviation #6) found the upgrade's new
 * behaviors (N18–N33) undocumented — zero hits in the doc surfaces. This pin
 * keeps the sweep from silently regressing:
 *   - every topic keyword must appear in the swept corpus
 *   - the retired phrases must appear nowhere in it
 * READ-ONLY: no doc file is modified.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_CANDIDATES = [
	join(process.cwd(), "AGENTS.md"),
	join(HERE, "..", "..", "..", "..", "AGENTS.md"),
	join(HERE, "..", "..", "..", "AGENTS.md"),
];

/** Surfaces the sweep owns (topic coverage). */
const TOPIC_SURFACES = [
	"AGENTS.md",
	"README.md",
	"pi-extension/src/AGENTS.md",
	"Doc/velpari-sequence/README.md",
	"Doc/velpari-sequence/02-revision-workflows.md",
	"Doc/velpari-sequence/03-staleness-and-validation.md",
	"Doc/velpari-sequence/06-artifact-formats.md",
	"Doc/velpari-sequence/07-state-and-locking-files.md",
];

/** Surfaces scanned for retired phrases (incl. the N24-04 injected string). */
const RETIRED_SURFACES = [
	...TOPIC_SURFACES,
	"skills/agents/design-finalizer.md",
	"pi-extension/src/hooks/before-agent-start.ts",
	// All 9 stage skills (amendment A2): the 3.4 publish-clause fix touches 8
	// of them and the N24-03 fix touches prd + testplan — every one is scanned
	// so the retired clause / garble cannot regress in an unscanned file.
	"skills/velpari-prd.md",
	"skills/velpari-rtm.md",
	"skills/velpari-feasibility.md",
	"skills/velpari-architecture-generator.md",
	"skills/velpari-atomic-function.md",
	"skills/velpari-pseudocode.md",
	"skills/velpari-development-order.md",
	"skills/velpari-final-design.md",
	"skills/velpari-testplan.md",
];

function repoRoot(): string {
	for (const c of ROOT_CANDIDATES) {
		if (existsSync(c)) return dirname(c);
	}
	throw new Error("doc-coverage: repo root not found");
}

function read(rel: string): string {
	return readFileSync(join(repoRoot(), rel), "utf8");
}

describe("doc coverage (Phase 5 pin)", () => {
	it("documents every upgrade topic (N18–N33)", () => {
		const text = TOPIC_SURFACES.map(read).join("\n");
		const topics: ReadonlyArray<readonly [string, string]> = [
			["session gate (N18)", "session gate"],
			["preflight (N22)", "preflight"],
			["soft-lock (N19/N20)", "soft-lock"],
			["semver bump gate (N27)", "bump:"],
			["Excalidraw pin (N31)", "mcp-excalidraw-server@2.0.0"],
			["maxWorktrees (N32)", "maxWorktrees"],
			["testing.runner (N33)", "testing.runner"],
			["doctor v2 fix flow (N23)", "fix-flow"],
		];
		for (const [topic, needle] of topics) {
			assert.ok(text.includes(needle), `missing topic: ${topic} (needle "${needle}")`);
		}
	});

	it("retired phrases are gone", () => {
		// A3c hardening: whitespace-normalized scan — a line-wrapped garble
		// collapses to the same signature as a one-line one.
		const text = RETIRED_SURFACES.map(read).join("\n").replace(/\s+/g, " ");
		const gone: readonly string[] = [
			"Errors OR warnings",
			"always the latest upstream",
			"always latest upstream",
			"the publish tool as fallback",
			"writes the published copy to `Doc/`",
			"which same gate chain",
			"(same gate chain as",
		];
		for (const phrase of gone) {
			assert.ok(!text.includes(phrase), `retired phrase still present: "${phrase}"`);
		}
	});
});
