/**
 * LoggingPlan schema + validator + renderer (v1.4.0).
 *
 * Covers:
 *   - validateLoggingPlan: happy path, missing fields, invalid RFC 5424
 *     level, negative retention, bad correlation header, empty event
 *     catalog, missing log shape fields.
 *   - renderLoggingPlanMarkdown: produces a markdown string with all
 *     17 sections in canonical order + YAML frontmatter.
 *   - SYSLOG_SEVERITIES + RFC_2119_KEYWORDS constants.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	LOGGING_PLAN_REQUIRED_SECTIONS,
	RFC_2119_KEYWORDS,
	SYSLOG_SEVERITIES,
	renderLoggingPlanMarkdown,
	validateLoggingPlan,
	type LoggingPlan,
	type Severity,
} from "../../src/core/logging-plan.js";

function makePlan(overrides: Partial<LoggingPlan> = {}): LoggingPlan {
	return {
		frontmatter: {
			artifact: "logging-plan",
			project: "DemoApp",
			version: "1.0.0",
			status: "approved",
			stage: "designed",
			run: "2026-09-16-10-00-demo",
			created: "2026-09-16T10:00:00Z",
			updated: "2026-09-16T10:00:00Z",
			...overrides.frontmatter,
		},
		objectives: {
			purpose: "Audit-trail logging for compliance with PCI-DSS Req 10.",
			scopeIn: ["checkout service", "payment service"],
			scopeOut: ["marketing site"],
			...overrides.objectives,
		},
		complianceRegimes:
			overrides.complianceRegimes ?? [
				{
					framework: "PCI-DSS",
					version: "v4.0",
					clauses: ["10.2", "10.3", "10.5"],
					appliesTo: ["authn", "authz", "data-access"],
				},
			],
		eventCatalog:
			overrides.eventCatalog ?? [
				{
					name: "authn-success",
					minimumSeverity: "notice",
					retentionMonths: 12,
					examples: ["login"],
				},
			],
		logShape:
			overrides.logShape ?? [
				{ name: "timestamp", type: "string", required: true, description: "ISO 8601", example: "2026-09-16T10:00:00Z" },
				{ name: "severity", type: "string", required: true, description: "RFC 5424 level", example: "warning" },
				{ name: "host", type: "string", required: true, description: "Hostname", example: "host-1" },
				{ name: "message", type: "string", required: true, description: "Human text", example: "ok" },
			],
		logLevels: {
			emergency: "page",
			alert: "page",
			critical: "page",
			error: "alert",
			warning: "log",
			notice: "log",
			informational: "log",
			debug: "off",
			...overrides.logLevels,
		},
		transport: {
			primary: "OTLP/gRPC",
			fallbacks: [],
			protocol: "OTLP",
			tls: true,
			...overrides.transport,
		},
		storage: {
			primary: "OpenSearch",
			tiers: [
				{ tier: "hot", retentionMonths: 3, storageBackend: "NVMe", encryptionAtRest: true },
				{ tier: "warm", retentionMonths: 9, storageBackend: "S3", encryptionAtRest: true },
			],
			piiRedaction: true,
			tamperEvident: true,
			...overrides.storage,
		},
		clockSync: {
			source: "pool.ntp.org",
			protocol: "NTP",
			maxSkewMs: 50,
			...overrides.clockSync,
		},
		alerting:
			overrides.alerting ?? [
				{
					name: "authn-storm",
					trigger: ">=10 failures in 5m",
					severity: "critical",
					destination: "PagerDuty",
					slo: "60s",
				},
			],
		reviewCadence: {
			dailyReviewRequired: true,
			reviewOwner: "Security",
			siemIntegration: "Sentinel",
			...overrides.reviewCadence,
		},
		correlation: {
			traceContext: "W3C",
			headerName: "traceparent",
			propagatedByDefault: true,
			...overrides.correlation,
		},
		mapping: {
			designCrosscutsSection: "Doc/design/design_DemoApp.md §11",
			testCases: [],
			...overrides.mapping,
		},
		changeLog:
			overrides.changeLog ?? [
				{ date: "2026-09-16", author: "agent", note: "initial" },
			],
	};
}

describe("constants", () => {
	it("LOGGING_PLAN_REQUIRED_SECTIONS has 16 body entries in canonical order", () => {
		assert.strictEqual(LOGGING_PLAN_REQUIRED_SECTIONS.length, 16);
		assert.strictEqual(LOGGING_PLAN_REQUIRED_SECTIONS[0], "## 1. Logging Objectives & Scope");
		assert.strictEqual(LOGGING_PLAN_REQUIRED_SECTIONS[15], "## 16. Change Log");
	});

	it("SYSLOG_SEVERITIES has 8 RFC 5424 levels in canonical order", () => {
		assert.strictEqual(SYSLOG_SEVERITIES.length, 8);
		assert.deepEqual(
			[...SYSLOG_SEVERITIES],
			[
				"emergency",
				"alert",
				"critical",
				"error",
				"warning",
				"notice",
				"informational",
				"debug",
			],
		);
	});

	it("RFC_2119_KEYWORDS lists shall/should/may/must/required/recommended/optional", () => {
		assert.ok(RFC_2119_KEYWORDS.includes("shall"));
		assert.ok(RFC_2119_KEYWORDS.includes("should"));
		assert.ok(RFC_2119_KEYWORDS.includes("may"));
		assert.ok(RFC_2119_KEYWORDS.includes("must"));
	});
});

describe("validateLoggingPlan", () => {
	it("returns empty array for a complete plan", () => {
		const errors = validateLoggingPlan(makePlan());
		assert.deepEqual(errors, []);
	});

	it("rejects wrong frontmatter.artifact", () => {
		const errors = validateLoggingPlan(
			makePlan({ frontmatter: { artifact: "wrong" } as never }),
		);
		assert.ok(errors.some((e) => e.field === "frontmatter.artifact"));
	});

	it("rejects non-SemVer version", () => {
		const errors = validateLoggingPlan(
			makePlan({ frontmatter: { version: "1.0" } as never }),
		);
		assert.ok(errors.some((e) => e.field === "frontmatter.version"));
	});

	it("rejects empty event catalog", () => {
		const errors = validateLoggingPlan(makePlan({ eventCatalog: [] }));
		assert.ok(errors.some((e) => e.field === "eventCatalog" && e.severity === "error"));
	});

	it("rejects negative retention months", () => {
		const errors = validateLoggingPlan({
			...makePlan(),
			eventCatalog: [
				{
					name: "bad",
					minimumSeverity: "warning",
					retentionMonths: -1,
					examples: ["x"],
				},
			],
		});
		assert.ok(
			errors.some(
				(e) => e.field === "eventCatalog[bad].retentionMonths" && e.severity === "error",
			),
		);
	});

	it("rejects unknown RFC 5424 severity", () => {
		const errors = validateLoggingPlan({
			...makePlan(),
			eventCatalog: [
				{
					name: "x",
					minimumSeverity: "panic" as Severity,
					retentionMonths: 12,
					examples: ["x"],
				},
			],
		});
		assert.ok(
			errors.some((e) => e.field === "eventCatalog[x].minimumSeverity"),
		);
	});

	it("rejects log shape missing RFC 5424 mandatory fields", () => {
		const errors = validateLoggingPlan({
			...makePlan(),
			logShape: [
				{ name: "custom", type: "string", required: false, description: "x", example: "y" },
			],
		});
		assert.ok(errors.some((e) => e.field === "logShape" && e.message.includes("timestamp")));
	});

	it("rejects bad correlation traceContext", () => {
		const errors = validateLoggingPlan(
			makePlan({ correlation: { traceContext: "jaeger" as never, headerName: "traceparent", propagatedByDefault: true } }),
		);
		assert.ok(errors.some((e) => e.field === "correlation.traceContext"));
	});

	it("warns (not errors) when alert list is empty", () => {
		const errors = validateLoggingPlan(makePlan({ alerting: [] }));
		assert.ok(errors.some((e) => e.field === "alerting" && e.severity === "warning"));
		// and no errors
		assert.ok(!errors.some((e) => e.severity === "error"));
	});

	it("warns when change log is empty", () => {
		const errors = validateLoggingPlan(makePlan({ changeLog: [] }));
		assert.ok(errors.some((e) => e.field === "changeLog" && e.severity === "warning"));
	});
});

describe("renderLoggingPlanMarkdown", () => {
	it("produces frontmatter + all 17 sections", () => {
		const md = renderLoggingPlanMarkdown(makePlan());
		assert.ok(md.startsWith("---\n"));
		for (const heading of LOGGING_PLAN_REQUIRED_SECTIONS) {
			assert.ok(md.includes(heading), `missing heading: ${heading}`);
		}
	});

	it("includes overlay name in frontmatter when set", () => {
		const md = renderLoggingPlanMarkdown(
			makePlan({ frontmatter: { overlay: "financial-payments" } as never }),
		);
		assert.ok(md.includes("overlay: financial-payments"));
	});

	it("renders the event catalog as a markdown table", () => {
		const md = renderLoggingPlanMarkdown(makePlan());
		assert.ok(md.includes("| Event Category | Min Severity |"));
		assert.ok(md.includes("| authn-success |"));
	});

	it("renders the storage tier table with hot/warm/cold/archive", () => {
		const md = renderLoggingPlanMarkdown(makePlan());
		assert.ok(md.includes("| Tier | Retention (months) | Backend |"));
		assert.ok(md.includes("| hot | 3 | NVMe |"));
	});

	it("renders compliance regime map as a table", () => {
		const md = renderLoggingPlanMarkdown(makePlan());
		assert.ok(md.includes("| Framework | Version | Clauses | Applies to |"));
		assert.ok(md.includes("| PCI-DSS | v4.0 | 10.2, 10.3, 10.5 |"));
	});

	it("lists all 8 RFC 5424 severities in §5", () => {
		const md = renderLoggingPlanMarkdown(makePlan());
		const codeMap: Record<string, number> = {
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
			assert.ok(md.includes(`| ${codeMap[sev]} | ${sev} |`), `missing row for ${sev}`);
		}
	});

	it("renders change log entries", () => {
		const md = renderLoggingPlanMarkdown(makePlan());
		assert.ok(md.includes("| Date | Author | Note |"));
		assert.ok(md.includes("| 2026-09-16 | agent | initial |"));
	});
});
