/**
 * Tests for doctor/checks/agent-template-completeness.ts (DSI P4, D18).
 *
 * (a) The real bundled corpus must be clean — this is the regression pin
 *     that would have caught the malformed `design-conflict-detector.md`
 *     template (it carried only `name` + `description`).
 * (b) A temp template dir with a missing `tools:` yields exactly one
 *     error naming the file + field (the check's `dir` override).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	AGENT_TEMPLATE_COMPLETENESS_TITLE,
	checkAgentTemplateCompleteness,
	REQUIRED_TEMPLATE_FIELDS,
} from "../../../src/doctor/checks/agent-template-completeness.js";

/** Run a fixture-building callback against a fresh temp template dir. */
function withDir(fn: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "velpari-template-completeness-"));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("doctor/checks/agent-template-completeness", () => {
	it("uses the stable section title", () => {
		withDir((dir) => {
			const section = checkAgentTemplateCompleteness(process.cwd(), { dir });
			assert.equal(section.title, "Agent template completeness");
			assert.equal(section.title, AGENT_TEMPLATE_COMPLETENESS_TITLE);
		});
	});

	it("(a) the real bundled corpus has 0 errors (regression pin)", () => {
		const section = checkAgentTemplateCompleteness();
		const errors = section.items.filter((i) => i.status === "error");
		assert.equal(errors.length, 0, `bundled templates must be complete: ${JSON.stringify(errors, null, 2)}`);
		assert.ok(
			section.items.some((i) => i.status === "ok"),
			"a clean corpus reports an ok item",
		);
	});

	it("(b) a template missing `tools:` yields exactly one error", () => {
		withDir((dir) => {
			writeFileSync(
				join(dir, "broken.md"),
				"---\nname: broken\ndescription: a broken template\nthinking: minimal\n---\nbody\n",
			);
			const section = checkAgentTemplateCompleteness(process.cwd(), { dir });
			const errors = section.items.filter((i) => i.status === "error");
			assert.equal(errors.length, 1, "exactly one missing-field error");
			assert.match(errors[0]!.message, /broken\.md/);
			assert.match(errors[0]!.message, /tools/);
			assert.ok(errors[0]!.suggestion, "error carries a fix suggestion");
		});
	});

	it("(b2) a template missing `thinking:` yields an error naming thinking", () => {
		withDir((dir) => {
			writeFileSync(
				join(dir, "no-thinking.md"),
				"---\nname: no-thinking\ndescription: a template\ntools: read\n---\nbody\n",
			);
			const section = checkAgentTemplateCompleteness(process.cwd(), { dir });
			const errors = section.items.filter((i) => i.status === "error");
			assert.equal(errors.length, 1);
			assert.match(errors[0]!.message, /thinking/);
		});
	});

	it("(b3) a complete template is clean", () => {
		withDir((dir) => {
			writeFileSync(
				join(dir, "good.md"),
				"---\nname: good\ndescription: a complete template\ntools: read, write, bash\nthinking: minimal\n---\nbody\n",
			);
			const section = checkAgentTemplateCompleteness(process.cwd(), { dir });
			assert.equal(section.items.filter((i) => i.status === "error").length, 0);
			assert.ok(section.items.some((i) => i.status === "ok"));
		});
	});

	it("reports every missing field of one template", () => {
		withDir((dir) => {
			writeFileSync(join(dir, "empty-fm.md"), "---\nname: empty-fm\n---\nbody\n");
			const section = checkAgentTemplateCompleteness(process.cwd(), { dir });
			const errors = section.items.filter((i) => i.status === "error");
			assert.equal(errors.length, 1, "one item listing all missing fields");
			for (const field of REQUIRED_TEMPLATE_FIELDS.filter((f) => f !== "name")) {
				assert.match(errors[0]!.message, new RegExp(field));
			}
		});
	});

	it("handles a missing template directory without throwing", () => {
		const section = checkAgentTemplateCompleteness(process.cwd(), {
			dir: join(tmpdir(), "velpari-no-such-template-dir"),
		});
		assert.equal(section.title, "Agent template completeness");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "info");
	});
});
