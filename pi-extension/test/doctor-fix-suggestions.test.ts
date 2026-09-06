/**
 * doctor/checks/fix-suggestions tests (Phase 3).
 *
 * Locks the contract for the centralized suggestion table:
 *   - Every fingerprint has a non-empty suggestion string.
 *   - suggestionFor() returns the table value for known keys.
 *   - suggestionFor() throws for unknown keys (typo guard).
 *   - The rendered report includes `→ Fix:` lines for actionable items.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SUGGESTIONS,
	suggestionFor,
	type SuggestionKey,
} from "../src/discipline/doctor/checks/fix-suggestions.js";
import { formatDiagnosticReport, runDoctor } from "../src/discipline/doctor/index.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-suggest-"));
}

test("SUGGESTIONS has no empty entries", () => {
	for (const [key, value] of Object.entries(SUGGESTIONS)) {
		assert.ok(
			typeof value === "string" && value.length > 0,
			`suggestion for "${key}" must be a non-empty string`,
		);
	}
});

test("suggestionFor returns the table value for every key", () => {
	for (const key of Object.keys(SUGGESTIONS) as SuggestionKey[]) {
		const value = suggestionFor(key);
		assert.equal(value, SUGGESTIONS[key]);
	}
});

test("suggestionFor throws for unknown fingerprints", () => {
	assert.throws(
		() => suggestionFor("not-a-real-fingerprint" as SuggestionKey),
		/Unknown suggestion fingerprint/,
	);
});

test("every known check fingerprint maps to a non-empty suggestion", () => {
	// Spot-check that the fingerprints referenced by checks exist in
	// the table. Adding a new check that uses suggestionFor("foo")
	// without adding "foo" to SUGGESTIONS fails the type system; this
	// test just guards against runtime drift.
	const referenced: SuggestionKey[] = [
		"no-active-run",
		"config-missing",
		"config-invalid",
		"profile-missing",
		"doc-dir-missing",
		"project-name-missing",
		"artifact-missing",
		"artifact-legacy-only",
		"psrs-missing",
		"psrs-legacy-only",
		"rtm-missing",
		"rtm-unknown-id",
		"unknown-multiplexer",
		"subagent-ext-missing",
		"scout-agent-missing",
		"scout-agent-bad-frontmatter",
		"skill-missing",
		"skill-bad-contract",
		"secret-detected",
		"setup-files",
		"setup-discuss",
		"setup-prd",
		"setup-rtm",
		"setup-profile",
		"setup-approve",
	];
	for (const key of referenced) {
		assert.ok(SUGGESTIONS[key], `expected SUGGESTIONS to define "${key}"`);
	}
});

test("rendered report includes → Fix: lines for actionable items", () => {
	const dir = tempDir();
	try {
		const report = runDoctor(dir);
		const text = formatDiagnosticReport(report);
		// On a fresh tmpdir with no state.json + no files.json + no agents,
		// at least these sections emit actionable items with suggestions.
		assert.match(text, /→ Fix:/, "rendered report must include at least one → Fix: line");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("rendered report renders the suggestion verbatim after → Fix:", () => {
	const dir = tempDir();
	try {
		// Stage a minimal files.json so step 1 is ok and step 2 is pending.
		mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			join(dir, ".pi", "velpari", "files.json"),
			JSON.stringify({
				version: 3,
				projectName: "Demo",
				framework: {},
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			}),
			"utf8",
		);
		const report = runDoctor(dir);
		const text = formatDiagnosticReport(report);
		// Setup-progress step 2 should suggest running /velpari-discuss.
		assert.match(text, new RegExp(`→ Fix: ${escapeRegExp(suggestionFor("setup-discuss"))}`));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
