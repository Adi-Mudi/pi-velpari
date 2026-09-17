/**
 * Architectural style catalog (Phase 5, plan §Phase 5).
 *
 * The named architectural styles a design may adopt (per Richards &
 * Ford, *Fundamentals of Software Architecture*; SEI ATAM; Rozanski &
 * Woods; community consensus). Each style carries:
 *   - favoured QAs (the quality attributes the style helps achieve)
 *   - disfavoured QAs (the QAs the style fights against)
 *   - domain hints (where the style fits best)
 *   - a one-line description
 *
 * Decision support: `scoreStyleAgainstQAs(style, qaScenarios)` returns
 * a deterministic numeric score that the design-style-selector scout
 * uses to rank candidate styles. The highest-score style becomes
 * ADR-001's `decision` field; the runner-ups populate the `options`
 * array.
 *
 * Pure logic. No IO. No LLM calls.
 */

import type { QualityScenario } from "./quality-scenario.js";

export interface ArchitecturalStyle {
	id: string;
	label: string;
	description: string;
	favouredQAs: string[]; // QA ids this style helps
	disfavouredQAs: string[]; // QA ids this style fights
	bestForDomains: string[];
	notes: string;
}

export const STYLE_CATALOG: ReadonlyArray<ArchitecturalStyle> = [
	{
		id: "layered",
		label: "Layered",
		description:
			"Strict layers (Presentation / Business / Persistence / Database). N-Tier; entry of the standard lineup.",
		favouredQAs: ["modifiability", "testability"],
		disfavouredQAs: ["scalability", "elasticity"],
		bestForDomains: ["CRUD apps", "internal tools", "ERP"],
		notes:
			"Smallest cognitive load. Hard to scale horizontally; deployment unit is large.",
	},
	{
		id: "modular-monolith",
		label: "Modular Monolith",
		description:
			"One deployable, well-bounded modules inside (per Velocity / Modular Monolith).",
		favouredQAs: ["modifiability", "deployability", "testability"],
		disfavouredQAs: ["scalability", "availability"],
		bestForDomains: ["SMB SaaS", "startups", "MVC replacements"],
		notes:
			"Module boundaries erode without governance. Modular Monolith → Microservices refactor is the canonical journey.",
	},
	{
		id: "pipeline",
		label: "Pipeline",
		description:
			"Data flows through chained filters / pipes / transformations.",
		favouredQAs: ["performance", "availability"],
		disfavouredQAs: ["modifiability", "usability"],
		bestForDomains: ["ETL", "stream processing", "image / video / shell"],
		notes:
			"Bad for stateful, transactional workflows. Excellent for throughput-oriented processing.",
	},
	{
		id: "microkernel",
		label: "Microkernel",
		description:
			"Core system + plug-ins loaded at runtime. Plugin registry is the seam.",
		favouredQAs: ["modifiability", "extensibility", "deployability"],
		disfavouredQAs: ["performance"],
		bestForDomains: ["IDEs", "browsers", "middleware", "Jenkins"],
		notes:
			"Stable core, plug-ins can be deployed independently. Plugin isolation is a real engineering effort.",
	},
	{
		id: "service-based",
		label: "Service-Based",
		description:
			"A handful of coarse-grained services, domain-driven boundaries, not yet microservices.",
		favouredQAs: ["modifiability", "deployability"],
		disfavouredQAs: ["performance", "elasticity"],
		bestForDomains: ["Mid-large systems", "monolith → services refactors"],
		notes:
			"Simpler than microservices, but still benefits from independent deployment.",
	},
	{
		id: "event-driven",
		label: "Event-Driven",
		description:
			"Asynchronous producer / consumer interactions via a broker (Kafka, SNS/SQS).",
		favouredQAs: ["scalability", "availability", "extensibility"],
		disfavouredQAs: ["modifiability", "testability"],
		bestForDomains: ["Integration", "real-time updates", "Sagas"],
		notes:
			"Debugging and consistency are harder. Eventual consistency is the default mental model.",
	},
	{
		id: "microservices",
		label: "Microservices",
		description:
			"Many small, independently deployable services, each owning its data.",
		favouredQAs: ["deployability", "scalability", "modifiability"],
		disfavouredQAs: ["performance", "simplicity"],
		bestForDomains: ["Large teams", "large systems", "Amazon / Netflix scale"],
		notes:
			"Maximum team autonomy, maximum operational complexity. The hardest style to do well.",
	},
	{
		id: "space-based",
		label: "Space-Based",
		description:
			"Processing grid + in-memory data grid. Removes the database as the bottleneck.",
		favouredQAs: ["scalability", "elasticity", "performance"],
		disfavouredQAs: ["modifiability", "cost"],
		bestForDomains: ["Ticketing", "trading", "auctions"],
		notes:
			"Designed for elastic, extreme concurrency. Infrastructure-heavy; not for small user base.",
	},
	{
		id: "hexagonal",
		label: "Hexagonal (Ports & Adapters)",
		description:
			"Inside-out: domain at center, ports on the boundary, adapters on the outside.",
		favouredQAs: ["modifiability", "testability"],
		disfavouredQAs: ["simplicity", "performance"],
		bestForDomains: ["Long-lived domains", "integrations"],
		notes:
			"Pairs well with any of the deployment-side styles (Layered, Microservices, Service-Based).",
	},
	{
		id: "serverless",
		label: "Serverless / FaaS",
		description:
			"Stateless functions on demand; backend services managed by the cloud.",
		favouredQAs: ["elasticity", "cost-at-rest"],
		disfavouredQAs: ["performance", "modifiability"],
		bestForDomains: ["Bursty workloads", "event pipelines"],
		notes:
			"Vendor lock-in is the cost. Cold start and per-invocation latency must be designed around.",
	},
] as const;

/** Map style id → ArchitecturalStyle for direct lookup. */
export const STYLE_BY_ID: ReadonlyMap<string, ArchitecturalStyle> = new Map(
	STYLE_CATALOG.map((s) => [s.id, s]),
);

/**
 * Score a style against a set of QA scenarios. Deterministic; no LLM.
 * Higher score = better fit. Score is bounded to [-N, +N] where N is
 * the number of scenarios.
 */
export function scoreStyleAgainstQAs(
	style: ArchitecturalStyle,
	scenarios: ReadonlyArray<QualityScenario>,
): number {
	let score = 0;
	for (const s of scenarios) {
		// Map QA stimulus back to a canonical id best-effort: look at
		// the surrounding sourceArtifact context. The scout normalises
		// scenarios to {source, stimulus, env, artifact, response,
		// responseMeasure}; we use the artifact name when the QA id is
		// present in the scenario (heuristic via artifact prefix).
		// For now: match the QA id directly when the scenario includes it
		// in the artifact line.
		const matchedId = extractQAId(s);
		if (style.favouredQAs.includes(matchedId)) score += 1;
		else if (style.disfavouredQAs.includes(matchedId)) score -= 1;
		// Unknown QAs → 0 contribution (the style may still apply).
	}
	return score;
}

/**
 * Render a style-fitness report. Used by the design-style-selector
 * scout.
 */
export function rankStylesForScenarios(
	scenarios: ReadonlyArray<QualityScenario>,
): Array<{ style: ArchitecturalStyle; score: number }> {
	return STYLE_CATALOG.map((style) => ({
		style,
		score: scoreStyleAgainstQAs(style, scenarios),
	})).sort((a, b) => b.score - a.score);
}

/**
 * Best-effort extraction of the canonical QA attribute id from a 6-part
 * scenario. We use the artifact field first; the QA usually appears
 * as the artifact prefix (e.g., "checkout-service" → "performance" if
 * a fixture sets it). For now we leave it explicit and assume callers
 * pre-fill `s.qaId` when they know it; otherwise we look at the
 * stimulus for known keywords (English).
 */
function extractQAId(s: QualityScenario): string {
	if (s.qaId) return s.qaId.toLowerCase();
	const text = `${s.stimulus} ${s.response} ${s.artifact ?? ""}`.toLowerCase();
	if (/p95|throughput|latency|response time/.test(text)) return "performance";
	if (/rto|rpo|outage|recover/.test(text)) return "availability";
	if (/cipher|tls|encryption|audit|authentication/.test(text)) return "security";
	if (/elastic|concurrent|10k|100k|peak/.test(text)) return "scalability";
	if (/deploy|rollout|releas/.test(text)) return "deployability";
	if (/test|mock|coverage/.test(text)) return "testability";
	if (/audit|standards|pci|hipaa/.test(text)) return "compliance";
	return "unknown";
}
