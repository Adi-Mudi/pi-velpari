/**
 * configure-requirements UI handler tests (gap #7 from coverage baseline).
 *
 * Strategy: drive `handleConfigureRequirements` with a generic UiResponder
 * that picks the first option for any select, returns a fixed string for
 * any input, and returns true/false for confirms. Override the default
 * by returning a specific value for the question we want to test.
 *
 * Tests:
 *   - happy path: 7-step ask + web-research + save
 *   - warns when an existing profile is found
 *   - aborts when core question answer is missing (3 attempts then bail)
 *   - aborts when novelty is skipped
 *   - aborts when application type is skipped
 *   - web-research without pi: warns but continues
 *   - web-research declined: no prompt sent, profile still saved
 *   - fallback path: no exact match → user picks "core"
 *   - fallback path: user picks "stop" → no profile saved
 *   - confirm-save declined: no profile saved
 *   - select undefined (user dismissed picker) → cancel without save
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleConfigureRequirements } from "../../src/ops/configure-requirements/index.js";
import { loadRequirementsProfile } from "../../src/core/profile.js";

interface Notice {
	message: string;
	level: string;
}

interface UiScript {
	select: (title: string, options: string[]) => Promise<string | number | undefined>;
	input: (title: string, placeholder?: string) => Promise<string | undefined>;
	confirm: (title: string, message?: string) => Promise<boolean | undefined>;
}

type UiResponder = (call: {
	method: "select" | "input" | "confirm";
	title: string;
	options?: string[];
}) => string | number | boolean | undefined;

let tmpDir: string;
let notices: Notice[];

function makeCtx(respond: UiResponder): ExtensionCommandContext {
	notices = [];
	const ui: UiScript = {
		select: async (title, options) => {
			const r = respond({ method: "select", title, options });
			return r as string | undefined;
		},
		input: async (title) => {
			const r = respond({ method: "input", title });
			return r as string | undefined;
		},
		confirm: async (title) => {
			const r = respond({ method: "confirm", title });
			return r as boolean | undefined;
		},
	};
	return {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
			setStatus: () => {},
			select: ui.select,
			input: ui.input,
			confirm: ui.confirm,
		},
	} as unknown as ExtensionCommandContext;
}

function allMessages(): string {
	return notices.map((n) => n.message).join("\n");
}

/**
 * Generic happy-path responder: pick first option for every select,
 * return a fixed string for every input, return true for every confirm.
 */
function happyRespond(): UiResponder {
	return (call) => {
		if (call.method === "input") return "ok";
		if (call.method === "select") return call.options?.[0] ?? "";
		if (call.method === "confirm") return true;
		return undefined;
	};
}

function makePi(recorder: { sentPrompts: string[] }) {
	return {
		sendUserMessage: (msg: string) => {
			recorder.sentPrompts.push(msg);
		},
	} as unknown as Parameters<typeof handleConfigureRequirements>[1];
}

function writeFilesConfig(projectName: string) {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "files.json"), JSON.stringify({ version: 4, projectName }));
}

function writeValidExistingProfile() {
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "requirements-profile.json"),
		JSON.stringify({
			profileId: "core-psrs-v1",
			profileKind: "common-core",
			version: "1.1.0",
			createdAt: new Date().toISOString(),
			requiredSections: [],
			applicationType: "web",
			domain: "general",
			developmentMethod: "agile",
			regulated: false,
			securityLevel: "medium",
			outputVariant: "standard",
			conditionalQuestions: [],
			researchConsent: false,
			researchSources: [],
		}),
	);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-cfg-req-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("/velpari-configure-requirements — UI handler", () => {
	it("happy path: 7-step ask + web-research + save", async () => {
		writeFilesConfig("TestApp");
		const piRecorder = { sentPrompts: [] as string[] };
		const ctx = makeCtx(happyRespond());

		await handleConfigureRequirements(ctx, makePi(piRecorder), tmpDir);

		assert.equal(piRecorder.sentPrompts.length, 1, "research consent + pi → one prompt sent");
		const saved = loadRequirementsProfile(tmpDir);
		assert.ok(saved, "profile was not saved");
		assert.equal(saved!.profileKind === "built-in" || saved!.profileKind === "common-core", true);
		assert.match(allMessages(), /Profile saved:/);
	});

	it("warns when an existing profile is found", async () => {
		writeFilesConfig("TestApp");
		writeValidExistingProfile();

		const piRecorder = { sentPrompts: [] as string[] };
		const ctx = makeCtx(happyRespond());

		await handleConfigureRequirements(ctx, makePi(piRecorder), tmpDir);

		assert.match(allMessages(), /Existing profile: core-psrs-v1@1\.1\.0/);
		assert.match(allMessages(), /Re-running will overwrite/);
	});

	it("aborts when core question answer is missing (3 attempts then bail)", async () => {
		writeFilesConfig("TestApp");
		const respond: UiResponder = (call) => {
			// The first "what are you building" answer is empty.
			if (call.method === "input" && call.title === "What are you building? (one sentence)") return "";
			return "ok";
		};
		const ctx = makeCtx(respond);

		await handleConfigureRequirements(ctx, undefined, tmpDir);

		assert.match(allMessages(), /Aborted after 3 empty attempts/);
		assert.equal(loadRequirementsProfile(tmpDir), null, "no profile should be saved on abort");
	});

	it("aborts when novelty is skipped", async () => {
		writeFilesConfig("TestApp");
		const respond: UiResponder = (call) => {
			if (call.method === "input") return "ok";
			if (call.method === "select" && call.title === "Novelty") return undefined;
			if (call.method === "confirm") return false;
			return undefined;
		};
		const ctx = makeCtx(respond);

		await handleConfigureRequirements(ctx, undefined, tmpDir);

		assert.match(allMessages(), /Configuration aborted \(missing novelty\)/);
		assert.equal(loadRequirementsProfile(tmpDir), null);
	});

	it("aborts when application type is skipped (after passing novelty + platforms)", async () => {
		writeFilesConfig("TestApp");
		const respond: UiResponder = (call) => {
			if (call.method === "input") return "ok";
			if (call.method === "select" && call.title === "Novelty") return call.options?.[0] ?? "";
			if (call.method === "select" && call.title === "Application type") return undefined;
			if (call.method === "confirm") return false;
			return undefined;
		};
		const ctx = makeCtx(respond);

		await handleConfigureRequirements(ctx, undefined, tmpDir);

		assert.match(allMessages(), /Configuration aborted \(missing application type\)/);
	});

	it("web-research without pi: warns but continues", async () => {
		writeFilesConfig("TestApp");
		const piRecorder = { sentPrompts: [] as string[] };
		const ctx = makeCtx(happyRespond());

		// No pi passed → research handoff cannot fire.
		await handleConfigureRequirements(ctx, undefined, tmpDir);

		assert.equal(piRecorder.sentPrompts.length, 0);
		assert.match(allMessages(), /Web research was requested but no ExtensionAPI is available/);
		assert.match(allMessages(), /Profile saved:/);
	});

	it("web-research declined: no prompt sent, profile still saved", async () => {
		writeFilesConfig("TestApp");
		const piRecorder = { sentPrompts: [] as string[] };
		const respond: UiResponder = (call) => {
			if (call.method === "input") return "ok";
			if (call.method === "select") return call.options?.[0] ?? "";
			// Decline web research.
			if (call.method === "confirm" && call.title === "Web research?") return false;
			if (call.method === "confirm") return true;
			return undefined;
		};
		const ctx = makeCtx(respond);

		await handleConfigureRequirements(ctx, makePi(piRecorder), tmpDir);

		assert.equal(piRecorder.sentPrompts.length, 0);
		assert.match(allMessages(), /Profile saved:/);
	});

	it("fallback path: no exact match → user picks 'core' fallback", async () => {
		writeFilesConfig("TestApp");
		const piRecorder = { sentPrompts: [] as string[] };
		// Force fallback by picking an option that yields no exact built-in match.
		// APPLICATION_TYPES last value is "other"; DOMAINS last is "other".
		// DEVELOPMENT_METHODS last is "regulated".
		const respond: UiResponder = (call) => {
			if (call.method === "input") return "ok";
			if (call.method === "select") {
				if (call.title === "Choose a profile") return call.options?.[0] ?? "";
				if (call.title.startsWith("No exact profile match")) return "Use common PSRS core";
				// Application type, domain, development method: pick the LAST option.
				// applicationType labels: ["Web", "Mobile", ..., "Other"]
				// domain labels: ["General", "Healthcare", ..., "Other"]
				// developmentMethod labels: ["Agile", "Waterfall", "Hybrid", "Safety Critical", "Regulated"]
				if (call.title === "Application type") return call.options?.[call.options.length - 1] ?? "";
				if (call.title === "Domain") return call.options?.[call.options.length - 1] ?? "";
				if (call.title === "Development method") return call.options?.[call.options.length - 1] ?? "";
				return call.options?.[0] ?? "";
			}
			if (call.method === "confirm") return true;
			return undefined;
		};
		const ctx = makeCtx(respond);

		await handleConfigureRequirements(ctx, makePi(piRecorder), tmpDir);

		const saved = loadRequirementsProfile(tmpDir);
		assert.ok(saved, "profile was not saved");
		assert.equal(saved!.profileKind, "common-core", "fallback should pick the common PSRS core");
	});

	it("fallback path: user picks 'stop' → no profile saved", async () => {
		writeFilesConfig("TestApp");
		const piRecorder = { sentPrompts: [] as string[] };
		const respond: UiResponder = (call) => {
			if (call.method === "input") return "ok";
			if (call.method === "select") {
				if (call.title.startsWith("No exact profile match")) return "Stop";
				if (call.title === "Application type") return call.options?.[call.options.length - 1] ?? "";
				if (call.title === "Domain") return call.options?.[call.options.length - 1] ?? "";
				if (call.title === "Development method") return call.options?.[call.options.length - 1] ?? "";
				return call.options?.[0] ?? "";
			}
			if (call.method === "confirm") return true;
			return undefined;
		};
		const ctx = makeCtx(respond);

		await handleConfigureRequirements(ctx, makePi(piRecorder), tmpDir);

		assert.match(allMessages(), /Configuration cancelled\. No profile was saved\./);
		assert.equal(loadRequirementsProfile(tmpDir), null);
	});

	it("confirm-save declined: no profile saved", async () => {
		writeFilesConfig("TestApp");
		const piRecorder = { sentPrompts: [] as string[] };
		const respond: UiResponder = (call) => {
			if (call.method === "input") return "ok";
			if (call.method === "select") return call.options?.[0] ?? "";
			// Decline the save confirmation.
			if (call.method === "confirm" && call.title === "Confirm profile selection?") return false;
			if (call.method === "confirm") return true;
			return undefined;
		};
		const ctx = makeCtx(respond);

		await handleConfigureRequirements(ctx, makePi(piRecorder), tmpDir);

		assert.match(allMessages(), /Configuration cancelled \(user declined save\)/);
		assert.equal(loadRequirementsProfile(tmpDir), null);
	});

	it("select undefined (user dismissed fallback picker) → cancel without save", async () => {
		writeFilesConfig("TestApp");
		const piRecorder = { sentPrompts: [] as string[] };
		const respond: UiResponder = (call) => {
			if (call.method === "input") return "ok";
			if (call.method === "select") {
				// If we hit the exact-match picker, return undefined to dismiss.
				if (call.title === "Choose a profile") return undefined;
				if (call.title.startsWith("No exact profile match")) return undefined; // user pressed Esc
				// Otherwise pick last option to force fallback path.
				if (call.title === "Application type") return call.options?.[call.options.length - 1] ?? "";
				if (call.title === "Domain") return call.options?.[call.options.length - 1] ?? "";
				if (call.title === "Development method") return call.options?.[call.options.length - 1] ?? "";
				return call.options?.[0] ?? "";
			}
			if (call.method === "confirm") return true;
			return undefined;
		};
		const ctx = makeCtx(respond);

		await handleConfigureRequirements(ctx, makePi(piRecorder), tmpDir);

		// runFallbackActions returns undefined when picked is undefined → handler
		// reports "Configuration cancelled" (no "No profile was saved" suffix
		// because that message fires only when fallback === "stop").
		assert.match(allMessages(), /Configuration cancelled/);
		assert.equal(loadRequirementsProfile(tmpDir), null);
	});
});
