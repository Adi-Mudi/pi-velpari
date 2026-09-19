/**
 * Tests for ui/fix-picker.ts (L2).
 *
 * The picker is a 2-level wrapper around `runSimplePicker`. The custom
 * TUI path is exercised transitively by `simple-picker.test.ts`. Here
 * we focus on the fallback (non-TUI) flow so we can assert the
 * 2-level orchestration behavior (when items exist, "Fix an item"
 * opens a sub-picker; without items the option is omitted).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { runFixPicker } from "../../src/ui/fix-picker.js";
import type { ActionableItem } from "../../src/doctor/fix-dispatch.js";

function makeCtx(
	selects: (string | undefined)[],
	capturedSelectOptions?: string[][],
): ExtensionContext {
	let index = 0;
	return {
		cwd: "/tmp",
		ui: {
			select: async (_title: string, options: string[]) => {
				capturedSelectOptions?.push(options);
				return selects[index++];
			},
		} as unknown as ExtensionUIContext,
	} as unknown as ExtensionContext;
}

function makeItems(n: number): ActionableItem[] {
	return Array.from({ length: n }, (_, i) => ({
		index: i,
		section: `Section ${i}`,
		status: i % 2 === 0 ? "error" : "warning",
		message: `Item ${i} message`,
		suggestion: `Suggestion text for item ${i}: run the matching command`,
		level: "interactive",
	}));
}

const REPORT_PATH = "/tmp/velpari-fixture/.IDE_Plans/velpari/doctor-report.md";

describe("runFixPicker (fallback)", () => {
	it("returns open-report when the user picks it", async () => {
		const ctx = makeCtx(["Open full report"]);
		const result = await runFixPicker(ctx, {
			title: "Doctor fix",
			items: makeItems(2),
			reportPath: REPORT_PATH,
		});
		assert.deepEqual(result, { kind: "open-report" });
	});

	it("returns skip when the user picks it", async () => {
		const ctx = makeCtx(["Skip — end doctor"]);
		const result = await runFixPicker(ctx, {
			title: "Doctor fix",
			items: makeItems(2),
			reportPath: REPORT_PATH,
		});
		assert.deepEqual(result, { kind: "skip" });
	});

	it("returns skip when the user cancels (Esc)", async () => {
		const ctx = makeCtx([undefined]);
		const result = await runFixPicker(ctx, {
			title: "Doctor fix",
			items: makeItems(2),
			reportPath: REPORT_PATH,
		});
		assert.deepEqual(result, { kind: "skip" });
	});

	it("opens the sub-picker when 'fix-an-item' is chosen and returns the matched item", async () => {
		// First select: pick "Fix an item" → triggers sub-picker.
		// Sub-picker options come from items, label = "<icon>  <message>"
		// where the icon is "❌" for error and "⚠️" for warning
		// (matches doctor/_types.ts:iconFor). makeItems() makes even
		// indexes "error" → "❌" and odd indexes "warning" → "⚠️".
		// So item index 2 (error) gets label "❌  Item 2 message".
		const ctx = makeCtx(["Fix an item (3 actionable)", "❌  Item 2 message"]);
		const items = makeItems(3);
		const result = await runFixPicker(ctx, {
			title: "Doctor fix",
			items,
			reportPath: REPORT_PATH,
		});
		assert.equal(result.kind, "fix-one");
		if (result.kind === "fix-one") {
			assert.equal(result.item.index, 2);
			assert.equal(result.item.message, "Item 2 message");
		}
	});

	it("returns skip when the sub-picker cancels (Esc)", async () => {
		const ctx = makeCtx(["Fix an item (1 actionable)", undefined]);
		const result = await runFixPicker(ctx, {
			title: "Doctor fix",
			items: makeItems(1),
			reportPath: REPORT_PATH,
		});
		assert.deepEqual(result, { kind: "skip" });
	});

	it("omits 'Fix an item' when items is empty", async () => {
		const captured: string[][] = [];
		// Only "Open full report" and "Skip — end doctor" should be
		// offered (2 options).
		const ctx = makeCtx(["Open full report"], captured);
		const result = await runFixPicker(ctx, {
			title: "Doctor fix",
			items: [],
			reportPath: REPORT_PATH,
		});
		assert.deepEqual(result, { kind: "open-report" });
		const labels = captured[0] ?? [];
		assert.equal(labels.length, 2);
		assert.ok(!labels.some((l) => l.startsWith("Fix an item")));
	});

	it("decorates top-level options with item count when items exist", async () => {
		const captured: string[][] = [];
		const ctx = makeCtx(["Skip — end doctor"], captured);
		await runFixPicker(ctx, {
			title: "Doctor fix",
			items: makeItems(5),
			reportPath: REPORT_PATH,
		});
		const labels = captured[0] ?? [];
		assert.ok(labels.some((l) => l.includes("(5 actionable)")));
	});

	// Note: the report path appears as a `hint` on the
	// "Open full report" picker row in custom-TUI mode. The fallback
	// path passes only `label`s to `ctx.ui.select`, so hints are
	// invisible to fallback callers. The custom-TUI path is exercised
	// transitively by `test/ui/simple-picker.test.ts`.
});
