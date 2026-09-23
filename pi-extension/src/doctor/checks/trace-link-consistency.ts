/**
 * RTM↔test-cases link consistency check (audit item c8 — D3).
 *
 * The requirement↔test link is recorded in two places:
 *
 *   - RTM sidecar `rows[].tests[]` — the AUTHORITY (the RTM is the
 *     traceability matrix of record)
 *   - test-cases sidecar `records[].traces[]` — the per-test declaration
 *
 * Nothing writes both atomically, so they can drift. This check reconciles
 * them: a link present in exactly one sidecar is a WARNING (asymmetric
 * trace — reconcile at the next RTM/testplan revise; not corruption).
 * Skipped (info) when either sidecar is absent or invalid — legacy
 * projects and broken sidecars are reported by the per-artifact checks
 * (`rtm-data.ts`, `test-cases-data.ts`); double-reporting adds noise.
 *
 * Only requirement traces (FR-N / NFR-N) are compared — AF-N traces have
 * no RTM row counterpart.
 *
 * Layer 1 (doctor). Imports node builtins + L0 core modules only.
 */

import { readFileSync } from "node:fs";
import { resolveDocArtifact } from "../../core/paths.js";
import { resolveRtmSidecar, type RtmData } from "../../core/rtm-data.js";
import { resolveTestCasesSidecar, type TestCasesData } from "../../core/test-cases-data.js";
import { parseYaml } from "../../core/yaml-data.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** A requirement↔test link, compared across the two sidecars. */
interface TraceLink {
	/** Requirement id (FR-N / NFR-N). */
	req: string;
	/** Test id (TC-N / IT-N). */
	test: string;
}

function linkKey(link: TraceLink): string {
	return `${link.req}→${link.test}`;
}

/** Requirement traces only — AF-N has no RTM row counterpart. */
const REQUIREMENT_TRACE_RE = /^(?:FR|NFR)-\d+$/;

/** Links declared by the RTM authority: row.tests[] per requirement row. */
function rtmLinks(data: RtmData): TraceLink[] {
	const links: TraceLink[] = [];
	for (const row of data.rows) {
		for (const test of row.tests) {
			links.push({ req: row.id, test });
		}
	}
	return links;
}

/** Links declared by each test record's traces[]. */
function testCaseLinks(data: TestCasesData): TraceLink[] {
	const links: TraceLink[] = [];
	for (const record of [...data.unitTests, ...data.integrationTests]) {
		for (const trace of record.traces) {
			if (REQUIREMENT_TRACE_RE.test(trace)) links.push({ req: trace, test: record.id });
		}
	}
	return links;
}

/** Doctor section "RTM↔test-cases link consistency". */
export function checkTraceLinkConsistencySection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "RTM↔test-cases link check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "RTM↔test-cases link consistency", items };
	}

	// Both sidecars must exist and parse; otherwise the per-artifact checks
	// own the report and this check stays out of the way (info skip).
	const rtmMd = resolveDocArtifact("RTM", projectName, cwd);
	const rtmSidecar = rtmMd ? resolveRtmSidecar(rtmMd.path) : null;
	const tcMd = resolveDocArtifact("test-cases", projectName, cwd);
	const tcSidecar = tcMd ? resolveTestCasesSidecar(tcMd.path) : null;
	if (!rtmSidecar || !tcSidecar) {
		const missing = [!rtmSidecar ? "RTM" : null, !tcSidecar ? "test-cases" : null].filter(Boolean);
		items.push({
			status: "info",
			message: `RTM↔test-cases link check skipped — ${missing.join(" + ")} sidecar absent (legacy project); the cross-check needs both.`,
		});
		return { title: "RTM↔test-cases link consistency", items };
	}

	const rtmParsed = parseYaml(readFileSync(rtmSidecar.path, "utf8"));
	const tcParsed = parseYaml(readFileSync(tcSidecar, "utf8"));
	if (!rtmParsed.ok || !tcParsed.ok) {
		items.push({
			status: "info",
			message: "RTM↔test-cases link check skipped — a sidecar is not valid YAML (reported by its per-artifact check).",
		});
		return { title: "RTM↔test-cases link consistency", items };
	}

	const authorityLinks = rtmLinks(rtmParsed.data as RtmData);
	const declaredLinks = testCaseLinks(tcParsed.data as TestCasesData);
	const authority = new Set(authorityLinks.map(linkKey));
	const declared = new Set(declaredLinks.map(linkKey));

	let asymmetric = 0;
	for (const link of authorityLinks) {
		if (declared.has(linkKey(link))) continue;
		asymmetric++;
		items.push({
			status: "warning",
			message: `RTM-only link: RTM row ${link.req} tests[] lists ${link.test}, but ${link.test} does not trace ${link.req}.`,
			suggestion: suggestionFor("trace-link-asymmetric"),
		});
	}
	for (const link of declaredLinks) {
		if (authority.has(linkKey(link))) continue;
		asymmetric++;
		items.push({
			status: "warning",
			message: `TC-only link: ${link.test} traces ${link.req}, but RTM row ${link.req} tests[] does not list ${link.test}.`,
			suggestion: suggestionFor("trace-link-asymmetric"),
		});
	}

	items.push({
		status: asymmetric === 0 ? "ok" : "info",
		message:
			asymmetric === 0
				? `RTM↔test-cases links consistent — ${authority.size} link(s) checked, all symmetric (RTM tests[] is the authority).`
				: `RTM↔test-cases link summary: ${asymmetric} asymmetric link(s) across ${authority.size} RTM + ${declared.size} declared link(s).`,
	});
	return { title: "RTM↔test-cases link consistency", items };
}
