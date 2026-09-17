/**
 * adr.ts tests (Phase 4).
 *
 * Covers:
 *   - parseADRSection returns [] when section absent
 *   - parseADRSection extracts valid ADR blocks
 *   - parseADRSection skips malformed blocks
 *   - renderADR + renderADRSection produce expected shape
 *   - validateADR catches missing fields
 *   - validateADR catches bad id pattern
 *   - validateADR catches bad status
 *   - validateADR accepts a valid ADR
 *   - supersedeADR flips old status and appends new
 *   - supersedeADR throws on bad supersedes pointer
 *   - supersedeADR throws on invalid new ADR
 *   - findOrphanADRs detects missing supersedes/supersededBy counterparts
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	parseADRSection,
	renderADR,
	renderADRSection,
	validateADR,
	validateFirstADR,
	supersedeADR,
	findOrphanADRs,
	type ADR,
} from "../../src/core/adr.js";

function makeADR(overrides: Partial<ADR> = {}): ADR {
	return {
		id: "ADR-001",
		title: "Pick a modular monolith",
		status: "proposed",
		stage: "design",
		date: "2026-09-13T00:00:00.000Z",
		runId: "run-1",
		context: "Two scouts disagreed on architecture shape.",
		options: [
			{ id: "A", label: "Modular monolith", pros: "Simple deploy", cons: "Shared DB", score: "8/10" },
			{ id: "B", label: "Microservices", pros: "Independent deploys", cons: "Network complexity", score: "6/10" },
		],
		decision: "A",
		rationale: "Project size doesn't justify microservices complexity.",
		consequences: "Easier to refactor later if scale demands.",
		reconsiderTriggers: ["Sustained > 1000 RPS", "Team size > 20 engineers"],
		...overrides,
	};
}

describe("parseADRSection", () => {
	it("returns [] when the section is absent", () => {
		assert.deepEqual(parseADRSection("# Title\n\n## Body\n"), []);
	});

	it("extracts a valid ADR block", () => {
		const adr = makeADR();
		const section = renderADRSection([adr]);
		const parsed = parseADRSection(`# Title\n\n${section}\n`);
		assert.strictEqual(parsed.length, 1);
		assert.strictEqual(parsed[0]?.id, "ADR-001");
		assert.strictEqual(parsed[0]?.decision, "A");
	});

	it("skips malformed blocks", () => {
		const goodAdr = makeADR();
		const bad = "```yaml\n{not-json\n```\n";
		const good = renderADR(goodAdr);
		const md = `# Title\n\n## Architecture Decisions\n\n${bad}${good}\n`;
		const parsed = parseADRSection(md);
		assert.strictEqual(parsed.length, 1, "only the good block parses");
	});
});

describe("renderADR + renderADRSection", () => {
	it("renderADR includes a summary line and a YAML block", () => {
		const adr = makeADR();
		const out = renderADR(adr);
		assert.match(out, /^- ADR-001: Pick a modular monolith \|/m);
		assert.match(out, /```yaml/);
		assert.match(out, /```$/m);
	});

	it("renderADRSection returns empty string when no ADRs", () => {
		assert.strictEqual(renderADRSection([]), "");
	});

	it("renderADRSection includes every ADR", () => {
		const a = makeADR({ id: "ADR-001", title: "First" });
		const b = makeADR({ id: "ADR-002", title: "Second" });
		const out = renderADRSection([a, b]);
		assert.match(out, /## Architecture Decisions/);
		assert.match(out, /ADR-001/);
		assert.match(out, /ADR-002/);
	});
});

describe("validateADR", () => {
	it("accepts a valid ADR", () => {
		assert.deepEqual(validateADR(makeADR()), []);
	});

	it("flags missing fields", () => {
		const adr = makeADR();
		const broken = { ...adr, title: undefined } as unknown as Partial<ADR>;
		const issues = validateADR(broken);
		assert.ok(issues.some((i) => i.includes("title")));
	});

	it("flags bad id pattern", () => {
		const adr = makeADR({ id: "ad-hoc" });
		const issues = validateADR(adr);
		assert.ok(issues.some((i) => i.includes("ADR-<digits>")));
	});

	it("flags bad status", () => {
		const adr = makeADR({ status: "weird" as unknown as ADR["status"] });
		const issues = validateADR(adr);
		assert.ok(issues.some((i) => i.includes("status")));
	});

	it("flags options missing id or label", () => {
		const adr = makeADR({ options: [{ id: "", label: "x", pros: "", cons: "" }] });
		const issues = validateADR(adr);
		assert.ok(issues.some((i) => i.includes("option")));
	});
});

describe("supersedeADR", () => {
	it("flips the old ADR to superseded and appends the new one", () => {
		const old = makeADR({ id: "ADR-001", status: "accepted" });
		const fresh = makeADR({ id: "ADR-002", status: "accepted", supersedes: "ADR-001" });
		const next = supersedeADR([old], "ADR-001", fresh);
		const oldNow = next.find((a) => a.id === "ADR-001");
		const newOne = next.find((a) => a.id === "ADR-002");
		assert.strictEqual(oldNow?.status, "superseded");
		assert.strictEqual(oldNow?.supersededBy, "ADR-002");
		assert.ok(newOne);
		assert.strictEqual(next.length, 2);
	});

	it("throws when the new ADR does not declare supersedes correctly", () => {
		const old = makeADR({ id: "ADR-001", status: "accepted" });
		const fresh = makeADR({ id: "ADR-002", status: "accepted" }); // no supersedes
		assert.throws(() => supersedeADR([old], "ADR-001", fresh), /supersedes/);
	});

	it("throws when the new ADR is invalid", () => {
		const old = makeADR({ id: "ADR-001", status: "accepted" });
		const fresh = { ...makeADR({ id: "ADR-002", supersedes: "ADR-001" }), title: undefined } as unknown as ADR;
		assert.throws(() => supersedeADR([old], "ADR-001", fresh), /invalid/);
	});

	it("throws when the old ADR id is not present", () => {
		const fresh = makeADR({ id: "ADR-002", supersedes: "ADR-001" });
		assert.throws(() => supersedeADR([], "ADR-001", fresh), /not found/);
	});
});

describe("findOrphanADRs", () => {
	it("returns empty when all supersedes/supersededBy resolve", () => {
		const old = makeADR({ id: "ADR-001", status: "superseded", supersededBy: "ADR-002" });
		const fresh = makeADR({ id: "ADR-002", status: "accepted", supersedes: "ADR-001" });
		assert.deepEqual(findOrphanADRs([old, fresh]), []);
	});

	it("flags an ADR whose supersedes points to a missing id", () => {
		const fresh = makeADR({ id: "ADR-002", status: "accepted", supersedes: "ADR-999" });
		const orphans = findOrphanADRs([fresh]);
		assert.strictEqual(orphans.length, 1);
		assert.strictEqual(orphans[0]?.id, "ADR-002");
	});

	it("flags an ADR whose supersededBy points to a missing id", () => {
		const old = makeADR({ id: "ADR-001", status: "superseded", supersededBy: "ADR-999" });
		const orphans = findOrphanADRs([old]);
		assert.strictEqual(orphans.length, 1);
		assert.strictEqual(orphans[0]?.id, "ADR-001");
	});
});

describe("validateFirstADR", () => {
	it("flags empty ADR list", () => {
		const issues = validateFirstADR([]);
		assert.strictEqual(issues.length, 1);
		assert.match(issues[0] ?? "", /at least one ADR/i);
	});

	it("passes when ADR-001 is accepted with ≥2 options and stage 'design'", () => {
		const first = makeADR({ id: "ADR-001", status: "accepted" });
		// ensure 2 options
		first.options = [
			{ id: "A", label: "Layered", pros: "Simple", cons: "Hard to scale", score: "8/10" },
			{ id: "B", label: "Microservices", pros: "Independent", cons: "Complex", score: "6/10" },
		];
		const issues = validateFirstADR([first]);
		assert.deepEqual(issues, [], JSON.stringify(issues));
	});

	it("passes when the first *active* ADR is ADR-007 (post-supersession)", () => {
		// First ADR is superseded → skip. Next active is ADR-007 — the live one.
		const old = makeADR({ id: "ADR-001", status: "superseded", supersededBy: "ADR-007" });
		const fresh = makeADR({ id: "ADR-007", status: "accepted", stage: "design", supersedes: "ADR-001" });
		const issues = validateFirstADR([old, fresh]);
		assert.deepEqual(issues, [], JSON.stringify(issues));
	});

	it("flags first active ADR when status is not 'accepted'", () => {
		const adr = makeADR({ status: "proposed" });
		adr.options = [
			{ id: "A", label: "X", pros: "", cons: "" },
			{ id: "B", label: "Y", pros: "", cons: "" },
		];
		const issues = validateFirstADR([adr]);
		assert.ok(issues.some((i) => /accepted/.test(i)), JSON.stringify(issues));
	});

	it("flags first ADR with fewer than 2 options (rubber-stamp)", () => {
		const adr = makeADR({});
		adr.options = [
			{ id: "A", label: "Only choice", pros: "", cons: "" },
		];
		const issues = validateFirstADR([adr]);
		assert.ok(issues.some((i) => /rubber-stamp/.test(i) || /2 options/.test(i)), JSON.stringify(issues));
	});

	it("flags first ADR with wrong stage", () => {
		const adr = makeADR({ stage: "implementation" });
		adr.options = [
			{ id: "A", label: "X", pros: "", cons: "" },
			{ id: "B", label: "Y", pros: "", cons: "" },
		];
		const issues = validateFirstADR([adr]);
		assert.ok(issues.some((i) => /stage/.test(i)), JSON.stringify(issues));
	});
});
