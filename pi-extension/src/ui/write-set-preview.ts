/**
 * Write-set preview renderer (L2 — Phase 5 of /velpari-generate-sub-agents).
 *
 * Renders a `WriteAgentsResult` (or `RegenerationPreview`) as a multi-line
 * string for the confirmation dialog. Multi-line safe via
 * `truncateToWidth` from `@earendil-works/pi-tui` — fixes the "Rendered
 * line ... exceeds terminal width" crash documented in pi-seani's
 * CHANGELOG (v0.7.x).
 *
 * Buckets (in display order):
 *   1. Will create      (`created` from WriteAgentsResult; `recreate` from RegenerationPreview)
 *   2. Will regenerate  (`regenerated` from WriteAgentsResult; `overwrite` from RegenerationPreview)
 *   3. Will keep edits  (`keptDrifted` — present in both shapes)
 *   4. Will skip        (`skipped` from WriteAgentsResult; `unknown` from RegenerationPreview)
 *
 * Empty buckets are omitted entirely (no "(0)" noise).
 * A summary line at the top counts the total planned writes.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type {
	RegenerationPreview,
	WriteAgentsResult,
} from "../core/agents-generator.js";

interface WriteSetPreviewOptions {
	/** Maximum line width (terminal columns). Defaults to 80. */
	width?: number;
	/** When true, the bucket labels use the regenerate-friendly copy
	 *  ("will create", "will overwrite", "will keep edits", "will skip"). */
	regenerateMode?: boolean;
}

const DEFAULT_WIDTH = 80;
const BUCKET_INDENT = "    ";
const LINE_INDENT = "      ";
const PREVIEW_GLYPH = {
	plus: "+",
	tilde: "~",
	star: "*",
	minus: "-",
} as const;

/** A unified bucket shape so the renderer can accept either
 *  WriteAgentsResult or RegenerationPreview. */
interface PreviewBuckets {
	willCreate: string[];
	willRegenerate: string[];
	willKeep: string[];
	willSkip: string[];
}

function toBuckets(input: WriteAgentsResult | RegenerationPreview, regenerateMode: boolean): PreviewBuckets {
	if (regenerateMode) {
		const regen = input as RegenerationPreview;
		return {
			willCreate: regen.recreate,
			willRegenerate: regen.overwrite,
			willKeep: regen.keptDrifted,
			willSkip: regen.unknown,
		};
	}
	const write = input as WriteAgentsResult;
	return {
		willCreate: write.created,
		willRegenerate: write.regenerated,
		willKeep: write.keptDrifted,
		willSkip: write.skipped,
	};
}

function bucketHeader(label: string, count: number): string {
	const truncated = truncateToWidth(label, Math.max(10, DEFAULT_WIDTH - 4));
	return `  ${truncated} (${count}):`;
}

/** Render a `WriteAgentsResult` or `RegenerationPreview` as a multi-line
 *  confirmation message. Each bucket is omitted when empty. The total
 *  write count is shown in the header. */
export function renderWriteSetPreview(
	input: WriteAgentsResult | RegenerationPreview,
	options: WriteSetPreviewOptions = {},
): string {
	const width = options.width ?? DEFAULT_WIDTH;
	const regenerateMode = options.regenerateMode ?? false;
	const b = toBuckets(input, regenerateMode);
	const lines: string[] = [];

	const totalWrites = b.willCreate.length + b.willRegenerate.length;
	const header =
		totalWrites === 0
			? "No files will be written."
			: `Plan: ${totalWrites} file${totalWrites === 1 ? "" : "s"} will be written.`;
	lines.push(truncateToWidth(header, width));
	lines.push("");

	if (b.willCreate.length > 0) {
		lines.push(truncateToWidth(bucketHeader("Will create", b.willCreate.length), width));
		for (const path of b.willCreate) {
			lines.push(
				truncateToWidth(
					`${LINE_INDENT}${PREVIEW_GLYPH.plus} ${path}`,
					width,
				),
			);
		}
		lines.push("");
	}

	if (b.willRegenerate.length > 0) {
		lines.push(truncateToWidth(bucketHeader("Will regenerate", b.willRegenerate.length), width));
		for (const path of b.willRegenerate) {
			lines.push(
				truncateToWidth(
					`${LINE_INDENT}${PREVIEW_GLYPH.tilde} ${path}`,
					width,
				),
			);
		}
		lines.push("");
	}

	if (b.willKeep.length > 0) {
		lines.push(truncateToWidth(bucketHeader("Will keep (user-edited)", b.willKeep.length), width));
		for (const path of b.willKeep) {
			lines.push(
				truncateToWidth(
					`${LINE_INDENT}${PREVIEW_GLYPH.star} ${path}`,
					width,
				),
			);
		}
		lines.push("");
	}

	if (b.willSkip.length > 0) {
		lines.push(truncateToWidth(bucketHeader("Will skip (unknown origin)", b.willSkip.length), width));
		for (const path of b.willSkip) {
			lines.push(
				truncateToWidth(
					`${LINE_INDENT}${PREVIEW_GLYPH.minus} ${path}`,
					width,
				),
			);
		}
		lines.push("");
	}

	// Trim trailing blank line if present
	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}

	return lines.join("\n");
}

// Re-export for callers that just want the type alongside the renderer.
export type { WriteAgentsResult, RegenerationPreview };

// Keep BUCKET_INDENT exported for callers building custom dialogs that
// need to align with the preview indent.
export { BUCKET_INDENT };
