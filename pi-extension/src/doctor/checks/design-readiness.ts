/**
 * Doctor check — Design artifact readiness (Phase 1 of the
 * architecture-generator upgrade plan; arc42 / SEI QAS alignment).
 *
 * Verifies every published design carries the standards-required
 * sections from Phase 1:
 *   - §0 Introduction & Goals (arc42 §1)         — error when missing
 *   - §0.4 Architecture Constraints (arc42 §2)   — error when missing
 *   - §5 Quality Attribute Scenarios (SEI 6-part)
 *       - heading present                          — error when missing
 *       - at least one row                         — error when empty
 *       - every row carries every required column  — error when incomplete
 *       - each Response measure is non-empty       — error when blank
 *       - each Approach cell non-empty             — error when blank
 *
 * Phase 1 only validates the §0/§2/§5 surface (the must-have scaffold).
 * Phases 2–7 add checks for Context / Deployment / Crosscutting /
 * Glossary / Risks / forced ADR-001 / C4 levels incrementally; each
 * version appends to gateDesignReadiness() and checkDesignReadiness().
 *
 * Wired into:
 *   - `/velpari-doctor` via `doctor/index.ts:runDoctor`
 *   - `the publish tool` publish gate via `doctor/gate.ts:runPublishGate`
 *
 * Pure logic: no filesystem access, no LLM calls. The caller (gate.ts)
 * passes the working-copy content as a string.
 */

import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { parseADRSection } from "../../core/adr.js";
import { STYLE_CATALOG } from "../../core/style-catalog.js";
import { isKnownTactic } from "../../core/tactic-catalog.js";

export interface DesignReadinessError {
	code: string;
	message: string;
}

/** Section headings we require in every published design (Phases 1 + 2 + 3 + 6 set). */
const HEADINGS_REQUIRED = {
	introduction: /^##\s+0\.\s+Introduction\s+&\s+Goals\b/m,
	constraints: /^###\s+0\.4\s+Architecture\s+Constraints\b/m,
	qaScenarios: /^##\s+5\.\s+Quality\s+Attribute\s+Scenarios\b/m,
	contextView: /^##\s+9\.\s+Context\s+View\b/m,
	deploymentView: /^##\s+10\.\s+Deployment\s+View\b/m,
	crosscutting: /^##\s+11\.\s+Crosscutting\s+Concepts\b/m,
	risks: /^##\s+12\.\s+Risks\s+&\s+Tech\s+Debt\b/m,
	glossary: /^##\s+13\.\s+Glossary\b/m,
	c4Diagrams: /^##\s+14\.\s+Diagrams\s+\(C4\)/m,
};

/** Phase 6: each of the three C4 diagrams must appear at least once. */
const REQUIRED_C4_BLOCKS = [
	{ keyword: "C4Context", label: "C4 Level 1 (System Context)" },
	{ keyword: "C4Container", label: "C4 Level 2 (Container)" },
	{ keyword: "C4Component", label: "C4 Level 3 (Component)" },
] as const;

/**
 * The 8 required columns in the SEI 6-part + 2 extra QA scenarios table
 * (NFR ID | Source | Stimulus | Environment | Artifact | Response |
 * Response measure | Approach). Seven of these are the 6-part form
 * (Source / Stimulus / Environment / Artifact / Response / Response
 * measure) plus Approach, plus a unique NFR ID.
 */
const QA_COLUMNS_REQUIRED = [
	"NFR ID",
	"Source",
	"Stimulus",
	"Environment",
	"Artifact",
	"Response",
	"Response measure",
	"Approach",
] as const;

/**
 * Strict gate check — returns 0..N errors. Empty result means publish
 * is allowed. Used by `the publish tool`'s publish gate.
 */
export function gateDesignReadiness(workingContent: string | null): DesignReadinessError[] {
	const errors: DesignReadinessError[] = [];

	if (workingContent === null) {
		// No design yet — caller will have skipped publish. Return empty so
		// the gate does not falsely report a missing-§0 error.
		return errors;
	}

	if (!HEADINGS_REQUIRED.introduction.test(workingContent)) {
		errors.push({
			code: "design.missing-introduction",
			message:
				"Design artifact is missing `## 0. Introduction & Goals` (arc42 §1). " +
				"Add the section with mission, top 3–5 quality goals, and stakeholder summary.",
		});
	}

	if (!HEADINGS_REQUIRED.constraints.test(workingContent)) {
		errors.push({
			code: "design.missing-constraints",
			message:
				"Design artifact is missing `### 0.4 Architecture Constraints` (arc42 §2). " +
				"Add the sub-section inside `## 0. Introduction & Goals` listing hard limits.",
		});
	}

	if (!HEADINGS_REQUIRED.qaScenarios.test(workingContent)) {
		errors.push({
			code: "design.missing-qa-scenarios",
			message:
				"Design artifact is missing `## 5. Quality Attribute Scenarios` (SEI 6-part form). " +
				"Rename or replace the legacy §5 Non-Functional Considerations section.",
		});
	} else {
		const tableRows = extractQAScenarioRows(workingContent);
		if (tableRows.length === 0) {
			errors.push({
				code: "design.empty-qa-table",
				message:
					"`## 5. Quality Attribute Scenarios` is present but the table has no data rows. " +
					"Add at least one row that traces to a source PRD NFR.",
			});
		} else {
			for (const row of tableRows) {
				for (const col of QA_COLUMNS_REQUIRED) {
					if (!row[col] || row[col].trim() === "" || row[col].trim() === "<...>") {
						errors.push({
							code: "design.qa-row-incomplete",
							message:
								`Quality Attribute Scenario row "${row["NFR ID"] || "(unknown)"}" ` +
								`is missing the required column "${col}".`,
						});
					}
				}
			}
		}
	}

	// Phase 2: Context View (§9) is required.
	if (!HEADINGS_REQUIRED.contextView.test(workingContent)) {
		errors.push({
			code: "design.missing-context-view",
			message:
				"Design artifact is missing `## 9. Context View` (Rozanski & Woods; C4 Level 1). " +
				"Add the section with users, external systems, trust boundaries, cross-boundary data flows.",
		});
	}

	// Phase 2: Deployment View (§10) is required.
	if (!HEADINGS_REQUIRED.deploymentView.test(workingContent)) {
		errors.push({
			code: "design.missing-deployment-view",
			message:
				"Design artifact is missing `## 10. Deployment View` (Rozanski & Woods). " +
				"Add the section with container→host mapping, network topology, scaling boundaries.",
		});
	}

	// Phase 3: Crosscutting Concepts (§11) is required.
	if (!HEADINGS_REQUIRED.crosscutting.test(workingContent)) {
		errors.push({
			code: "design.missing-crosscutting",
			message:
				"Design artifact is missing `## 11. Crosscutting Concepts` (arc42 §8). " +
				"Add the section with one concrete decision per crosscutting concern.",
		});
	}

	// Phase 3: Risks & Tech Debt (§12) is required.
	if (!HEADINGS_REQUIRED.risks.test(workingContent)) {
		errors.push({
			code: "design.missing-risks",
			message:
				"Design artifact is missing `## 12. Risks & Tech Debt` (arc42 §11). " +
				"Add the section with at least one known risk + impact + mitigation + owner.",
		});
	}

	// Phase 3: Glossary (§13) is required.
	if (!HEADINGS_REQUIRED.glossary.test(workingContent)) {
		errors.push({
			code: "design.missing-glossary",
			message:
				"Design artifact is missing `## 13. Glossary` (arc42 §12; ubiquitous language). " +
				"Add the section with terms + definitions + source citations.",
		});
	}

	// Phase 5: every §5 `Approach` cell must name a known SEI tactic.
	if (HEADINGS_REQUIRED.qaScenarios.test(workingContent)) {
		const qaRows = extractQAScenarioRows(workingContent);
		for (const row of qaRows) {
			const approach = row["Approach"] ?? "";
			if (approach && !isKnownTactic(approach)) {
				errors.push({
					code: "design.tactic-unknown",
					message:
						`Quality Attribute Scenario row "${row["NFR ID"] || "(unknown)"}" ` +
						`names tactic "${approach}" which is not in the SEI catalog. ` +
						`Allowed: cache, retry, replicate, failover, queue-load-level, ` +
						`authenticate, authorize, encrypt, audit, validate-input, ` +
						`encapsulate, inject, bind-late, use-interfaces, separate-interface, ` +
						`record-playback, mock-dependencies, …`,
				});
			}
		}
	}

	// Phase 5: ADR-001's chosen style must be a known style ID.
	const adrs = parseADRSection(workingContent);
	const styleAdr = adrs.find((a) => a.id === "ADR-001" && a.status === "accepted");
	if (styleAdr) {
		const chosenId = (styleAdr.decision ?? "").toLowerCase().replace(/[^a-z-]/g, "");
		const styleIds = new Set(STYLE_CATALOG.map((s) => s.id));
		if (!styleIds.has(chosenId)) {
			errors.push({
				code: "design.style-unknown",
				message:
					`ADR-001 declares chosen style "${styleAdr.decision ?? "(empty)"}" ` +
					`which is not in the style catalog. Allowed: ` +
					STYLE_CATALOG.map((s) => s.id).join(", "),
			});
		}
	}

	// Phase 6: §14 Diagrams (C4) + 3 Mermaid blocks.
	if (!HEADINGS_REQUIRED.c4Diagrams.test(workingContent)) {
		errors.push({
			code: "design.missing-c4-diagrams",
			message:
				"Design artifact is missing `## 14. Diagrams (C4)` (Simon Brown's C4 model). " +
				"Add the section with three Mermaid blocks: C4Context, C4Container, C4Component.",
		});
	} else {
		const sectionBlocks = extractC4Blocks(workingContent);
		for (const req of REQUIRED_C4_BLOCKS) {
			if (!sectionBlocks.has(req.keyword)) {
				errors.push({
					code: "design.missing-c4-block",
					message:
						`## 14. Diagrams (C4) is missing the ${req.label} block (keyword: ${req.keyword}).`,
				});
			}
		}
	}

	return errors;
}

/**
 * Phase 6: extract the set of Mermaid C4 block keywords present
 * under the §14 heading. Stops walking at the next `## ` heading.
 * Exported for testability.
 */
export function extractC4Blocks(content: string): Set<string> {
	const keywords = new Set<string>();
	const start = content.match(/^##\s+14\.\s+Diagrams\s+\(C4\)/m);
	if (!start) return keywords;
	const idx = start.index ?? 0;
	const afterStart = idx + start[0].length;
	const rest = content.slice(afterStart);
	const nextHeading = rest.search(/^##\s+/m);
	const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
	const fenceRe = /```mermaid\b([\s\S]*?)```/g;
	let m: RegExpExecArray | null = fenceRe.exec(section);
	while (m !== null) {
		const block = m[1] ?? "";
		for (const req of REQUIRED_C4_BLOCKS) {
			if (block.includes(req.keyword)) keywords.add(req.keyword);
		}
		m = fenceRe.exec(section);
	}
	return keywords;
}

/**
 * Audit check — returns a DiagnosticSection for `/velpari-doctor`.
 */
export function checkDesignReadiness(workingContent: string | null): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (workingContent === null) {
		items.push({
			status: "info",
			message: "No design artifact yet (readiness check skipped).",
		});
		return { title: "Design readiness (Phase 1)", items };
	}

	const errors = gateDesignReadiness(workingContent);
	if (errors.length === 0) {
		const rows = extractQAScenarioRows(workingContent);
		const constraintsMatched = HEADINGS_REQUIRED.constraints.test(workingContent);
		const introMatched = HEADINGS_REQUIRED.introduction.test(workingContent);
		const qaMatched = HEADINGS_REQUIRED.qaScenarios.test(workingContent);
		items.push({
			status: "ok",
			message:
				`All Phase-1 design sections present (intro=${introMatched}, constraints=${constraintsMatched}, ` +
				`QA scenarios=${qaMatched}, rows=${rows.length}).`,
		});
	} else {
		for (const e of errors) {
			items.push({ status: "error", message: e.message });
		}
	}

	return { title: "Design readiness (Phase 1)", items };
}

/**
 * Find the §5 QA scenario table and parse each row into a column→value
 * map. Returns rows where every value is a non-empty cell. Skips
 * header + separator rows.
 *
 * Pure function — exported for testability.
 */
export function extractQAScenarioRows(content: string): Record<string, string>[] {
	const rows: Record<string, string>[] = [];
	const lines = content.split(/\r?\n/);
	const headerCells = QA_COLUMNS_REQUIRED.map((c) => c.toLowerCase());
	const cellSplit = /\s*\|\s*/;

	let inQASection = false;
	let tableColumns: string[] | null = null;

	for (const line of lines) {
		if (HEADINGS_REQUIRED.qaScenarios.test(line)) {
			inQASection = true;
			tableColumns = null;
			continue;
		}
		// When we hit any other top-level (## ) or sub-level (### ) heading
		// after the QA section, stop walking the table.
		if (inQASection && /^#{2,}\s/.test(line) && !HEADINGS_REQUIRED.qaScenarios.test(line)) {
			inQASection = false;
		}
		if (!inQASection) continue;

		const trimmed = line.trim();
		if (!trimmed.startsWith("|")) continue;

		const cells = trimmed
			.replace(/^\|/, "")
			.replace(/\|$/, "")
			.split(cellSplit);

		if (tableColumns === null) {
			// First pipe-row: must match the header.
			if (cells.length < headerCells.length) continue;
			const lower = cells.map((c) => c.trim().toLowerCase());
			const matches = headerCells.every((req, i) => {
				const cell = lower[i] ?? "";
				return cell === req || cell.startsWith(req);
			});
			if (matches) {
				// Preserve canonical column names (original case) so the row
				// maps back to QA_COLUMNS_REQUIRED for the gate.
				tableColumns = QA_COLUMNS_REQUIRED.slice();
			} else {
				continue;
			}
			continue;
		}

		// Separator row (---|---|---) — skip.
		if (/^[\s|:-]+$/.test(trimmed) && cells.every((c) => /^:?-+:?$/.test(c.trim()))) {
			continue;
		}

		// Data row.
		const row: Record<string, string> = {};
		const firstCol = tableColumns[0] ?? "";
		for (let i = 0; i < tableColumns.length; i++) {
			const colName = tableColumns[i] ?? "";
			row[colName] = (cells[i] ?? "").trim();
		}
		// A data row whose first cell is empty is treated as a blank row and skipped.
		if (tableColumns.length > 0 && row[firstCol] === "") continue;
		rows.push(row);
	}

	return rows;
}
