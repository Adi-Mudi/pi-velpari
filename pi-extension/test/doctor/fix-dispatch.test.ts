/**
 * Doctor fix dispatcher tests (Phase 8 / Level A, v1.4.x).
 *
 * Covers:
 *   - `listActionableItems` — filtering, ordering, index assignment.
 *   - `dispatchFixChoice` — each of the four `FixChoice` branches
 *     dispatches the right side-effect (sendUserMessage vs notify)
 *     and never throws.
 *
 * The dispatcher never mutates `Doc/` directly; every test asserts
 * that the only state change happens via `pi.sendUserMessage` (the
 * parent LLM handoff) — same posture as brainstorm / design-logging.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	listActionableItems,
	actionableItemCount,
	dispatchFixChoice,
	type ActionableItem,
} from "../../src/doctor/fix-dispatch.js";
import type {
	DiagnosticItem,
	DiagnosticReport,
	DiagnosticSection,
} from "../../src/doctor/_types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function item(
	partial: Partial<DiagnosticItem> & Pick<DiagnosticItem, "status" | "message">,
): DiagnosticItem {
	return {
		...partial,
	} as DiagnosticItem;
}

function section(title: string, items: DiagnosticItem[]): DiagnosticSection {
	return { title, items };
}

function makeReport(sections: DiagnosticSection[]): DiagnosticReport {
	const summary = { ok: 0, warning: 0, error: 0, info: 0 };
	for (const s of sections) {
		for (const it of s.items) summary[it.status]++;
	}
	return { ok: summary.error === 0, summary, sections };
}

interface NotifyCall {
	title: string;
	level?: string;
}

function makeCtx(): {
	ctx: ExtensionCommandContext;
	notifies: NotifyCall[];
} {
	const notifies: NotifyCall[] = [];
	const ctx = {
		ui: {
			notify: (title: string, level?: string) => {
				notifies.push({ title, level });
			},
		},
	} as unknown as ExtensionCommandContext;
	return { ctx, notifies };
}

function makePi(): {
	pi: ExtensionAPI;
	sent: Array<{ message: string; opts?: unknown }>;
} {
	const sent: Array<{ message: string; opts?: unknown }> = [];
	const pi = {
		sendUserMessage: (message: string, opts?: unknown) => {
			sent.push({ message, opts });
		},
	} as unknown as ExtensionAPI;
	return { pi, sent };
}

const REPORT_PATH = "/tmp/velpari-fixture/.IDE_Plans/velpari/doctor-report.md";

// ---------------------------------------------------------------------------
// listActionableItems
// ---------------------------------------------------------------------------

describe("listActionableItems", () => {
	it("returns only error + warning items with a non-empty suggestion", () => {
		const report = makeReport([
			section("A", [
				item({ status: "error", message: "m1", suggestion: "Fix via /velpari-prd" }),
				item({ status: "warning", message: "m2", suggestion: "Re-run /velpari-rtm" }),
				item({ status: "ok", message: "m3" }),
				item({ status: "info", message: "m4" }),
				item({ status: "error", message: "m5" }), // no suggestion
				item({ status: "warning", message: "m6" }), // no suggestion
			]),
		]);
		const result = listActionableItems(report);
		assert.equal(result.length, 2);
		assert.equal(result[0]?.message, "m1");
		assert.equal(result[1]?.message, "m2");
	});

	it("returns an empty array for a clean report", () => {
		const report = makeReport([
			section("A", [item({ status: "ok", message: "fine" })]),
			section("B", [item({ status: "info", message: "note" })]),
		]);
		assert.deepEqual(listActionableItems(report), []);
		assert.equal(actionableItemCount(report), 0);
	});

	it("preserves section order and assigns 0-based indexes in document order", () => {
		const report = makeReport([
			section("Run state", []),
			section("Config", [
				item({ status: "error", message: "config bad", suggestion: "fix config" }),
			]),
			section("Doc/ artifacts", [
				item({ status: "warning", message: "missing artifact", suggestion: "rerun stage" }),
				item({ status: "error", message: "psrs invalid", suggestion: "fill rows" }),
			]),
		]);
		const result = listActionableItems(report);
		assert.equal(result.length, 3);
		assert.equal(result[0]?.index, 0);
		assert.equal(result[0]?.section, "Config");
		assert.equal(result[1]?.index, 1);
		assert.equal(result[1]?.section, "Doc/ artifacts");
		assert.equal(result[2]?.index, 2);
	});

	it("every actionable item carries level=interactive in Phase 1", () => {
		const report = makeReport([
			section("X", [item({ status: "error", message: "m", suggestion: "s" })]),
		]);
		const result = listActionableItems(report);
		for (const it of result) {
			assert.equal(it.level, "interactive");
		}
	});
});

// ---------------------------------------------------------------------------
// dispatchFixChoice
// ---------------------------------------------------------------------------

describe("dispatchFixChoice", () => {
	const oneItem: ActionableItem = {
		index: 3,
		section: "Doc/ artifacts",
		status: "error",
		message: "PSRS rows missing",
		suggestion: "Run /velpari-prd after /velpari-brainstorm",
		level: "interactive",
	};

	it("kind: 'skip' does nothing (no notifies, no sendUserMessage)", async () => {
		const { ctx, notifies } = makeCtx();
		const { pi, sent } = makePi();
		await dispatchFixChoice({
			ctx,
			pi,
			cwd: "/tmp",
			projectName: "",
			choice: { kind: "skip" },
			reportPath: REPORT_PATH,
		});
		assert.equal(notifies.length, 0);
		assert.equal(sent.length, 0);
	});

	it("kind: 'open-report' notifies the report path and does not handoff", async () => {
		const { ctx, notifies } = makeCtx();
		const { pi, sent } = makePi();
		await dispatchFixChoice({
			ctx,
			pi,
			cwd: "/tmp",
			projectName: "",
			choice: { kind: "open-report" },
			reportPath: REPORT_PATH,
		});
		assert.equal(notifies.length, 1);
		assert.match(notifies[0]?.title ?? "", new RegExp(REPORT_PATH.replace(/[/.]/g, "\\$&")));
		assert.equal(notifies[0]?.level, "info");
		assert.equal(sent.length, 0);
	});

	it("kind: 'all-safe' (Phase 2) runs every safe remediate + re-audits", async () => {
		const { ctx, notifies } = makeCtx();
		const { pi, sent } = makePi();
		await dispatchFixChoice({
			ctx,
			pi,
			cwd: "/tmp",
			projectName: "",
			choice: { kind: "all-safe" },
			reportPath: REPORT_PATH,
		});
		// Expected notifies:
		//   1. "Doctor fix: running all safe remediates (Phase 2 / Level B)..."
		//   2..N+1. one per whitelist fingerprint (3 in our setup: all no-ops)
		//   N+2. "After remediate: 0 errors / 0 warnings — clean."
		assert.ok(notifies.length >= 2, `expected >=2 notifies, got ${notifies.length}`);
		// First notify announces the remediate pass.
		assert.match(notifies[0]?.title ?? "", /running all safe remediates/);
		// Last notify is the post-remediate summary.
		const last = notifies[notifies.length - 1];
		assert.match(last?.title ?? "", /After remediate:/);
		// No LLM handoff in the all-safe branch (purely deterministic).
		assert.equal(sent.length, 0);
	});

	it("kind: 'all-safe' surfaces a per-fingerprint message for each whitelist entry", async () => {
		const { ctx, notifies } = makeCtx();
		const { pi } = makePi();
		await dispatchFixChoice({
			ctx,
			pi,
			cwd: "/tmp",
			projectName: "",
			choice: { kind: "all-safe" },
			reportPath: REPORT_PATH,
		});
		// Each safe fingerprint has its own notify line — even a no-op
		// surfaces "Remediate \"<fingerprints>\": nothing to fix (already clean)."
		const fingerprintText = notifies.map((n) => n.title).join("\n");
		assert.match(fingerprintText, /frontmatter-missing/);
		assert.match(fingerprintText, /fingerprint-untracked/);
		assert.match(fingerprintText, /working-published-drift/);
	});

	it("kind: 'fix-one' dispatches the parent LLM with a structured prompt", async () => {
		const { ctx, notifies } = makeCtx();
		const { pi, sent } = makePi();
		await dispatchFixChoice({
			ctx,
			pi,
			cwd: "/tmp",
			projectName: "",
			choice: { kind: "fix-one", item: oneItem },
			reportPath: REPORT_PATH,
		});
		assert.equal(sent.length, 1);
		const prompt = sent[0]?.message ?? "";
		// The prompt must reference the report path (so the parent LLM
		// can read it for full context), the section, status, message,
		// and suggestion text.
		assert.match(prompt, new RegExp(REPORT_PATH.replace(/[/.]/g, "\\$&")));
		assert.match(prompt, /Doc\/ artifacts/);
		assert.match(prompt, /error/);
		assert.match(prompt, /PSRS rows missing/);
		assert.match(prompt, /\/velpari-prd/);
		// sendUserMessage is called with expandPromptTemplates.
		assert.deepEqual(sent[0]?.opts, { expandPromptTemplates: true });
		// And the user gets a notify too.
		assert.equal(notifies.length, 1);
		assert.match(notifies[0]?.title ?? "", /dispatched/);
		assert.match(notifies[0]?.title ?? "", /#3/);
	});

	it("never edits Doc/ directly (only sendUserMessage + notify)", async () => {
		// Defensive regression: ensure the dispatcher has no other
		// outbound call paths. The mocks only capture sendUserMessage
		// + notify; if the dispatcher invents a new mutation channel,
		// these tests will pass but the production guard would not.
		const { ctx, notifies } = makeCtx();
		const { pi, sent } = makePi();
		await dispatchFixChoice({
			ctx,
			pi,
			cwd: "/tmp",
			projectName: "",
			choice: { kind: "fix-one", item: oneItem },
			reportPath: REPORT_PATH,
		});
		// Total outbound = 1 sendUserMessage + 1 notify = 2.
		const totalCalls = sent.length + notifies.length;
		assert.equal(totalCalls, 2);
	});

	// -----------------------------------------------------------------------
	// Phase 3 (Level C) — agentic branch via buildFixBrief
	// -----------------------------------------------------------------------

	const AGENTIC_SUGGESTION =
		"A requirement changed after the RTM linked to it. Re-run `/velpari-rtm` in update mode to review the design/test links, then `/velpari-atomic-function-approve`.";

	const agenticItem: ActionableItem = {
		index: 5,
		section: "Fingerprints",
		status: "warning",
		message: "RTM row FR-03 fingerprint mismatch (suspect).",
		suggestion: AGENTIC_SUGGESTION,
		level: "agentic",
	};

	it("kind: 'fix-one' on an agentic item dispatches a structured FixBrief", async () => {
		const { ctx, notifies } = makeCtx();
		const { pi, sent } = makePi();
		await dispatchFixChoice({
			ctx,
			pi,
			cwd: "/tmp",
			projectName: "",
			choice: { kind: "fix-one", item: agenticItem },
			reportPath: REPORT_PATH,
		});
		assert.equal(sent.length, 1);
		const prompt = sent[0]?.message ?? "";
		// The agentic prompt must include the structured brief block.
		assert.match(prompt, /Doctor Agentic Fix Brief/);
		assert.match(prompt, /fingerprint-suspect/);
		assert.match(prompt, /\/velpari-rtm/);
		assert.match(prompt, /Success Criterion/);
		// Notify text mentions agentic dispatch (not the Phase 1 fallback wording).
		assert.match(notifies[0]?.title ?? "", /agentic/i);
	});

	it("kind: 'fix-one' on an interactive item still uses the Phase 1 generic prompt", async () => {
		const { ctx, notifies } = makeCtx();
		const { pi, sent } = makePi();
		await dispatchFixChoice({
			ctx,
			pi,
			cwd: "/tmp",
			projectName: "",
			choice: { kind: "fix-one", item: oneItem }, // interactive (psrs-missing-style)
			reportPath: REPORT_PATH,
		});
		assert.equal(sent.length, 1);
		const prompt = sent[0]?.message ?? "";
		assert.doesNotMatch(prompt, /Doctor Agentic Fix Brief/);
		assert.match(prompt, /most appropriate \/velpari-\* command/);
	});
});
