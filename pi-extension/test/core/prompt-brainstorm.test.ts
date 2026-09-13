/**
 * buildStagePrompt scan-plan block tests (Phase 3).
 *
 * Asserts the brainstorm prompt carries the user's scan-gate decision:
 *   - scansSelected present  → `## Scan Plan` block (with pre-rendered
 *     role/timeout lines from the dispatcher) replaces `## Flags`
 *   - scansSelected undefined → legacy `## Flags` web-search line renders
 *     unchanged; no Scan Plan block (in-flight runs must not break)
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	buildStagePrompt,
	type BuildStagePromptInput,
} from "../../src/core/prompt.js";
import { formatScanPlanLines } from "../../src/stages/brainstorm/dispatcher.js";

function baseInput(): BuildStagePromptInput {
	return {
		stage: "brainstorming",
		mission: "Test mission",
		framework: undefined,
		runId: "run-1",
		answers: [],
		webSearchAllowed: false,
		paths: {},
	};
}

describe("buildStagePrompt — scan plan block", () => {
	it("renders ## Scan Plan with role/timeout lines when scansSelected is provided", () => {
		const prompt = buildStagePrompt({
			...baseInput(),
			understandingConfirmed: true,
			scansSelected: ["code", "doc"],
			scanPlanLines: formatScanPlanLines(["code", "doc"]),
		});
		assert.match(prompt, /## Scan Plan/);
		assert.match(prompt, /Understanding confirmed: yes/);
		assert.match(prompt, /code — scouts: extractor, prd-checker \(timeout 30s\)/);
		assert.match(prompt, /doc — scouts: prd-checker, rtm-checker \(timeout 30s\)/);
		// The legacy flags section is replaced.
		assert.ok(!prompt.includes("## Flags"));
	});

	it("renders the skipped-scans line when the user approved zero scans", () => {
		const prompt = buildStagePrompt({
			...baseInput(),
			scansSelected: [],
			scanPlanLines: formatScanPlanLines([]),
		});
		assert.match(prompt, /## Scan Plan/);
		assert.match(prompt, /skipped scans/);
		assert.ok(!prompt.includes("## Flags"));
	});

	it("keeps the legacy ## Flags web-search line when scansSelected is absent", () => {
		const prompt = buildStagePrompt({ ...baseInput(), webSearchAllowed: true });
		assert.match(prompt, /## Flags/);
		assert.match(prompt, /Web search: ALLOWED \(spawn web-search-agent subagent\)\./);
		assert.ok(!prompt.includes("## Scan Plan"));
	});

	it("renders the resolved community agent name in the web-search line", () => {
		const prompt = buildStagePrompt({
			...baseInput(),
			webSearchAllowed: true,
			communityAgentName: "my-web-scout",
		});
		assert.match(prompt, /Web search: ALLOWED \(spawn my-web-scout subagent\)\./);
		const denied = buildStagePrompt({
			...baseInput(),
			webSearchAllowed: false,
			communityAgentName: "my-web-scout",
		});
		assert.match(denied, /Web search: NOT ALLOWED \(skip my-web-scout subagent\)\./);
	});

	it("omits the Scan Plan block entirely when scansSelected is undefined", () => {
		const prompt = buildStagePrompt(baseInput());
		assert.ok(!prompt.includes("## Scan Plan"));
		assert.match(prompt, /Web search: NOT ALLOWED/);
	});

	it("non-brainstorm stages are unaffected by the legacy path", () => {
		const prompt = buildStagePrompt({ ...baseInput(), stage: "drafting-prd" });
		assert.match(prompt, /<pi-velpari stage="drafting-prd">/);
		assert.ok(!prompt.includes("## Scan Plan"));
	});
});

describe("buildStagePrompt — existing project context block", () => {
	it("renders the block with artifact paths, config, profile, and history", () => {
		const prompt = buildStagePrompt({
			...baseInput(),
			existingContext: {
				publishedArtifacts: ["/proj/Doc/requirements/PRD_TodoApp.md"],
				projectName: "TodoApp",
				framework: "TypeScript",
				profileId: "core-psrs-v1",
				previousRunIds: ["2026-01-01-10-00-old-run"],
				history: ["brainstorming via /velpari-brainstorm"],
			},
		});
		assert.match(prompt, /## Existing Project Context/);
		assert.match(prompt, /CHANGE brainstorm/);
		assert.match(prompt, /\/proj\/Doc\/requirements\/PRD_TodoApp\.md/);
		assert.match(prompt, /projectName=TodoApp/);
		assert.match(prompt, /framework=TypeScript/);
		assert.match(prompt, /Requirements profile: core-psrs-v1/);
		assert.match(prompt, /Previous runs: 2026-01-01-10-00-old-run/);
		assert.match(prompt, /Run history \(this run\): brainstorming via \/velpari-brainstorm/);
	});

	it("omits the block when the context is null (fresh project unchanged)", () => {
		const prompt = buildStagePrompt({ ...baseInput(), existingContext: null });
		// The skill markdown mentions the block name; assert on the block body.
		assert.ok(!prompt.includes("This is NOT a fresh project"));
	});

	it("omits the block when the context carries no signals", () => {
		const prompt = buildStagePrompt({
			...baseInput(),
			existingContext: {
				publishedArtifacts: [],
				previousRunIds: [],
				history: ["brainstorming via /velpari-brainstorm"],
			},
		});
		assert.ok(!prompt.includes("This is NOT a fresh project"));
	});

	it("renders before the interview answers section", () => {
		const prompt = buildStagePrompt({
			...baseInput(),
			existingContext: {
				publishedArtifacts: ["/proj/Doc/requirements/PRD_TodoApp.md"],
				previousRunIds: [],
				history: [],
			},
		});
		const contextIdx = prompt.indexOf("## Existing Project Context");
		const answersIdx = prompt.indexOf("## Interview Answers");
		assert.ok(contextIdx >= 0 && answersIdx > contextIdx);
	});
});
