/**
 * SEI Tactics Catalog (Phase 5, plan §Phase 5).
 *
 * The reusable design decisions (tactics) Bass / Clements / Kazman
 * identify in *Software Architecture in Practice* (SEI Series). Each
 * tactic:
 *   - targets one or more quality attributes (e.g. `cache` targets
 *     `performance`)
 *   - applies to one or more system contexts (e.g. `retry` only makes
 *     sense for transient failures)
 *
 * Pure data + lookup helpers. No IO. No LLM calls. Used by:
 *   - design §5 design template (every row's `Approach` cell names a
 *     tactic from this catalog)
 *   - design-readiness gate (warns on unknown tactic names)
 *   - design-style-selector scout (Phase 5, justifies the style choice
 *     by tactic coverage)
 */

type QACategory =
	| "performance"
	| "availability"
	| "security"
	| "modifiability"
	| "testability"
	| "usability"
	| "interoperability"
	| "compliance"
	| "scalability"
	| "deployability";

export interface Tactic {
	id: string;
	label: string;
	category: QACategory;
	targetsQA: QACategory[];
	appliesToContext: string[];
	rationaleHint: string;
}

export const TACTIC_CATALOG: ReadonlyArray<Tactic> = [
	// Performance tactics
	{
		id: "increase-resources",
		label: "Increase resources",
		category: "performance",
		targetsQA: ["performance"],
		appliesToContext: ["saturated resource", "predictable load"],
		rationaleHint: "More CPU / RAM / instances yields more throughput; cheapest first.",
	},
	{
		id: "reduce-computation",
		label: "Reduce computation",
		category: "performance",
		targetsQA: ["performance"],
		appliesToContext: ["hot loop", "expensive query"],
		rationaleHint: "Replace O(n²) with O(n) or move work off the critical path.",
	},
	{
		id: "cache",
		label: "Cache results",
		category: "performance",
		targetsQA: ["performance"],
		appliesToContext: ["repeat reads", "expensive computation", "external call"],
		rationaleHint: "Read-mostly data, hot keys; pick TTL and invalidation carefully.",
	},
	{
		id: "parallel-computation",
		label: "Parallelize",
		category: "performance",
		targetsQA: ["performance"],
		appliesToContext: ["independent work units", "batch jobs"],
		rationaleHint: "Fan out; ensure idempotency + ordering invariants.",
	},
	{
		id: "prioritize-events",
		label: "Prioritize events",
		category: "performance",
		targetsQA: ["performance"],
		appliesToContext: ["mixed traffic", "VIPs"],
		rationaleHint: "Drain high-priority work first; tail latency improves for everyone.",
	},

	// Availability tactics
	{
		id: "retry",
		label: "Retry on transient failure",
		category: "availability",
		targetsQA: ["availability"],
		appliesToContext: ["network calls", "transient errors"],
		rationaleHint: "Limit attempts + jitter; never retry non-idempotent operations blindly.",
	},
	{
		id: "replicate",
		label: "Replicate state",
		category: "availability",
		targetsQA: ["availability", "performance"],
		appliesToContext: ["hot data", "single-region fragility"],
		rationaleHint: "Multi-AZ or multi-region; quorum reads/writes.",
	},
	{
		id: "failover",
		label: "Active/Standby failover",
		category: "availability",
		targetsQA: ["availability"],
		appliesToContext: ["single master", "regulated SLOs"],
		rationaleHint: "Detect + promote; keep RTO tight.",
	},
	{
		id: "ping-echo",
		label: "Health probe (ping/echo)",
		category: "availability",
		targetsQA: ["availability"],
		appliesToContext: ["load-balanced services"],
		rationaleHint: "Monitor each instance; fail fast on no-response.",
	},
	{
		id: "transaction",
		label: "Bound work in transactions",
		category: "availability",
		targetsQA: ["availability", "usability"],
		appliesToContext: ["long-lived workflows"],
		rationaleHint: "Keep units small; combine with compensating actions for cross-aggregate flows.",
	},
	{
		id: "queue-load-level",
		label: "Queue-based load leveling",
		category: "availability",
		targetsQA: ["availability", "performance"],
		appliesToContext: ["bursty traffic", "rate-mismatched producer/consumer"],
		rationaleHint: "Buffer absorbs spikes; consumer controls its own pace.",
	},

	// Security tactics
	{
		id: "authenticate",
		label: "Authenticate users + systems",
		category: "security",
		targetsQA: ["security"],
		appliesToContext: ["any trust boundary"],
		rationaleHint: "Identify before you authorise; never trust the network.",
	},
	{
		id: "authorize",
		label: "Authorize action",
		category: "security",
		targetsQA: ["security"],
		appliesToContext: ["any privileged operation"],
		rationaleHint: "Default-deny; RBAC or policy-as-code.",
	},
	{
		id: "encrypt",
		label: "Encrypt data",
		category: "security",
		targetsQA: ["security"],
		appliesToContext: ["PII / PHI / secrets", "data at rest or in flight"],
		rationaleHint: "At rest + in flight; key management is the harder half.",
	},
	{
		id: "audit",
		label: "Audit log every privileged action",
		category: "security",
		targetsQA: ["security", "compliance"],
		appliesToContext: ["PII / regulated data"],
		rationaleHint: "Immutable, timestamped, queryable.",
	},
	{
		id: "validate-input",
		label: "Validate input",
		category: "security",
		targetsQA: ["security", "modifiability"],
		appliesToContext: ["every external surface"],
		rationaleHint: "Strict schema at the boundary; reject malformed input early.",
	},

	// Modifiability tactics
	{
		id: "encapsulate",
		label: "Encapsulate behind an interface",
		category: "modifiability",
		targetsQA: ["modifiability"],
		appliesToContext: ["modules with multiple drivers"],
		rationaleHint: "Stable interface + swappable implementation.",
	},
	{
		id: "inject",
		label: "Dependency injection",
		category: "modifiability",
		targetsQA: ["modifiability", "testability"],
		appliesToContext: ["modules with plug-in collaborators"],
		rationaleHint: "Loose coupling; trivially testable.",
	},
	{
		id: "bind-late",
		label: "Bind late (config-time)",
		category: "modifiability",
		targetsQA: ["modifiability"],
		appliesToContext: ["variant deployments"],
		rationaleHint: "Defer choice until the latest reasonable moment.",
	},
	{
		id: "use-interfaces",
		label: "Depend on interfaces, not concretes",
		category: "modifiability",
		targetsQA: ["modifiability", "testability"],
		appliesToContext: ["any code that talks to another module"],
		rationaleHint: "Ports and adapters; inversion-of-control.",
	},

	// Testability tactics
	{
		id: "separate-interface",
		label: "Separate test interface",
		category: "testability",
		targetsQA: ["testability"],
		appliesToContext: ["modules with hard-to-reproduce states"],
		rationaleHint: "Test-only API at a stable seam.",
	},
	{
		id: "record-playback",
		label: "Record / playback",
		category: "testability",
		targetsQA: ["testability"],
		appliesToContext: ["concurrent / async systems"],
		rationaleHint: "Deterministic replay of captured events.",
	},
	{
		id: "simulate",
		label: "Simulate scarce resources",
		category: "testability",
		targetsQA: ["testability"],
		appliesToContext: ["network faults", "disk failures"],
		rationaleHint: "Chaos testing; fault injection.",
	},
	{
		id: "mock-dependencies",
		label: "Mock third-party dependencies",
		category: "testability",
		targetsQA: ["testability"],
		appliesToContext: ["any external service"],
		rationaleHint: "Avoid real-network tests; pre-scripted mocks.",
	},

	// Usability tactics
	{
		id: "cancel-task",
		label: "Cancel / undo user task",
		category: "usability",
		targetsQA: ["usability"],
		appliesToContext: ["long-running user actions"],
		rationaleHint: "User-confidence; tail latency protection.",
	},
	{
		id: "progress-indicator",
		label: "Show progress",
		category: "usability",
		targetsQA: ["usability"],
		appliesToContext: ["operations > 1s"],
		rationaleHint: "Spinner or real progress bar; never block the UI thread.",
	},
] as const;

/** Map tactic id → Tactic for direct lookup. */
export const TACTIC_BY_ID: ReadonlyMap<string, Tactic> = new Map(TACTIC_CATALOG.map((t) => [t.id, t]));

/** All tactic ids (lowercase). Useful for quick validation. */
export const TACTIC_IDS: ReadonlyArray<string> = TACTIC_CATALOG.map((t) => t.id);

/** True if `id` is a known tactic in the catalog. */
export function isKnownTactic(id: string): boolean {
	return TACTIC_BY_ID.has(id);
}

/**
 * Return the tactics that target a given QA category. The result
 * preserves catalog order, so callers can show "common choices first".
 */
export function tacticsForQA(qa: QACategory): Tactic[] {
	return TACTIC_CATALOG.filter((t) => t.targetsQA.includes(qa));
}
