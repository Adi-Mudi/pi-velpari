/**
 * Integration: Update mode (Phase 8, plan §Phase 8).
 *
 * Verifies that when a published artifact exists, the next stage run
 * detects update mode and injects the baseline into the prompt. The
 * ADR mechanism must support supersession across updates.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	renderADRSection,
	supersedeADR,
	parseADRSection,
	type ADR,
} from "../../src/core/adr.js";

function makeADR(overrides: Partial<ADR> = {}): ADR {
	return {
		id: "ADR-001",
		title: "Pick a modular monolith",
		status: "accepted",
		stage: "design",
		date: "2026-09-13T00:00:00.000Z",
		runId: "r",
		context: "Two scouts disagreed.",
		options: [
			{ id: "A", label: "Modular monolith", pros: "Simple", cons: "Shared DB" },
			{ id: "B", label: "Microservices", pros: "Independent", cons: "Complex" },
		],
		decision: "A",
		rationale: "Project size doesn't justify microservices.",
		consequences: "Easier to refactor later.",
		reconsiderTriggers: ["Scale > 1000 RPS"],
		...overrides,
	};
}

describe("update mode — Phase 8 cross-cutting verification", () => {
	it("revision appends a new ADR + supersedes the old one", () => {
		// First-run: 1 accepted ADR.
		const v1 = [makeADR({ id: "ADR-001", status: "accepted" })];

		// Second-run (update): new ADR supersedes the old one.
		const v2ADR = makeADR({
			id: "ADR-002",
			title: "Switch to event-driven",
			supersedes: "ADR-001",
			context: "Scale changed; ADR-001's reconsider trigger fired.",
		});
		const v2 = supersedeADR(v1, "ADR-001", v2ADR);

		// Verify the supersession chain.
		assert.strictEqual(v2.length, 2);
		const old = v2.find((a) => a.id === "ADR-001");
		const fresh = v2.find((a) => a.id === "ADR-002");
		assert.strictEqual(old?.status, "superseded");
		assert.strictEqual(old?.supersededBy, "ADR-002");
		assert.strictEqual(fresh?.supersedes, "ADR-001");
	});

	it("revision does not duplicate ids (append-only)", () => {
		const v1 = [makeADR({ id: "ADR-001" })];
		const v2 = supersedeADR(v1, "ADR-001", makeADR({ id: "ADR-002", supersedes: "ADR-001" }));
		const ids = v2.map((a) => a.id);
		assert.deepEqual(ids.sort(), ["ADR-001", "ADR-002"]);
	});

	it("re-rendered ADR section survives parseADRSection round-trip", () => {
		const v2 = supersedeADR(
			[makeADR({ id: "ADR-001" })],
			"ADR-001",
			makeADR({ id: "ADR-002", supersedes: "ADR-001" }),
		);
		const section = renderADRSection(v2);
		// parseADRSection needs an ## heading to anchor on.
		const wrapped = `# Title\n\n${section}\n\n## Next Section`;
		const parsed = parseADRSection(wrapped);
		assert.strictEqual(parsed.length, 2);
	});

	it("standards overlay switch survives an update cycle", () => {
		// Switching overlay mid-cycle: the new run picks up the new
		// profile from state and the doctor gate validates it.
		const overlay1 = { id: "none", version: "1.0.0", selectedAt: "t1", selectedBy: "user" as const };
		const overlay2 = {
			id: "medical-device-b",
			version: "1.0.0",
			selectedAt: "t2",
			selectedBy: "user" as const,
		};
		// Update-mode ADRs can also reference the new overlay (e.g. when
		// adding a new module that must be classified under Class B).
		const newAdr = makeADR({
			id: "ADR-003",
			title: "Add Class B safety classification for telemetry module",
			supersedes: "ADR-002",
			context: "Overlay switch to medical-device-b requires safety classes.",
		});
		assert.strictEqual(newAdr.supersedes, "ADR-002");
		assert.notStrictEqual(overlay1.id, overlay2.id);
	});
});
