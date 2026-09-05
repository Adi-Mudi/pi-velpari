/**
 * Custom entry renderers for Velpari (v0.5.0 Phase I.2).
 *
 * Registers a styled `velpari-status` entry renderer using Pi's official
 * TUI primitives from `@earendil-works/pi-tui` (`Box` + `Text`). The
 * renderer is invoked by Pi when the user expands a `velpari-status`
 * entry written by `discipline/status.ts` via `pi.appendEntry(...)`.
 *
 * Before I.2 the entry was shown with the default JSON renderer, which
 * works but is verbose. This module is the only consumer of the
 * `@earendil-works/pi-tui` peer dep.
 *
 * Pattern: matches the `status-line.ts` example in
 * https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions
 */

import { Box, Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";

/** Shape of the data attached to each "velpari-status" entry. */
export interface VelpariStatusEntryData {
	runId?: string;
	mission?: string;
	stage?: string;
	updatedAt?: string;
	profileId?: string;
	profileKind?: string;
	profileVersion?: string;
	applicationType?: string;
	domain?: string;
	developmentMethod?: string;
	regulated?: boolean;
	outputVariant?: string;
}

/** Truncate `s` to `n` chars, append ellipsis if longer. */
export function truncate(s: string, n: number): string {
	if (s.length <= n) return s;
	return `${s.slice(0, n - 1)}…`;
}

/** Compose the optional detail lines shown only when the entry is expanded. */
function detailLines(d: VelpariStatusEntryData): string[] {
	const out: string[] = [];
	if (d.applicationType) out.push(`applicationType=${d.applicationType}`);
	if (d.domain) out.push(`domain=${d.domain}`);
	if (d.developmentMethod) out.push(`developmentMethod=${d.developmentMethod}`);
	if (typeof d.regulated === "boolean") {
		out.push(`regulated=${d.regulated ? "yes" : "no"}`);
	}
	if (d.outputVariant) out.push(`outputVariant=${d.outputVariant}`);
	if (d.updatedAt) out.push(`updatedAt=${d.updatedAt}`);
	return out;
}

/**
 * Register the `velpari-status` entry renderer.
 *
 * Called once from `index.ts` during the extension factory function. The
 * `customType` literal here MUST match the one used in
 * `discipline/status.ts:pi.appendEntry("velpari-status", ...)`.
 */
export function registerVelpariStatusRenderer(pi: ExtensionAPI): void {
	pi.registerEntryRenderer("velpari-status", (entry, options: { expanded: boolean }, theme: Theme) => {
		const data = (entry.data ?? {}) as VelpariStatusEntryData;
		const head = theme.bold(`Velpari status — ${data.stage ?? "(unknown stage)"}`);
		const sub = theme.fg(
			"muted",
			`runId=${data.runId ?? "?"}  mission=${truncate(data.mission ?? "?", 40)}`,
		);
		const profileLine = data.profileId
			? theme.fg(
					"accent",
					`profile: ${data.profileId}@${data.profileVersion ?? "?"} (${data.profileKind ?? "?"})`,
				)
			: theme.fg("muted", "profile: (none — run /velpari-configure-requirements)");

		// 1px horizontal padding, no vertical, no background tint.
		const box = new Box(1, 0, undefined);
		box.addChild(new Text(head, 0, 0));
		box.addChild(new Text(sub, 0, 0));
		box.addChild(new Text(profileLine, 0, 0));

		// Detail lines only when the user expands the entry.
		if (options.expanded) {
			box.addChild(new Text("", 0, 0));
			for (const line of detailLines(data)) {
				box.addChild(new Text(theme.fg("muted", `  ${line}`), 0, 0));
			}
		}

		return box;
	});
}
