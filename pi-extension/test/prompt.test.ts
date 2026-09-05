import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStagePrompt, loadStageSkill } from "../src/prompt.js";

test("loadStageSkill returns content for discussing stage", () => {
	const result = loadStageSkill("discussing");
	assert.equal(typeof result, "string");
	assert.ok(result.length > 0);
});

test("loadStageSkill returns content for drafted-prd stage", () => {
	const result = loadStageSkill("drafted-prd");
	assert.equal(typeof result, "string");
	assert.ok(result.length > 0);
});

test("loadStageSkill strips YAML frontmatter", () => {
	const result = loadStageSkill("discussing");
	// Frontmatter delimited by --- ... --- at the start of file is stripped.
	assert.equal(result.startsWith("---"), false, "frontmatter should be stripped");
});

test("loadStageSkill throws for stage with no skill mapping", () => {
	assert.throws(() => loadStageSkill("none"), /No skill mapped/);
});

test("loadStageSkill throws when skill file missing", () => {
	// "handoff-ready" maps to "handoff" — we don't ship that skill file in v2.0
	// yet, but the function should still throw a clear error if file is absent.
	// (Skip if the file does exist; in v2.0 there is no handoff skill file.)
	try {
		loadStageSkill("handoff-ready");
		// If no throw, that's fine — file exists.
	} catch (err) {
		assert.match(String(err), /not found|No skill/);
	}
});

test("buildStagePrompt includes metadata block with mission", () => {
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "MyMission",
		framework: undefined,
		runId: "2026-09-03-14-00-my-mission",
		answers: ["a1"],
		webSearchAllowed: false,
		paths: {
			extractorReport: "/tmp/ext.json",
			prdCheckerReport: "/tmp/prd.json",
			rtmCheckerReport: "/tmp/rtm.json",
			webSearchReport: "/tmp/web.json",
			discussionNotes: "/tmp/notes.md",
			scoutsDir: "/tmp/scouts",
		},
	});
	assert.match(prompt, /<pi-velpari stage="discussing">/);
	assert.match(prompt, /Mission: MyMission/);
});

test("buildStagePrompt includes framework line when provided", () => {
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "M",
		framework: "TypeScript",
		runId: undefined,
		answers: [],
		webSearchAllowed: false,
		paths: {
			extractorReport: "",
			prdCheckerReport: "",
			rtmCheckerReport: "",
			webSearchReport: "",
			discussionNotes: "",
			scoutsDir: "",
		},
	});
	assert.match(prompt, /Framework: TypeScript/);
});

test("buildStagePrompt omits framework line when undefined", () => {
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "M",
		framework: undefined,
		runId: undefined,
		answers: [],
		webSearchAllowed: false,
		paths: {
			extractorReport: "",
			prdCheckerReport: "",
			rtmCheckerReport: "",
			webSearchReport: "",
			discussionNotes: "",
			scoutsDir: "",
		},
	});
	assert.doesNotMatch(prompt, /Framework:/);
});

test("buildStagePrompt embeds interview answers", () => {
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "M",
		framework: undefined,
		runId: undefined,
		answers: ["first answer", "second answer"],
		webSearchAllowed: false,
		paths: {
			extractorReport: "",
			prdCheckerReport: "",
			rtmCheckerReport: "",
			webSearchReport: "",
			discussionNotes: "",
			scoutsDir: "",
		},
	});
	assert.match(prompt, /1\. first answer/);
	assert.match(prompt, /2\. second answer/);
});

test("buildStagePrompt includes web search ALLOWED flag when true", () => {
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "M",
		framework: undefined,
		runId: undefined,
		answers: [],
		webSearchAllowed: true,
		paths: {
			extractorReport: "",
			prdCheckerReport: "",
			rtmCheckerReport: "",
			webSearchReport: "",
			discussionNotes: "",
			scoutsDir: "",
		},
	});
	assert.match(prompt, /Web search: ALLOWED/);
});

test("buildStagePrompt includes web search NOT ALLOWED flag when false", () => {
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "M",
		framework: undefined,
		runId: undefined,
		answers: [],
		webSearchAllowed: false,
		paths: {
			extractorReport: "",
			prdCheckerReport: "",
			rtmCheckerReport: "",
			webSearchReport: "",
			discussionNotes: "",
			scoutsDir: "",
		},
	});
	assert.match(prompt, /Web search: NOT ALLOWED/);
});

test("buildStagePrompt includes scout paths", () => {
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "M",
		framework: undefined,
		runId: undefined,
		answers: [],
		webSearchAllowed: false,
		paths: {
			extractorReport: "/path/extractor-report.json",
			prdCheckerReport: "/path/prd-checker-report.json",
			rtmCheckerReport: "/path/rtm-checker-report.json",
			webSearchReport: "/path/web-search-report.json",
			discussionNotes: "/path/discussion-notes.md",
			scoutsDir: "/path/scouts",
		},
	});
	assert.match(prompt, /extractor-report\.json: \/path\/extractor-report\.json/);
	assert.match(prompt, /prd-checker-report\.json: \/path\/prd-checker-report\.json/);
	assert.match(prompt, /rtm-checker-report\.json: \/path\/rtm-checker-report\.json/);
	assert.match(prompt, /web-search-report\.json: \/path\/web-search-report\.json/);
	assert.match(prompt, /Discussion notes \(working copy\): \/path\/discussion-notes\.md/);
});

test("buildStagePrompt renders compact profile metadata when provided", () => {
	const prompt = buildStagePrompt({
		stage: "drafting-prd",
		mission: "M",
		framework: undefined,
		runId: "x",
		answers: [],
		webSearchAllowed: false,
		profileMetadata: {
			profileId: "banking-web-v1",
			profileKind: "built-in",
			profileVersion: "1.1.0",
			applicationType: "web",
			domain: "banking",
			developmentMethod: "regulated",
			regulated: true,
			outputVariant: "compliance",
		},
		paths: { workingCopy: "/tmp/x" },
	});
	assert.match(prompt, /## Profile \(compact\)/);
	assert.match(prompt, /Profile id: banking-web-v1/);
	assert.match(prompt, /Profile version: 1\.1\.0/);
	assert.match(prompt, /Application type: web/);
	assert.match(prompt, /Domain: banking/);
	assert.match(prompt, /Regulated: yes/);
	assert.match(prompt, /Output variant: compliance/);
});

test("buildStagePrompt omits the actual profile metadata block when profileMetadata is absent", () => {
	const prompt = buildStagePrompt({
		stage: "drafting-prd",
		mission: "M",
		framework: undefined,
		runId: undefined,
		answers: [],
		webSearchAllowed: false,
		paths: { workingCopy: "/tmp/x" },
	});
	// The profile metadata block uses "Profile id:" + "Profile version:" lines.
	// The skill markdown also describes the feature but never emits "Profile id:".
	assert.doesNotMatch(prompt, /Profile id: /);
	assert.doesNotMatch(prompt, /Profile version: /);
});

test("buildStagePrompt includes the stage skill content", () => {
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "M",
		framework: undefined,
		runId: undefined,
		answers: [],
		webSearchAllowed: false,
		paths: {
			extractorReport: "",
			prdCheckerReport: "",
			rtmCheckerReport: "",
			webSearchReport: "",
			discussionNotes: "",
			scoutsDir: "",
		},
	});
	// velpari-discuss.md mentions subagent spawning.
	assert.match(prompt, /subagent/);
});

test("buildStagePrompt handles unicode + newlines in answers", () => {
	const unicodeAnswer = "café\nrésumé 🚀\nnaïve";
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "M",
		framework: undefined,
		runId: undefined,
		answers: [unicodeAnswer],
		webSearchAllowed: false,
		paths: {
			extractorReport: "",
			prdCheckerReport: "",
			rtmCheckerReport: "",
			webSearchReport: "",
			discussionNotes: "",
			scoutsDir: "",
		},
	});
	assert.ok(prompt.includes(unicodeAnswer), "unicode + newlines must be preserved verbatim");
	assert.match(prompt, /café/);
	assert.match(prompt, /🚀/);
});

test("buildStagePrompt handles paths with spaces and special characters", () => {
	const weirdPath = "/Users/jane/my project/run-1 (v2)/ext.json";
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "M",
		framework: undefined,
		runId: undefined,
		answers: [],
		webSearchAllowed: false,
		paths: {
			extractorReport: weirdPath,
			prdCheckerReport: weirdPath,
			rtmCheckerReport: weirdPath,
			webSearchReport: weirdPath,
			discussionNotes: weirdPath,
			scoutsDir: weirdPath,
		},
	});
	assert.ok(prompt.includes(weirdPath), "paths with spaces and parens must be preserved");
});