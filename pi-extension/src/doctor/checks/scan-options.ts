/**
 * Scan-options doctor check (Phase C of the brainstorm lifecycle v2.1
 * upgrade).
 *
 * Reports which brainstorm scans are available given the current
 * files.json + filesystem state. Mirrors the logic in
 * `core/scan-options.ts: getAvailableScanTypes` so the developer can
 * verify their config without running brainstorm.
 *
 * Two project shapes:
 *   - code project     (codePaths configured + exist on disk) → code on
 *   - doc-only project (inputDocuments configured + exist) → doc on
 *   - any project                                             → community on
 *
 * The check is informational only — it never errors. The actual gating
 * happens at the SCAN-gate picker (`stages/brainstorm/scan-gate.ts`).
 */

import { loadFilesConfig } from "../../core/config.js";
import { availableScanList, getAvailableScanTypes } from "../../core/scan-options.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";

export function checkScanOptions(cwd: string = process.cwd()): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	let config;
	try {
		config = loadFilesConfig(cwd);
	} catch {
		// Phase C: corrupt files.json renders as info here — the Config
		// section already carries the UNREADABLE error (doctor-always-renders).
		items.push({
			status: "info",
			message: "Scan options: files.json unreadable — see the Config section",
		});
		return { title: "Available scans (SCAN gate)", items };
	}
	const available = getAvailableScanTypes(config, cwd);
	const enabled = availableScanList(available);

	// One info line per scan, with the reason when off
	for (const scan of ["code", "doc", "community"] as const) {
		const isOn = scan === "code" ? available.code : scan === "doc" ? available.doc : available.community;
		if (isOn) {
			items.push({
				status: "ok",
				message: `Scan "${scan}" is available.`,
			});
		} else {
			const reason = scan === "code" ? available.reasons.code : scan === "doc" ? available.reasons.doc : undefined;
			items.push({
				status: "info",
				message: `Scan "${scan}" is NOT available.${reason ? ` Reason: ${reason}.` : ""}`,
			});
		}
	}

	// Summary line — shows what the SCAN-gate picker will offer next time
	items.push({
		status: "info",
		message:
			enabled.length > 0
				? `SCAN-gate picker will offer: ${enabled.join(", ")}. The developer always chooses (v2.1: no default).`
				: "SCAN-gate picker will offer only community (web search — FR-52 consent).",
	});

	return { title: "Available scans (SCAN gate)", items };
}
