/**
 * Doctor: logging-plan section (v1.4.0).
 *
 * Covers:
 *   - Missing plan + overlay 'none' → info (not error).
 *   - Missing plan + overlay financial-payments → error (overlay requires).
 *   - Complete plan + overlay financial-payments → ok.
 *   - Complete plan + wrong frontmatter artifact → error.
 *   - Complete plan + retention shortfall → error.
 *   - Complete plan + missing tamper-evident → error (when overlay requires).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { checkLoggingPlanSection } from "../../src/doctor/checks/logging-plan.js";
import { loadState, saveState, type RunState } from "../../src/core/state.js";

let cwd: string;

function writePublished(projectName: string, content: string): void {
	mkdirSync(join(cwd, "Doc", "observability"), { recursive: true });
	writeFileSync(join(cwd, "Doc", "observability", `logging-plan_${projectName}.md`), content);
}

const completePlan = (overlay?: string) => `---
artifact: logging-plan
project: Demo
version: 1.0.0
status: approved
stage: designed
run: r
created: 2026-09-16T10:00:00Z
updated: 2026-09-16T10:00:00Z
${overlay ? `overlay: ${overlay}\n` : ""}---

## 1. Logging Objectives & Scope

## 2. Compliance Regime Map

## 3. Event Catalog

## 4. Log Shape

## 5. Log Levels

## 6. Transport

## 7. Storage & Retention

| Tier | Retention (months) | Backend | Encryption at rest |
|---|---|---|---|
| hot | 3 | NVMe | yes |
| warm | 12 | S3 | yes |

## 8. Protection

Logs are tamper-evident (append-only WORM storage).

## 9. Clock Synchronization

## 10. Monitoring & Alerting

## 11. Log Review Cadence

## 12. Correlation IDs & Trace Context

## 13. Privacy Considerations

PII redaction is enabled at the source.

## 14. Mapping to Design Crosscuts

## 15. Mapping to Test Plan

## 16. Change Log
`;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "vp-doctor-log-"));
	// Copy the bundled overlays (catalogue + 5 profile.json files) into
	// the test cwd so that loadOverlay() finds them. The doctor check
	// reads `cwd/skills/standards/...`, but the test cwd is a tmp dir.
	// Walk up 4 levels from this file: dist/pi-extension/test/doctor/<file>
	// → dist/pi-extension/test/doctor → dist/pi-extension/test → dist/pi-extension
	// → dist → <project root>.
	const bundledOverlaysDir = resolve(
		join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "skills", "standards"),
	);
	try {
		mkdirSync(join(cwd, "skills", "standards"), { recursive: true });
		cpSync(join(bundledOverlaysDir, "catalogue.json"), join(cwd, "skills", "standards", "catalogue.json"));
		cpSync(join(bundledOverlaysDir, "overlays"), join(cwd, "skills", "standards", "overlays"), {
			recursive: true,
		});
	} catch (err) {
		// If bundled files are missing, the overlay-dependent tests will fail
		// via the loader returning null — surface that explicitly so it's
		// diagnosable rather than a silent skip.
		console.error("[logging-plan test] could not seed bundled overlays:", (err as Error).message);
	}
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

function seedState(overlay: { id: string; version: string; selectedAt: string } | null | undefined): void {
	const state: RunState = {
		version: 1,
		runId: "r",
		mission: "m",
		currentStage: "designed",
		history: [],
		updatedAt: new Date().toISOString(),
		standardsProfile: overlay
			? { id: overlay.id, version: overlay.version, selectedAt: overlay.selectedAt, selectedBy: "user" }
			: undefined,
	};
	saveState(state, cwd);
}

describe("checkLoggingPlanSection", () => {
	it("returns info when no plan and overlay is 'none'", () => {
		seedState({ id: "none", version: "1.0.0", selectedAt: "2026-09-16" });
		const section = checkLoggingPlanSection(cwd, "Demo");
		const head = section.items[0];
		assert.ok(head);
		assert.strictEqual(head!.status, "info");
		assert.ok(head!.message.includes("Logging plan: MISSING"));
	});

	it("returns error when no plan and overlay requires logging", () => {
		seedState({
			id: "financial-payments",
			version: "1.0.0",
			selectedAt: "2026-09-16",
		});
		const section = checkLoggingPlanSection(cwd, "Demo");
		const head = section.items[0];
		assert.ok(head);
		assert.strictEqual(head!.status, "error");
		assert.ok(head!.message.includes("requires it"));
	});

	it("returns ok when a complete plan exists", () => {
		seedState(undefined);
		writePublished("Demo", completePlan());
		const section = checkLoggingPlanSection(cwd, "Demo");
		// First item is the existence confirmation
		const head = section.items[0];
		assert.ok(head);
		assert.strictEqual(head!.status, "ok");
	});

	it("rejects wrong frontmatter artifact", () => {
		seedState(undefined);
		const bad = completePlan().replace("artifact: logging-plan", "artifact: wrong");
		writePublished("Demo", bad);
		const section = checkLoggingPlanSection(cwd, "Demo");
		const item = section.items.find((i) => i.message.includes('Frontmatter artifact must be "logging-plan"'));
		assert.ok(item, "should have wrong-artifact error");
		assert.strictEqual(item!.status, "error");
	});

	it("warns on missing section headings", () => {
		seedState(undefined);
		// Drop §13 Privacy Considerations
		const truncated = completePlan().replace(/## 13\.[\s\S]*?(?=## 14\.)/, "");
		writePublished("Demo", truncated);
		const section = checkLoggingPlanSection(cwd, "Demo");
		const item = section.items.find((i) => i.message.includes("Missing section heading(s)"));
		assert.ok(item, "should have missing-sections warning");
		assert.strictEqual(item!.status, "warning");
	});

	it("errors when retention shortfall vs overlay minimum (financial-payments = 12 mo)", () => {
		seedState({
			id: "financial-payments",
			version: "1.0.0",
			selectedAt: "2026-09-16",
		});
		// Plan has only 6 months (hot=3, warm=3)
		const short = completePlan("financial-payments").replace("| warm | 12 |", "| warm | 3 |");
		writePublished("Demo", short);
		const section = checkLoggingPlanSection(cwd, "Demo");
		const item = section.items.find((i) => i.message.includes("Retention shortfall"));
		assert.ok(item, "should have retention-shortfall error");
		assert.strictEqual(item!.status, "error");
	});

	it("errors when tamper-evident missing and overlay requires it", () => {
		seedState({
			id: "financial-payments",
			version: "1.0.0",
			selectedAt: "2026-09-16",
		});
		// Replace the §8 tamper-evident sentence with text that does NOT
		// contain any of the regex tokens (tamper[- ]evident|append[- ]only|worm|write[- ]once).
		const noTamper = completePlan("financial-payments").replace(
			"Logs are tamper-evident (append-only WORM storage).",
			"Logs are encrypted at rest using AES-256; access is governed by IAM roles.",
		);
		writePublished("Demo", noTamper);
		const section = checkLoggingPlanSection(cwd, "Demo");
		const item = section.items.find((i) => i.message.includes("Tamper-evident storage is required"));
		assert.ok(item, "should have tamper-evident-missing error");
		assert.strictEqual(item!.status, "error");
	});

	it("accepts a plan whose retention exceeds the overlay minimum", () => {
		seedState({
			id: "financial-payments",
			version: "1.0.0",
			selectedAt: "2026-09-16",
		});
		// Plan has 24 months total (warm=21); PCI needs >=12
		const long = completePlan("financial-payments").replace("| warm | 12 |", "| warm | 21 |");
		writePublished("Demo", long);
		const section = checkLoggingPlanSection(cwd, "Demo");
		const item = section.items.find((i) => i.message.includes("Retention 21 months"));
		assert.ok(item, "should have retention-ok item");
		assert.strictEqual(item!.status, "ok");
	});

	it("uses no-overlay state to mean: no retention enforcement", () => {
		// Default state: no standardsProfile
		const state = loadState(cwd);
		if (state.standardsProfile) {
			// Skip — some env might write one; this is a soft assertion.
			return;
		}
		writePublished("Demo", completePlan());
		const section = checkLoggingPlanSection(cwd, "Demo");
		// Without overlay, no retention-shortfall item should appear
		const item = section.items.find((i) => i.message.includes("Retention shortfall"));
		assert.strictEqual(item, undefined);
	});
});
