/**
 * Tests for the D14 body check in doctor/checks/agents.ts
 * (`checkAgentFileIntegrity`).
 *
 * Issue 14 (binding): the body check is warning-first, never error.
 *   - a non-empty body shorter than 200 chars → warning
 *   - a body byte-identical (trim + whitespace-collapsed) to another
 *     role's body → warning naming the twin
 *   - an empty body → the pre-existing warning
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkAgentFileIntegrity } from "../../../src/doctor/checks/agents.js";

/** Build an agent markdown file: minimal valid frontmatter + body. */
function agentMarkdown(name: string, body: string): string {
	return `---\nname: ${name}\ndescription: test agent\n---\n${body}\n`;
}

/** Run the integrity check against a temp `.pi/agents/` tree. */
function withAgentsDir(files: Record<string, string>, run: (cwd: string) => void): void {
	const cwd = mkdtempSync(join(tmpdir(), "velpari-agent-body-"));
	try {
		const agentsDir = join(cwd, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		for (const [filename, content] of Object.entries(files)) {
			writeFileSync(join(agentsDir, filename), content);
		}
		run(cwd);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

/** Body-related items only (drops the section summary lines). */
function bodyItems(section: { items: { status: string; message: string }[] }) {
	return section.items.filter(
		(i) => !/^Agent file integrity:/.test(i.message) && !/^Agent file integrity OK:/.test(i.message),
	);
}

const HEALTHY_BODY =
	"This agent owns the requirements traceability matrix. It maps every functional requirement to its design element and its test case, keeps ids stable across revisions, and reports any coverage gaps back to the parent session for resolution.";

describe("checkAgentFileIntegrity — D14 body check", () => {
	it("(a) flags a non-empty body shorter than 200 chars with exactly one warning", () => {
		withAgentsDir({ "short-agent.md": agentMarkdown("short-agent", "Too short.") }, (cwd) => {
			const section = checkAgentFileIntegrity(cwd);
			const warnings = bodyItems(section).filter((i) => i.status === "warning");
			assert.equal(warnings.length, 1, `expected exactly one body warning, got ${JSON.stringify(warnings)}`);
			assert.match(warnings[0]!.message, /body is very short/);
			assert.match(warnings[0]!.message, /short-agent\.md/);
		});
	});

	it("(b) flags two roles with identical bodies, naming the twin", () => {
		withAgentsDir(
			{
				"alpha.md": agentMarkdown("alpha", HEALTHY_BODY),
				"beta.md": agentMarkdown("beta", HEALTHY_BODY),
			},
			(cwd) => {
				const section = checkAgentFileIntegrity(cwd);
				const copy = bodyItems(section).filter((i) => /body is identical to/.test(i.message));
				assert.equal(copy.length, 2, "one copy-paste warning per twin file");
				for (const item of copy) {
					assert.equal(item.status, "warning");
					assert.match(item.message, /body is identical to `(alpha|beta)\.md` — a copy-paste of another role\./);
				}
				assert.ok(
					copy.some((i) => /alpha\.md: body is identical to `beta\.md`/.test(i.message)),
					"alpha names beta as the twin",
				);
				assert.ok(
					copy.some((i) => /beta\.md: body is identical to `alpha\.md`/.test(i.message)),
					"beta names alpha as the twin",
				);
			},
		);
	});

	it("(c) a healthy body produces no body item", () => {
		withAgentsDir({ "healthy-agent.md": agentMarkdown("healthy-agent", HEALTHY_BODY) }, (cwd) => {
			const section = checkAgentFileIntegrity(cwd);
			assert.equal(bodyItems(section).length, 0, `unexpected body items: ${JSON.stringify(bodyItems(section))}`);
			assert.equal(
				section.items.filter((i) => i.status === "warning" || i.status === "error").length,
				0,
				`unexpected warnings/errors: ${JSON.stringify(section.items)}`,
			);
		});
	});

	it("(d) keeps the existing empty-body warning", () => {
		withAgentsDir({ "empty-agent.md": agentMarkdown("empty-agent", "") }, (cwd) => {
			const section = checkAgentFileIntegrity(cwd);
			const empty = bodyItems(section).filter((i) => /body is empty after frontmatter/.test(i.message));
			assert.equal(empty.length, 1);
			assert.equal(empty[0]!.status, "warning");
		});
	});
});
