/**
 * Fix-brief emitter tests (Phase 3 / Level C).
 *
 * Covers:
 *   - `findFingerprintFromSuggestion` — exact-match reverse lookup.
 *   - `buildFixBrief` — returns a brief for agentic items, null for
 *     interactive / auto-safe / unmatched items.
 *   - `renderFixBrief` — output includes every key field.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildFixBrief, findFingerprintFromSuggestion, renderFixBrief } from "../../src/doctor/fix-brief.js";
import type { ActionableItem } from "../../src/doctor/fix-dispatch.js";

function item(suggestion: string): ActionableItem {
	return {
		index: 0,
		section: "Test section",
		status: "error",
		message: "Test message",
		suggestion,
		level: "agentic",
	};
}

const FINGERPRINT_SUSPECT_SUGGESTION =
	"A requirement changed after the RTM linked to it. Re-run `/velpari-rtm` in update mode to review the design/test links, then `/velpari-atomic-function-approve`.";

const PHASE_MISMATCH_SUGGESTION =
	"The RTM row phase differs from the PRD Phase column for the same id. Re-run `/velpari-rtm` in update mode and copy the phase from the PRD (1 = MVP), then `/velpari-testplan-approve`.";

const MVP_INCOMPLETE_SUGGESTION =
	"Phase-1 (MVP) requirements are not fully covered. Re-run `/velpari-rtm` in update mode to add the missing rows/test links, then `/velpari-development-order-approve`.";

const RTM_UNKNOWN_ID_SUGGESTION =
	"Either add the missing ids to the PSRS or remove them from the RTM. Traceability is bidirectional.";

const PSRS_MISSING_SUGGESTION = "Run `/velpari-brainstorm` first, then `/velpari-prd`.";

const FRONTMATTER_MISSING_SUGGESTION =
	"Republish the artifact: re-run its stage command, then `/velpari-rtm-approve` — frontmatter is auto-injected at publish time.";

// ---------------------------------------------------------------------------
// findFingerprintFromSuggestion
// ---------------------------------------------------------------------------

describe("findFingerprintFromSuggestion", () => {
	it("returns the matching key for an exact suggestion text match", () => {
		assert.equal(findFingerprintFromSuggestion(FINGERPRINT_SUSPECT_SUGGESTION), "fingerprint-suspect");
		assert.equal(findFingerprintFromSuggestion(PHASE_MISMATCH_SUGGESTION), "phase-mismatch");
		assert.equal(findFingerprintFromSuggestion(MVP_INCOMPLETE_SUGGESTION), "mvp-incomplete");
		assert.equal(findFingerprintFromSuggestion(RTM_UNKNOWN_ID_SUGGESTION), "rtm-unknown-id");
	});

	it("returns undefined for unknown text", () => {
		assert.equal(findFingerprintFromSuggestion("completely made-up suggestion"), undefined);
	});

	it("returns undefined for an empty string", () => {
		assert.equal(findFingerprintFromSuggestion(""), undefined);
	});
});

// ---------------------------------------------------------------------------
// buildFixBrief
// ---------------------------------------------------------------------------

describe("buildFixBrief", () => {
	it("returns a structured brief for an agentic fingerprint (fingerprint-suspect)", () => {
		const brief = buildFixBrief(item(FINGERPRINT_SUSPECT_SUGGESTION));
		assert.ok(brief, "expected a brief");
		assert.equal(brief?.fingerprint, "fingerprint-suspect");
		assert.equal(brief?.diagnosis, "Test message");
		assert.equal(brief?.suggestedCommand, "/velpari-rtm");
		assert.match(brief?.successCriterion ?? "", /fingerprint-suspect/);
		assert.match(brief?.contextBlock ?? "", /Test section/);
	});

	it("returns /velpari-prd for rtm-unknown-id (suggested command table)", () => {
		const brief = buildFixBrief(item(RTM_UNKNOWN_ID_SUGGESTION));
		assert.ok(brief);
		assert.equal(brief?.suggestedCommand, "/velpari-prd");
	});

	it("returns null for an interactive-fingerprint item", () => {
		// psrs-missing is interactive (default level).
		const brief = buildFixBrief(item(PSRS_MISSING_SUGGESTION));
		assert.equal(brief, null);
	});

	it("returns null for an auto-safe fingerprint item", () => {
		// frontmatter-missing is auto-safe (Phase 2 handled it).
		const brief = buildFixBrief(item(FRONTMATTER_MISSING_SUGGESTION));
		assert.equal(brief, null);
	});

	it("returns null when the suggestion text doesn't map to any fingerprint", () => {
		const brief = buildFixBrief(item("the developer should do X"));
		assert.equal(brief, null);
	});

	it("returns null for an empty suggestion", () => {
		const brief = buildFixBrief(item(""));
		assert.equal(brief, null);
	});
});

// ---------------------------------------------------------------------------
// renderFixBrief
// ---------------------------------------------------------------------------

describe("renderFixBrief", () => {
	it("includes every key field from a brief", () => {
		const brief = buildFixBrief(item(PHASE_MISMATCH_SUGGESTION));
		assert.ok(brief);
		const text = renderFixBrief(brief);
		assert.match(text, /Doctor Agentic Fix Brief/);
		assert.match(text, /Fingerprint.*phase-mismatch/);
		assert.match(text, /Suggested Command.*\/velpari-rtm/);
		assert.match(text, /Diagnosis.*Test message/);
		assert.match(text, /Context/);
		assert.match(text, /Success Criterion/);
	});

	it("renders the context block inside a fenced code block", () => {
		const brief = buildFixBrief(item(MVP_INCOMPLETE_SUGGESTION));
		assert.ok(brief);
		const text = renderFixBrief(brief);
		// fenced by ``` ... ```
		assert.match(text, /```[\s\S]*```/);
	});
});
