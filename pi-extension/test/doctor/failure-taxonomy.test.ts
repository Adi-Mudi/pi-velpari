/**
 * Failure-taxonomy tests (Doctor upgrade Phase 0 — contract C4).
 *
 * Covers:
 *   - `classifyItem` heuristics from the section id (and message fallback).
 *   - `actionForFailure` class defaults + the FIX_LEVELS/SAFE_WHITELIST bridge.
 *   - the `"unknown"` / `"manual"` default.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { classifyItem, actionForFailure } from "../../src/doctor/failure-taxonomy.js";
import { SUGGESTIONS } from "../../src/doctor/checks/fix-suggestions.js";

/**
 * Build a minimal taxonomy item.
 * @param {string} message - Item message.
 * @param {string} [suggestion] - Optional fix suggestion prose.
 * @returns {{ message: string; suggestion?: string }} The sample item.
 */
function item(message: string, suggestion?: string): { message: string; suggestion?: string } {
	return suggestion === undefined ? { message } : { message, suggestion };
}

// ---------------------------------------------------------------------------
// classifyItem
// ---------------------------------------------------------------------------

describe("classifyItem", () => {
	it("classifies config-broken from the config section id", () => {
		assert.equal(classifyItem(item("Config: INVALID"), "config"), "config-broken");
		assert.equal(classifyItem(item(""), "requirements-profile"), "config-broken");
		assert.equal(classifyItem(item(""), "standards-profile-phase-3"), "config-broken");
	});

	it("classifies state-unreadable from the run-state section id", () => {
		assert.equal(classifyItem(item("Run state: UNREADABLE"), "run-state"), "state-unreadable");
	});

	it("classifies store-integrity from store/db section ids", () => {
		assert.equal(classifyItem(item(""), "store-db-integrity"), "store-integrity");
		assert.equal(classifyItem(item(""), "audit-hash-chain-n15"), "store-integrity");
		assert.equal(classifyItem(item(""), "soft-locks-n19"), "store-integrity");
		assert.equal(classifyItem(item(""), "last-verified-backup-n11"), "store-integrity");
	});

	it("classifies lock-stale from lock/worktree section ids", () => {
		assert.equal(classifyItem(item(""), "run-lock-n13"), "lock-stale");
		assert.equal(classifyItem(item(""), "worktree-binding-n17"), "lock-stale");
	});

	it("classifies artifact-stale from staleness/coverage section ids", () => {
		assert.equal(classifyItem(item(""), "freshness-stale-set"), "artifact-stale");
		assert.equal(classifyItem(item(""), "stale-downstream-artifacts"), "artifact-stale");
		assert.equal(classifyItem(item(""), "id-coverage"), "artifact-stale");
	});

	it("classifies fingerprint-drift from frontmatter/sidecar section ids", () => {
		assert.equal(classifyItem(item(""), "artifact-frontmatter"), "fingerprint-drift");
		assert.equal(classifyItem(item(""), "rtm-data-sidecar"), "fingerprint-drift");
		assert.equal(classifyItem(item(""), "working-published-separation"), "fingerprint-drift");
	});

	it("classifies agent-config from agent section ids", () => {
		assert.equal(classifyItem(item(""), "scout-agents-pi-agents"), "agent-config");
		assert.equal(classifyItem(item(""), "generated-agent-freshness"), "agent-config");
		assert.equal(classifyItem(item(""), "stage-skills"), "agent-config");
	});

	it("classifies environment from environment-adjacent section ids", () => {
		assert.equal(classifyItem(item(""), "environment"), "environment");
		assert.equal(classifyItem(item(""), "multiplexer-required-for-velpari-brainstorm-v2-1"), "environment");
		assert.equal(classifyItem(item(""), "pi-extension-conformance"), "environment");
	});

	it("classifies scaffold-missing from setup/path section ids", () => {
		assert.equal(classifyItem(item(""), "setup-progress"), "scaffold-missing");
		assert.equal(classifyItem(item(""), "grouped-legacy-paths"), "scaffold-missing");
	});

	it("falls back to message keywords when the section id is unknown", () => {
		assert.equal(classifyItem(item("Node.js is too old"), "mystery-section"), "environment");
		assert.equal(classifyItem(item("The file is stale"), "mystery-section"), "artifact-stale");
	});

	it("returns unknown when neither the section id nor the message match", () => {
		assert.equal(classifyItem(item("something entirely unrelated"), "mystery-section"), "unknown");
	});
});

// ---------------------------------------------------------------------------
// actionForFailure
// ---------------------------------------------------------------------------

describe("actionForFailure", () => {
	it("defaults to manual when the class has no fingerprint bridge", () => {
		assert.equal(actionForFailure("unknown", item("no fingerprint")), "manual");
		assert.equal(actionForFailure("config-broken", item("no fingerprint")), "manual");
	});

	it("escalates store-integrity failures", () => {
		assert.equal(actionForFailure("store-integrity", item("corrupt db")), "escalate");
	});

	it("bridges whitelisted fingerprints to auto-safe", () => {
		assert.equal(
			actionForFailure("unknown", item("bookkeeping drift", SUGGESTIONS["bookkeeping-advance"])),
			"auto-safe",
		);
		assert.equal(
			actionForFailure("unknown", item("drift", SUGGESTIONS["working-published-drift"])),
			"auto-safe",
		);
	});

	it("bridges agentic fingerprints to agentic", () => {
		assert.equal(
			actionForFailure("unknown", item("changed requirement", SUGGESTIONS["fingerprint-suspect"])),
			"agentic",
		);
	});

	it("ignores unmatched suggestion prose", () => {
		assert.equal(actionForFailure("unknown", item("msg", "not a known suggestion")), "manual");
	});
});
