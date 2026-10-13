/**
 * Fix-plan artifact (DGR P1 — lane 1a, D3).
 *
 * The gated repair flow persists a reviewable plan before GATE B: the
 * `.md` twin for humans and the `.json` twin for machines, mirroring the
 * `report.md` / `report.json` pair (`report.ts` + `report-schema.ts`).
 * Each item carries the D7 impact line (`impact.ts`) and the D8 action
 * (`action-policy.decideAction`), so the plan is the single reviewable
 * surface for what a repair batch would do.
 *
 * The artifact is written only when a plan is deliberately built (the
 * gated flow's Plan stage). It is never written by a read-only doctor
 * run, so it is never overwritten silently — a re-plan calls
 * `writeFixPlan` again on purpose.
 *
 * Layer rule: L1 `doctor/` — imports L0 (`core/constants.ts`,
 * `io/atomic-write.ts`) and sibling L1 doctor modules. No UI, no writes
 * beyond the two atomic writes.
 */

import { join } from "node:path";
import { PATHS } from "../core/constants.js";
import { atomicWriteFile, atomicWriteJson } from "../io/atomic-write.js";
import type { DiagnosticItem } from "./_types.js";
import { decideAction } from "./action-policy.js";
import type { FixAction } from "./failure-taxonomy.js";
import type { ActionableItem } from "./fix-dispatch.js";
import { impactFor } from "./impact.js";
import { slugId } from "./report-schema.js";

/** Current fix-plan JSON schema version. Bump on any breaking shape change. */
export const FIX_PLAN_SCHEMA_VERSION = 1;

/**
 * Paths of the fix-plan pair, derived from the report path so the two
 * artifacts always live side by side (`.IDE_Plans/velpari/`).
 */
export const FIX_PLAN_MD_PATH = PATHS.DOCTOR_REPORT.replace(/doctor-report\.md$/, "doctor-fix-plan.md");
export const FIX_PLAN_JSON_PATH = FIX_PLAN_MD_PATH.replace(/\.md$/, ".json");

/**
 * One plan item input: an `ActionableItem` plus an optional stable
 * section id. Callers that already know the section id (e.g. the chat
 * renderer) pass it; the gated flow's `RepairView` omits it and the
 * title is slugged instead (same convention as `report-schema.ts`).
 */
export interface FixPlanItemInput extends ActionableItem {
	/** Stable machine section id; falls back to `slugId(section)`. */
	sectionId?: string;
}

/** The plan's item source — structurally the gated flow's `RepairView`. */
export interface FixPlanView {
	items: ReadonlyArray<FixPlanItemInput>;
}

/** Options for building a fix plan. */
export interface FixPlanOptions {
	/** Configured project name ("" = unconfigured). */
	projectName: string;
	/** ISO-8601 timestamp; injectable so tests are deterministic. */
	generatedAt?: string;
}

/** One item in the fix-plan JSON twin. */
export interface FixPlanJsonItem {
	/** 0-based ordinal from the actionable set (stable picker key). */
	id: number;
	section: string;
	status: "error" | "warning";
	message: string;
	impact: string;
	suggestion: string;
	action: FixAction;
	/** D4 feedback default — every item is included until the user says otherwise. */
	include: boolean;
}

/** Counts over the plan's items, keyed by action plus the include tally. */
export interface FixPlanSummary {
	total: number;
	autoSafe: number;
	agentic: number;
	manual: number;
	escalate: number;
	include: number;
}

/** Versioned machine-readable fix plan. */
export interface FixPlanJson {
	schemaVersion: number;
	generatedAt: string;
	projectName: string;
	summary: FixPlanSummary;
	items: FixPlanJsonItem[];
}

/** The built plan: the markdown body and its JSON twin. */
export interface FixPlan {
	markdown: string;
	json: FixPlanJson;
}

/** Map a `FixAction` to its summary counter key. */
const SUMMARY_KEY: Readonly<Record<FixAction, "autoSafe" | "agentic" | "manual" | "escalate">> = {
	"auto-safe": "autoSafe",
	agentic: "agentic",
	manual: "manual",
	escalate: "escalate",
};

/**
 * Build the fix plan (markdown + JSON) from a view of actionable items.
 * Pure — the only non-deterministic value is `generatedAt` when not
 * supplied.
 *
 * @param {FixPlanView} view - The actionable items (1:1 with the plan's list).
 * @param {FixPlanOptions} opts - Project name + optional timestamp.
 * @returns {FixPlan} The markdown body and the versioned JSON twin.
 */
export function buildFixPlan(view: FixPlanView, opts: FixPlanOptions): FixPlan {
	const generatedAt = opts.generatedAt ?? new Date().toISOString();
	const items = view.items.map(toJsonItem);
	const json: FixPlanJson = {
		schemaVersion: FIX_PLAN_SCHEMA_VERSION,
		generatedAt,
		projectName: opts.projectName,
		summary: summarize(items),
		items,
	};
	return { markdown: renderFixPlanMarkdown(json), json };
}

/** Project one actionable item into its plan twin (impact + action derived here). */
function toJsonItem(item: FixPlanItemInput): FixPlanJsonItem {
	const sectionId = item.sectionId ?? slugId(item.section);
	const diagnostic: DiagnosticItem = { status: item.status, message: item.message, suggestion: item.suggestion };
	return {
		id: item.index,
		section: item.section,
		status: item.status,
		message: item.message,
		impact: impactFor(sectionId, diagnostic),
		suggestion: item.suggestion,
		action: decideAction(sectionId, diagnostic),
		include: true,
	};
}

/** Tally the plan items by action (plus the include count). */
function summarize(items: FixPlanJsonItem[]): FixPlanSummary {
	const summary: FixPlanSummary = { total: items.length, autoSafe: 0, agentic: 0, manual: 0, escalate: 0, include: 0 };
	for (const item of items) {
		summary[SUMMARY_KEY[item.action]]++;
		if (item.include) summary.include++;
	}
	return summary;
}

/** Render the human-readable markdown body for one plan. */
function renderFixPlanMarkdown(json: FixPlanJson): string {
	const lines: string[] = [];
	lines.push("# Velpari Doctor — Fix Plan");
	lines.push("");
	lines.push(`- **Project:** ${json.projectName || "(unconfigured)"}`);
	lines.push(`- **Generated:** ${json.generatedAt}`);
	lines.push(
		`- **Items:** ${json.summary.total} (${json.summary.autoSafe} auto-safe, ${json.summary.agentic} agentic, ${json.summary.manual} manual, ${json.summary.escalate} escalate)`,
	);
	lines.push("");
	if (json.items.length === 0) {
		lines.push("_No actionable items._");
		return `${lines.join("\n")}\n`;
	}
	lines.push("## Items");
	lines.push("");
	for (const item of json.items) {
		lines.push(`### ${item.id + 1}. [${item.status}] ${item.section} — ${item.message}`);
		lines.push("");
		lines.push(`- **Impact:** ${item.impact}`);
		lines.push(`- **Fix:** ${item.suggestion}`);
		lines.push(`- **Action:** ${item.action}`);
		lines.push(`- **Include:** ${item.include ? "yes" : "no"}`);
		lines.push("");
	}
	return lines.join("\n");
}

/** Result of writing the fix-plan pair. */
export interface WriteFixPlanResult {
	/** Absolute markdown path written. */
	markdownPath: string;
	/** Absolute JSON path written. */
	jsonPath: string;
}

/**
 * Write both fix-plan artifacts atomically under `cwd`. Called only when
 * a plan is deliberately built (the gated flow's Plan stage) — never by
 * a read-only doctor run — so the previous plan is only replaced by a
 * deliberate re-plan.
 *
 * @param {string} cwd - Project root.
 * @param {FixPlan} plan - The object returned by `buildFixPlan`.
 * @returns {WriteFixPlanResult} The absolute paths written.
 */
export function writeFixPlan(cwd: string, plan: FixPlan): WriteFixPlanResult {
	const markdownPath = join(cwd, FIX_PLAN_MD_PATH);
	const jsonPath = join(cwd, FIX_PLAN_JSON_PATH);
	atomicWriteFile(markdownPath, plan.markdown, "utf8");
	atomicWriteJson(jsonPath, plan.json);
	return { markdownPath, jsonPath };
}
