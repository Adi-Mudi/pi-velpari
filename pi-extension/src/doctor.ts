/**
 * /velpari-doctor handler (FR-12).
 *
 * Audits the Velpari setup:
 *  - .pi/velpari/files.json validity (NFR-04)
 *  - Doc/ artifacts present for completed stages (FR-22 traceability)
 *  - Secret scan over all artifacts (NFR-04)
 *  - Writes report to .IDE_Plans/velpari/doctor-report.md (NFR-05)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadState } from "./state.js";
import { PATHS } from "./constants.js";
import { loadFilesConfig, validateFilesConfig } from "./config.js";

const MAX_NOTIFY_LENGTH = 8000;

const SECRET_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
	{ name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
	{ name: "GitHub PAT", regex: /ghp_[A-Za-z0-9]{36}/g },
	{ name: "OpenAI API Key", regex: /sk-[A-Za-z0-9]{48}/g },
	{ name: "Generic Bearer Token", regex: /Bearer\s+[A-Za-z0-9_\-.]{20,}/g },
];

/**
 * Scan text for accidental secrets (NFR-04).
 * Returns array of `{ pattern, line }` for each match.
 */
export function scanForSecrets(text: string): Array<{ pattern: string; line: number; match: string }> {
	const hits: Array<{ pattern: string; line: number; match: string }> = [];
	const lines = text.split("\n");
	for (const { name, regex } of SECRET_PATTERNS) {
		for (const [i, line] of lines.entries()) {
			const matches = line.match(regex);
			if (matches) {
				for (const m of matches) {
					hits.push({ pattern: name, line: i + 1, match: m });
				}
			}
		}
	}
	return hits;
}

/**
 * Run the full audit. Returns the report markdown and writes it to disk.
 */
export function runDoctor(cwd: string = process.cwd()): string {
	const lines: string[] = ["# Velpari Doctor Report", ""];

	const statePath = join(cwd, PATHS.STATE_FILE);
	const configPath = join(cwd, PATHS.CONFIG_DIR, "files.json");

	// 1. State file
	if (existsSync(statePath)) {
		const state = loadState(cwd);
		lines.push(`Run: ${state.runId}`);
		lines.push(`Mission: ${state.mission || "(none)"}`);
		lines.push(`Current stage: ${state.currentStage}`);
		lines.push(`History entries: ${state.history.length}`);
	} else {
		lines.push("No active run. State: empty.");
	}
	lines.push("");

	// 2. Config validity
	if (existsSync(configPath)) {
		const config = loadFilesConfig(cwd);
		const valid = validateFilesConfig(config);
		lines.push(`Config: ${valid ? "VALID" : "INVALID"} (projectName="${config.projectName}")`);
	} else {
		lines.push("Config: MISSING (run /velpari-configure-inputs)");
	}
	lines.push("");

	// 3. Doc/ artifact presence + secret scan
	const docDir = join(cwd, "Doc");
	lines.push("## Doc/ artifacts");
	if (!existsSync(docDir)) {
		lines.push("- Doc/ directory missing");
	} else {
		const files = readdirSync(docDir).filter((f) => f.endsWith(".md"));
		if (files.length === 0) {
			lines.push("- (no artifacts)");
		}
		const secrets: string[] = [];
		for (const f of files) {
			const filePath = join(docDir, f);
			const content = readFileSync(filePath, "utf8");
			lines.push(`- ${f}`);
			const hits = scanForSecrets(content);
			for (const h of hits) {
				secrets.push(`  - ${h.pattern} at line ${h.line} in ${f}`);
			}
		}
		if (secrets.length > 0) {
			lines.push("");
			lines.push("## Secret scan (NFR-04)");
			lines.push(...secrets);
		} else {
			lines.push("");
			lines.push("## Secret scan");
			lines.push("No secrets detected.");
		}
	}

	return lines.join("\n");
}

/**
 * Write the doctor report to disk.
 */
export function writeDoctorReport(report: string, cwd: string = process.cwd()): void {
	const reportPath = join(cwd, PATHS.DOCTOR_REPORT);
	mkdirSync(join(cwd, PATHS.RUN_STATE_DIR), { recursive: true });
	writeFileSync(reportPath, report, "utf8");
}

/**
 * /velpari-doctor handler. Runs the audit and emits summary.
 */
export async function handleDoctor(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const report = runDoctor(cwd);
	writeDoctorReport(report, cwd);
	const reportPath = join(cwd, PATHS.DOCTOR_REPORT);
	if (report.length <= MAX_NOTIFY_LENGTH) {
		ctx.ui.notify(report, "info");
	} else {
		ctx.ui.notify(report.slice(0, MAX_NOTIFY_LENGTH) + "\n... [truncated]", "info");
	}
	ctx.ui.notify(`Full report written to ${reportPath}.`, "info");
}
