/**
 * Shared TUI detection for the ui/ widgets (L2).
 *
 * Extracted from the copy-pasted copies inside Senai's picker widgets
 * (simple-picker, list-editor, role-picker) so each Velpari widget uses
 * one shared check instead of its own duplicate.
 *
 * A widget uses its custom `ctx.ui.custom` renderer only when the session
 * is a real TUI session AND `custom` is a genuine function (not a
 * `[native code]` stub, which some harnesses expose without rendering
 * support). Otherwise the widget falls back to `ctx.ui.select` /
 * `ctx.ui.confirm`.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** True when the session supports the custom TUI renderer. */
export function isTui(ctx: ExtensionContext): boolean {
	return (
		(ctx as unknown as { mode?: string }).mode === "tui" &&
		typeof ctx.ui.custom === "function" &&
		!ctx.ui.custom.toString().includes("[native code]")
	);
}
