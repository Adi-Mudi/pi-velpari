/**
 * Tests for ui/simple-picker.ts (L2).
 *
 * Ported from Senai's test/ui/simple-picker.test.ts. The ctx.ui mock
 * pattern (makeFallbackCtx / makeTuiCtx) matches the repo's test style:
 * node:test with strict assert, no test framework.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	runSimplePicker,
	runSimpleConfirm,
	type SimplePickerItem,
} from "../../src/ui/simple-picker.js";

const ENTER = "\r";
const DOWN = "\x1b[B";
const UP = "\x1b[A";

const ITEMS: SimplePickerItem[] = [
	{ id: "a", label: "Option A" },
	{ id: "b", label: "Option B" },
	{ id: "c", label: "Option C" },
];

function makeTheme() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		dim: (text: string) => text,
	} as unknown as import("@earendil-works/pi-coding-agent").Theme;
}

function makeFallbackCtx(
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

function makeTuiCtx(): {
	ctx: ExtensionContext;
	getComponent: () => unknown;
} {
	let component: unknown;
	const custom = async (
		factory: (
			tui: import("@earendil-works/pi-tui").TUI,
			theme: import("@earendil-works/pi-coding-agent").Theme,
			keybindings: import("@earendil-works/pi-tui").KeybindingsManager,
			done: (result: string | undefined) => void,
		) => import("@earendil-works/pi-tui").Component,
	): Promise<string | undefined> => {
		return new Promise((resolve) => {
			component = factory(
				{ requestRender: () => {} } as unknown as import("@earendil-works/pi-tui").TUI,
				makeTheme(),
				{} as import("@earendil-works/pi-tui").KeybindingsManager,
				resolve,
			);
		});
	};
	const ctx = {
		cwd: "/tmp",
		mode: "tui",
		ui: { custom } as unknown as ExtensionUIContext,
	} as unknown as ExtensionContext;
	return { ctx, getComponent: () => component };
}

describe("runSimplePicker fallback", () => {
	it("returns the picked item's id by label", async () => {
		const ctx = makeFallbackCtx(["Option B"]);
		const result = await runSimplePicker(ctx, { title: "Pick", items: ITEMS });
		assert.strictEqual(result, "b");
	});

	it("returns undefined on cancel", async () => {
		const ctx = makeFallbackCtx([undefined]);
		const result = await runSimplePicker(ctx, { title: "Pick", items: ITEMS });
		assert.strictEqual(result, undefined);
	});

	it("never appends hints to fallback labels", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx(["Option A"], captured);
		const items: SimplePickerItem[] = [
			{ id: "a", label: "Option A", hint: "(recommended)" },
		];
		await runSimplePicker(ctx, { title: "Pick", items });
		assert.deepStrictEqual(captured[0], ["Option A"], "fallback label is byte-identical to the item label");
	});
});

describe("runSimplePicker custom TUI", () => {
	it("returns the focused item id on enter", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimplePicker(ctx, { title: "Pick", items: ITEMS });
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput(DOWN);
		comp.handleInput(ENTER);
		const result = await promise;
		assert.strictEqual(result, "b");
	});

	it("returns undefined on escape", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimplePicker(ctx, { title: "Pick", items: ITEMS });
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput("\x1b");
		const result = await promise;
		assert.strictEqual(result, undefined);
	});

	it("renders border, title, subtitle, and footer", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimplePicker(ctx, {
			title: "Pick one",
			subtitle: " Only the good ones.",
			items: ITEMS,
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		const lines = comp.render(80);
		assert.ok(lines.some((l) => l.includes("Pick one")), "title shown");
		assert.ok(lines.some((l) => l.includes("Only the good ones.")), "subtitle shown");
		assert.ok(lines.some((l) => l.includes("↑↓ navigate • enter select • esc cancel")), "footer shown");
		assert.ok(lines.filter((l) => l.startsWith("─")).length >= 4, "borders shown");
		comp.handleInput("\x1b");
		await promise;
	});

	it("shows the hint dim after the label in the custom picker", async () => {
		const recordingTheme = {
			fg: (color: string, text: string) => `${color}:${text}`,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => text,
			dim: (text: string) => text,
		} as unknown as import("@earendil-works/pi-coding-agent").Theme;
		let component: { render: (width: number) => string[]; handleInput: (data: string) => void } | undefined;
		const custom = async (factory: any): Promise<any> =>
			new Promise((resolve) => {
				component = factory({ requestRender: () => {} }, recordingTheme, {}, resolve);
			});
		const ctx = {
			cwd: "/tmp",
			mode: "tui",
			ui: { custom },
		} as unknown as ExtensionContext;

		const promise = runSimplePicker(ctx, {
			title: "Pick",
			items: [{ id: "a", label: "Option A", hint: "(recommended)" }],
		});
		const lines = component!.render(80);
		assert.ok(lines.some((l) => l.includes("dim:(recommended)")), "hint rendered dim");
		component!.handleInput("\x1b");
		await promise;
	});

	it("wraps up from the first item to the last", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimplePicker(ctx, { title: "Pick", items: ITEMS });
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput(UP);
		comp.handleInput(ENTER);
		const result = await promise;
		assert.strictEqual(result, "c", "UP from first wraps to last");
	});

	it("scrolls the window and shows the info line when items exceed the page size", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const items = Array.from({ length: 6 }, (_, i) => ({
			id: `i${i}`,
			label: `Item ${i}`,
		}));
		const promise = runSimplePicker(ctx, { title: "Pick", items, pageSize: 3 });
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		let lines = comp.render(80);
		assert.ok(lines.some((l) => l.includes("(1-3/6)")), "scroll info shown");
		for (let i = 0; i < 5; i++) comp.handleInput(DOWN);
		lines = comp.render(80);
		assert.ok(lines.some((l) => l.includes("Item 5")), "scrolled window shows Item 5");
		assert.ok(!lines.some((l) => l.includes("Item 0")), "Item 0 scrolled out");
		comp.handleInput(ENTER);
		const result = await promise;
		assert.strictEqual(result, "i5");
	});

	it("focuses initialSelectedId and falls back to the first item for an unknown id", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimplePicker(ctx, { title: "Pick", items: ITEMS, initialSelectedId: "c" });
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput(ENTER);
		assert.strictEqual(await promise, "c");

		const second = makeTuiCtx();
		const promise2 = runSimplePicker(second.ctx, { title: "Pick", items: ITEMS, initialSelectedId: "nope" });
		const comp2 = second.getComponent() as { handleInput: (data: string) => void };
		comp2.handleInput(ENTER);
		assert.strictEqual(await promise2, "a", "unknown id falls back to the first item");
	});
});

describe("runSimpleConfirm", () => {
	it("returns true on Yes, false on No, false on escape (TUI)", async () => {
		const yes = makeTuiCtx();
		const yesPromise = runSimpleConfirm(yes.ctx, "Sure?", "Do the thing?");
		(yes.getComponent() as { handleInput: (d: string) => void }).handleInput(ENTER);
		assert.strictEqual(await yesPromise, true, "Yes (first row) → true");

		const no = makeTuiCtx();
		const noPromise = runSimpleConfirm(no.ctx, "Sure?", "Do the thing?");
		const noComp = no.getComponent() as { handleInput: (d: string) => void };
		noComp.handleInput(DOWN);
		noComp.handleInput(ENTER);
		assert.strictEqual(await noPromise, false, "No → false");

		const esc = makeTuiCtx();
		const escPromise = runSimpleConfirm(esc.ctx, "Sure?", "Do the thing?");
		(esc.getComponent() as { handleInput: (d: string) => void }).handleInput("\x1b");
		assert.strictEqual(await escPromise, false, "escape → false");
	});

	it("delegates to ctx.ui.confirm outside TUI mode", async () => {
		let confirmCalled = false;
		let customCalled = false;
		const ctx = {
			cwd: "/tmp",
			ui: {
				confirm: async () => {
					confirmCalled = true;
					return true;
				},
				custom: async () => {
					customCalled = true;
					return undefined;
				},
			} as unknown as ExtensionUIContext,
		} as unknown as ExtensionContext;

		const result = await runSimpleConfirm(ctx, "Sure?", "Do the thing?");
		assert.strictEqual(result, true, "confirm result passed through");
		assert.strictEqual(confirmCalled, true, "ctx.ui.confirm used");
		assert.strictEqual(customCalled, false, "custom picker not used outside TUI");
	});
});

describe("coverage audit gaps", () => {
	it("fallback returns undefined when select returns a label not in the offered list", async () => {
		const ctx = makeFallbackCtx(["Not an offered label"]);
		const result = await runSimplePicker(ctx, { title: "Pick", items: ITEMS });
		assert.strictEqual(result, undefined, "unknown label maps to no item id");
	});

	it("uses the fallback when custom is a native function", async () => {
		let customCalled = false;
		const custom = async () => {
			customCalled = true;
			return undefined;
		};
		custom.toString = () => "function () { [native code] }";
		const ctx = {
			cwd: "/tmp",
			mode: "tui",
			ui: {
				select: async () => "Option B",
				custom,
			} as unknown as ExtensionUIContext,
		} as unknown as ExtensionContext;
		const result = await runSimplePicker(ctx, { title: "Pick", items: ITEMS });
		assert.strictEqual(result, "b", "fallback select path used");
		assert.strictEqual(customCalled, false, "native custom is never called");
	});

	it("custom picker wraps DOWN from the last item to the first", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimplePicker(ctx, { title: "Pick", items: ITEMS, initialSelectedId: "c" });
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput(DOWN);
		comp.handleInput(ENTER);
		const result = await promise;
		assert.strictEqual(result, "a", "DOWN from last wraps to index 0");
	});

	it("handles an empty items array without crashing in fallback and custom modes", async () => {
		const captured: string[][] = [];
		const fbCtx = makeFallbackCtx([undefined], captured);
		const fbResult = await runSimplePicker(fbCtx, { title: "Pick", items: [] });
		assert.deepStrictEqual(captured[0], [], "fallback select offered no labels");
		assert.strictEqual(fbResult, undefined);

		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimplePicker(ctx, { title: "Pick", items: [] });
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		assert.ok(comp.render(80).length > 0, "custom picker renders with no items");
		comp.handleInput(ENTER);
		const result = await promise;
		assert.strictEqual(result, undefined, "enter on empty list resolves undefined");
	});
});

describe("width clamping (TUI crash guard)", () => {
	it("never renders a line wider than the given width, even with a long multi-line confirm message", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const message = [
			`Input documents: ${"Very Long Document Name, ".repeat(20)}`,
			"",
			"Paths to add to the configuration (14):",
			...Array.from(
				{ length: 14 },
				(_, i) => `  - folder-${i}/with-a-very-long-generated-path-name-${i}`,
			),
			"Existing configured paths are not touched. Proceed?",
		].join("\n");
		const promise = runSimpleConfirm(ctx, "Update inputs", message);
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		for (const width of [213, 80, 40, 10]) {
			for (const line of comp.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: "${line}"`);
			}
		}
		comp.handleInput("\x1b");
		assert.strictEqual(await promise, false, "escape cancels the confirm");
	});

	it("splits the confirm message on newlines into separate rendered lines", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimpleConfirm(ctx, "Confirm", "line one\nline two\nline three");
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		const lines = comp.render(80);
		assert.ok(lines.some((l) => l.includes("line one")), "first line shown");
		assert.ok(lines.some((l) => l.includes("line two")), "second line shown");
		assert.ok(lines.some((l) => l.includes("line three")), "third line shown");
		comp.handleInput("\x1b");
		await promise;
	});

	it("truncates long titles and long item labels with hints", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimplePicker(ctx, {
			title: "T".repeat(300),
			items: [{ id: "a", label: "L".repeat(300), hint: "H".repeat(300) }],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		for (const line of comp.render(40)) {
			assert.ok(visibleWidth(line) <= 40, `line exceeds width 40: "${line}"`);
		}
		comp.handleInput("\x1b");
		await promise;
	});
});

describe("width clamping edge cases", () => {
	it("keeps lines within width when the theme adds real ANSI escape codes", async () => {
		const ansiTheme = {
			fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[0m`,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
			dim: (text: string) => `\x1b[2m${text}\x1b[22m`,
		} as unknown as import("@earendil-works/pi-coding-agent").Theme;
		let component:
			| { render: (width: number) => string[]; handleInput: (data: string) => void }
			| undefined;
		const custom = async (factory: any): Promise<any> =>
			new Promise((resolve) => {
				component = factory({ requestRender: () => {} }, ansiTheme, {}, resolve);
			});
		const ctx = { cwd: "/tmp", mode: "tui", ui: { custom } } as unknown as ExtensionContext;
		const promise = runSimplePicker(ctx, {
			title: "T".repeat(300),
			subtitle: "S".repeat(300),
			items: [{ id: "a", label: "L".repeat(300), hint: "H".repeat(300) }],
		});
		for (const width of [80, 40, 10, 2]) {
			for (const line of component!.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
		}
		component!.handleInput("\x1b");
		await promise;
	});

	it("handles emoji and CJK characters without exceeding width", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimplePicker(ctx, {
			title: "✅ Pick 🚀 漢字テスト",
			items: [{ id: "a", label: "Option ✅🚀漢字".repeat(20), hint: "漢字🚀".repeat(20) }],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		for (const width of [40, 10, 2]) {
			for (const line of comp.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
		}
		comp.handleInput("\x1b");
		await promise;
	});

	it("hard-cuts a single unbroken 500-character token", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const token = "x".repeat(500);
		const promise = runSimplePicker(ctx, {
			title: token,
			subtitle: token,
			items: [{ id: "a", label: token }],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		for (const width of [40, 10, 2]) {
			for (const line of comp.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
		}
		comp.handleInput("\x1b");
		await promise;
	});

	it("renders within width at tiny widths 2 and 3", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimplePicker(ctx, { title: "Pick", items: ITEMS });
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		for (const width of [2, 3]) {
			for (const line of comp.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
		}
		comp.handleInput("\x1b");
		await promise;
	});

	it("renders a blank-only subtitle and empty items without crashing", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runSimplePicker(ctx, { title: "Pick", subtitle: "\n\n", items: [] });
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		for (const width of [80, 10]) {
			for (const line of comp.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
		}
		comp.handleInput("\x1b");
		await promise;
	});
});
