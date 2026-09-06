/**
 * Sub-agent extension health check (Phase 4a).
 *
 * Audits pi's `settings.json` packages list for:
 *   - pi-interactive-subagents present (error if missing)
 *   - version ≥ 3.7.2 (warning if older; the version comes from the
 *     cloned git repo's package.json)
 *   - no competing subagent providers (warning if more than one)
 *   - no dead local-path entries (warning if a non-npm: / non-git:
 *     path doesn't resolve)
 *
 * Mirrors Senai's checks-environment.checkSubagentExtension, adapted
 * to the Velpari scope (only the subagent provider matters; Senai
 * also audits retry/compaction — those don't apply here).
 */

import { existsSync, readFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join, isAbsolute } from "node:path";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Provider packages we know about; >1 = ambiguous tool resolution. */
const SUBAGENT_PROVIDER_PACKAGES = [
	"pi-interactive-subagents",
	"pi-subagents",
	"pi-teams",
	"extensions/subagent",
];

/** Minimum version of pi-interactive-subagents that Velpari requires. */
const MIN_PROVIDER_VERSION = "3.7.2";

interface SettingsShape {
	packages?: string[];
	retry?: { enabled?: boolean; maxRetries?: number };
	compaction?: { enabled?: boolean; reserveTokens?: number };
}

function loadSettings(agentDirOverride?: string): SettingsShape | null {
	try {
		const settingsPath = join(agentDirOverride ?? getAgentDir(), "settings.json");
		if (!existsSync(settingsPath)) return null;
		return JSON.parse(readFileSync(settingsPath, "utf8")) as SettingsShape;
	} catch {
		return null;
	}
}

function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map((n) => Number.parseInt(n, 10));
	const pb = b.split(".").map((n) => Number.parseInt(n, 10));
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = pa[i] ?? 0;
		const nb = pb[i] ?? 0;
		if (na < nb) return -1;
		if (na > nb) return 1;
	}
	return 0;
}

export function checkSubagentExtension(agentDirOverride?: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const settings = loadSettings(agentDirOverride);

	if (!settings) {
		items.push({
			status: "info",
			message: "Could not read pi settings.json — sub-agent extension check skipped.",
		});
		return { title: "Sub-agent extension", items };
	}

	const packages = Array.isArray(settings.packages) ? settings.packages : [];
	const agentDir = agentDirOverride ?? getAgentDir();

	// 1. Dead local-path entries.
	for (const pkg of packages) {
		if (pkg.startsWith("npm:") || pkg.startsWith("git:")) continue;
		const resolved = isAbsolute(pkg) ? pkg : join(agentDir, pkg);
		if (!existsSync(resolved)) {
			items.push({
				status: "warning",
				message: `Dead package entry in settings.json: "${pkg}"`,
				details: [
					`Resolved path does not exist: ${resolved}`,
					"A stale entry can later reappear and shadow the real sub-agent provider. Remove it.",
				],
			});
		}
	}

	// 2. Multiple sub-agent providers installed.
	const providers = packages.filter((pkg) =>
		SUBAGENT_PROVIDER_PACKAGES.some((known) => pkg.includes(known)),
	);
	if (providers.length > 1) {
		items.push({
			status: "warning",
			message: `Multiple sub-agent-providing extensions installed: ${providers.join(", ")}`,
			details: [
				"Velpari is tested against pi-interactive-subagents; other providers may register conflicting `subagent` tools.",
				"Keep exactly one sub-agent provider in the packages list.",
			],
		});
	}

	// 3. pi-interactive-subagents presence and version.
	const hasProvider = packages.some((pkg) => pkg.includes("pi-interactive-subagents"));
	if (!hasProvider) {
		items.push({
			status: "error",
			message: "pi-interactive-subagents is not in pi's packages list.",
			details: [
				"Velpari delegates all visible-subagent spawning to it. Without it, /velpari-discuss cannot spawn the 4 scout subagents in multiplexer panes.",
			],
			suggestion: suggestionFor("subagent-ext-missing"),
		});
	} else {
		let version: string | null = null;
		try {
			const pkgJson = join(
				agentDir,
				"git",
				"github.com",
				"HazAT",
				"pi-interactive-subagents",
				"package.json",
			);
			version = (JSON.parse(readFileSync(pkgJson, "utf8")) as { version?: string }).version ?? null;
		} catch {
			version = null;
		}
		if (version === null) {
			items.push({
				status: "info",
				message: "pi-interactive-subagents is listed but its installed version could not be read.",
			});
		} else if (compareVersions(version, MIN_PROVIDER_VERSION) < 0) {
			items.push({
				status: "warning",
				message: `pi-interactive-subagents ${version} is older than ${MIN_PROVIDER_VERSION}.`,
				details: [
					"Older versions lack the failure reporting Velpari relies on.",
				],
				suggestion: suggestionFor("subagent-ext-missing"),
			});
		} else {
			items.push({
				status: "ok",
				message: `pi-interactive-subagents ${version} installed (≥ ${MIN_PROVIDER_VERSION}).`,
			});
		}
	}

	return { title: "Sub-agent extension", items };
}
