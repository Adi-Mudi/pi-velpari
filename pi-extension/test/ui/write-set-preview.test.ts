/**
 * write-set-preview tests (Phase 5).
 *
 * Covers: empty result, each bucket independently, both shapes
 * (WriteAgentsResult + RegenerationPreview), regenerateMode flag
 * (bucket label + source mapping), width-bound truncation (the
 * TUI crash fix), and multi-line output shape.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { renderWriteSetPreview } from "../../src/ui/write-set-preview.js";
import type { RegenerationPreview, WriteAgentsResult } from "../../src/core/agents-generator.js";

describe("write-set-preview (Phase 5)", () => {
	describe("empty result", () => {
		it("returns the 'No files will be written' header for an empty WriteAgentsResult", () => {
			const md = renderWriteSetPreview({
				created: [],
				regenerated: [],
				keptDrifted: [],
				skipped: [],
			});
			assert.match(md, /^No files will be written\.$/);
			assert.ok(!md.includes("Will create"), "no empty bucket headers");
			assert.ok(!md.includes("Will regenerate"));
			assert.ok(!md.includes("Will keep"));
			assert.ok(!md.includes("Will skip"));
		});

		it("returns the 'No files will be written' header for an empty RegenerationPreview", () => {
			const md = renderWriteSetPreview(
				{ recreate: [], overwrite: [], keptDrifted: [], unknown: [] },
				{ regenerateMode: true },
			);
			assert.match(md, /^No files will be written\.$/);
		});
	});

	describe("buckets — WriteAgentsResult shape", () => {
		it("renders only the 'Will create' bucket when only created is non-empty", () => {
			const md = renderWriteSetPreview({
				created: [".pi/agents/foo.md"],
				regenerated: [],
				keptDrifted: [],
				skipped: [],
			});
			assert.match(md, /Will create \(1\):/);
			assert.match(md, /\+ \.pi\/agents\/foo\.md/);
			assert.ok(!md.includes("Will regenerate"));
			assert.ok(!md.includes("Will keep"));
			assert.ok(!md.includes("Will skip"));
		});

		it("renders all 4 buckets when all are non-empty", () => {
			const md = renderWriteSetPreview({
				created: [".pi/agents/a.md"],
				regenerated: [".pi/agents/b.md"],
				keptDrifted: [".pi/agents/c.md"],
				skipped: [".pi/agents/d.md"],
			});
			assert.match(md, /Will create \(1\):/);
			assert.match(md, /\+ \.pi\/agents\/a\.md/);
			assert.match(md, /Will regenerate \(1\):/);
			assert.match(md, /~ \.pi\/agents\/b\.md/);
			assert.match(md, /Will keep \(user-edited\) \(1\):/);
			assert.match(md, /\* \.pi\/agents\/c\.md/);
			assert.match(md, /Will skip \(unknown origin\) \(1\):/);
			assert.match(md, /- \.pi\/agents\/d\.md/);
		});
	});

	describe("buckets — RegenerationPreview shape (regenerateMode: true)", () => {
		it("maps recreate → Will create", () => {
			const md = renderWriteSetPreview(
				{
					recreate: [".pi/agents/x.md"],
					overwrite: [],
					keptDrifted: [],
					unknown: [],
				},
				{ regenerateMode: true },
			);
			assert.match(md, /Will create \(1\):/);
			assert.match(md, /\+ \.pi\/agents\/x\.md/);
		});

		it("maps overwrite → Will regenerate", () => {
			const md = renderWriteSetPreview(
				{
					recreate: [],
					overwrite: [".pi/agents/y.md"],
					keptDrifted: [],
					unknown: [],
				},
				{ regenerateMode: true },
			);
			assert.match(md, /Will regenerate \(1\):/);
			assert.match(md, /~ \.pi\/agents\/y\.md/);
		});

		it("maps unknown → Will skip (unknown origin)", () => {
			const md = renderWriteSetPreview(
				{
					recreate: [],
					overwrite: [],
					keptDrifted: [],
					unknown: [".pi/agents/z.md"],
				},
				{ regenerateMode: true },
			);
			assert.match(md, /Will skip \(unknown origin\) \(1\):/);
			assert.match(md, /- \.pi\/agents\/z\.md/);
		});
	});

	describe("header + total count", () => {
		it("singular 'file' for total = 1", () => {
			const md = renderWriteSetPreview({
				created: [".pi/agents/a.md"],
				regenerated: [],
				keptDrifted: [],
				skipped: [],
			});
			assert.match(md, /^Plan: 1 file will be written\./);
		});

		it("plural 'files' for total > 1", () => {
			const md = renderWriteSetPreview({
				created: [".pi/agents/a.md"],
				regenerated: [".pi/agents/b.md"],
				keptDrifted: [],
				skipped: [],
			});
			assert.match(md, /^Plan: 2 files will be written\./);
		});
	});

	describe("width truncation (TUI crash fix)", () => {
		// pi-tui's truncateToWidth wraps the output in ANSI escape sequences
		// for theme styling, so the JS string length is longer than the
		// visible width. Strip ANSI codes before measuring.
		function visibleWidth(line: string): number {
			// eslint-disable-next-line no-control-regex
			return line.replace(/\x1B\[[0-9;]*m/g, "").length;
		}

		it("truncates long paths to fit the given width", () => {
			const longPath = ".pi/agents/" + "very-long-segment-" + "very-long-segment-" + ".md";
			const md = renderWriteSetPreview(
				{ created: [longPath], regenerated: [], keptDrifted: [], skipped: [] },
				{ width: 40 },
			);
			// Every line of the output must be ≤ 40 visible chars
			// (no Pi TUI crash). ANSI escape sequences are stripped
			// from the measurement because pi-tui wraps truncation in
			// theme escapes that don't count toward display width.
			for (const line of md.split("\n")) {
				assert.ok(
					visibleWidth(line) <= 40,
					`line exceeds 40 visible chars (visible ${visibleWidth(line)}, raw ${line.length}): "${line}"`,
				);
			}
		});

		it("defaults to 80-char width (sane terminal default)", () => {
			const path80 = ".pi/agents/" + "x".repeat(60) + "-name.md";
			const md = renderWriteSetPreview({ created: [path80], regenerated: [], keptDrifted: [], skipped: [] });
			for (const line of md.split("\n")) {
				assert.ok(
					visibleWidth(line) <= 80,
					`line exceeds 80 visible chars (visible ${visibleWidth(line)}, raw ${line.length})`,
				);
			}
		});
	});

	describe("output shape", () => {
		it("trim trailing blank lines", () => {
			const md = renderWriteSetPreview({
				created: [".pi/agents/a.md"],
				regenerated: [],
				keptDrifted: [],
				skipped: [],
			});
			assert.ok(!md.endsWith("\n"), "output must not end with a newline");
			assert.ok(!md.endsWith("\n\n"));
		});

		it("preserves bucket order: create → regenerate → keep → skip", () => {
			const md = renderWriteSetPreview({
				created: [".pi/agents/a.md"],
				regenerated: [".pi/agents/b.md"],
				keptDrifted: [".pi/agents/c.md"],
				skipped: [".pi/agents/d.md"],
			});
			const idxCreate = md.indexOf("Will create");
			const idxRegen = md.indexOf("Will regenerate");
			const idxKeep = md.indexOf("Will keep");
			const idxSkip = md.indexOf("Will skip");
			assert.ok(idxCreate >= 0 && idxRegen > idxCreate, "create before regenerate");
			assert.ok(idxRegen > idxCreate && idxKeep > idxRegen, "regenerate before keep");
			assert.ok(idxKeep > idxRegen && idxSkip > idxKeep, "keep before skip");
		});
	});
});

// Suppress unused-import warnings for types
type _UnusedResult = WriteAgentsResult;
type _UnusedPreview = RegenerationPreview;
