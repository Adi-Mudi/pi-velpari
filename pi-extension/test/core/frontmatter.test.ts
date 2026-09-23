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
		// `supersedes` is only present on UPDATE publishes (Phase 7
		// of the architecture-generator upgrade plan), so a fresh
		// publish with no `supersedes` input does not emit it.
		// `sunset` is only present when set (v1.2.2), so a fresh
		// publish with no `sunset` input does not emit it either.
		// `deprecatedAt` is only present after the sunset auto-archive
		// (v1.3.0), so a fresh publish with no archive action does
		// not emit it.
		const expected = (ARTIFACT_FRONTMATTER_FIELDS as readonly string[]).filter(
			(f) => f !== "supersedes" && f !== "sunset" && f !== "deprecatedAt",
		);
		for (const field of expected) {
			assert.ok(field in parsed.fields, `missing ${field}`);
		}
		assert.equal(parsed.fields.artifact, "RTM");
		assert.equal(parsed.fields.version, "1.0.0");
		assert.equal(parsed.fields.status, "published");
		assert.equal(parsed.fields.created, NOW);
		assert.equal(parsed.fields.updated, NOW);
		assert.equal(parsed.body, "# RTM\n");
	});

	it("Phase 7: writes supersedes when input.supersedes is set", () => {
		const out = withArtifactFrontmatter("# RTM v2\n", { ...INPUT, supersedes: "RTM_v1_2026-09-13" });
		const parsed = parseFrontmatterBlock(out)!;
		assert.equal(parsed.fields.supersedes, "RTM_v1_2026-09-13");
	});

	it("Phase 7: supersedes is absent when input.supersedes is undefined", () => {
		const out = withArtifactFrontmatter("# RTM v2\n", INPUT);
		const parsed = parseFrontmatterBlock(out)!;
		assert.equal(parsed.fields.supersedes, undefined);
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
			"supersedes",
			"sunset",
			"deprecatedAt",
		]);
	});

	it("returns empty when the block is complete", () => {
		const out = withArtifactFrontmatter("# T\n", {
			...INPUT,
			supersedes: "x",
			sunset: "2099-01-01",
			deprecatedAt: "2026-09-14",
		});
		assert.deepEqual(missingFrontmatterFields(out), []);
	});

	it("reports supersedes missing for a fresh publish without one", () => {
		const out = withArtifactFrontmatter("# T\n", INPUT);
		const missing = missingFrontmatterFields(out);
		assert.deepEqual(missing, ["supersedes", "sunset", "deprecatedAt"]);
	});

	it("v1.2.2: writes sunset when input.sunset is set", () => {
		const out = withArtifactFrontmatter("# T\n", { ...INPUT, supersedes: "x", sunset: "2026-12-31" });
		const parsed = parseFrontmatterBlock(out);
		assert.ok(parsed);
		assert.equal(parsed.fields.sunset, "2026-12-31");
	});

	it("v1.2.2: omits sunset when input.sunset is undefined", () => {
		const out = withArtifactFrontmatter("# T\n", INPUT);
		const parsed = parseFrontmatterBlock(out);
		assert.ok(parsed);
		assert.equal(parsed.fields.sunset, undefined);
	});
});

describe("withArtifactFrontmatter — B4 freshness inputs stamp", () => {
	it("writes the inputs JSON scalar and round-trips it unchanged", () => {
		const inputs = JSON.stringify({
			"brainstorm:cli-todo": "a".repeat(64),
			"prd:TestApp": "b".repeat(64),
		});
		const out = withArtifactFrontmatter("# RTM\n", { ...INPUT, inputs });
		const parsed = parseFrontmatterBlock(out)!;
		assert.equal(parsed.fields.inputs, inputs);
		assert.deepEqual(JSON.parse(parsed.fields.inputs!), JSON.parse(inputs));
	});

	it("refreshes a stale inputs line carried into the working copy", () => {
		const content = `---\ninputs: {"old":"${"0".repeat(64)}"}\n---\n\n# RTM\n`;
		const inputs = JSON.stringify({ "prd:TestApp": "c".repeat(64) });
		const out = withArtifactFrontmatter(content, { ...INPUT, inputs });
		const parsed = parseFrontmatterBlock(out)!;
		assert.equal(parsed.fields.inputs, inputs);
	});

	it("renderFrontmatter keeps the JSON scalar on one line", () => {
		const inputs = JSON.stringify({ "prd:TestApp": "d".repeat(64) });
		const block = renderFrontmatter({ artifact: "PRD", inputs });
		assert.ok(block.includes(`inputs: ${inputs}\n`));
	});
});
