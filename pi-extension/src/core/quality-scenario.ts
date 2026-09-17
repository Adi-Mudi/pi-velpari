/**
 * Quality Attribute Scenario — the 6-part form (Phase 1 / Phase 5).
 *
 * Shared between the design-readiness gate (§5 of the design template)
 * and the style-catalog scoring (Phase 5). The 6 parts are exactly
 * Bass / Clements / Kazman's notation (per *Software Architecture in
 * Practice*):
 *
 *   - source       who/what creates the stimulus
 *   - stimulus     the trigger
 *   - environment  conditions under which it happens
 *   - artifact     the subsystem that responds
 *   - response     what the system does
 *   - responseMeasure  how success is measured (must be numeric)
 *
 * Optional `qaId` is a canonical attribute name (e.g. "performance",
 * "availability", "security") pre-filled by the design-contract-
 * definer scout from the source PRD's Quality Requirements section.
 */

export interface QualityScenario {
	source: string;
	stimulus: string;
	environment: string;
	artifact: string;
	response: string;
	responseMeasure: string;
	/** Optional canonical QA id (e.g. "performance"). Set by the parent LLM
	 *  when extracting from the PRD so style scoring can match style.favouredQAs. */
	qaId?: string;
	/** Source row id (e.g. "NFR-1") for traceability. */
	sourceNfrRow?: string;
	/** RFC 2119 keyword (`shall` / `should` / `may`) — Phase 5 only
	 *  validates the keyword is present; the scout extracts the keyword
	 *  from the PRD row when it builds the scenario. */
	rfc2119Keyword?: "shall" | "should" | "may";
	/** Tactic name from `tactic-catalog.ts` (SEI tactic catalog). Set by the
	 *  contract-definer scout when it surfaces an interface-scoped tactic. */
	approach?: string;
}
