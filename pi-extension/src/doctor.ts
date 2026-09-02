import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadState } from "./state.js";
import { PATHS } from "./constants.js";

/**
 * Run the doctor audit. Phase A stub — returns a minimal report.
 */
export function runDoctor(cwd: string = process.cwd()): string {
	const statePath = join(cwd, PATHS.STATE_FILE);
	if (!existsSync(statePath)) {
		return "Doctor: No active Velpari run. Phase A stub.\n";
	}
	const state = loadState(cwd);
	return [
		"# Velpari Doctor Report",
		"",
		`Run: ${state.runId}`,
		`Stage: ${state.currentStage}`,
		"",
		"Phase A stub — full audit ships in Phase C.",
		"",
	].join("\n");
}

/**
 * Write the doctor report to disk. Phase A stub.
 */
export function writeDoctorReport(report: string, cwd: string = process.cwd()): void {
	const reportPath = join(cwd, PATHS.DOCTOR_REPORT);
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, report, "utf8");
}

/**
 * Scan text for accidental secrets. Phase A stub — returns empty list.
 * Real regex set ships in Phase C (NFR-04).
 */
export function scanForSecrets(_text: string): string[] {
	void _text;
	return [];
}
