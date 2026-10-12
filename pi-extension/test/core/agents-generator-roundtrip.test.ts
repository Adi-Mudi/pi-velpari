/**
 * Generator ↔ doctor round-trip contract test (PH hotfix).
 *
 * The proven defect this pins: `buildGeneratedAgentMarkdown` used to emit
 * `name/description/tools/session-mode/auto-exit/spawning` but NO
 * `thinking:`, and hardcoded `session-mode: lineage-only`. Because
 * `updateAgentsJson` maps each role to its generated file, the doctor's
 * `checkScoutAgentsSection` then flagged EVERY generated agent with
 * `frontmatter missing fields: thinking` (a hard error).
 *
 * This is a NON-VACUOUS round trip: it actually generates an agent, writes
 * it to `.pi/agents/`, points `agents.json` at it, and then runs the real
 * doctor check against the real file on disk — the exact seam that was
 * broken. (Per master plan §14 / Gap 9.)
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	planAgentGeneration,
	scoutTemplateRoleDef,
	updateAgentsJson,
	writeGeneratedAgents,
	type GeneratedRoleDef,
} from "../../src/core/agents-generator.js";
import { checkScoutAgentsSection } from "../../src/doctor/checks/agents.js";

/** Create a unique temp project dir for one round-trip run.
 *  @returns Absolute path to a fresh temp directory. */
function freshTmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-agent-roundtrip-"));
}

describe("generator ↔ doctor round-trip (PH hotfix)", () => {
	it("template-derived generated agents pass checkScoutAgentsSection with no errors", () => {
		const cwd = freshTmp();
		try {
			// Two template-derived roles from different stages — reviewer
			// (thinking: high, atomic-function) + fr-extractor (thinking:
			// minimal, prd) — so the thinking fallback is exercised across
			// distinct template values.
			const roles = ["reviewer", "fr-extractor"] as const;
			const defs: GeneratedRoleDef[] = [];
			for (const role of roles) {
				const def = scoutTemplateRoleDef(role);
				assert.ok(def, `scoutTemplateRoleDef(${role}) must resolve the bundled template`);
				defs.push(def);
			}

			const plans = planAgentGeneration(cwd, defs, [], null);
			writeGeneratedAgents(cwd, plans);
			// Maps each role → `<slug>-<role>` in agents.json, exactly as the
			// real /velpari-generate-sub-agents flow does.
			updateAgentsJson(cwd, plans);

			for (const plan of plans) {
				const filePath = join(cwd, ".pi", "agents", `${plan.agentName}.md`);
				assert.ok(existsSync(filePath), `${filePath} must exist after writeGeneratedAgents`);
				const content = readFileSync(filePath, "utf8");
				// The PH.1 fix: `thinking:` is always emitted.
				assert.match(content, /^thinking:\s*\S+$/m, "generated frontmatter must contain thinking:");
				// The PH.2 fix: the template's session-mode survives verbatim.
				assert.match(
					content,
					/^session-mode:\s*standalone$/m,
					"generated frontmatter must carry the template's session-mode (standalone)",
				);
			}

			// Reviewer's template declares `thinking: high` — proves the value
			// came from the template, not the bare default.
			const reviewerPlan = plans.find((p) => p.role === "reviewer");
			assert.ok(reviewerPlan, "reviewer plan must exist");
			assert.match(reviewerPlan!.content, /^thinking:\s*high$/m, "reviewer template thinking: high must be emitted");

			// The real doctor check over the real file on disk.
			const section = checkScoutAgentsSection(cwd);
			const errors = section.items.filter((item) => item.status === "error");
			assert.equal(errors.length, 0, `no doctor errors expected; got: ${errors.map((e) => e.message).join(" | ")}`);
			const missingFields = section.items.filter((item) => /missing fields/.test(item.message));
			assert.equal(
				missingFields.length,
				0,
				`no 'missing fields' items expected; got: ${missingFields.map((m) => m.message).join(" | ")}`,
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
