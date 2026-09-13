/**
 * Artifact frontmatter tests (RTM traceability upgrade, Phase 1).
 *
 * Covers:
 *   - parseFrontmatterBlock: fields + body extraction, no-block case
 *   - renderFrontmatter: canonical field order, extras preserved
 *   - withArtifactFrontmatter: fills missing fields, preserves existing,
 *     version/created fall back to the published copy, updated refreshes
 *   - missingFrontmatterFields: full list when no block, partial list
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	ARTIFACT_FRONTMATTER_FIELDS,
	missingFrontmatterFields,
	parseFrontmatterBlock,
	renderFrontmatter,
	withArtifactFrontmatter,
} from "../../src/core/frontmatter.js";

const NOW = "2026-09-12T23:10:00.000Z";
const INPUT = {
	artifact: "RTM",
	project: "TestApp",
	stage: "built-rtm",
	run: "2026-09-12-22-00-test-app",
	now: NOW,
};

describe("parseFrontmatterBlock", () => {
	it("parses fields and returns the body", () => {
		const parsed = parseFrontmatterBlock("---\nartifact: RTM\nversion: 1.0.0\n---\n\n# Title\n\ntext");
		assert.ok(parsed);
		assert.equal(parsed.fields.artifact, "RTM");
		assert.equal(parsed.fields.version, "1.0.0");
		assert.equal(parsed.body, "# Title\n\ntext");
	});

	it("returns null when no block is present", () => {
		assert.equal(parseFrontmatterBlock("# Title\n\ntext"), null);
	});

	it("ignores malformed lines inside the block", () => {
		const parsed = parseFrontmatterBlock("---\nartifact: RTM\nnot a field\n---\n# T");
		assert.ok(parsed);
		assert.deepEqual(Object.keys(parsed.fields), ["artifact"]);
	});
});

describe("renderFrontmatter", () => {
	it("renders canonical fields first, extras after", () => {
		const block = renderFrontmatter({
			documentType: "product-software-requirements",
			artifact: "PRD",
			project: "TestApp",
			version: "2.0.0",
		});
		const lines = block.split("\n");
		assert.equal(lines[0], "---");
		assert.equal(lines[1], "artifact: PRD");
		assert.equal(lines[2], "project: TestApp");
		assert.equal(lines[3], "version: 2.0.0");
		assert.equal(lines[4], "documentType: product-software-requirements");
		assert.equal(lines[5], "---");
	});
});

describe("withArtifactFrontmatter", () => {
	it("prepends a full block to content without frontmatter", () => {
		const out = withArtifactFrontmatter("# RTM\n", INPUT);
		const parsed = parseFrontmatterBlock(out);
		assert.ok(parsed);
		for (const field of ARTIFACT_FRONTMATTER_FIELDS) {
			assert.ok(field in parsed.fields, `missing ${field}`);
		}
		assert.equal(parsed.fields.artifact, "RTM");
		assert.equal(parsed.fields.version, "1.0.0");
		assert.equal(parsed.fields.status, "published");
		assert.equal(parsed.fields.created, NOW);
		assert.equal(parsed.fields.updated, NOW);
		assert.equal(parsed.body, "# RTM\n");
	});

	it("preserves existing fields and never overwrites them", () => {
		const content = "---\nversion: 2.3.0\nstatus: draft\n---\n\n# RTM\n";
		const out = withArtifactFrontmatter(content, INPUT);
		const parsed = parseFrontmatterBlock(out)!;
		assert.equal(parsed.fields.version, "2.3.0");
		assert.equal(parsed.fields.status, "draft");
		assert.equal(parsed.fields.updated, NOW);
	});

	it("keeps extra keys (PSRS schema) alongside the canonical fields", () => {
		const content = "---\ndocumentType: product-software-requirements\nprofile: core-psrs-v1\n---\n\n# PSRS\n";
		const out = withArtifactFrontmatter(content, { ...INPUT, artifact: "PRD" });
		const parsed = parseFrontmatterBlock(out)!;
		assert.equal(parsed.fields.documentType, "product-software-requirements");
		assert.equal(parsed.fields.profile, "core-psrs-v1");
		assert.equal(parsed.fields.artifact, "PRD");
	});

	it("falls back to the published copy for version and created", () => {
		const published = "---\nversion: 1.4.0\ncreated: 2026-01-01T00:00:00.000Z\n---\n\n# RTM\n";
		const out = withArtifactFrontmatter("# RTM v2\n", INPUT, published);
		const parsed = parseFrontmatterBlock(out)!;
		assert.equal(parsed.fields.version, "1.4.0");
		assert.equal(parsed.fields.created, "2026-01-01T00:00:00.000Z");
		assert.equal(parsed.fields.updated, NOW);
	});

	it("is idempotent on a second publish", () => {
		const once = withArtifactFrontmatter("# RTM\n", INPUT);
		const twice = withArtifactFrontmatter(once, { ...INPUT, now: "2026-09-13T00:00:00.000Z" });
		const parsed = parseFrontmatterBlock(twice)!;
		assert.equal(parsed.fields.created, NOW);
		assert.equal(parsed.fields.updated, "2026-09-13T00:00:00.000Z");
	});
});

describe("missingFrontmatterFields", () => {
	it("returns every field when no block exists", () => {
		assert.deepEqual(missingFrontmatterFields("# T\n"), [...ARTIFACT_FRONTMATTER_FIELDS]);
	});

	it("returns only the missing fields", () => {
		const content = "---\nartifact: RTM\nproject: TestApp\n---\n\n# T\n";
		assert.deepEqual(missingFrontmatterFields(content), [
			"version",
			"status",
			"stage",
			"run",
			"created",
			"updated",
		]);
	});

	it("returns empty when the block is complete", () => {
		const out = withArtifactFrontmatter("# T\n", INPUT);
		assert.deepEqual(missingFrontmatterFields(out), []);
	});
});
