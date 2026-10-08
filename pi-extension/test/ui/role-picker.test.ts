/**
 * Tests for ui/role-picker.ts (L2).
 *
 * Ported from Senai's test/ui/role-picker.test.ts, adapted to the local
 * RoleGuidance type and the neutral Velpari default subtitle. Mock
 * pattern matches the repo's test style: node:test with strict assert.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { runRolePicker, type RolePickerItem } from "../../src/ui/role-picker.js";

const ENTER = "\r";
const DOWN = "\x1b[B";
const UP = "\x1b[A";

const DEFAULT_SUBTITLE = "Pick a role to review its agent mapping; Finish when done.";

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

function makeFallbackCtx(selects: (string | undefined)[], capturedSelectOptions?: string[][]): ExtensionContext {
	let index = 0;
	return {
		cwd: "/tmp",
		ui: {
			select: async (_title: string, options: string[]) => {
				capturedSelectOptions?.push(options);
				return selects[index++] as string;
			},
		} as unknown as ExtensionUIContext,
	} as unknown as ExtensionContext;
}

function makeTuiCtx(): {
	ctx: ExtensionContext;
	getComponent: () => unknown;
	getDone: () => (result: ReturnType<typeof runRolePicker> extends Promise<infer R> ? R : never) => void;
} {
	let component: unknown;
	let doneFn: (result: any) => void = () => {};

	const custom = async (
		factory: (
			tui: import("@earendil-works/pi-tui").TUI,
			theme: import("@earendil-works/pi-coding-agent").Theme,
			keybindings: import("@earendil-works/pi-tui").KeybindingsManager,
			done: (result: any) => void,
		) => import("@earendil-works/pi-tui").Component,
	): Promise<any> => {
		return new Promise((resolve) => {
			doneFn = resolve;
			component = factory(makeTui(), makeTheme(), {} as import("@earendil-works/pi-tui").KeybindingsManager, resolve);
		});
	};

	const ctx = {
		cwd: "/tmp",
		mode: "tui",
		ui: {
			select: async () => "",
			custom,
		} as unknown as ExtensionUIContext,
	} as unknown as ExtensionContext;

	return {
		ctx,
		getComponent: () => component,
		getDone: () => doneFn,
	};
}

const ITEMS: RolePickerItem[] = [
	{ id: "scout-1", label: "Scout 1", agent: "scout", summary: "not set", assigned: false },
	{ id: "planner", label: "Planner", agent: "planner", summary: "reads=1", assigned: true },
];

describe("runRolePicker fallback", () => {
	it("returns the selected role", async () => {
		const ctx = makeFallbackCtx(["⬜ scout-1: Scout 1 (scout) — not set"]);
		const result = await runRolePicker(ctx, { title: "Test", items: ITEMS });
		assert.deepStrictEqual(result, { kind: "role", role: "scout-1" });
	});

	it("returns finish when Finish is selected", async () => {
		const ctx = makeFallbackCtx(["⬜ Finish"]);
		const result = await runRolePicker(ctx, { title: "Test", items: ITEMS });
		assert.deepStrictEqual(result, { kind: "finish" });
	});

	it("returns back on cancellation", async () => {
		const ctx = makeFallbackCtx([undefined]);
		const result = await runRolePicker(ctx, { title: "Test", items: ITEMS });
		assert.deepStrictEqual(result, { kind: "back" });
	});

	it("offers only Finish when there are no items", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx(["⬜ Finish"], captured);
		const result = await runRolePicker(ctx, { title: "Test", items: [] });
		assert.deepStrictEqual(captured[0], ["⬜ Finish"]);
		assert.deepStrictEqual(result, { kind: "finish" });
	});

	it("omits the agent suffix in the label when agent is an empty string", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx(["⬜ Finish"], captured);
		const items: RolePickerItem[] = [{ id: "role-x", label: "Role X", agent: "", summary: "nothing", assigned: false }];
		const result = await runRolePicker(ctx, { title: "Test", items });
		assert.deepStrictEqual(captured[0], ["⬜ role-x: Role X — nothing", "⬜ Finish"]);
		assert.ok(!(captured[0]?.[0] ?? "").includes("()"));
		assert.deepStrictEqual(result, { kind: "finish" });
	});
});

describe("runRolePicker custom TUI", () => {
	it("returns the selected role on enter", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput(ENTER);
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "role", role: "scout-1" });
	});

	it("returns finish when Finish row is selected", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput(DOWN);
		comp.handleInput(DOWN);
		comp.handleInput(ENTER);
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "finish" });
	});

	it("returns back on escape", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput("\x1b");
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "back" });
	});

	it("renders assigned rows differently", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		runRolePicker(ctx, { title: "Test", items: ITEMS });
		const comp = getComponent() as {
			render: (width: number) => string[];
		};
		const lines = comp.render(80);
		const scoutLine = lines.find((l) => l.includes("Scout 1"));
		const plannerLine = lines.find((l) => l.includes("Planner"));
		assert.ok(scoutLine);
		assert.ok(plannerLine);
		// In the identity test theme the strings are equal, but the structure is present.
		assert.ok(scoutLine.includes("not set"));
		assert.ok(plannerLine.includes("reads=1"));
	});

	it("starts selection at initialSelectedId", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runRolePicker(ctx, {
			title: "Test",
			items: ITEMS,
			initialSelectedId: "planner",
		});
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput(ENTER);
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "role", role: "planner" });
	});

	it("wraps UP from the first item to the Finish row", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput(UP);
		comp.handleInput(ENTER);
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "finish" });
	});

	it("wraps DOWN from the Finish row to the first item", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
		const comp = getComponent() as { handleInput: (data: string) => void };
		// Two items plus Finish = three rows; down three times wraps to index 0.
		comp.handleInput(DOWN);
		comp.handleInput(DOWN);
		comp.handleInput(DOWN);
		comp.handleInput(ENTER);
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "role", role: "scout-1" });
	});

	it("scrolls the window down and back up", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const items = Array.from({ length: 20 }, (_, i) => ({
			id: `role-${String(i).padStart(2, "0")}`,
			label: `Role ${String(i).padStart(2, "0")}`,
			agent: "worker",
			summary: "s",
			assigned: false,
		}));
		const promise = runRolePicker(ctx, { title: "Test", items, pageSize: 5 });
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};

		for (let i = 0; i < 6; i++) {
			comp.handleInput(DOWN);
		}
		let lines = comp.render(80);
		// Lower bound moved: selection is row 6, so the window starts at row 2.
		assert.ok(lines.some((line) => line.includes("Role 06")));
		assert.ok(!lines.some((line) => line.includes("Role 00")));
		assert.ok(!lines.some((line) => line.includes("Role 01")));

		for (let i = 0; i < 6; i++) {
			comp.handleInput(UP);
		}
		lines = comp.render(80);
		// Upper bound restored: the window starts at row 0 again.
		assert.ok(lines.some((line) => line.includes("Role 00")));
		assert.ok(!lines.some((line) => line.includes("Role 06")));

		getDone()({ kind: "back" });
		await promise;
	});

	it("offers only the Finish row when there are no items", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runRolePicker(ctx, { title: "Test", items: [] });
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput(ENTER);
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "finish" });
	});

	it("falls back to the first item for an unknown initialSelectedId", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runRolePicker(ctx, {
			title: "Test",
			items: ITEMS,
			initialSelectedId: "nope",
		});
		const comp = getComponent() as { handleInput: (data: string) => void };
		comp.handleInput(ENTER);
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "role", role: "scout-1" });
	});

	it("ignores an unrecognized key and leaves the render unchanged", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
		let resolved = false;
		void promise.then(() => {
			resolved = true;
		});
		const comp = getComponent() as {
			handleInput: (data: string) => void;
			render: (width: number) => string[];
		};
		const before = comp.render(80).join("\n");
		comp.handleInput("x");
		const after = comp.render(80).join("\n");
		assert.strictEqual(after, before);
		await new Promise((resolve) => setImmediate(resolve));
		assert.strictEqual(resolved, false);
		getDone()({ kind: "back" });
		await promise;
	});

	it("renders a custom subtitle instead of the default tip", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runRolePicker(ctx, {
			title: "Test",
			items: ITEMS,
			subtitle: "Pick one role per line.",
		});
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(80);
		assert.ok(lines.some((line) => line.includes("Pick one role per line.")));
		assert.ok(!lines.some((line) => line.includes(DEFAULT_SUBTITLE)), "default subtitle is replaced by the custom one");
		getDone()({ kind: "back" });
		await promise;
	});

	it("renders without crashing at a tiny width", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(1);
		assert.ok(lines.length > 0);
		getDone()({ kind: "back" });
		await promise;
	});
});

describe("role picker guidance tags", () => {
	it("includes the guidance tag in fallback labels", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx([undefined], captured);
		const items: RolePickerItem[] = [
			{ id: "scout-2", label: "Scout 2", agent: "scout", summary: "not set", assigned: false, guidance: "recommended" },
		];
		await runRolePicker(ctx, { title: "t", items });
		assert.ok((captured[0]?.[0] ?? "").includes("[recommended]"), "fallback label carries the tag");
	});

	it("renders the guidance tag text in the custom picker", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const items: RolePickerItem[] = [
			{
				id: "scout-1",
				label: "Scout 1",
				agent: "scout",
				summary: "not set",
				assigned: false,
				guidance: "design-defined",
			},
		];
		const promise = runRolePicker(ctx, { title: "t", items });
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(80);
		assert.ok(
			lines.some((l) => l.includes("[design-defined]")),
			"custom row carries the tag",
		);
		getDone()({ kind: "back" });
		await promise;
	});

	it("renders each guidance kind with its theme color", async () => {
		// Color-recording theme: fg(color, text) embeds the color name.
		const recordingTheme = {
			fg: (color: string, text: string) => `${color}:${text}`,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => text,
			dim: (text: string) => text,
		} as unknown as import("@earendil-works/pi-coding-agent").Theme;

		let component: { render: (width: number) => string[] } | undefined;
		let doneFn: (result: unknown) => void = () => {};
		const custom = async (factory: any): Promise<any> =>
			new Promise((resolve) => {
				doneFn = resolve;
				component = factory({ requestRender: () => {} }, recordingTheme, {}, resolve);
			});
		const ctx = {
			cwd: "/tmp",
			mode: "tui",
			ui: { select: async () => "", custom },
		} as unknown as ExtensionContext;

		const items: RolePickerItem[] = [
			{
				id: "scout-1",
				label: "Scout 1",
				agent: "scout",
				summary: "not set",
				assigned: false,
				guidance: "design-defined",
			},
			{ id: "scout-2", label: "Scout 2", agent: "scout", summary: "not set", assigned: false, guidance: "recommended" },
			{ id: "scout-3", label: "Scout 3", agent: "scout", summary: "not set", assigned: false, guidance: "optional" },
		];
		const promise = runRolePicker(ctx, { title: "t", items });
		const lines = component!.render(80);
		assert.ok(
			lines.some((l) => l.includes("success:[design-defined]")),
			"design-defined is green",
		);
		assert.ok(
			lines.some((l) => l.includes("warning:[recommended]")),
			"recommended is yellow",
		);
		assert.ok(
			lines.some((l) => l.includes("dim:[optional]")),
			"optional is dim",
		);
		doneFn({ kind: "back" });
		await promise;
	});
});

describe("role picker guidance edge cases", () => {
	it("omits the tag for items without guidance in fallback labels", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx([undefined], captured);
		const items: RolePickerItem[] = [
			{ id: "scout-2", label: "Scout 2", agent: "scout", summary: "not set", assigned: false },
		];
		await runRolePicker(ctx, { title: "t", items });
		assert.ok(!(captured[0]?.[0] ?? "").includes("["), "no tag when guidance is undefined");
	});

	it("keeps the assigned marker and the tag together in fallback labels", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx([undefined], captured);
		const items: RolePickerItem[] = [
			{
				id: "planner",
				label: "Planner",
				agent: "planner",
				summary: "truth=docs/PRD.md",
				assigned: true,
				guidance: "recommended",
			},
		];
		await runRolePicker(ctx, { title: "t", items });
		assert.ok((captured[0]?.[0] ?? "").startsWith("✅"), "assigned marker present");
		assert.ok((captured[0]?.[0] ?? "").includes("[recommended]"), "tag present on assigned row");
	});

	it("renders design-defined and optional tags in fallback labels", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx([undefined], captured);
		const items: RolePickerItem[] = [
			{
				id: "scout-1",
				label: "Scout 1",
				agent: "scout",
				summary: "not set",
				assigned: false,
				guidance: "design-defined",
			},
			{ id: "scout-3", label: "Scout 3", agent: "scout", summary: "not set", assigned: false, guidance: "optional" },
		];
		await runRolePicker(ctx, { title: "t", items });
		assert.ok((captured[0]?.[0] ?? "").includes("[design-defined]"));
		assert.ok((captured[0]?.[1] ?? "").includes("[optional]"));
	});

	it("renders no tag on the Finish row", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const items: RolePickerItem[] = [
			{
				id: "scout-1",
				label: "Scout 1",
				agent: "scout",
				summary: "not set",
				assigned: false,
				guidance: "design-defined",
			},
		];
		const promise = runRolePicker(ctx, { title: "t", items });
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(80);
		const finishLine = lines.find((l) => l.includes("Finish"));
		assert.ok(finishLine, "Finish row exists");
		assert.ok(!finishLine.includes("["), "Finish row carries no tag");
		getDone()({ kind: "back" });
		await promise;
	});

	it("keeps the tag on the focused row", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const items: RolePickerItem[] = [
			{ id: "scout-2", label: "Scout 2", agent: "scout", summary: "not set", assigned: false, guidance: "recommended" },
			{ id: "scout-3", label: "Scout 3", agent: "scout", summary: "not set", assigned: false, guidance: "optional" },
		];
		const promise = runRolePicker(ctx, { title: "t", items });
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(80);
		const focusedLine = lines.find((l) => l.startsWith("→"));
		assert.ok(focusedLine, "a focused row exists");
		assert.ok(focusedLine.includes("[recommended]"), "focused row keeps the tag");
		getDone()({ kind: "back" });
		await promise;
	});

	it("renders no tag for items without guidance in the custom picker", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const items: RolePickerItem[] = [
			{ id: "scout-2", label: "Scout 2", agent: "scout", summary: "not set", assigned: false },
		];
		const promise = runRolePicker(ctx, { title: "t", items });
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(80);
		const row = lines.find((l) => l.includes("Scout 2"));
		assert.ok(row);
		assert.ok(!row.includes("["), "no tag when guidance is undefined");
		getDone()({ kind: "back" });
		await promise;
	});

	it("renders assigned rows with the tag in the custom picker", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const items: RolePickerItem[] = [
			{
				id: "planner",
				label: "Planner",
				agent: "planner",
				summary: "truth=docs/PRD.md",
				assigned: true,
				guidance: "recommended",
			},
		];
		const promise = runRolePicker(ctx, { title: "t", items });
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(80);
		const row = lines.find((l) => l.includes("Planner"));
		assert.ok(row);
		assert.ok(row.includes("truth=docs/PRD.md"), "assigned summary present");
		assert.ok(row.includes("[recommended]"), "tag present on assigned row");
		getDone()({ kind: "back" });
		await promise;
	});
});

describe("role picker needs labels", () => {
	it("includes the needs text in fallback labels", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx([undefined], captured);
		const items: RolePickerItem[] = [
			{
				id: "reviewer-correctness",
				label: "Reviewer — Correctness",
				agent: "rev",
				summary: "not set",
				assigned: false,
				needs: "RTM / traceability document",
			},
		];
		await runRolePicker(ctx, { title: "t", items });
		assert.ok(
			(captured[0]?.[0] ?? "").includes("(needs: RTM / traceability document)"),
			"fallback label carries the needs text",
		);
	});

	it("renders the needs text in the custom picker and omits it when unset", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const items: RolePickerItem[] = [
			{
				id: "reviewer-correctness",
				label: "Reviewer — Correctness",
				agent: "rev",
				summary: "not set",
				assigned: false,
				needs: "RTM / traceability document",
			},
			{ id: "scout-2", label: "Scout 2", agent: "scout", summary: "not set", assigned: false },
		];
		const promise = runRolePicker(ctx, { title: "t", items });
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(80);
		const reviewerLine = lines.find((l) => l.includes("Reviewer — Correctness"));
		const scoutLine = lines.find((l) => l.includes("Scout 2"));
		assert.ok(reviewerLine?.includes("(needs: RTM / traceability document)"), "custom row carries the needs text");
		assert.ok(scoutLine && !scoutLine.includes("(needs:"), "no needs text when unset");
		getDone()({ kind: "back" });
		await promise;
	});

	it("places the needs text between the label and the agent part in fallback labels", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx([undefined], captured);
		const items: RolePickerItem[] = [
			{
				id: "reviewer-correctness",
				label: "Reviewer — Correctness",
				agent: "rev",
				summary: "not set",
				assigned: false,
				guidance: "recommended",
				needs: "RTM / traceability document",
			},
		];
		await runRolePicker(ctx, { title: "t", items });
		assert.ok(
			(captured[0]?.[0] ?? "").includes(
				"Reviewer — Correctness (needs: RTM / traceability document) (rev) — not set [recommended]",
			),
			"needs sits after the label, before the agent part",
		);
	});

	it("keeps the needs text on assigned rows in fallback labels", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx([undefined], captured);
		const items: RolePickerItem[] = [
			{
				id: "reviewer-correctness",
				label: "Reviewer — Correctness",
				agent: "rev",
				summary: "truth=docs/RTM.md",
				assigned: true,
				needs: "RTM / traceability document",
			},
		];
		await runRolePicker(ctx, { title: "t", items });
		assert.ok((captured[0]?.[0] ?? "").startsWith("✅"), "assigned marker present");
		assert.ok(
			(captured[0]?.[0] ?? "").includes("(needs: RTM / traceability document)"),
			"needs present on assigned row",
		);
		assert.ok((captured[0]?.[0] ?? "").includes("truth=docs/RTM.md"), "assigned summary present");
	});

	it("keeps the needs text on the focused row in the custom picker", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const items: RolePickerItem[] = [
			{
				id: "reviewer-correctness",
				label: "Reviewer — Correctness",
				agent: "rev",
				summary: "not set",
				assigned: false,
				needs: "RTM / traceability document",
			},
			{ id: "scout-2", label: "Scout 2", agent: "scout", summary: "not set", assigned: false },
		];
		const promise = runRolePicker(ctx, { title: "t", items });
		const comp = getComponent() as { render: (width: number) => string[] };
		const focusedLine = comp.render(80).find((l) => l.startsWith("→"));
		assert.ok(focusedLine, "a focused row exists");
		assert.ok(focusedLine.includes("(needs: RTM / traceability document)"), "focused row keeps the needs text");
		getDone()({ kind: "back" });
		await promise;
	});

	it("renders needs text and the colored guidance tag together in the custom picker", async () => {
		const recordingTheme = {
			fg: (color: string, text: string) => `${color}:${text}`,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => text,
			dim: (text: string) => text,
		} as unknown as import("@earendil-works/pi-coding-agent").Theme;

		let component: { render: (width: number) => string[] } | undefined;
		let doneFn: (result: unknown) => void = () => {};
		const custom = async (factory: any): Promise<any> =>
			new Promise((resolve) => {
				doneFn = resolve;
				component = factory({ requestRender: () => {} }, recordingTheme, {}, resolve);
			});
		const ctx = {
			cwd: "/tmp",
			mode: "tui",
			ui: { select: async () => "", custom },
		} as unknown as ExtensionContext;

		const items: RolePickerItem[] = [
			{
				id: "reviewer-correctness",
				label: "Reviewer — Correctness",
				agent: "rev",
				summary: "not set",
				assigned: false,
				guidance: "recommended",
				needs: "RTM / traceability document",
			},
		];
		const promise = runRolePicker(ctx, { title: "t", items });
		const lines = component!.render(200);
		const row = lines.find((l) => l.includes("Reviewer — Correctness"));
		assert.ok(row, "reviewer row exists");
		assert.ok(row.includes("(needs: RTM / traceability document)"), "needs text present");
		assert.ok(row.includes("warning:[recommended]"), "guidance tag still colored");
		doneFn({ kind: "back" });
		await promise;
	});
});

describe("coverage audit gaps", () => {
	it("renders the default subtitle when the subtitle option is omitted", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
		const comp = getComponent() as { render: (width: number) => string[] };
		const lines = comp.render(200);
		assert.ok(
			lines.some((line) => line.includes(DEFAULT_SUBTITLE)),
			"default subtitle shown",
		);
		getDone()({ kind: "back" });
		await promise;
	});

	it("fallback treats a label not in idMap as finish", async () => {
		const ctx = makeFallbackCtx(["Not a real label"]);
		const result = await runRolePicker(ctx, { title: "Test", items: ITEMS });
		assert.deepStrictEqual(result, { kind: "finish" });
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
				select: async () => "⬜ Finish",
				custom,
			} as unknown as ExtensionUIContext,
		} as unknown as ExtensionContext;
		const result = await runRolePicker(ctx, { title: "Test", items: ITEMS });
		assert.deepStrictEqual(result, { kind: "finish" }, "fallback select path used");
		assert.strictEqual(customCalled, false, "native custom is never called");
	});

	it("renders the focused Finish row without the focus accent", async () => {
		const recordingTheme = {
			fg: (color: string, text: string) => `${color}:${text}`,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => text,
			dim: (text: string) => text,
		} as unknown as import("@earendil-works/pi-coding-agent").Theme;

		let component: { render: (width: number) => string[]; handleInput: (data: string) => void } | undefined;
		let doneFn: (result: unknown) => void = () => {};
		const custom = async (factory: any): Promise<any> =>
			new Promise((resolve) => {
				doneFn = resolve;
				component = factory({ requestRender: () => {} }, recordingTheme, {}, resolve);
			});
		const ctx = {
			cwd: "/tmp",
			mode: "tui",
			ui: { select: async () => "", custom },
		} as unknown as ExtensionContext;

		const promise = runRolePicker(ctx, { title: "Test", items: ITEMS });
		// Two roles plus Finish = three rows; move focus onto Finish.
		component!.handleInput(DOWN);
		component!.handleInput(DOWN);
		const lines = component!.render(80);
		const focused = lines.find((l) => l.startsWith("→"));
		assert.ok(focused, "a focused row exists");
		assert.ok(focused.includes("text:Finish"), "focused Finish row uses the plain text color");
		assert.ok(!focused.includes("accent:"), "focused Finish row gets no accent");
		doneFn({ kind: "back" });
		await promise;
	});
});

describe("role-picker showBack", () => {
	const BACK_ITEMS: RolePickerItem[] = [
		{ id: "scout-1", label: "Scout 1", agent: "scout", summary: "default", assigned: false },
	];

	it("fallback offers Back first when showBack is set and selecting it returns back", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx(["Back"], captured);
		const result = await runRolePicker(ctx, { title: "Test", items: BACK_ITEMS, showBack: true });
		assert.deepStrictEqual(result, { kind: "back" });
		assert.strictEqual(captured[0]?.[0] ?? "", "Back", "Back is the first offered option");
	});

	it("fallback does not offer Back by default", async () => {
		const captured: string[][] = [];
		const ctx = makeFallbackCtx([undefined], captured);
		const result = await runRolePicker(ctx, { title: "Test", items: BACK_ITEMS });
		assert.deepStrictEqual(result, { kind: "back" });
		const offered = captured[0] ?? [];
		assert.ok(offered.length > 0 && !offered.includes("Back"));
	});

	it("custom picker renders the Back row plainly and Enter on it resolves back", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const promise = runRolePicker(ctx, { title: "Test", items: BACK_ITEMS, showBack: true });
		const component = getComponent() as {
			render: (width: number) => string[];
			handleInput: (data: string) => void;
		};
		const lines = component.render(80);
		const backRow = lines.find((l) => l.includes("Back"));
		assert.ok(backRow, "Back row is rendered");
		assert.ok(backRow.startsWith("→"), "Back is the first (focused) row");
		component.handleInput(ENTER);
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "back" });
	});
});

describe("width clamping (TUI crash guard)", () => {
	it("never renders a line wider than the given width, even with long summaries and agent names", async () => {
		const { ctx, getComponent } = makeTuiCtx();
		const items: RolePickerItem[] = [
			{
				id: "scout-1",
				label: "Scout 1 — Architecture / big-picture ".repeat(10),
				agent: "nifty-trend-google-sheets-apps-script-scout-1 ".repeat(5),
				summary: "reads: very/long/truth/document/path.md ".repeat(10),
				assigned: true,
				needs: "truth document missing ".repeat(5),
			},
			{
				id: "planner",
				label: "Planner",
				agent: "planner",
				summary: "reads=1",
				assigned: true,
			},
		];
		const promise = runRolePicker(ctx, {
			title: "T".repeat(300),
			subtitle: "S".repeat(300),
			items,
		});
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
		const result = await promise;
		assert.deepStrictEqual(result, { kind: "back" });
	});
});

describe("width clamping edge cases", () => {
	it("keeps lines within width with real ANSI codes on a fully-loaded row", async () => {
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
			ui: { select: async () => "", custom },
		} as unknown as ExtensionContext;
		const items: RolePickerItem[] = [
			{
				id: "scout-1",
				label: "L".repeat(300),
				agent: "a".repeat(300),
				summary: "s".repeat(300),
				assigned: true,
				guidance: "recommended",
				needs: "n".repeat(300),
			},
		];
		const promise = runRolePicker(ctx, { title: "T".repeat(300), subtitle: "S".repeat(300), items });
		for (const width of [80, 40, 10, 2]) {
			for (const line of component!.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
		}
		doneFn({ kind: "back" });
		await promise;
	});

	it("handles emoji and CJK in labels and summaries", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const items: RolePickerItem[] = [
			{
				id: "scout-1",
				label: "Scout ✅🚀漢字".repeat(20),
				agent: "agent-🚀",
				summary: "漢字✅".repeat(30),
				assigned: false,
			},
		];
		const promise = runRolePicker(ctx, { title: "t", items });
		const comp = getComponent() as { render: (width: number) => string[] };
		for (const width of [40, 10, 2]) {
			for (const line of comp.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
		}
		getDone()({ kind: "back" });
		await promise;
	});

	it("renders within width at tiny widths 2 and 3", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const promise = runRolePicker(ctx, { title: "t", items: ITEMS });
		const comp = getComponent() as { render: (width: number) => string[] };
		for (const width of [2, 3]) {
			for (const line of comp.render(width)) {
				assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}`);
			}
		}
		getDone()({ kind: "back" });
		await promise;
	});

	it("keeps the guidance tag when there is enough space", async () => {
		const { ctx, getComponent, getDone } = makeTuiCtx();
		const items: RolePickerItem[] = [
			{
				id: "planner",
				label: "Planner",
				agent: "planner",
				summary: "reads=1",
				assigned: true,
				guidance: "recommended",
			},
		];
		const promise = runRolePicker(ctx, { title: "t", items });
		const comp = getComponent() as { render: (width: number) => string[] };
		const row = comp.render(200).find((l) => l.includes("Planner"));
		assert.ok(row?.includes("[recommended]"), "tag survives at wide width");
		getDone()({ kind: "back" });
		await promise;
	});
});
