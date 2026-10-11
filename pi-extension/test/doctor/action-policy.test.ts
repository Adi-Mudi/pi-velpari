/**
 * Action-policy tests (Doctor upgrade Phase 2 — T4).
 *
 * Covers `decideAction`: the SAFE_WHITELIST / FIX_LEVELS auto-safe bridge,
 * the taxonomy class defaults (manual / escalate), the agentic bridge,
 * and purity (same input → same output).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { decideAction } from "../../src/doctor/action-policy.js";
import { SUGGESTIONS } from "../../src/doctor/checks/fix-suggestions.js";
import type { DiagnosticItem } from "../../src/doctor/_types.js";

/**
 * Build a minimal actionable item.
 * @param {string} message - Item message.
 * @param {string} [suggestion] - Optional fix suggestion prose.
 * @returns {DiagnosticItem} The sample item.
 */
function item(message: string, suggestion?: string): DiagnosticItem {
	return suggestion === undefined
		? { status: "error", message }
		: { status: "error", message, suggestion };
}

describe("decideAction", () => {
	it("bridges a whitelisted fingerprint to auto-safe, even in an escalating section", () => {
		// `store-db-*` classifies as store-integrity (class default: escalate),
		// but the repair policy wins: config-restore-git is whitelisted.
		assert.equal(
			decideAction("store-db-integrity", item("config unreadable", SUGGESTIONS["config-restore-git"])),
			"auto-safe",
		);
		assert.equal(
			decideAction("unknown-section", item("drift", SUGGESTIONS["working-published-drift"])),
			"auto-safe",
		);
	});

	it("bridges FIX_LEVELS auto-safe fingerprints to auto-safe", () => {
		// git-attr-missing / git-ignore-missing are auto-safe in FIX_LEVELS and
		// healed by the single `git-integration-heal` fn (not whitelisted by
		// their own name).
		assert.equal(
			decideAction("git-integration", item("missing binary attribute", SUGGESTIONS["git-attr-missing"])),
			"auto-safe",
		);
		assert.equal(
			decideAction("git-integration", item("missing ignore pattern", SUGGESTIONS["git-ignore-missing"])),
			"auto-safe",
		);
	});

	it("bridges an agentic fingerprint to agentic", () => {
		assert.equal(
			decideAction("mystery", item("a requirement changed", SUGGESTIONS["fingerprint-suspect"])),
			"agentic",
		);
		assert.equal(decideAction("mystery", item("phase differs", SUGGESTIONS["phase-mismatch"])), "agentic");
	});

	it("falls back to the taxonomy class default when no fingerprint matches", () => {
		// store-integrity → escalate.
		assert.equal(decideAction("store-db-integrity", item("corrupt db")), "escalate");
		// config-broken → manual.
		assert.equal(decideAction("config", item("files.json invalid")), "manual");
		// Unknown → manual (no rule matches).
		assert.equal(decideAction("mystery-section", item("something entirely unrelated")), "manual");
	});

	it("is pure — identical input yields identical output", () => {
		const it1 = item("config unreadable", SUGGESTIONS["config-restore-git"]);
		assert.equal(decideAction("config", it1), decideAction("config", it1));
		assert.equal(decideAction("store-db-integrity", it1), "auto-safe");
	});
});
