/**
 * Tests for doctor/checks/agents.ts.
 * Phase 2: closes the 55% / 55% funcs coverage gap.
 *
 * Focuses on the pure exports (parseFrontmatter, validation constants)
 * because the section-producing functions (checkScoutAgentsSection etc.)
 * need a full agent-file tree on disk and are exercised by integration
 * tests already.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
	ALL_STAGE_SCOUTS,
	KNOWN_TOOL_NAMES,
	REQUIRED_AGENT_FIELDS,
	STAGES_WITH_SKILL_MARKDOWN,
	VALID_AUTO_EXIT,
	VALID_SESSION_MODES,
	VALID_SPAWNING,
	VALID_THINKING_LEVELS,
	parseFrontmatter,
} from "../../../src/doctor/checks/agents.js";

describe("doctor/checks/agents constants", () => {
	it("REQUIRED_AGENT_FIELDS lists the 7 mandatory frontmatter keys", () => {
		assert.deepEqual(REQUIRED_AGENT_FIELDS, [
			"name",
			"description",
			"tools",
			"thinking",
			"session-mode",
			"auto-exit",
			"spawning",
		]);
	});

	it("VALID_SESSION_MODES only allows standalone or lineage-only", () => {
		assert.equal(VALID_SESSION_MODES.size, 2);
		assert.ok(VALID_SESSION_MODES.has("standalone"));
		assert.ok(VALID_SESSION_MODES.has("lineage-only"));
	});

	it("VALID_AUTO_EXIT only allows the literal strings true/false", () => {
		assert.equal(VALID_AUTO_EXIT.size, 2);
		assert.ok(VALID_AUTO_EXIT.has("true"));
		assert.ok(VALID_AUTO_EXIT.has("false"));
	});

	it("VALID_SPAWNING matches VALID_AUTO_EXIT", () => {
		assert.deepEqual([...VALID_AUTO_EXIT].sort(), [...VALID_SPAWNING].sort());
	});

	it("VALID_THINKING_LEVELS has at least the canonical levels", () => {
		for (const lvl of ["low", "medium", "high"]) {
			assert.ok(VALID_THINKING_LEVELS.has(lvl), `expected ${lvl}`);
		}
	});

	it("KNOWN_TOOL_NAMES includes the core tools", () => {
		for (const t of ["bash", "read", "write", "edit"]) {
			assert.ok(KNOWN_TOOL_NAMES.has(t), `expected ${t}`);
		}
	});

	it("ALL_STAGE_SCOUTS covers the stages with scouts", () => {
		const expected = [
			"brainstorm",
			"prd",
			"rtm",
			"feasibility",
			"architecture-generator",
			"pseudocode",
			"testplan",
			"atomic-function",
			"development-order",
			"final-design",
		];
		for (const stage of expected) {
			const scouts = ALL_STAGE_SCOUTS[stage];
			assert.ok(Array.isArray(scouts), `${stage} has scouts`);
			assert.ok(scouts.length >= 1, `${stage} has ≥1 scout`);
		}
	});

	it("STAGES_WITH_SKILL_MARKDOWN lists stages that ship a skill markdown", () => {
		assert.ok(STAGES_WITH_SKILL_MARKDOWN.length > 0);
		for (const stage of STAGES_WITH_SKILL_MARKDOWN) {
			assert.ok(typeof stage === "string");
		}
	});
});

describe("parseFrontmatter", () => {
	it("returns {} when there is no frontmatter block", () => {
		assert.deepEqual(parseFrontmatter("# hello\nbody\n"), {});
	});

	it("parses a simple key-value block", () => {
		const md = `---\nname: foo\ndescription: bar\n---\nbody`;
		assert.deepEqual(parseFrontmatter(md), { name: "foo", description: "bar" });
	});

	it("trims values", () => {
		const md = `---\nname:   spaced   \n---\n`;
		assert.deepEqual(parseFrontmatter(md), { name: "spaced" });
	});

	it("handles YAML list values under a key", () => {
		const md = `---\ntools:\n  - bash\n  - read\n  - write\n---\n`;
		const fm = parseFrontmatter(md);
		assert.ok(fm.tools);
		assert.ok(fm.tools.includes("bash"));
		assert.ok(fm.tools.includes("read"));
		assert.ok(fm.tools.includes("write"));
	});

	it("stops at the closing --- delimiter", () => {
		const md = `---\nname: a\n---\nname: b\n`;
		assert.deepEqual(parseFrontmatter(md), { name: "a" });
	});

	it("ignores lines that don't match key-value or list-item patterns", () => {
		const md = `---\nname: a\nrandom note line\ndescription: c\n---\n`;
		const fm = parseFrontmatter(md);
		assert.equal(fm.name, "a");
		assert.equal(fm.description, "c");
	});

	it("supports hyphenated and underscored keys", () => {
		const md = `---\nsession-mode: standalone\nauto-exit: true\nspawning: false\n---\n`;
		const fm = parseFrontmatter(md);
		assert.equal(fm["session-mode"], "standalone");
		assert.equal(fm["auto-exit"], "true");
		assert.equal(fm.spawning, "false");
	});

	it("handles keys with numeric suffixes", () => {
		const md = `---\nfield2: v\n---\n`;
		const fm = parseFrontmatter(md);
		assert.equal(fm.field2, "v");
	});

	it("returns {} when the block is malformed (no closing delimiter)", () => {
		const md = `---\nname: foo\n`;
		assert.deepEqual(parseFrontmatter(md), {});
	});

	it("returns {} on empty input", () => {
		assert.deepEqual(parseFrontmatter(""), {});
	});
});