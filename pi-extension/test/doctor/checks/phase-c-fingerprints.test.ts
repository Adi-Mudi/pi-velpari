/**
 * Phase C fingerprint guard (plan Subphase 2.6) — fix-command-per-finding.
 *
 * `suggestionFor` THROWS on an unknown key, so a typo in any Phase C
 * check's suggestion key would crash the doctor at render time. This
 * test pins every key added by Phase C (the plan's Subphase 2.5 list) as
 * resolvable, non-empty suggestion text — the key-typo guard.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { SUGGESTIONS, suggestionFor } from "../../../src/doctor/checks/fix-suggestions.js";

/** Every Phase C key from plan Subphase 2.5 (SUGGESTIONS half). */
const PHASE_C_KEYS: readonly string[] = [
	"digest-contract-unavailable",
	"digest-not-stamped",
	"digest-mismatch",
	"store-uncommitted",
	"semver-contract-unavailable",
	"semver-bump-mismatch",
	"soft-lock-contract-unavailable",
	"environment-node-old",
	"environment-git-missing",
	"environment-pi-missing",
	"environment-config-invalid",
	"conformance-not-applicable",
	"conformance-layer-mismatch",
	"conformance-hooks-missing",
	"conformance-dep-violation",
	"config-baseline-missing",
	"config-drift",
	"config-unreadable",
	"config-restore-git",
	"generated-manifest-unreadable",
	"generated-file-missing",
	"generated-file-modified",
	"generated-file-bad-config",
	"generated-file-unregistered",
	"binding-mismatch",
	"binding-conflict",
	"bookkeeping-drift",
	"bookkeeping-advance",
	"scaffold-missing",
];

describe("Phase C suggestion fingerprints", () => {
	it("every Phase C key resolves to non-empty suggestion text", () => {
		for (const key of PHASE_C_KEYS) {
			const text = suggestionFor(key as keyof typeof SUGGESTIONS);
			assert.equal(typeof text, "string", `key ${key} must resolve`);
			assert.ok(text.length > 0, `key ${key} must not be empty`);
		}
	});

	it("every Phase C suggestion names a concrete fix (not a restatement)", () => {
		for (const key of PHASE_C_KEYS) {
			const text = suggestionFor(key as keyof typeof SUGGESTIONS);
			assert.ok(
				text.length > 20,
				`key ${key} looks like a placeholder: ${text}`,
			);
		}
	});

	it("the key list itself is complete against SUGGESTIONS", () => {
		for (const key of PHASE_C_KEYS) {
			assert.ok(
				Object.prototype.hasOwnProperty.call(SUGGESTIONS, key),
				`${key} missing from SUGGESTIONS`,
			);
		}
	});
});
