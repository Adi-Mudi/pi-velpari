/**
 * Tests for ui/list-editor.ts (L2).
 *
 * Ported from Senai's test/ui/list-editor.test.ts. Mock pattern matches
 * the repo's test style: node:test with strict assert.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { runListEditor, truncateMiddle, type ListEditorAction } from "../../src/ui/list-editor.js";

const ENTER = "\r";
const DOWN = "\x1b[B";
const UP = "\x1b[A";

function makeTheme() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		dim: (text: string) => text,
	} as unknown as import("@earendil-works/pi-coding-agent").Theme;
}

function makeTui() {
	return {
		requestRender: () => {},
	} as unknown as import("@earendil-works/pi-tui").TUI;
}

function makeFallbackCtx(
	selects: (string | undefined)[],
	inputs: (string | undefined)[],
	capturedSelectOptions?: string[][],
): ExtensionContext {
	let selectIndex = 0;
	let inputIndex = 0;
	return {
		cwd: "/tmp",
		ui: {
			select: async (_title: string, options: string[]) => {
				capturedSelectOptions?.push(options);
				return selects[selectIndex++];
			},
			input: async () => inputs[inputIndex++] ?? "",
		} as unknown as ExtensionUIContext,
	} as unknown as ExtensionContext;
}

function makeTuiCtx(): {
	ctx: ExtensionContext;
	getComponent: () => unknown;
	getDone: () => (action: ListEditorAction) => void;
} {
	let component: unknown;
	let doneFn: (action: ListEditorAction) => void = () => {};

	const custom = async (
		factory: (
			tui: import("@earendil-works/pi-tui").TUI,
			theme: import("@earendil-works/pi-coding-agent").Theme,
			keybindings: import("@earendil-works/pi-tui").KeybindingsManager,
			done: (result: ListEditorAction) => void,
		) => import("@earendil-works/pi-tui").Component,
	): Promise<ListEditorAction> => {
		return new Promise((resolve) => {
			doneFn = resolve;
			component = factory(makeTui(), makeTheme(), {} as import("@earendil-works/pi-tui").KeybindingsManager, resolve);
		});
	};

	const ctx = {
		cwd: "/tmp",
		mode: "tui",
		ui: {
			input: async () => "",
			custom,
		} as unknown as ExtensionUIContext,
	} as unknown as ExtensionContext;

	return {
		ctx,
		getComponent: () => component,
		getDone: () => doneFn,
	};
}

function selectedLine(lines: string[]): string | undefined {
	return lines.find((line) => line.startsWith("→"));
}

describe("runListEditor fallback", () => {
	it("returns done with current paths on Back", async () => {
		const ctx = makeFallbackCtx(["Back"], []);
		const result = await runListEditor(ctx, {
			title: "Test",
			items: [
				{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" },
				{ id: "r1", kind: "selected", label: "✅ Remove: b", value: "b" },
			],
		});
		assert.deepStrictEqual(result, { kind: "done", paths: ["b"] });
	});

	it("adds a suggestion and returns done with it", async () => {
		const ctx = makeFallbackCtx(["⬜ Suggest: a", "Back"], []);
		const result = await runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
		});
		assert.deepStrictEqual(result, { kind: "done", paths: ["a"] });
	});

	it("removes a selected path and returns done", async () => {
		const ctx = makeFallbackCtx(["✅ Remove: b", "Back"], []);
		const result = await runListEditor(ctx, {
			title: "Test",
			items: [{ id: "r1", kind: "selected", label: "✅ Remove: b", value: "b" }],
		});
		assert.deepStrictEqual(result, { kind: "done", paths: [] });
	});

	it("returns filter action with query", async () => {
		const ctx = makeFallbackCtx(["Filter suggestions..."], ["src"]);
		const result = await runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: src/main.ts", value: "src/main.ts" }],
			enableFilter: true,
		});
		assert.deepStrictEqual(result, { kind: "filter", query: "src", paths: [] });
	});

	it("returns custom action with id and current paths", async () => {
		const ctx = makeFallbackCtx(["Add custom"], []);
		const result = await runListEditor(ctx, {
			title: "Test",
			items: [{ id: "r1", kind: "selected", label: "✅ Remove: b", value: "b" }],
			customActions: [{ id: "add", label: "Add custom" }],
		});
		assert.deepStrictEqual(result, { kind: "custom", id: "add", paths: ["b"] });
	});

	it("paginates suggestions and moves between pages", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx(["Next page →", "← Previous page", "Back"], [], captured);
		const items = Array.from({ length: 5 }, (_, i) => ({
			id: `s${i}`,
			kind: "suggestion" as const,
			label: `⬜ Suggest: path${i}`,
			value: `path${i}`,
		}));
		const result = await runListEditor(ctx, { title: "Test", items, pageSize: 2 });

		// First page: no previous-page control, second-page labels absent.
		const page0 = captured[0] ?? [];
		const page1 = captured[1] ?? [];
		const page2 = captured[2] ?? [];
		assert.ok(page0.includes("Next page →"));
		assert.ok(!page0.includes("← Previous page"));
		assert.ok(page0.includes("⬜ Suggest: path0"));
		assert.ok(!page0.includes("⬜ Suggest: path2"));
		// Second page: second-page labels shown, both page controls present.
		assert.ok(page1.includes("⬜ Suggest: path2"));
		assert.ok(page1.includes("⬜ Suggest: path3"));
		assert.ok(page1.includes("← Previous page"));
		assert.ok(page1.includes("Next page →"));
		// Previous page returns to the first page.
		assert.ok(page2.includes("⬜ Suggest: path0"));
		assert.ok(!page2.includes("← Previous page"));
		assert.deepStrictEqual(result, { kind: "done", paths: [] });
	});

	it("returns back when the select is cancelled", async () => {
		const ctx = makeFallbackCtx([undefined], []);
		const result = await runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
		});
		assert.deepStrictEqual(result, { kind: "back" });
	});

	it("hides non-matching suggestions when a filter query is preset", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx(["Back"], [], captured);
		const result = await runListEditor(ctx, {
			title: "Test",
			items: [
				{ id: "s1", kind: "suggestion", label: "⬜ Suggest: src/a.ts", value: "src/a.ts" },
				{ id: "s2", kind: "suggestion", label: "⬜ Suggest: docs/b.md", value: "docs/b.md" },
			],
			filterQuery: "src",
		});
		assert.ok(captured[0]?.includes("⬜ Suggest: src/a.ts"));
		assert.ok(!captured[0]?.includes("⬜ Suggest: docs/b.md"));
		assert.deepStrictEqual(result, { kind: "done", paths: [] });
	});

	it("clears the preset filter via the clear label and empty input", async () => {
		const ctx = makeFallbackCtx(["Filter: src (clear)"], [""]);
		const result = await runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: src/a.ts", value: "src/a.ts" }],
			enableFilter: true,
			filterQuery: "src",
		});
		assert.deepStrictEqual(result, { kind: "filter", query: "", paths: [] });
	});

	it("offers only Back when there are no suggestions or selected items", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx(["Back"], [], captured);
		const result = await runListEditor(ctx, { title: "Test", items: [] });
		assert.deepStrictEqual(captured[0], ["Back"]);
		assert.deepStrictEqual(result, { kind: "done", paths: [] });
	});

	it("uses the fallback select path when forceFallback is true in TUI mode", async () => {
		let customCalled = false;
		const ctx = {
			cwd: "/tmp",
			mode: "tui",
			ui: {
				select: async () => "Back",
				input: async () => "",
				custom: async () => {
					customCalled = true;
					return { kind: "back" };
				},
			} as unknown as ExtensionUIContext,
		} as unknown as ExtensionContext;
		const result = await runListEditor(ctx, {
			title: "Test",
			items: [],
			forceFallback: true,
		});
		assert.strictEqual(customCalled, false);
		assert.deepStrictEqual(result, { kind: "done", paths: [] });
	});
});

describe("runListEditor custom TUI", () => {
	it("returns done with paths when Back is selected", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "r1", kind: "selected", label: "✅ Remove: b", value: "b" }],
		});
		const comp = getComponent() as { handleInput: (data: string) => void };
		// The top action bar starts focused on Back; just confirm it.
		comp.handleInput(ENTER);
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "done", paths: ["b"] });
	});

	it("adds a suggestion without closing", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		// Move focus from the action bar into the content list, then add the suggestion.
		comp.handleInput(DOWN);
		comp.handleInput(ENTER);

		const line = selectedLine(comp.render(80));
		assert.ok(line?.includes("✅ a"), `expected a to be selected after adding, got: ${line}`);

		getDone()({ kind: "back" });
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "back" });
	});

	it("preserves cursor position after removing an item", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [
				{ id: "r1", kind: "selected", label: "✅ Remove: a", value: "a" },
				{ id: "r2", kind: "selected", label: "✅ Remove: b", value: "b" },
				{ id: "r3", kind: "selected", label: "✅ Remove: c", value: "c" },
			],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		// Move from the action bar into the content list, then down to "b" and remove it.
		comp.handleInput(DOWN);
		comp.handleInput(DOWN);
		comp.handleInput(ENTER);

		const line = selectedLine(comp.render(80));
		assert.ok(line?.includes("c"), `expected cursor on c after removing b, got: ${line}`);

		// Remove c as well, then move back up to Back and finish.
		comp.handleInput(ENTER);
		comp.handleInput(UP);
		comp.handleInput(ENTER);

		const result = await promise;
		assert.deepStrictEqual(result, { kind: "done", paths: ["a"] });
	});

	it("keeps action bar visible while scrolling a long list", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const items = Array.from({ length: 15 }, (_, i) => ({
			id: `s${i}`,
			kind: "suggestion" as const,
			label: `⬜ Suggest: path${i}`,
			value: `path${i}`,
		}));
		const promise = runListEditor(ctx, {
			title: "Test",
			items,
			pageSize: 5,
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};

		// Move into the list and scroll down well past the visible window.
		comp.handleInput(DOWN);
		for (let i = 0; i < 12; i++) {
			comp.handleInput(DOWN);
		}

		const lines = comp.render(80);
		assert.ok(
			lines.some((line) => line.includes("Back")),
			`expected action bar to stay visible, got:\n${lines.join("\n")}`,
		);

		getDone()({ kind: "back" });
		await promise;
	});

	it("triggers Filter from the top action bar", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
			enableFilter: true,
		});
		const comp = getComponent() as { handleInput: (data: string) => void };
		// Focus starts on Back; move down to Filter and confirm.
		comp.handleInput(DOWN);
		comp.handleInput(ENTER);

		const result = await promise;
		assert.deepStrictEqual(result, { kind: "filter", query: "", paths: [] });
	});

	it("triggers Add custom path from the top action bar", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
			enableFilter: true,
			customActions: [{ id: "add-custom", label: "Add custom path" }],
		});
		const comp = getComponent() as { handleInput: (data: string) => void };
		// Focus starts on Back; move down past Filter to Add custom path and confirm.
		comp.handleInput(DOWN);
		comp.handleInput(DOWN);
		comp.handleInput(ENTER);

		const result = await promise;
		assert.deepStrictEqual(result, { kind: "custom", id: "add-custom", paths: [] });
	});

	it("returns back on escape", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
		});
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput("\x1b");
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "back" });
	});

	it("renders empty section placeholders when there is no content", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, { title: "Test", items: [] });
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(80);
		assert.ok(
			lines.some((line) => line.includes("Selected (0)")),
			`expected an empty Selected section, got:\n${lines.join("\n")}`,
		);
		assert.ok(
			lines.some((line) => line.includes("Suggestions (0)")),
			`expected an empty Suggestions section, got:\n${lines.join("\n")}`,
		);
		assert.ok(
			lines.some((line) => line.includes("(none)")),
			`expected a (none) placeholder, got:\n${lines.join("\n")}`,
		);
		const selIdx = lines.findIndex((l) => l.includes("Selected (0)"));
		assert.ok(lines[selIdx + 1]?.includes("(none)"), "(none) sits directly under the Selected header");
		getDone()({ kind: "back" });
		await promise;
	});

	it("moves focus to the bottom of the content list on UP from the first action row", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [
				{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" },
				{ id: "s2", kind: "suggestion", label: "⬜ Suggest: b", value: "b" },
				{ id: "s3", kind: "suggestion", label: "⬜ Suggest: c", value: "c" },
			],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		comp.handleInput(UP);
		const line = selectedLine(comp.render(80));
		assert.ok(line?.includes("c"), `expected focus on last content item c, got: ${line}`);
		getDone()({ kind: "back" });
		await promise;
	});

	it("returns focus to the action bar on DOWN past the last content item", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		// Into the content list, then past its single item.
		comp.handleInput(DOWN);
		comp.handleInput(DOWN);
		const lines = comp.render(80);
		assert.ok(
			lines.some((line) => line.includes("→ Back")),
			`expected focus back on the Back action, got:\n${lines.join("\n")}`,
		);
		getDone()({ kind: "back" });
		await promise;
	});

	it("clamps the cursor and shows the placeholder after removing the last item", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "r1", kind: "selected", label: "✅ Remove: a", value: "a" }],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		// Move into the content list and remove the only item.
		comp.handleInput(DOWN);
		comp.handleInput(ENTER);
		const lines = comp.render(80);
		assert.ok(
			lines.some((line) => line.includes("(none)")),
			`expected a (none) placeholder, got:\n${lines.join("\n")}`,
		);
		getDone()({ kind: "back" });
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "back" });
	});

	it("keeps a suggestion only once after it is added", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		// Add the suggestion, then it is no longer offered in the content list.
		comp.handleInput(DOWN);
		comp.handleInput(ENTER);
		const lines = comp.render(80);
		assert.ok(
			lines.some((line) => line.includes("✅ a")),
			"a moved to the selected group",
		);
		assert.ok(!lines.some((line) => line.includes("⬜ a")), "a no longer offered as a suggestion");
		// Back out: UP returns to the action bar, ENTER on Back finishes.
		comp.handleInput(UP);
		comp.handleInput(ENTER);
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "done", paths: ["a"] });
	});

	it("shows the preset filter query in the action bar", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: src/a", value: "src/a" }],
			enableFilter: true,
			filterQuery: "src",
		});
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(80);
		assert.ok(
			lines.some((line) => line.includes("Filter: src (clear)")),
			`expected the action bar to show the preset filter, got:\n${lines.join("\n")}`,
		);
		getDone()({ kind: "back" });
		await promise;
	});

	it("ignores an unrecognized key and keeps rendering", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
		});
		let resolved = false;
		void promise.then(() => {
			resolved = true;
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		comp.handleInput("x");
		const lines = comp.render(80);
		assert.ok(lines.length > 0);
		await new Promise((resolve) => setImmediate(resolve));
		assert.strictEqual(resolved, false);
		getDone()({ kind: "back" });
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "back" });
	});
});

describe("truncateMiddle", () => {
	it("returns the path unchanged when it fits", () => {
		assert.strictEqual(truncateMiddle("docs/a.md", 20), "docs/a.md");
	});

	it("keeps the full filename visible when directories are long", () => {
		const result = truncateMiddle("very/long/directory/structure/file.md", 20);
		assert.strictEqual(result.length, 20);
		assert.ok(result.includes("…"), "middle marker present");
		assert.ok(result.endsWith("file.md"), "filename fully visible");
	});

	it("keeps the filename tail when the filename alone is too long", () => {
		const result = truncateMiddle("dir/a_very_long_file_name_that_exceeds.md", 15);
		assert.strictEqual(result.length, 15);
		assert.ok(result.startsWith("…"), "head-truncated");
		assert.ok(result.endsWith("exceeds.md"), "filename tail and extension visible");
	});

	it("handles the exact-fit boundary", () => {
		assert.strictEqual(truncateMiddle("abcde", 5), "abcde", "length == width stays unchanged");
		const truncated = truncateMiddle("abcde", 4);
		assert.strictEqual(truncated.length, 4, "length == width+1 gets truncated");
	});

	it("never crashes at tiny widths", () => {
		assert.strictEqual(truncateMiddle("some/path.md", 1), "…");
		assert.strictEqual(truncateMiddle("some/path.md", 0), "");
		const two = truncateMiddle("some/path.md", 2);
		assert.ok(two.length <= 2);
	});

	it("keeps the folder name for trailing-slash paths", () => {
		const result = truncateMiddle("PRD_doc/very/deep/folder/", 15);
		assert.strictEqual(result.length, 15);
		assert.ok(result.includes("folder"), "folder name still visible");
	});

	it("keeps same-head paths distinguishable by filename", () => {
		const a = truncateMiddle("shared/really/long/common/prefix/alpha.md", 25);
		const b = truncateMiddle("shared/really/long/common/prefix/beta.md", 25);
		assert.ok(a.includes("alpha.md"));
		assert.ok(b.includes("beta.md"));
		assert.notStrictEqual(a, b, "rows must stay distinguishable");
	});
});

describe("runListEditor Option A sections", () => {
	it("renders section headers with counts, selected on top", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [
				{ id: "r1", kind: "selected", label: "a", value: "a" },
				{ id: "r2", kind: "selected", label: "b", value: "b" },
				{ id: "s1", kind: "suggestion", label: "c", value: "c" },
			],
		});
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(80);
		const selIdx = lines.findIndex((l) => l.includes("Selected (2)"));
		const sugIdx = lines.findIndex((l) => l.includes("Suggestions (1)"));
		assert.ok(selIdx !== -1, "Selected header with count");
		assert.ok(sugIdx !== -1, "Suggestions header with count");
		assert.ok(selIdx < sugIdx, "Selected section pinned above Suggestions");
		getDone()({ kind: "back" });
		await promise;
	});

	it("uses uniform markers and drops the Suggest/Remove prefixes", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [
				{ id: "r1", kind: "selected", label: "a", value: "a" },
				{ id: "s1", kind: "suggestion", label: "b", value: "b" },
			],
		});
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(80);
		assert.ok(
			lines.some((l) => l.includes("✅ a")),
			"selected row carries ✅",
		);
		assert.ok(
			lines.some((l) => l.includes("⬜ b")),
			"suggestion row carries ⬜",
		);
		assert.ok(!lines.some((l) => l.includes("Suggest:") || l.includes("Remove:")), "no per-row prefix swap");
		getDone()({ kind: "back" });
		await promise;
	});

	it("toggles a row into the selected group and back", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "a", value: "a" }],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		// Into the content list, add the suggestion.
		comp.handleInput(DOWN);
		comp.handleInput(ENTER);
		let lines = comp.render(80);
		assert.ok(
			lines.some((l) => l.includes("Selected (1)")),
			"added to the selected group",
		);
		assert.ok(lines.some((l) => l.includes("✅ a")));

		// Toggle it back out.
		comp.handleInput(ENTER);
		lines = comp.render(80);
		assert.ok(
			lines.some((l) => l.includes("Selected (0)")),
			"removed from the selected group",
		);
		assert.ok(
			lines.some((l) => l.includes("⬜ a")),
			"back in suggestions",
		);
		getDone()({ kind: "back" });
		await promise;
	});

	it("shows the full path of the focused row in the detail line", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const longPath = "docs/very/long/path/to/the/real_file_name.md";
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: longPath, value: longPath }],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		comp.handleInput(DOWN); // focus the content row
		const lines = comp.render(40);
		const rowLine = lines.find((l) => l.includes("real_file_name.md") && l.includes("⬜"));
		assert.ok(rowLine?.includes("…"), "row is truncated at width 40");
		assert.ok(
			lines.some((l) => l.startsWith(" 📄 docs/very/long/path")),
			"detail line starts the full untruncated path",
		);
		getDone()({ kind: "back" });
		await promise;
	});

	it("renders without crashing at narrow widths", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [
				{
					id: "s1",
					kind: "suggestion",
					label: "docs/very/long/path/to/the/real_file_name.md",
					value: "docs/very/long/path/to/the/real_file_name.md",
				},
			],
		});
		const comp = getComponent() as { render: (width: number) => string[] };
		const at20 = comp.render(20);
		assert.ok(at20.length > 0, "renders at width 20");
		assert.ok(
			at20.some((l) => l.includes("…") && l.includes("file_name.md")),
			"rows still identifiable at width 20 (truncation marker + filename tail)",
		);
		const at1 = comp.render(1);
		assert.ok(at1.length > 0, "renders at width 1");
		getDone()({ kind: "back" });
		await promise;
	});

	it("shrinks the footer hint to fit narrow widths", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "a", value: "a" }],
		});
		const comp = getComponent() as { render: (width: number) => string[] };
		const at80 = comp.render(80);
		assert.ok(
			at80.some((l) => l.includes("↑↓ navigate • enter add/remove • esc cancel")),
			"full footer at wide width",
		);
		const at40 = comp.render(40);
		const footer = at40.find((l) => l.includes("esc"));
		assert.ok(footer, "footer present at width 40");
		assert.ok(footer.length <= 40, `footer fits width 40, got: ${footer}`);
		getDone()({ kind: "back" });
		await promise;
	});
});

describe("coverage audit gaps", () => {
	it("head-truncates the detail continuation when the path exceeds 2*width-3", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		// text = " 📄 " + path, so the path must push text.length past 2*40-3 = 77.
		const longPath = `docs/${"a".repeat(80)}`;
		const promise = runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: longPath, value: longPath }],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		comp.handleInput(DOWN); // focus the content row
		const lines = comp.render(40);
		const continuation = lines.find((l) => l.startsWith("  …"));
		assert.ok(continuation, `expected a head-truncated detail continuation, got:\n${lines.join("\n")}`);
		assert.ok(continuation.length <= 40, `continuation fits width 40, got: ${continuation}`);
		getDone()({ kind: "back" });
		await promise;
	});

	it("fallback returns back when select returns a label not in labelToId", async () => {
		const ctx = makeFallbackCtx(["Not an offered label"], []);
		const result = await runListEditor(ctx, {
			title: "Test",
			items: [{ id: "s1", kind: "suggestion", label: "⬜ Suggest: a", value: "a" }],
		});
		assert.deepStrictEqual(result, { kind: "back" });
	});

	it("fallback clamps the page back when adding a suggestion shrinks the list", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx(["Next page →", "Next page →", "⬜ Suggest: path4", "Back"], [], captured);
		const items = Array.from({ length: 5 }, (_, i) => ({
			id: `s${i}`,
			kind: "suggestion" as const,
			label: `⬜ Suggest: path${i}`,
			value: `path${i}`,
		}));
		const result = await runListEditor(ctx, { title: "Test", items, pageSize: 2 });

		// Page 2 showed only path4 before it was added.
		assert.deepStrictEqual(
			(captured[2] ?? []).filter((l) => l.startsWith("⬜")),
			["⬜ Suggest: path4"],
		);
		// After adding path4, 4 suggestions remain on 2 pages: page clamps from 2 to 1.
		const afterAdd = (captured[3] ?? []).filter((l) => l.startsWith("⬜"));
		assert.deepStrictEqual(afterAdd, ["⬜ Suggest: path2", "⬜ Suggest: path3"]);
		assert.deepStrictEqual(result, { kind: "done", paths: ["path4"] });
	});

	it("uses the fallback when custom is a native function", async () => {
		let customCalled = false;
		const custom = async () => {
			customCalled = true;
			return { kind: "back" as const };
		};
		custom.toString = () => "function () { [native code] }";
		const ctx = {
			cwd: "/tmp",
			mode: "tui",
			ui: {
				select: async () => "Back",
				input: async () => "",
				custom,
			} as unknown as ExtensionUIContext,
		} as unknown as ExtensionContext;
		const result = await runListEditor(ctx, { title: "Test", items: [] });
		assert.strictEqual(customCalled, false, "native custom is never called");
		assert.deepStrictEqual(result, { kind: "done", paths: [] });
	});

	it("truncateMiddle falls through to the tail slice at base.length + 1 === maxWidth", () => {
		// base = "abcdef.md" (9), maxWidth = 10: base.length + 1 is not < maxWidth.
		const result = truncateMiddle("dir/abcdef.md", 10);
		assert.strictEqual(result, "…abcdef.md");
		assert.strictEqual(result.length, 10);
	});
});

describe("width clamping (TUI crash guard)", () => {
	it("never renders a line wider than the given width, even with a long title and many actions", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "T".repeat(300),
			items: [
				...Array.from({ length: 8 }, (_, i) => ({
					id: `a${i}`,
					kind: "action" as const,
					label: `Action ${i} with a very long label`,
					value: "",
				})),
				{
					id: "s1",
					kind: "suggestion" as const,
					label: "s",
					value: `${"dir/".repeat(30)}file.md`,
				},
			],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		for (const width of [213, 80, 40, 20]) {
			for (const line of comp.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: "${line}"`);
			}
		}
		comp.handleInput("\x1b");
		const result = await promise;
		assert.strictEqual(result.kind, "back");
	});
});

describe("width clamping edge cases", () => {
	it("keeps lines within width with real ANSI codes on a loaded editor", async () => {
		const ansiTheme = {
			fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[0m`,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
			dim: (text: string) => `\x1b[2m${text}\x1b[22m`,
		} as unknown as import("@earendil-works/pi-coding-agent").Theme;
		let component: { render: (width: number) => string[] } | undefined;
		let doneFn: (result: unknown) => void = () => {};
		const custom = async (factory: any): Promise<any> =>
			new Promise((resolve) => {
				doneFn = resolve;
				component = factory({ requestRender: () => {} }, ansiTheme, {}, resolve);
			});
		const ctx = {
			cwd: "/tmp",
			mode: "tui",
			ui: { input: async () => "", custom },
		} as unknown as ExtensionContext;
		const promise = runListEditor(ctx, {
			title: "T".repeat(300),
			items: [
				...Array.from({ length: 8 }, (_, i) => ({
					id: `a${i}`,
					kind: "action" as const,
					label: `Action ${i} ${"x".repeat(100)}`,
					value: "",
				})),
				{ id: "s1", kind: "suggestion" as const, label: "s", value: `${"dir/".repeat(50)}file.md` },
			],
		});
		for (const width of [80, 40, 20, 2]) {
			for (const line of component!.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
		}
		doneFn({ kind: "back" });
		await promise;
	});

	it("handles emoji and CJK in selected and suggestion paths", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "t",
			items: [
				{ id: "r1", kind: "selected", label: "r", value: `${"漢字🚀/".repeat(20)}file.md` },
				{ id: "s1", kind: "suggestion", label: "s", value: `${"dir✅/".repeat(20)}file.md` },
			],
		});
		const comp = getComponent() as { render: (width: number) => string[] };
		for (const width of [40, 20]) {
			for (const line of comp.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
		}
		getDone()({ kind: "back" });
		await promise;
	});

	it("clamps the content-focus detail line for a long emoji path", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "t",
			items: [
				{ id: "a1", kind: "action", label: "Done", value: "" },
				{ id: "s1", kind: "suggestion", label: "s", value: `${"dir🚀/".repeat(30)}file.md` },
			],
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		comp.handleInput(UP); // actions -> content area, last row
		for (const width of [40, 20]) {
			const lines = comp.render(width);
			for (const line of lines) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
			assert.ok(
				lines.some((l) => l.includes("📄")),
				"detail line shown",
			);
		}
		comp.handleInput("\x1b");
		await promise;
	});

	it("renders within width at tiny widths 2 and 3", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runListEditor(ctx, {
			title: "t",
			items: [{ id: "s1", kind: "suggestion", label: "s", value: "a/b.md" }],
		});
		const comp = getComponent() as { render: (width: number) => string[] };
		for (const width of [2, 3]) {
			for (const line of comp.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
		}
		getDone()({ kind: "back" });
		await promise;
	});
});
