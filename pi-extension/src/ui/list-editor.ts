/**
 * Multi-select list editor widget (L2).
 *
 * Port of Senai's `ui/list-editor.ts`, semantics kept EXACTLY:
 * Esc = back/cancel; the "Back" action item = done/commit (this inversion
 * is intentional). Uses the shared `./is-tui.js` TUI check.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { isTui } from "./is-tui.js";

type ListEditorItemKind = "suggestion" | "selected" | "action";

export interface ListEditorItem {
	id: string;
	kind: ListEditorItemKind;
	label: string;
	description?: string;
	value: string;
}

interface ListEditorCustomAction {
	id: string;
	label: string;
}

interface ListEditorOptions {
	title: string;
	items: ListEditorItem[];
	filterQuery?: string;
	enableFilter?: boolean;
	customActions?: ListEditorCustomAction[];
	pageSize?: number;
	/** Force the simple ctx.ui.select fallback even in TUI mode. */
	forceFallback?: boolean;
}

export type ListEditorAction =
	| { kind: "done"; paths: string[] }
	| { kind: "back" }
	| { kind: "filter"; query: string; paths: string[] }
	| { kind: "custom"; id: string; paths: string[] };

const FILTER_ID = "__filter__";
const BACK_ID = "__back__";
const PAGE_PREV_ID = "__page-prev__";
const PAGE_NEXT_ID = "__page-next__";

function matchesFilter(path: string, query: string): boolean {
	if (!query) return true;
	return path.toLowerCase().includes(query.toLowerCase());
}

/** Truncate a path so the filename stays visible: head + … + filename.
 *  If the filename alone is too long, keep its tail (extension visible).
 *  User decision: a truncated row must still be identifiable. */
export function truncateMiddle(text: string, maxWidth: number): string {
	if (maxWidth < 1) return "";
	if (text.length <= maxWidth) return text;
	if (maxWidth === 1) return "…";
	const base = text.replace(/\/+$/, "").split("/").pop() ?? text;
	if (base.length + 1 < maxWidth) {
		const head = maxWidth - base.length - 1;
		return `${text.slice(0, head)}…${base}`;
	}
	return `…${text.slice(-(maxWidth - 1))}`;
}

export async function runListEditor(ctx: ExtensionContext, options: ListEditorOptions): Promise<ListEditorAction> {
	if (!options.forceFallback && isTui(ctx)) {
		return runCustomListEditor(ctx, options);
	}
	return runFallbackListEditor(ctx, options);
}

async function runFallbackListEditor(ctx: ExtensionContext, options: ListEditorOptions): Promise<ListEditorAction> {
	const pageSize = options.pageSize ?? 10;
	let currentPaths = options.items.filter((i) => i.kind === "selected").map((i) => i.value);
	const allSuggestions = options.items.filter((i) => i.kind === "suggestion").map((i) => i.value);
	let filterQuery = options.filterQuery ?? "";
	let page = 0;

	while (true) {
		const available = allSuggestions.filter((s) => !currentPaths.includes(s) && matchesFilter(s, filterQuery));
		const pageCount = Math.max(1, Math.ceil(available.length / pageSize));
		page = Math.max(0, Math.min(page, pageCount - 1));
		const start = page * pageSize;
		const pageSuggestions = available.slice(start, start + pageSize);

		const labels: string[] = [];
		const labelToId = new Map<string, string>();

		if (options.enableFilter) {
			const label = filterQuery ? `Filter: ${filterQuery} (clear)` : "Filter suggestions...";
			labels.push(label);
			labelToId.set(label, FILTER_ID);
		}

		for (const path of pageSuggestions) {
			const label = `⬜ Suggest: ${path}`;
			labels.push(label);
			labelToId.set(label, `suggest:${path}`);
		}

		if (pageCount > 1) {
			if (page > 0) {
				labels.push("← Previous page");
				labelToId.set("← Previous page", PAGE_PREV_ID);
			}
			if (page < pageCount - 1) {
				labels.push("Next page →");
				labelToId.set("Next page →", PAGE_NEXT_ID);
			}
		}

		for (const action of options.customActions ?? []) {
			labels.push(action.label);
			labelToId.set(action.label, `custom:${action.id}`);
		}

		for (const path of currentPaths) {
			const label = `✅ Remove: ${path}`;
			labels.push(label);
			labelToId.set(label, `selected:${path}`);
		}

		labels.push("Back");
		labelToId.set("Back", BACK_ID);

		const choice = await ctx.ui.select(options.title, labels);
		if (choice === undefined) {
			return { kind: "back" };
		}

		const id = labelToId.get(choice);
		if (!id) {
			return { kind: "back" };
		}

		if (id === FILTER_ID) {
			const input = await ctx.ui.input("Filter by name (empty clears):");
			const query = (input ?? "").trim().toLowerCase();
			return { kind: "filter", query, paths: currentPaths };
		}

		if (id === PAGE_PREV_ID) {
			page--;
			continue;
		}
		if (id === PAGE_NEXT_ID) {
			page++;
			continue;
		}

		if (id === BACK_ID) {
			return { kind: "done", paths: currentPaths };
		}

		if (id.startsWith("custom:")) {
			return {
				kind: "custom",
				id: id.replace("custom:", ""),
				paths: currentPaths,
			};
		}

		if (id.startsWith("suggest:")) {
			const path = id.replace("suggest:", "");
			if (!currentPaths.includes(path)) {
				currentPaths.push(path);
			}
			continue;
		}

		if (id.startsWith("selected:")) {
			const path = id.replace("selected:", "");
			currentPaths = currentPaths.filter((p) => p !== path);
			continue;
		}

		return { kind: "back" };
	}
}

function buildActionItems(options: ListEditorOptions): ListEditorItem[] {
	const items: ListEditorItem[] = [];
	items.push({ id: BACK_ID, kind: "action", label: "Back", value: BACK_ID });

	if (options.enableFilter) {
		const query = options.filterQuery ?? "";
		items.push({
			id: FILTER_ID,
			kind: "action",
			label: query ? `Filter: ${query} (clear)` : "Filter suggestions...",
			value: FILTER_ID,
		});
	}

	for (const action of options.customActions ?? []) {
		items.push({
			id: `custom:${action.id}`,
			kind: "action",
			label: action.label,
			value: action.id,
		});
	}

	return items;
}

interface ContentRow {
	kind: "selected" | "suggestion";
	path: string;
}

async function runCustomListEditor(ctx: ExtensionContext, options: ListEditorOptions): Promise<ListEditorAction> {
	return ctx.ui.custom<ListEditorAction>((tui, theme, _keybindings, done) => {
		let currentPaths = options.items.filter((i) => i.kind === "selected").map((i) => i.value);
		const allSuggestions = options.items.filter((i) => i.kind === "suggestion").map((i) => i.value);

		const actionItems = buildActionItems(options);
		let focusArea: "actions" | "content" = "actions";
		let actionIndex = 0;
		let contentIndex = 0;
		let scrollOffset = 0;
		const pageSize = options.pageSize ?? 10;

		function rows(): ContentRow[] {
			const query = options.filterQuery ?? "";
			const selected = currentPaths.map((path) => ({ kind: "selected" as const, path }));
			const suggestions = allSuggestions
				.filter((s) => !currentPaths.includes(s) && matchesFilter(s, query))
				.map((path) => ({ kind: "suggestion" as const, path }));
			return [...selected, ...suggestions];
		}

		function clamp() {
			const total = rows().length;
			if (total === 0) {
				contentIndex = 0;
				scrollOffset = 0;
				return;
			}
			contentIndex = Math.max(0, Math.min(contentIndex, total - 1));
			if (contentIndex < scrollOffset) scrollOffset = contentIndex;
			if (contentIndex >= scrollOffset + pageSize) {
				scrollOffset = contentIndex - pageSize + 1;
			}
		}

		function detailLines(width: number): string[] {
			if (focusArea !== "content") return [theme.fg("dim", " ")];
			const row = rows()[contentIndex];
			if (!row) return [theme.fg("dim", " ")];
			const text = ` 📄 ${row.path}`;
			if (text.length <= width) return [theme.fg("dim", text)];
			const first = text.slice(0, width);
			const rest = text.slice(width);
			if (rest.length <= width - 3) {
				return [theme.fg("dim", first), theme.fg("dim", `   ${rest}`)];
			}
			return [theme.fg("dim", first), theme.fg("dim", `  …${rest.slice(-(width - 3))}`)];
		}

		function renderRow(row: ContentRow, focused: boolean, width: number): string {
			const prefix = focused ? "→ " : "  ";
			const marker = row.kind === "selected" ? "✅" : "⬜";
			const text = truncateMiddle(row.path, Math.max(1, width - 6));
			const base = `${marker} ${text}`;
			if (focused) return `${prefix}${theme.fg("accent", theme.bold(base))}`;
			return row.kind === "selected" ? `${prefix}${theme.fg("success", base)}` : `${prefix}${theme.fg("dim", base)}`;
		}

		function render(width: number): string[] {
			const all = rows();
			const selCount = currentPaths.length;
			const lines: string[] = [];
			const border = "─".repeat(Math.max(2, width));
			lines.push(theme.fg("accent", border));
			lines.push(theme.fg("accent", theme.bold(truncateToWidth(` ${options.title}`, Math.max(2, width)))));

			const actionLabels = actionItems.map((action, i) => {
				const focused = focusArea === "actions" && i === actionIndex;
				const prefix = focused ? "→ " : "  ";
				const label = focused ? theme.fg("accent", theme.bold(action.label)) : theme.fg("text", action.label);
				return `${prefix}${label}`;
			});
			lines.push(truncateToWidth(actionLabels.join("   "), Math.max(2, width)));
			lines.push(theme.fg("borderMuted", border));

			lines.push(theme.fg("success", truncateToWidth(` ✅ Selected (${selCount})`, Math.max(2, width))));
			if (selCount === 0) {
				lines.push(theme.fg("dim", "  (none)"));
			}
			const visible = all.slice(scrollOffset, scrollOffset + pageSize);
			let emittedSuggestions = 0;
			for (let i = 0; i < visible.length; i++) {
				const row = visible[i];
				if (!row) continue;
				if (row.kind === "suggestion" && emittedSuggestions === 0) {
					lines.push(theme.fg("dim", truncateToWidth("  ── enter adds/removes ──", Math.max(2, width))));
					lines.push(
						theme.fg("warning", truncateToWidth(` 💡 Suggestions (${all.length - selCount})`, Math.max(2, width))),
					);
				}
				lines.push(renderRow(row, focusArea === "content" && scrollOffset + i === contentIndex, width));
				if (row.kind === "suggestion") emittedSuggestions++;
			}
			if (all.length - selCount === 0) {
				lines.push(theme.fg("dim", truncateToWidth("  ── enter adds/removes ──", Math.max(2, width))));
				lines.push(theme.fg("warning", truncateToWidth(" 💡 Suggestions (0)", Math.max(2, width))));
				lines.push(theme.fg("dim", "  (none)"));
			}
			if (all.length > pageSize) {
				lines.push(
					theme.fg(
						"dim",
						truncateToWidth(
							`  (${scrollOffset + 1}-${Math.min(scrollOffset + pageSize, all.length)}/${all.length})`,
							Math.max(2, width),
						),
					),
				);
			}

			lines.push(...detailLines(width));
			lines.push(theme.fg("accent", border));
			const footer = "↑↓ navigate • enter add/remove • esc cancel";
			const footerShort = "↑↓ move • enter toggle • esc";
			lines.push(theme.fg("dim", (footer.length <= width ? footer : footerShort).slice(0, Math.max(2, width))));
			lines.push(theme.fg("accent", border));
			return lines.map((l) => truncateToWidth(l, Math.max(2, width)));
		}

		async function handleAction(action: ListEditorItem) {
			if (action.id === BACK_ID) {
				done({ kind: "done", paths: currentPaths });
				return;
			}
			if (action.id === FILTER_ID) {
				const input = await ctx.ui.input("Filter by name (empty clears):");
				const query = (input ?? "").trim().toLowerCase();
				done({ kind: "filter", query, paths: currentPaths });
				return;
			}
			if (action.id.startsWith("custom:")) {
				done({ kind: "custom", id: action.value, paths: currentPaths });
			}
		}

		function toggleFocused() {
			const row = rows()[contentIndex];
			if (!row) return;
			if (row.kind === "suggestion") {
				if (!currentPaths.includes(row.path)) currentPaths.push(row.path);
			} else {
				currentPaths = currentPaths.filter((p) => p !== row.path);
			}
			clamp();
			tui.requestRender();
		}

		clamp();

		return {
			render,
			invalidate: () => {},
			handleInput: (data: string) => {
				if (matchesKey(data, Key.escape)) {
					done({ kind: "back" });
					return;
				}
				if (matchesKey(data, Key.enter)) {
					if (focusArea === "actions") {
						const action = actionItems[actionIndex];
						if (action) void handleAction(action);
					} else {
						toggleFocused();
					}
					return;
				}
				if (matchesKey(data, Key.up)) {
					const total = rows().length;
					if (focusArea === "actions") {
						if (actionIndex > 0) actionIndex--;
						else if (total > 0) {
							focusArea = "content";
							contentIndex = total - 1;
						}
					} else if (contentIndex > 0) {
						contentIndex--;
					} else {
						focusArea = "actions";
						actionIndex = actionItems.length - 1;
					}
					clamp();
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.down)) {
					const total = rows().length;
					if (focusArea === "actions") {
						if (actionIndex < actionItems.length - 1) actionIndex++;
						else if (total > 0) {
							focusArea = "content";
							contentIndex = 0;
						}
					} else if (contentIndex < total - 1) {
						contentIndex++;
					} else {
						focusArea = "actions";
						actionIndex = 0;
					}
					clamp();
					tui.requestRender();
					return;
				}
			},
		};
	});
}
