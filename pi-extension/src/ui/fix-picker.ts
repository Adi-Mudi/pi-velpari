/**
 * Doctor fix picker widget (L2).
 *
 * Two-level picker built on `runSimplePicker` (Senai port):
 *
 *   Level 1 — Top menu (always 3 options, one optional):
 *     - "Fix an item"          → opens Level 2 sub-picker over
 *                                actionable items (only if any)
 *     - "Open full report"     → notify with the report path
 *     - "Skip — end doctor"    → no-op
 *
 *   Level 2 — Item sub-picker (one row per ActionableItem):
 *     Each row shows: status icon + section + message headline +
 *     truncated suggestion as a hint.
 *
 * Phase 1 (Level A only) ships with this 2-level shape. Phase 2 (Level B)
 * adds a "Fix all safe" top-level option once `RemediateFn`s exist
 * under `doctor/checks/remediate/`. Phase 3 (Level C) leaves the picker
 * shape unchanged and replaces the Level 2 dispatch with a structured
 * `FixBrief` (see `doctor/fix-brief.ts`).
 *
 * Match the visual language of the existing pickers (single-choice,
 * border, title, → cursor, dim footer, no terminal chrome).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runSimplePicker, type SimplePickerItem } from "./simple-picker.js";
import type { ActionableItem, FixChoice } from "../doctor/fix-dispatch.js";

interface FixPickerOptions {
	title: string;
	subtitle?: string;
	items: ActionableItem[];
	reportPath: string;
}

const PICK_OPEN = "open-report";
const PICK_SKIP = "skip";
const PICK_FIX = "fix-an-item";

export async function runFixPicker(
	ctx: ExtensionContext,
	options: FixPickerOptions,
): Promise<FixChoice> {
	const hasItems = options.items.length > 0;
	const topOptions: SimplePickerItem[] = [];

	if (hasItems) {
		topOptions.push({
			id: PICK_FIX,
			label: `Fix an item (${options.items.length} actionable)`,
			hint: "pick one to dispatch to the parent LLM",
		});
	}
	topOptions.push(
		{
			id: PICK_OPEN,
			label: "Open full report",
			hint: options.reportPath,
		},
		{ id: PICK_SKIP, label: "Skip — end doctor" },
	);

	const top = await runSimplePicker(ctx, {
		title: options.title,
		subtitle: options.subtitle,
		items: topOptions,
	});

	if (!top || top === PICK_SKIP) return { kind: "skip" };
	if (top === PICK_OPEN) return { kind: "open-report" };

	if (top === PICK_FIX) {
		const itemOptions: SimplePickerItem[] = options.items.map((it) => ({
			id: String(it.index),
			label: `${iconForStatus(it.status)}  ${truncate(it.message, 60)}`,
			hint: `${it.section}  →  ${truncate(it.suggestion, 100)}`,
		}));
		const pickedId = await runSimplePicker(ctx, {
			title: `${options.title} — pick an item`,
			subtitle: `${options.items.length} actionable in this report`,
			items: itemOptions,
		});
		if (!pickedId) return { kind: "skip" };
		const idx = Number.parseInt(pickedId, 10);
		const item = options.items.find((it) => it.index === idx);
		if (!item) return { kind: "skip" };
		return { kind: "fix-one", item };
	}

	// Defensive: unknown id falls through to skip.
	return { kind: "skip" };
}

function iconForStatus(status: "error" | "warning"): string {
	return status === "error" ? "❌" : "⚠️";
}

function truncate(s: string, n: number): string {
	if (s.length <= n) return s;
	return `${s.slice(0, Math.max(0, n - 1))}…`;
}
