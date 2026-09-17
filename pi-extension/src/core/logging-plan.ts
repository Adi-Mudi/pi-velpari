/**
 * Logging plan schema + validator + renderer + loader (L0).
 *
 * The logging plan is a cross-cutting deliverable produced by the
 * `/velpari-design-logging` discipline command. The published artifact
 * lives at `Doc/observability/logging-plan_<projectName>.md` (grouped
 * layout) or `Doc/logging-plan_<projectName>.md` (legacy fallback) and
 * is read by Senai through the `observability.loggingPlan` field of
 * `.pi/senai/architect-inputs.json`.
 *
 * The 17 required sections below are the single source of truth.
 * Both `skills/velpari-design-logging.md` and the doctor check
 * `doctor/checks/logging-plan.ts` import `LOGGING_PLAN_REQUIRED_SECTIONS`
 * from this module to avoid drift.
 *
 * L0 — imports nothing else from src/. Pure functions + types + IO.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Frozen constants — the canonical list of sections + their order.
// ---------------------------------------------------------------------------

/**
 * Frozen ordered list of the 16 required body sections. The YAML
 * frontmatter is structural metadata emitted by
 * `atomicWriteJsonWithFrontmatter` and is verified separately by
 * the doctor check (its own `frontmatter` item). The body sections
 * below are the markdown headings every published plan must carry,
 * in this exact order. The doctor gate refuses to publish a plan
 * that is missing any of them.
 */
export const LOGGING_PLAN_REQUIRED_SECTIONS: ReadonlyArray<string> = Object.freeze([
	"## 1. Logging Objectives & Scope",
	"## 2. Compliance Regime Map",
	"## 3. Event Catalog",
	"## 4. Log Shape",
	"## 5. Log Levels",
	"## 6. Transport",
	"## 7. Storage & Retention",
	"## 8. Protection",
	"## 9. Clock Synchronization",
	"## 10. Monitoring & Alerting",
	"## 11. Log Review Cadence",
	"## 12. Correlation IDs & Trace Context",
	"## 13. Privacy Considerations",
	"## 14. Mapping to Design Crosscuts",
	"## 15. Mapping to Test Plan",
	"## 16. Change Log",
]);

/**
 * RFC 5424 §6.2.1 severity levels (0 = Emergency, 7 = Debug).
 * Lower numbers are more severe.
 */
export const SYSLOG_SEVERITIES: ReadonlyArray<Severity> = Object.freeze([
	"emergency",
	"alert",
	"critical",
	"error",
	"warning",
	"notice",
	"informational",
	"debug",
]);

/** RFC 2119 requirement keywords. Each NFR row in the PRD must carry one. */
export const RFC_2119_KEYWORDS: ReadonlyArray<Rfc2119Keyword> = Object.freeze([
	"shall",
	"should",
	"may",
	"must",
	"required",
	"recommended",
	"optional",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** RFC 5424 severity level. Numeric value is implied by order in SYSLOG_SEVERITIES. */
export type Severity =
	| "emergency"
	| "alert"
	| "critical"
	| "error"
	| "warning"
	| "notice"
	| "informational"
	| "debug";

/** RFC 2119 requirement keyword. */
export type Rfc2119Keyword =
	| "shall"
	| "should"
	| "may"
	| "must"
	| "required"
	| "recommended"
	| "optional";

/** One compliance regime that applies to the project (e.g. PCI DSS Req 10). */
export interface ComplianceRegime {
	framework: string;
	version: string;
	clauses: string[];
	appliesTo: ReadonlyArray<"authn" | "authz" | "data-access" | "config" | "system" | "audit">;
}

/** Category of events that must be logged. */
export interface EventCategory {
	name: string;
	minimumSeverity: Severity;
	retentionMonths: number;
	examples: ReadonlyArray<string>;
}

/** One field in the canonical log shape (RFC 5424 + OWASP Logging Vocabulary). */
export interface LogShapeField {
	name: string;
	type: "string" | "number" | "boolean" | "object";
	required: boolean;
	description: string;
	example: string;
}

/** Storage tier (hot / warm / cold / archive). */
export interface RetentionTier {
	tier: "hot" | "warm" | "cold" | "archive";
	retentionMonths: number;
	storageBackend: string;
	encryptionAtRest: boolean;
}

/** One monitoring/alerting rule. */
export interface MonitoringAlert {
	name: string;
	trigger: string;
	severity: Severity;
	destination: string;
	slo?: string;
}

/** Complete logging plan (the structured form). */
export interface LoggingPlan {
	frontmatter: {
		artifact: "logging-plan";
		project: string;
		version: string;
		status: "draft" | "approved" | "deprecated";
		stage: string;
		run: string;
		created: string;
		updated: string;
		overlay?: string;
	};
	objectives: {
		purpose: string;
		scopeIn: ReadonlyArray<string>;
		scopeOut: ReadonlyArray<string>;
	};
	complianceRegimes: ReadonlyArray<ComplianceRegime>;
	eventCatalog: ReadonlyArray<EventCategory>;
	logShape: ReadonlyArray<LogShapeField>;
	logLevels: Readonly<Record<Severity, string>>;
	transport: {
		primary: string;
		fallbacks: ReadonlyArray<string>;
		protocol: string;
		tls: boolean;
	};
	storage: {
		primary: string;
		tiers: ReadonlyArray<RetentionTier>;
		piiRedaction: boolean;
		tamperEvident: boolean;
	};
	clockSync: {
		source: string;
		protocol: "NTP" | "PTP" | "chrony" | "other";
		maxSkewMs: number;
	};
	alerting: ReadonlyArray<MonitoringAlert>;
	reviewCadence: {
		dailyReviewRequired: boolean;
		reviewOwner: string;
		siemIntegration: string;
	};
	correlation: {
		traceContext: "W3C" | "OTel" | "none";
		headerName: string;
		propagatedByDefault: boolean;
	};
	mapping: {
		designCrosscutsSection: string;
		testCases: ReadonlyArray<string>;
	};
	changeLog: ReadonlyArray<{ date: string; author: string; note: string }>;
}

/** One validation issue found in a LoggingPlan. */
export interface LoggingPlanValidationError {
	field: string;
	message: string;
	severity: "error" | "warning";
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Pure validator. Returns an array of issues; empty array means valid.
 * Severity "error" blocks publish; "warning" is shown but does not block.
 */
export function validateLoggingPlan(plan: LoggingPlan): LoggingPlanValidationError[] {
	const errors: LoggingPlanValidationError[] = [];

	// Frontmatter
	if (plan.frontmatter.artifact !== "logging-plan") {
		errors.push({ field: "frontmatter.artifact", message: "must be 'logging-plan'", severity: "error" });
	}
	if (!plan.frontmatter.project) {
		errors.push({ field: "frontmatter.project", message: "must be non-empty", severity: "error" });
	}
	if (!/^\d+\.\d+\.\d+$/.test(plan.frontmatter.version)) {
		errors.push({ field: "frontmatter.version", message: "must be SemVer (e.g. 1.0.0)", severity: "error" });
	}
	if (!plan.frontmatter.created || !plan.frontmatter.updated) {
		errors.push({ field: "frontmatter.created", message: "created and updated must be set", severity: "error" });
	}

	// Objectives
	if (!plan.objectives.purpose) {
		errors.push({ field: "objectives.purpose", message: "must describe the plan's purpose", severity: "error" });
	}
	if (plan.objectives.scopeIn.length === 0) {
		errors.push({ field: "objectives.scopeIn", message: "must list at least one in-scope item", severity: "error" });
	}

	// Compliance regimes
	if (plan.complianceRegimes.length === 0) {
		errors.push({ field: "complianceRegimes", message: "must list at least one regime (even 'none')", severity: "warning" });
	}
	for (const regime of plan.complianceRegimes) {
		if (!regime.framework) {
			errors.push({ field: "complianceRegimes[].framework", message: "framework id required", severity: "error" });
		}
		if (!regime.version) {
			errors.push({ field: "complianceRegimes[].version", message: "framework version required", severity: "error" });
		}
		if (regime.clauses.length === 0) {
			errors.push({ field: `complianceRegimes[${regime.framework}].clauses`, message: "must name at least one clause", severity: "error" });
		}
	}

	// Event catalog
	if (plan.eventCatalog.length === 0) {
		errors.push({ field: "eventCatalog", message: "must list at least one event category", severity: "error" });
	}
	for (const ec of plan.eventCatalog) {
		if (!SYSLOG_SEVERITIES.includes(ec.minimumSeverity)) {
			errors.push({
				field: `eventCatalog[${ec.name}].minimumSeverity`,
				message: `unknown severity '${ec.minimumSeverity}' (RFC 5424 values: ${SYSLOG_SEVERITIES.join(", ")})`,
				severity: "error",
			});
		}
		if (ec.retentionMonths < 0) {
			errors.push({ field: `eventCatalog[${ec.name}].retentionMonths`, message: "must be ≥ 0", severity: "error" });
		}
		if (ec.examples.length === 0) {
			errors.push({ field: `eventCatalog[${ec.name}].examples`, message: "should list at least one example event", severity: "warning" });
		}
	}

	// Log shape (must include RFC 5424 mandatory fields)
	const requiredShapeFields = ["timestamp", "severity", "host", "message"];
	const fieldNames = plan.logShape.map((f) => f.name.toLowerCase());
	for (const required of requiredShapeFields) {
		if (!fieldNames.includes(required)) {
			errors.push({ field: "logShape", message: `missing required field '${required}'`, severity: "error" });
		}
	}
	for (const field of plan.logShape) {
		if (!field.name) {
			errors.push({ field: "logShape[].name", message: "name must be non-empty", severity: "error" });
		}
		if (!field.description) {
			errors.push({ field: `logShape[${field.name}].description`, message: "description must be non-empty", severity: "error" });
		}
	}

	// Log levels: every RFC 5424 severity must have a non-empty description
	for (const sev of SYSLOG_SEVERITIES) {
		if (!plan.logLevels[sev]) {
			errors.push({ field: `logLevels[${sev}]`, message: `RFC 5424 severity '${sev}' must have a description`, severity: "warning" });
		}
	}

	// Transport
	if (!plan.transport.primary) {
		errors.push({ field: "transport.primary", message: "primary transport required", severity: "error" });
	}
	if (!plan.transport.protocol) {
		errors.push({ field: "transport.protocol", message: "protocol required (e.g. RFC 5424, OTLP)", severity: "error" });
	}

	// Storage + retention
	if (!plan.storage.primary) {
		errors.push({ field: "storage.primary", message: "primary storage backend required", severity: "error" });
	}
	if (plan.storage.tiers.length === 0) {
		errors.push({ field: "storage.tiers", message: "at least one retention tier required", severity: "error" });
	}
	for (const tier of plan.storage.tiers) {
		if (tier.retentionMonths < 0) {
			errors.push({ field: `storage.tiers[${tier.tier}].retentionMonths`, message: "must be ≥ 0", severity: "error" });
		}
	}

	// Clock sync
	if (!plan.clockSync.source) {
		errors.push({ field: "clockSync.source", message: "clock source required (e.g. pool.ntp.org)", severity: "error" });
	}
	if (plan.clockSync.maxSkewMs < 0) {
		errors.push({ field: "clockSync.maxSkewMs", message: "must be ≥ 0", severity: "error" });
	}

	// Alerting
	if (plan.alerting.length === 0) {
		errors.push({ field: "alerting", message: "should list at least one alert rule", severity: "warning" });
	}
	for (const alert of plan.alerting) {
		if (!alert.name || !alert.trigger || !alert.destination) {
			errors.push({ field: `alerting[${alert.name}]`, message: "name, trigger, and destination required", severity: "error" });
		}
	}

	// Review cadence
	if (!plan.reviewCadence.reviewOwner) {
		errors.push({ field: "reviewCadence.reviewOwner", message: "must name a role or team", severity: "error" });
	}

	// Correlation
	if (!plan.correlation.headerName) {
		errors.push({ field: "correlation.headerName", message: "header name required (e.g. traceparent)", severity: "error" });
	}
	if (plan.correlation.traceContext !== "none" && plan.correlation.traceContext !== "W3C" && plan.correlation.traceContext !== "OTel") {
		errors.push({ field: "correlation.traceContext", message: `must be 'W3C', 'OTel', or 'none' (got '${plan.correlation.traceContext}')`, severity: "error" });
	}

	// Mapping
	if (!plan.mapping.designCrosscutsSection) {
		errors.push({ field: "mapping.designCrosscutsSection", message: "must reference the design §11 crosscuts section", severity: "warning" });
	}

	// Change log
	if (plan.changeLog.length === 0) {
		errors.push({ field: "changeLog", message: "should record at least the initial creation entry", severity: "warning" });
	}

	return errors;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Pure function: structured LoggingPlan → markdown string with YAML
 * frontmatter and the 17 required sections in their canonical order.
 * Section bodies are minimal placeholders; the parent LLM fills them
 * in based on the 3 scout reports.
 */
export function renderLoggingPlanMarkdown(plan: LoggingPlan): string {
	const lines: string[] = [];

	// Frontmatter
	lines.push("---");
	lines.push(`artifact: ${plan.frontmatter.artifact}`);
	lines.push(`project: ${plan.frontmatter.project}`);
	lines.push(`version: ${plan.frontmatter.version}`);
	lines.push(`status: ${plan.frontmatter.status}`);
	lines.push(`stage: ${plan.frontmatter.stage}`);
	lines.push(`run: ${plan.frontmatter.run}`);
	lines.push(`created: ${plan.frontmatter.created}`);
	lines.push(`updated: ${plan.frontmatter.updated}`);
	if (plan.frontmatter.overlay) {
		lines.push(`overlay: ${plan.frontmatter.overlay}`);
	}
	lines.push("---");
	lines.push("");

	// 1. Objectives & Scope
	lines.push("## 1. Logging Objectives & Scope");
	lines.push("");
	lines.push(`**Purpose.** ${plan.objectives.purpose}`);
	lines.push("");
	lines.push("**In scope.**");
	for (const item of plan.objectives.scopeIn) lines.push(`- ${item}`);
	lines.push("");
	lines.push("**Out of scope.**");
	for (const item of plan.objectives.scopeOut) lines.push(`- ${item}`);
	lines.push("");

	// 2. Compliance Regime Map
	lines.push("## 2. Compliance Regime Map");
	lines.push("");
	if (plan.complianceRegimes.length === 0) {
		lines.push("_No compliance regimes apply._");
	} else {
		lines.push("| Framework | Version | Clauses | Applies to |");
		lines.push("|---|---|---|---|");
		for (const r of plan.complianceRegimes) {
			lines.push(`| ${r.framework} | ${r.version} | ${r.clauses.join(", ")} | ${r.appliesTo.join(", ")} |`);
		}
	}
	lines.push("");

	// 3. Event Catalog
	lines.push("## 3. Event Catalog");
	lines.push("");
	if (plan.eventCatalog.length === 0) {
		lines.push("_No event categories defined._");
	} else {
		lines.push("| Event Category | Min Severity | Retention (months) | Examples |");
		lines.push("|---|---|---|---|");
		for (const ec of plan.eventCatalog) {
			lines.push(`| ${ec.name} | ${ec.minimumSeverity} | ${ec.retentionMonths} | ${ec.examples.join("; ")} |`);
		}
	}
	lines.push("");

	// 4. Log Shape
	lines.push("## 4. Log Shape");
	lines.push("");
	if (plan.logShape.length === 0) {
		lines.push("_No log fields defined._");
	} else {
		lines.push("| Field | Type | Required | Description | Example |");
		lines.push("|---|---|---|---|---|");
		for (const f of plan.logShape) {
			lines.push(`| ${f.name} | ${f.type} | ${f.required ? "yes" : "no"} | ${f.description} | \`${f.example}\` |`);
		}
	}
	lines.push("");

	// 5. Log Levels
	lines.push("## 5. Log Levels");
	lines.push("");
	lines.push("Per RFC 5424 §6.2.1 (lower number = more severe):");
	lines.push("");
	lines.push("| Code | Severity | When to use |");
	lines.push("|---|---|---|");
	const codeMap: Record<Severity, number> = {
		emergency: 0,
		alert: 1,
		critical: 2,
		error: 3,
		warning: 4,
		notice: 5,
		informational: 6,
		debug: 7,
	};
	for (const sev of SYSLOG_SEVERITIES) {
		lines.push(`| ${codeMap[sev]} | ${sev} | ${plan.logLevels[sev] ?? "(not defined)"} |`);
	}
	lines.push("");

	// 6. Transport
	lines.push("## 6. Transport");
	lines.push("");
	lines.push(`- **Primary:** ${plan.transport.primary}`);
	if (plan.transport.fallbacks.length > 0) {
		lines.push(`- **Fallbacks:** ${plan.transport.fallbacks.join(", ")}`);
	}
	lines.push(`- **Protocol:** ${plan.transport.protocol}`);
	lines.push(`- **TLS:** ${plan.transport.tls ? "required" : "optional"}`);
	lines.push("");

	// 7. Storage & Retention
	lines.push("## 7. Storage & Retention");
	lines.push("");
	lines.push(`- **Primary storage:** ${plan.storage.primary}`);
	lines.push(`- **PII redaction:** ${plan.storage.piiRedaction ? "enabled" : "disabled"}`);
	lines.push(`- **Tamper-evident:** ${plan.storage.tamperEvident ? "yes" : "no"}`);
	lines.push("");
	lines.push("| Tier | Retention (months) | Backend | Encryption at rest |");
	lines.push("|---|---|---|---|");
	for (const tier of plan.storage.tiers) {
		lines.push(`| ${tier.tier} | ${tier.retentionMonths} | ${tier.storageBackend} | ${tier.encryptionAtRest ? "yes" : "no"} |`);
	}
	lines.push("");

	// 8. Protection
	lines.push("## 8. Protection");
	lines.push("");
	lines.push(
		plan.storage.tamperEvident
			? "Logs are tamper-evident (append-only, signed, or WORM storage)."
			: "Logs are NOT tamper-evident; document the mitigation strategy here.",
	);
	lines.push("");
	lines.push(
		plan.transport.tls
			? "Logs are encrypted in transit (TLS required on every transport)."
			: "Logs are NOT encrypted in transit — document the network isolation justification.",
	);
	lines.push("");
	lines.push("Access controls (who can read, write, delete, archive):");
	lines.push("- Read: SRE + Security");
	lines.push("- Write: application code only");
	lines.push("- Delete: nobody (retention policy enforces)");
	lines.push("- Archive: SRE only, dual-control");
	lines.push("");

	// 9. Clock Synchronization
	lines.push("## 9. Clock Synchronization");
	lines.push("");
	lines.push(`- **Source:** ${plan.clockSync.source}`);
	lines.push(`- **Protocol:** ${plan.clockSync.protocol}`);
	lines.push(`- **Max skew:** ${plan.clockSync.maxSkewMs} ms`);
	lines.push("");

	// 10. Monitoring & Alerting
	lines.push("## 10. Monitoring & Alerting");
	lines.push("");
	if (plan.alerting.length === 0) {
		lines.push("_No alerting rules defined._");
	} else {
		lines.push("| Alert | Trigger | Severity | Destination | SLO |");
		lines.push("|---|---|---|---|---|");
		for (const a of plan.alerting) {
			lines.push(`| ${a.name} | ${a.trigger} | ${a.severity} | ${a.destination} | ${a.slo ?? "—"} |`);
		}
	}
	lines.push("");

	// 11. Log Review Cadence
	lines.push("## 11. Log Review Cadence");
	lines.push("");
	lines.push(`- **Daily review required:** ${plan.reviewCadence.dailyReviewRequired ? "yes" : "no"}`);
	lines.push(`- **Review owner:** ${plan.reviewCadence.reviewOwner}`);
	lines.push(`- **SIEM integration:** ${plan.reviewCadence.siemIntegration}`);
	lines.push("");

	// 12. Correlation IDs & Trace Context
	lines.push("## 12. Correlation IDs & Trace Context");
	lines.push("");
	lines.push(`- **Standard:** ${plan.correlation.traceContext}`);
	lines.push(`- **Header name:** ${plan.correlation.headerName}`);
	lines.push(`- **Propagated by default:** ${plan.correlation.propagatedByDefault ? "yes" : "no"}`);
	lines.push("");

	// 13. Privacy Considerations
	lines.push("## 13. Privacy Considerations");
	lines.push("");
	lines.push(
		plan.storage.piiRedaction
			? "PII redaction is enabled at the source (logger level) and at the storage layer."
			: "PII redaction is DISABLED — document why and what compensating controls apply.",
	);
	lines.push("");
	lines.push("GDPR Art. 25 (data protection by design) applies when personal data is logged.");
	lines.push("");

	// 14. Mapping to Design Crosscuts
	lines.push("## 14. Mapping to Design Crosscuts");
	lines.push("");
	lines.push(`This plan is referenced from \`${plan.mapping.designCrosscutsSection}\` of the design doc.`);
	lines.push("");

	// 15. Mapping to Test Plan
	lines.push("## 15. Mapping to Test Plan");
	lines.push("");
	if (plan.mapping.testCases.length === 0) {
		lines.push("_No test-case references yet — the test plan should cite this section when verifying logging._");
	} else {
		lines.push("Test cases that verify this plan:");
		for (const tc of plan.mapping.testCases) {
			lines.push(`- ${tc}`);
		}
	}
	lines.push("");

	// 16. Change Log
	lines.push("## 16. Change Log");
	lines.push("");
	lines.push("| Date | Author | Note |");
	lines.push("|---|---|---|");
	for (const entry of plan.changeLog) {
		lines.push(`| ${entry.date} | ${entry.author} | ${entry.note} |`);
	}
	lines.push("");

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Read the published logging plan from disk. Prefers the grouped
 * layout (`Doc/observability/logging-plan_<project>.md`) and falls
 * back to the legacy flat layout (`Doc/logging-plan_<project>.md`).
 * Returns null when neither exists.
 *
 * The loader returns the raw markdown; callers that need the
 * structured form should parse the frontmatter + sections themselves
 * (kept out of L0 to keep this layer dependency-free).
 */
export function loadPublishedLoggingPlanMarkdown(
	cwd: string,
	projectName: string,
): { path: string; layout: "grouped" | "legacy"; content: string } | null {
	const safeProject = projectName.replace(/[^A-Za-z0-9_-]+/g, "-");
	const grouped = join(cwd, "Doc", "observability", `logging-plan_${safeProject}.md`);
	const legacy = join(cwd, "Doc", `logging-plan_${safeProject}.md`);
	try {
		if (existsSync(grouped)) {
			return { path: grouped, layout: "grouped", content: readFileSync(grouped, "utf8") };
		}
		if (existsSync(legacy)) {
			return { path: legacy, layout: "legacy", content: readFileSync(legacy, "utf8") };
		}
		return null;
	} catch {
		return null;
	}
}
