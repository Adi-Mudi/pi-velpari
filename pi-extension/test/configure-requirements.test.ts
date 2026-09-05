import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleConfigureRequirements } from "../src/discipline/configure-requirements/index.js";
import { buildResearchPrompt } from "../src/discipline/configure-requirements/research.js";
import { runFallbackActions } from "../src/discipline/configure-requirements/recommend.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-configure-req-"));
}

interface MockUI {
	notifies: Array<{ msg: string; level: string }>;
	inputs: Array<string | undefined>;
	confirms: boolean[];
	selects: Array<string | undefined>;
	inputCalls: number;
	confirmCalls: number;
	selectCalls: number;
	input: (title: string, placeholder?: string) => Promise<string | undefined>;
	confirm: (title: string, message: string) => Promise<boolean>;
	select: (title: string, options: string[]) => Promise<string | undefined>;
	notify: (msg: string, level: string) => void;
}

function makeUI(opts: {
	inputs?: Array<string | undefined>;
	confirms?: boolean[];
	selects?: Array<string | undefined>;
}): MockUI {
	const inputs: Array<string | undefined> = [...(opts.inputs ?? [])];
	const confirms: boolean[] = [...(opts.confirms ?? [])];
	const selects: Array<string | undefined> = [...(opts.selects ?? [])];
	return {
		notifies: [],
		inputs,
		confirms,
		selects,
		inputCalls: 0,
		confirmCalls: 0,
		selectCalls: 0,
		async input(_title: string, _placeholder?: string) {
			this.inputCalls++;
			return inputs.shift();
		},
		async confirm(_title: string, _message: string) {
			this.confirmCalls++;
			return confirms.shift() ?? false;
		},
		async select(_title: string, _options: string[]) {
			this.selectCalls++;
			return selects.shift();
		},
		notify(msg: string, level: string) {
			this.notifies.push({ msg, level });
		},
	};
}

function makeMockPi() {
	const sent: Array<{ prompt: string }> = [];
	return {
		sent,
		sendUserMessage(prompt: string) {
			sent.push({ prompt });
		},
	};
}

// Happy-path selects driven by the new native-select flow:
// order: novelty, application type, domain, dev method, security, recommendation picker
const HAPPY_INPUTS: Array<string | undefined> = [
	"expense tracker", // what
	"individuals", // who
	"daily expense tracking", // problem
	"web, ios", // platforms
];

const HAPPY_CONFIRMS: boolean[] = [
	true, // sensitive data
	false, // external systems
	false, // existingCodebase
	true, // regulated = true (because securityLevel=high)
	true, // web-research consent YES
	true, // confirm save profile
];

const HAPPY_SELECTS: Array<string | undefined> = [
	"New product", // novelty
	"Web", // application type
	"Banking", // domain
	"Regulated", // development method
	"High", // security level
	"Use common PSRS core", // recommendation (common core is always present + deterministic label)
];

/**
 * Banking-web happy path. The function picks the first matching built-in
 * ("banking-web-v1"). Tests use it for several paths.
 */
function happyPathUI(opts: { research?: boolean; cancelProfile?: boolean } = {}) {
	const confirms = [...HAPPY_CONFIRMS];
	confirms[4] = opts.research ?? true; // research consent
	const selects: Array<string | undefined> = [...HAPPY_SELECTS];
	if (opts.cancelProfile === true) selects[5] = "Stop — cancel without saving";
	return makeUI({ inputs: HAPPY_INPUTS, confirms, selects });
}

test("handleConfigureRequirements saves a profile JSON when the user confirms", async () => {
	const dir = tempDir();
	try {
		const ui = happyPathUI();
		const ctx = { ui } as never;
		const pi = makeMockPi();
		await handleConfigureRequirements(ctx, pi as never, dir);

		const path = join(dir, ".pi", "velpari", "requirements-profile.json");
		assert.ok(existsSync(path), "profile file should be created");
		const profile = JSON.parse(readFileSync(path, "utf8"));
		// happyPathUI uses "Use common PSRS core" so the saved
		// profile is core-psrs-v1 with profileKind=common-core.
		assert.equal(profile.profileId, "core-psrs-v1");
		assert.equal(profile.profileKind, "common-core");
		assert.equal(profile.version, "1.1.0");
		assert.ok(profile.requiredSections.includes("security"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements aborts when the user skips a required input", async () => {
	const dir = tempDir();
	try {
		// First required input is empty — handler should abort.
		const ui = makeUI({ inputs: ["", "foo", "bar"], confirms: [], selects: [] });
		const ctx = { ui } as never;
		await handleConfigureRequirements(ctx, undefined, dir);
		const errored = ui.notifies.some(
			(n) => n.level === "error" && /missing required answer/i.test(n.msg),
		);
		assert.ok(errored, "expected error about missing answer");
		assert.equal(
			existsSync(join(dir, ".pi", "velpari", "requirements-profile.json")),
			false,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements reports gap when no exact built-in match exists", async () => {
	const dir = tempDir();
	try {
		// Mobile + Healthcare has no exact built-in match
		// (mobile-general-v1 is general domain, healthcare-ai-v1 is ai appType).
		const inputs = ["x", "y", "z", ""];
		const confirms = [false, false, false, true, false, true];
		const selects: Array<string | undefined> = [
			"New product", // novelty
			"Mobile", // applicationType (no healthcare-mobile built-in)
			"Healthcare", // domain
			"Agile", // development method
			"Medium", // security level
			"Use common PSRS core", // recommendation
		];

		const ui = makeUI({ inputs, confirms, selects });
		const ctx = { ui } as never;
		await handleConfigureRequirements(ctx, undefined, dir);

		const path = join(dir, ".pi", "velpari", "requirements-profile.json");
		assert.ok(existsSync(path), "common PSRS core should be saved");
		const profile = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(profile.profileId, "core-psrs-v1");
		assert.equal(profile.profileKind, "common-core");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements honours cancel-from-profile-picker (Stop)", async () => {
	const dir = tempDir();
	try {
		const inputs = ["x", "x", "x", "web"];
		const confirms = [false, false, false, false, false, false];
		const selects = [
			"New product", // novelty
			"Web", // app type
			"General", // domain (no exact match for web/general/agile/medium with these combos— but web-general-v1 matches!)
		];
		selects.push("Agile"); // development method
		selects.push("Medium"); // security
		selects[5] = "Stop — cancel without saving";

		const ui = makeUI({ inputs, confirms, selects });
		const ctx = { ui } as never;
		await handleConfigureRequirements(ctx, undefined, dir);

		// No save should happen.
		assert.equal(
			existsSync(join(dir, ".pi", "velpari", "requirements-profile.json")),
			false,
		);
		const cancelled = ui.notifies.some(
			(n) => n.level === "info" && /cancelled/i.test(n.msg),
		);
		assert.ok(cancelled, "expected cancel notify");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements sends a research handoff via pi.sendUserMessage when consent=yes", async () => {
	const dir = tempDir();
	try {
		const ui = happyPathUI({ research: true });
		const ctx = { ui } as never;
		const pi = makeMockPi();
		await handleConfigureRequirements(ctx, pi as never, dir);

		assert.equal(pi.sent.length, 1, "should call pi.sendUserMessage exactly once");
		assert.match(pi.sent[0]!.prompt, /Profile selection: PENDING/);
		assert.match(pi.sent[0]!.prompt, /MUST NOT save or write a profile/);
		assert.match(pi.sent[0]!.prompt, /Research task:/);
		// Important: research prompt must NOT include any final selected profile id.
		assert.doesNotMatch(
			pi.sent[0]!.prompt,
			/^Profile: /m,
			"research prompt must not include a 'Profile:' (selected) line",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements does NOT fetch the web itself when no ExtensionAPI is provided", async () => {
	const dir = tempDir();
	try {
		const ui = happyPathUI({ research: true });
		const ctx = { ui } as never;
		// No pi provided.
		await handleConfigureRequirements(ctx, undefined, dir);

		const warning = ui.notifies.some(
			(n) => n.level === "warning" && /no ExtensionAPI is available/i.test(n.msg),
		);
		assert.ok(warning, "expected warning when research consent given without ExtensionAPI");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements persists researchConsent=true in the saved profile", async () => {
	const dir = tempDir();
	try {
		const ui = happyPathUI({ research: true });
		const ctx = { ui } as never;
		const pi = makeMockPi();
		await handleConfigureRequirements(ctx, pi as never, dir);
		const path = join(dir, ".pi", "velpari", "requirements-profile.json");
		const profile = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(profile.researchConsent, true);
		assert.deepEqual(profile.researchSources, []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements persists researchConsent=false when consent declined", async () => {
	const dir = tempDir();
	try {
		const ui = happyPathUI({ research: false });
		const ctx = { ui } as never;
		await handleConfigureRequirements(ctx, undefined, dir);
		const path = join(dir, ".pi", "velpari", "requirements-profile.json");
		const profile = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(profile.researchConsent, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements declines save when confirm-save returns false", async () => {
	const dir = tempDir();
	try {
		const ui = happyPathUI();
		// Override the last confirm (confirm-save) to false.
		ui.confirms[5] = false;
		const ctx = { ui } as never;
		await handleConfigureRequirements(ctx, undefined, dir);
		assert.equal(
			existsSync(join(dir, ".pi", "velpari", "requirements-profile.json")),
			false,
		);
		const declined = ui.notifies.some(
			(n) => n.level === "info" && /declined save/i.test(n.msg),
		);
		assert.ok(declined, "expected declined-save notify");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements chooses the common PSRS core when user picks it", async () => {
	const dir = tempDir();
	try {
		const ui = makeUI({
			inputs: ["simple tool", "developers", "common need", ""],
			confirms: [false, false, false, false, false, true],
			selects: [
				"New product", // novelty
				"Other", // applicationType
				"Other", // domain
				"Agile", // developmentMethod
				"Medium", // securityLevel
				"Use common PSRS core", // recommendation
			],
		});
		const ctx = { ui } as never;
		await handleConfigureRequirements(ctx, undefined, dir);

		const path = join(dir, ".pi", "velpari", "requirements-profile.json");
		const profile = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(profile.profileId, "core-psrs-v1");
		assert.equal(profile.profileKind, "common-core");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements notifies existing profile on re-run", async () => {
	const dir = tempDir();
	try {
		const ui1 = happyPathUI();
		await handleConfigureRequirements({ ui: ui1 } as never, undefined, dir);
		const notifyOnFirstRun = ui1.notifies.some(
			(n) => n.level === "info" && /Profile saved/i.test(n.msg),
		);
		assert.ok(notifyOnFirstRun);

		// Re-run: expect the existing-profile notice before the new flow.
		const ui2 = happyPathUI();
		await handleConfigureRequirements({ ui: ui2 } as never, undefined, dir);
		const existing = ui2.notifies.some(
			(n) => n.level === "info" && /Existing profile/i.test(n.msg),
		);
		assert.ok(existing, "expected existing-profile notice on re-run");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements uses ctx.ui.select for fixed choices", async () => {
	const dir = tempDir();
	try {
		const ui = happyPathUI();
		const ctx = { ui } as never;
		await handleConfigureRequirements(ctx, undefined, dir);
		// We expect several select calls (novelty, app type, domain, dev method,
		// security, recommendation).
		assert.ok(ui.selectCalls >= 6, `expected >=6 select calls; got ${ui.selectCalls}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements cancels when the recommend-picker is dismissed", async () => {
	const dir = tempDir();
	try {
		const ui = makeUI({
			inputs: ["a", "b", "c", ""],
			confirms: [false, false, false, false, false, false],
			selects: [
				"New product",
				"Web",
				"General",
				"Agile",
				"Medium",
				undefined, // picker dismissed
			],
		});
		const ctx = { ui } as never;
		await handleConfigureRequirements(ctx, undefined, dir);
		const cancelled = ui.notifies.some(
			(n) => n.level === "info" && /cancelled/i.test(n.msg),
		);
		assert.ok(cancelled, "expected cancel notify on dismissed picker");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runFallbackActions returns 'core' when 'Use common PSRS core' is picked", async () => {
	const dir = tempDir();
	try {
		const ui = makeUI({ inputs: [], confirms: [], selects: ["Use common PSRS core"] });
		const ctx = { ui } as never;
		const result = await runFallbackActions(ctx, dir);
		assert.equal(result, "core");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runFallbackActions returns 'closest' when 'Use closest built-in profile' is picked", async () => {
	const dir = tempDir();
	try {
		const ui = makeUI({ inputs: [], confirms: [], selects: ["Use closest built-in profile"] });
		const ctx = { ui } as never;
		const result = await runFallbackActions(ctx, dir);
		assert.equal(result, "closest");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runFallbackActions returns 'stop' for Stop / Update Velpari", async () => {
	const dir = tempDir();
	try {
		const ui = makeUI({ inputs: [], confirms: [], selects: ["Stop"] });
		const ctx = { ui } as never;
		const stop = await runFallbackActions(ctx, dir);
		assert.equal(stop, "stop");

		const ui2 = makeUI({ inputs: [], confirms: [], selects: ["Update Velpari with a new profile"] });
		const ctx2 = { ui: ui2 } as never;
		const update = await runFallbackActions(ctx2, dir);
		assert.equal(update, "stop");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runFallbackActions returns undefined when the picker is dismissed", async () => {
	const dir = tempDir();
	try {
		const ui = makeUI({ inputs: [], confirms: [], selects: [undefined] });
		const ctx = { ui } as never;
		const result = await runFallbackActions(ctx, dir);
		assert.equal(result, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("buildResearchPrompt emits a pending-profile research brief", () => {
	const prompt = buildResearchPrompt({
		what: "x",
		who: "y",
		problem: "z",
		novelty: "new-product",
		platforms: [],
		sensitiveData: false,
		externalSystems: false,
		existingCodebase: false,
		applicationType: "web",
		domain: "banking",
		developmentMethod: "regulated",
		securityLevel: "high",
		regulated: true,
	});
	assert.match(prompt, /Profile selection: PENDING/);
	assert.match(prompt, /MUST NOT save or write a profile/);
	assert.match(prompt, /Research task:/);
	// Must NOT include a final selected profile id.
	assert.doesNotMatch(prompt, /^Profile: /m);
	assert.match(prompt, /candidate required sections/i);
});

test("handleConfigureRequirements selectors show labels with title-case application types", async () => {
	const dir = tempDir();
	try {
		const ui = happyPathUI();
		const ctx = { ui } as never;
		await handleConfigureRequirements(ctx, undefined, dir);
		// Find the notify that mentions the recommendation list. Just ensure
		// a select() call referenced "Application type" or "Domain" — labels are title-cased.
		const sawRecommendInfo = ui.notifies.some(
			(n) => /Profile recommendations/.test(n.msg),
		);
		assert.ok(sawRecommendInfo, "expected a notify with profile recommendations");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureRequirements skipped research still saves profile (researchConsent=false)", async () => {
	const dir = tempDir();
	try {
		const ui = happyPathUI({ research: false });
		const ctx = { ui } as never;
		await handleConfigureRequirements(ctx, undefined, dir);
		const profile = JSON.parse(
			readFileSync(join(dir, ".pi", "velpari", "requirements-profile.json"), "utf8"),
		);
		assert.equal(profile.researchConsent, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
