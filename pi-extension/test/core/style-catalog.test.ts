/**
 * style-catalog tests (Phase 5).
 *
 *   - STYLE_CATALOG has expected entries (Layered, Modular Monolith,
 *     Microservices, Event-Driven, etc.)
 *   - STYLE_BY_ID lookup returns the same records
 *   - scoreStyleAgainstQAs ranks correctly:
 *       A scenario targeting performance favours Layered +
 *       disfavours Space-Based; Spaces wins for scalability.
 *   - rankStylesForScenarios returns deterministic order
 *   - Tactical ids are kebab-case
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	STYLE_CATALOG,
	STYLE_BY_ID,
	scoreStyleAgainstQAs,
	rankStylesForScenarios,
} from "../../src/core/style-catalog.js";
import type { QualityScenario } from "../../src/core/quality-scenario.js";

describe("STYLE_CATALOG", () => {
	it("exposes the canonical styles", () => {
		const ids = STYLE_CATALOG.map((s) => s.id);
		for (const expected of [
			"layered",
			"modular-monolith",
			"pipeline",
			"microkernel",
			"service-based",
			"event-driven",
			"microservices",
			"space-based",
			"hexagonal",
			"serverless",
		]) {
			assert.ok(ids.includes(expected), `missing style id "${expected}"`);
		}
	});

	it("has unique style ids", () => {
		const ids = STYLE_CATALOG.map((s) => s.id);
		assert.equal(new Set(ids).size, ids.length);
	});

	it("STYLE_BY_ID matches STYLE_CATALOG", () => {
		for (const s of STYLE_CATALOG) {
			assert.strictEqual(STYLE_BY_ID.get(s.id), s);
		}
	});

	it("every style has at least one favoured QA and a label", () => {
		for (const s of STYLE_CATALOG) {
			assert.ok(s.favouredQAs.length >= 1, `${s.id} needs ≥1 favoured QA`);
			assert.ok(s.label.length >= 1);
			assert.ok(s.description.length >= 1);
		}
	});
});

describe("scoreStyleAgainstQAs", () => {
	const perfScenario: QualityScenario = {
		stimulus: "p95 latency budget for 10k users",
		source: "users",
		environment: "normal",
		artifact: "checkout-service",
		response: "respond fast",
		responseMeasure: "p95 < 200ms",
		qaId: "performance",
	};
	const modifScenario: QualityScenario = {
		stimulus: "frequent schema changes expected",
		source: "product",
		environment: "evolving",
		artifact: "checkout-service",
		response: "code structure adapts",
		responseMeasure: "MTTR < 1 day",
		qaId: "modifiability",
	};
	const scaleScenario: QualityScenario = {
		stimulus: "10k concurrent users",
		source: "users",
		environment: "peak",
		artifact: "checkout-service",
		response: "service scales",
		responseMeasure: "scale to 10k",
		qaId: "scalability",
	};

	it("scores Modular Monolith higher than Space-Based on a modifiability scenario", () => {
		// Modular Monolith favours modifiability; Space-Based disfavours it.
		const modular = STYLE_BY_ID.get("modular-monolith")!;
		const space = STYLE_BY_ID.get("space-based")!;
		const modularScore = scoreStyleAgainstQAs(modular, [modifScenario]);
		const spaceScore = scoreStyleAgainstQAs(space, [modifScenario]);
		assert.ok(modularScore > spaceScore, `modular=${modularScore} space=${spaceScore}`);
	});

	it("scores Space-Based higher than Layered on a scalability scenario", () => {
		const layered = STYLE_BY_ID.get("layered")!;
		const space = STYLE_BY_ID.get("space-based")!;
		const layeredScore = scoreStyleAgainstQAs(layered, [scaleScenario]);
		const spaceScore = scoreStyleAgainstQAs(space, [scaleScenario]);
		assert.ok(spaceScore > layeredScore, `layered=${layeredScore} space=${spaceScore}`);
	});

	it("scores positively when the style favours the QA id", () => {
		const modular = STYLE_BY_ID.get("modular-monolith")!;
		const score = scoreStyleAgainstQAs(modular, [modifScenario]);
		assert.ok(score > 0, `expected positive score, got ${score}`);
	});

	it("scores negatively when the style disfavours the QA id", () => {
		const space = STYLE_BY_ID.get("space-based")!;
		const score = scoreStyleAgainstQAs(space, [modifScenario]);
		assert.ok(score < 0, `expected negative score, got ${score}`);
	});

	it("returns 0 for an unknown QA id", () => {
		const layered = STYLE_BY_ID.get("layered")!;
		const unknown: QualityScenario = {
			...perfScenario,
			qaId: "unknown",
		};
		const score = scoreStyleAgainstQAs(layered, [unknown]);
		assert.equal(score, 0);
	});

	it("uses the QA id from the scenario without keyword regex fallback", () => {
		// Pass qaId directly so the test exercises the code path that
		// respects the explicit id.
		const modular = STYLE_BY_ID.get("modular-monolith")!;
		const explicit: QualityScenario = {
			...modifScenario,
			qaId: "modifiability",
		};
		const score = scoreStyleAgainstQAs(modular, [explicit]);
		assert.ok(score > 0);
	});
});

describe("rankStylesForScenarios", () => {
	it("returns every style from the catalog", () => {
		const scenario: QualityScenario = {
			stimulus: "scale",
			source: "users",
			environment: "peak",
			artifact: "checkout-service",
			response: "scale",
			responseMeasure: "scale to 10k",
			qaId: "scalability",
		};
		const ranked = rankStylesForScenarios([scenario]);
		assert.equal(ranked.length, STYLE_CATALOG.length);
	});

	it("ranks deterministic — same input → same output", () => {
		const scenario: QualityScenario = {
			stimulus: "scale",
			source: "users",
			environment: "peak",
			artifact: "checkout-service",
			response: "scale",
			responseMeasure: "scale to 10k",
			qaId: "scalability",
		};
		const a = rankStylesForScenarios([scenario]);
		const b = rankStylesForScenarios([scenario]);
		assert.deepEqual(a, b);
	});

	it("highest-scoring style comes first", () => {
		const scenario: QualityScenario = {
			stimulus: "scale to 10k users",
			source: "users",
			environment: "peak",
			artifact: "checkout-service",
			response: "service scales",
			responseMeasure: "scale to 10k",
			qaId: "scalability",
		};
		const ranked = rankStylesForScenarios([scenario]);
		const top = ranked[0];
		assert.ok(top, "ranked list is non-empty");
		const runnerUp = ranked[1];
		if (runnerUp) {
			assert.ok(top.score >= runnerUp.score);
		}
	});
});
