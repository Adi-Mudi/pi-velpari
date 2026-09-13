/**
 * Diagnostic types for the doctor.
 *
 * Every check returns a `DiagnosticSection`; the orchestrator collects
 * sections into a `DiagnosticReport`. The report's verdict flips to
 * `false` when any item has status `"error"`.
 *
 * Mirrors `pi-seani/pi-extension/src/doctor/_types.ts` for parity, but
 * the contract is intentionally narrow so future phases (fix
 * suggestions, severity filtering, action-items callout) can build on
 * this base without a breaking change.
 */

export type DiagnosticStatus = "ok" | "warning" | "error" | "info";

export interface DiagnosticItem {
	status: DiagnosticStatus;
	message: string;
	details?: string[];
	suggestion?: string;
}

export interface DiagnosticSection {
	title: string;
	items: DiagnosticItem[];
}

export interface DiagnosticSummary {
	ok: number;
	warning: number;
	error: number;
	info: number;
}

export interface DiagnosticReport {
	ok: boolean;
	summary: DiagnosticSummary;
	sections: DiagnosticSection[];
}

/** Icon per status. Single source of truth for the renderer. */
export function iconFor(status: DiagnosticStatus): string {
	switch (status) {
		case "ok":
			return "✅";
		case "warning":
			return "⚠️";
		case "error":
			return "❌";
		case "info":
			return "ℹ️";
	}
}

/**
 * Compute the summary across all sections and the verdict flag.
 * Pure function; no side effects.
 */
export function summarize(sections: DiagnosticSection[]): {
	summary: DiagnosticSummary;
	ok: boolean;
} {
	const summary: DiagnosticSummary = { ok: 0, warning: 0, error: 0, info: 0 };
	for (const section of sections) {
		for (const item of section.items) {
			summary[item.status]++;
		}
	}
	return { summary, ok: summary.error === 0 };
}
