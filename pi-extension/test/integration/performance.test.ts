/**
 * Integration: Performance baseline (Phase 8, plan §Phase 8).
 *
 * Loose upper bounds on operations that should be cheap. If any of
 * these regress significantly (>2x) the test fails as a regression
 * signal — not a hard SLA.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { loadCatalogue, findOverlay } from "../../src/core/standards-catalogue.js";
import { findPackageRoot } from "../../src/core/paths.js";
import { renderADRSection, parseADRSection } from "../../src/core/adr.js";

const pkgRoot = findPackageRoot(process.cwd());

describe("performance — Phase 8 baseline", () => {
	it("catalogue load < 500ms (10 overlays)", () => {
		const start = Date.now();
		for (let i = 0; i < 100; i++) {
			loadCatalogue(pkgRoot);
		}
		const elapsed = Date.now() - start;
		// 100 loads in <500ms ⇒ each load <5ms (very generous)
		assert.ok(elapsed < 500, `100 catalogue loads took ${elapsed}ms (expected <500ms)`);
	});

	it("findOverlay by id < 50ms (single lookup)", () => {
		const catalogue = loadCatalogue(pkgRoot);
		assert.ok(catalogue);
		const start = Date.now();
		for (let i = 0; i < 1000; i++) {
			findOverlay(catalogue!, "medical-device-b");
		}
		const elapsed = Date.now() - start;
		// 1000 lookups in <50ms ⇒ each <0.05ms
		assert.ok(elapsed < 50, `1000 findOverlay calls took ${elapsed}ms (expected <50ms)`);
	});

	it("ADR parse + render round-trip < 100ms for a 10-ADR document", () => {
		const adrs = Array.from({ length: 10 }, (_, i) => ({
			id: `ADR-${String(i + 1).padStart(3, "0")}`,
			title: `Decision ${i + 1}`,
			status: "accepted" as const,
			stage: "design",
			date: "2026-09-13T00:00:00.000Z",
			runId: "r",
			context: `Context for decision ${i + 1}.`,
			options: [
				{ id: "A", label: "Option A", pros: "Pro", cons: "Con" },
				{ id: "B", label: "Option B", pros: "Pro", cons: "Con" },
			],
			decision: "A",
			rationale: "Rationale.",
			consequences: "Consequences.",
			reconsiderTriggers: ["Trigger"],
		}));
		const start = Date.now();
		for (let i = 0; i < 100; i++) {
			const section = renderADRSection(adrs);
			parseADRSection(`# D\n\n${section}\n`);
		}
		const elapsed = Date.now() - start;
		assert.ok(elapsed < 500, `100 round-trips took ${elapsed}ms (expected <500ms)`);
	});
});
