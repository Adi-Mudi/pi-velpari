/**
 * arch-confirm.ts tests — Step 3 of the architecture sub-life cycle.
 *
 * Covers:
 *   - user picks "Proceed" → confirmed: true
 *   - user picks "Adjust scope" → confirmed: false, outcome "adjust"
 *   - user picks "Pick a different profile" → confirmed: false, outcome "profile"
 *   - no UI → returns "no-ui" with confirmed: false
 *   - renderConfirmPrompt renders the summary
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { confirmWithDeveloper, renderConfirmPrompt } from "../../src/core/arch-confirm.js";
import type { ArchContext } from "../../src/core/arch-context.js";

function makeCtx(overrides: Partial<ArchContext> = {}): ArchContext {
	return {
		runId: "r",
		mission: "m",
		projectName: "P",
		filesConfig: null,
		requirementsProfile: null,
		standardsProfile: null,
		prd: null,
		rtm: null,
		feasibility: null,
		agentsConfig: null,
		missingInputs: [],
		...overrides,
	};
}

function makeUi(choice: string | null): { select: (title: string, options: string[]) => Promise<string | null> } {
	return {
		select: async (_title: string, _options: string[]) => choice,
	};
}

describe("confirmWithDeveloper — proceed", () => {
	it("returns confirmed: true when user picks Proceed", async () => {
		const ui = makeUi("Proceed — generate the architecture");
		const result = await confirmWithDeveloper(
			{ ui } as unknown as Parameters<typeof confirmWithDeveloper>[0],
			makeCtx(),
		);
		assert.strictEqual(result.outcome, "proceed");
		assert.strictEqual(result.confirmed, true);
		assert.match(result.summaryShown, /Project: P/);
	});

	it("returns confirmed: true for any label starting with 'Proceed'", async () => {
		const ui = makeUi("Proceed (custom wording)");
		const result = await confirmWithDeveloper(
			{ ui } as unknown as Parameters<typeof confirmWithDeveloper>[0],
			makeCtx(),
		);
		assert.strictEqual(result.outcome, "proceed");
		assert.strictEqual(result.confirmed, true);
	});
});

describe("confirmWithDeveloper — adjust scope", () => {
	it("returns confirmed: false when user picks Adjust", async () => {
		const ui = makeUi("Adjust scope — I'll edit the context first");
		const result = await confirmWithDeveloper(
			{ ui } as unknown as Parameters<typeof confirmWithDeveloper>[0],
			makeCtx(),
		);
		assert.strictEqual(result.outcome, "adjust");
		assert.strictEqual(result.confirmed, false);
	});
});

describe("confirmWithDeveloper — pick different profile", () => {
	it("returns confirmed: false when user picks the profile option", async () => {
		const ui = makeUi("Pick a different profile — run /velpari-configure-standards");
		const result = await confirmWithDeveloper(
			{ ui } as unknown as Parameters<typeof confirmWithDeveloper>[0],
			makeCtx(),
		);
		assert.strictEqual(result.outcome, "profile");
		assert.strictEqual(result.confirmed, false);
	});
});

describe("confirmWithDeveloper — no UI", () => {
	it("returns 'no-ui' when ui.select is missing", async () => {
		const result = await confirmWithDeveloper(
			{} as unknown as Parameters<typeof confirmWithDeveloper>[0],
			makeCtx(),
		);
		assert.strictEqual(result.outcome, "no-ui");
		assert.strictEqual(result.confirmed, false);
	});

	it("returns 'no-ui' when ui is undefined", async () => {
		const fakeCtx = { ui: undefined } as unknown as Parameters<typeof confirmWithDeveloper>[0];
		const result = await confirmWithDeveloper(fakeCtx, makeCtx());
		assert.strictEqual(result.outcome, "no-ui");
		assert.strictEqual(result.confirmed, false);
	});

	it("returns 'no-ui' when user dismisses the picker", async () => {
		const ui = makeUi(null);
		const result = await confirmWithDeveloper(
			{ ui } as unknown as Parameters<typeof confirmWithDeveloper>[0],
			makeCtx(),
		);
		assert.strictEqual(result.outcome, "no-ui");
		assert.strictEqual(result.confirmed, false);
	});
});

describe("renderConfirmPrompt", () => {
	it("includes the summary and asks the developer to pick", () => {
		const summary = "Project: P\nMission: m";
		const prompt = renderConfirmPrompt(summary);
		assert.match(prompt, /## Architecture sub-life cycle — confirm/);
		assert.match(prompt, /Project: P/);
		assert.match(prompt, /Proceed, adjust scope, or pick a different profile\?/);
	});
});
