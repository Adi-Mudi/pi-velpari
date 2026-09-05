/**
 * Doctor report writer.
 *
 * Phase D split: tiny file, just the disk-write side-effect of the report.
 * Kept separate from index.ts (which owns the orchestrator + handler)
 * because report-writing has no logical coupling to orchestration.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PATHS } from "../../core/constants.js";

/**
 * Write the doctor report to disk. Creates parent directories as needed.
 * Caller passes the report string produced by runDoctor.
 */
export function writeDoctorReport(report: string, cwd: string = process.cwd()): void {
	const reportPath = join(cwd, PATHS.DOCTOR_REPORT);
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, report, "utf8");
}
