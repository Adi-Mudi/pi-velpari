/**
 * Role picker widget (L2).
 *
 * Port of Senai's `ui/role-picker.ts`. The only Senai-specific import
 * (`RoleGuidance` from `core/agents-config/suggestions.ts`) is untangled:
 * the union is defined locally in this file. The default subtitle is
 * reworded to neutral Velpari wording. Uses the shared `./is-tui.js` TUI
 * check.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { isTui } from "./is-tui.js";

export type RoleGuidance = "design-defined" | "recommended" | "optional";

export interface RolePickerItem {
	id: string;
	label: string;
	agent: string;
	summary: string;
	assigned: boolean;
	guidance?: RoleGuidance;
	needs?: string;
}

/** Colors: green = handled by design, yellow = please
 *  configure, gray = your choice. */
const GUIDANCE_COLORS: Record<RoleGuidance, "success" | "warning" | "dim"> = {
	"design-defined": "success",
	recommended: "warning",
	optional: "dim",
};

interface RolePickerOptions {
	title: string;
	items: RolePickerItem[];
	pageSize?: number;
	subtitle?: string;
	initialSelectedId?: string;
	showBack?: boolean;
}

type RolePickerResult =
	| { kind: "role"; role: string }
	| { kind: "finish" }
	| { kind: "back" };

export async function runRolePicker(
	ctx: ExtensionContext,
	options: RolePickerOptions,
): Promise<RolePickerResult> {
	if (!isTui(ctx)) {
		return runFallbackRolePicker(ctx, options);
	}
	return runCustomRolePicker(ctx, options);
}

const FINISH_ID = "__finish__";
const BACK_ID = "__back__";

function makeFallbackOptions(
	items: RolePickerItem[],
	showBack?: boolean,
): { options: string[]; idMap: Map<string, string> } {
	const options: string[] = [];
	const idMap = new Map<string, string>();
	if (showBack) {
		options.push("Back");
		idMap.set("Back", BACK_ID);
	}
	for (const item of items) {
		const marker = item.assigned ? "✅" : "⬜";
		const agentPart = item.agent ? ` (${item.agent})` : "";
		const needsPart = item.needs ? ` (needs: ${item.needs})` : "";
		const guidancePart = item.guidance ? ` [${item.guidance}]` : "";
		const label = `${marker} ${item.id}: ${item.label}${needsPart}${agentPart} — ${item.summary}${guidancePart}`;
		options.push(label);
		idMap.set(label, item.id);
	}
	const finishLabel = "⬜ Finish";
	options.push(finishLabel);
	idMap.set(finishLabel, FINISH_ID);
	return { options, idMap };
}

async function runFallbackRolePicker(
	ctx: ExtensionContext,
	options: RolePickerOptions,
): Promise<RolePickerResult> {
	const { options: labels, idMap } = makeFallbackOptions(options.items, options.showBack);
	const choice = await ctx.ui.select(options.title, labels);
	if (!choice) return { kind: "back" };
	const id = idMap.get(choice);
	if (id === BACK_ID) return { kind: "back" };
	if (!id || id === FINISH_ID) return { kind: "finish" };
	return { kind: "role", role: id };
}

async function runCustomRolePicker(
	ctx: ExtensionContext,
	options: RolePickerOptions,
): Promise<RolePickerResult> {
	return ctx.ui.custom<RolePickerResult>((tui, theme, _keybindings, done) => {
		const pageSize = options.pageSize ?? 15;
		const items = [...options.items];
		items.push({
			id: FINISH_ID,
			label: "Finish",
			agent: "",
			summary: "",
			assigned: false,
		});
		if (options.showBack) {
			items.unshift({
				id: BACK_ID,
				label: "Back",
				agent: "",
				summary: "",
				assigned: false,
			});
		}

		let selectedIndex = Math.max(
			0,
			options.initialSelectedId
				? items.findIndex((i) => i.id === options.initialSelectedId)
				: 0,
		);
		let scrollOffset = 0;

		function ensureVisible() {
			if (selectedIndex < scrollOffset) {
				scrollOffset = selectedIndex;
			} else if (selectedIndex >= scrollOffset + pageSize) {
				scrollOffset = selectedIndex - pageSize + 1;
			}
		}

		function renderRow(item: RolePickerItem, focused: boolean, width: number): string {
			const prefix = focused ? "→ " : "  ";
			const agentPart = item.agent ? ` (${item.agent})` : "";
			const needsPart = item.needs ? ` (needs: ${item.needs})` : "";
			const guidancePart = item.guidance
				? ` ${theme.fg(GUIDANCE_COLORS[item.guidance], `[${item.guidance}]`)}`
				: "";
			const base = truncateToWidth(
				`${item.label}${needsPart}${agentPart} — ${item.summary}${guidancePart}`,
				Math.max(1, width - 2),
			);
			if (item.id === FINISH_ID) {
				return `${prefix}${theme.fg("text", "Finish")}`;
			}
			if (item.id === BACK_ID) {
				return `${prefix}${theme.fg("text", "Back")}`;
			}
			if (focused) {
				return `${prefix}${theme.fg("accent", theme.bold(base))}`;
			}
			if (item.assigned) {
				return `${prefix}${theme.fg("accent", base)}`;
			}
			return `${prefix}${theme.fg("dim", base)}`;
		}

		function render(width: number): string[] {
			const lines: string[] = [];
			const border = "─".repeat(Math.max(2, width));
			lines.push(theme.fg("accent", border));
			lines.push(
				theme.fg(
					"accent",
					theme.bold(truncateToWidth(` ${options.title}`, Math.max(2, width))),
				),
			);
			const subtitle = options.subtitle ?? " Pick a role to review its agent mapping; Finish when done.";
			lines.push(theme.fg("warning", truncateToWidth(subtitle, Math.max(2, width))));
			lines.push(theme.fg("accent", border));

			const visible = items.slice(scrollOffset, scrollOffset + pageSize);
			for (let i = 0; i < visible.length; i++) {
				const item = visible[i];
				if (!item) continue;
				const focused = scrollOffset + i === selectedIndex;
				lines.push(renderRow(item, focused, width));
			}

			lines.push(theme.fg("accent", border));
			lines.push(
				theme.fg(
					"dim",
					truncateToWidth(
						"↑↓ navigate • enter select • esc cancel",
						Math.max(2, width),
					),
				),
			);
			lines.push(theme.fg("accent", border));
			return lines.map((l) => truncateToWidth(l, Math.max(2, width)));
		}

		function move(delta: number) {
			selectedIndex = (selectedIndex + delta + items.length) % items.length;
			ensureVisible();
			tui.requestRender();
		}

		ensureVisible();

		return {
			render,
			invalidate: () => {},
			handleInput: (data: string) => {
				if (matchesKey(data, Key.escape)) {
					done({ kind: "back" });
					return;
				}
				if (matchesKey(data, Key.enter)) {
					const item = items[selectedIndex];
					if (!item) return;
					if (item.id === FINISH_ID) {
						done({ kind: "finish" });
					} else if (item.id === BACK_ID) {
						done({ kind: "back" });
					} else {
						done({ kind: "role", role: item.id });
					}
					return;
				}
				if (matchesKey(data, Key.up)) {
					move(-1);
					return;
				}
				if (matchesKey(data, Key.down)) {
					move(1);
					return;
				}
			},
		};
	});
}
