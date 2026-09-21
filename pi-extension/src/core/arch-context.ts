/**
 * Architecture sub-life cycle — Step 2: Load project context.
 *
 * Before any scout spawns, the parent LLM (via the architecture handler)
 * must read every upstream artifact + every config file. This module
 * returns a single ArchContext object that the confirm step renders to
 * the user before any write happens.
 *
 * Pure IO + JSON parsing. No fs writes. No LLM calls. No UI calls.
 * All missing-file handling is explicit; the confirm step decides whether
 * a missing input is fatal or a warning.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./constants.js";
import { resolveDocArtifact } from "./paths.js";
import { loadFilesConfig, type FilesConfig } from "./config.js";
import { loadRequirementsProfile, type RequirementsProfile } from "./profile.js";

export interface ArchContext {
	runId: string;
	mission: string;
	/** v1.0.x legacy single-design projectName. */
	projectName: string;
	/** v1.3.0+ multi-design: when filesConfig has projectNames,
	 * the prelude shows one shape line per projectName. Empty
	 * (or undefined for legacy single-design fixtures) means use
	 * the legacy `projectName` field instead. */
	projectNames?: string[];
	filesConfig: FilesConfig | null;
	requirementsProfile: RequirementsProfile | null;
	standardsProfile: StandardsProfile | null;
	prd: LoadedDoc | null;
	rtm: LoadedDoc | null;
	feasibility: LoadedDoc | null;
	agentsConfig: AgentsConfigSnapshot | null;
	missingInputs: MissingInput[];
}

interface LoadedDoc {
	path: string;
	content: string;
}

export interface StandardsProfile {
	id: string;
	version: string;
	selectedAt: string;
	selectedBy: string;
}

interface AgentsConfigSnapshot {
	roles: Record<string, string>;
}

export interface MissingInput {
	kind:
		| "PRD"
		| "RTM"
		| "feasibility"
		| "filesConfig"
		| "requirementsProfile"
		| "standardsProfile"
		| "agentsConfig";
	path: string;
	reason: "file-missing" | "parse-error";
}

/**
 * Load every input the architecture sub-life cycle needs.
 *
 * - Returns `missingInputs` so the confirm step can surface gaps.
 * - Never throws on missing files; only on JSON parse errors that should
 *   be surfaced verbatim (and which still end up in `missingInputs`).
 * - `cwd` defaults to `process.cwd()`.
 */
export function loadArchContext(runId: string, mission: string, cwd: string = process.cwd()): ArchContext {
	const projectName = deriveProjectName(cwd);
	const filesConfig = readFilesConfig(cwd);
	const requirementsProfile = safeLoad(() => loadRequirementsProfile(cwd), "requirementsProfile", cwd);
	const standardsProfile = loadStandardsProfile(cwd);
	const prd = loadDoc(resolveDocArtifact("PRD", projectName, cwd)?.path, "PRD", cwd);
	const rtm = loadDoc(resolveDocArtifact("RTM", projectName, cwd)?.path, "RTM", cwd);
	const feasibility = loadDoc(
		resolveDocArtifact("feasibility-study", projectName, cwd)?.path,
		"feasibility",
		cwd,
	);
	const agentsConfig = loadAgentsConfig(cwd);

	// v1.3.0+ multi-design: projectNames from the config, if set.
	// Falls back to [] for the legacy single-design path.
	const projectNames = filesConfig
		? ((filesConfig as unknown as { projectNames?: string[] }).projectNames ?? [])
		: [];

	return {
		runId,
		mission,
		projectName,
		projectNames: projectNames.length > 0 ? projectNames : undefined,
		filesConfig,
		requirementsProfile,
		standardsProfile,
		prd,
		rtm,
		feasibility,
		agentsConfig,
		missingInputs: collectMissingInputs({
			filesConfig,
			requirementsProfile,
			standardsProfile,
			prd,
			rtm,
			feasibility,
			agentsConfig,
			cwd,
		}),
	};
}

/**
 * Build the one-paragraph summary the confirm step shows the developer.
 * Pure string formatting — no IO, no LLM.
 */
export function summarizeArchContext(ctx: ArchContext): string {
	const lines: string[] = [];
	lines.push(`Project: ${ctx.projectName || "(unnamed)"}`);
	lines.push(`Mission: ${ctx.mission || "(empty)"}`);
	lines.push(`Run: ${ctx.runId}`);
	lines.push(`Framework: ${ctx.filesConfig?.framework?.language ?? "(not configured)"}`);
	lines.push(
		`Standards overlay: ${ctx.standardsProfile ? `${ctx.standardsProfile.id}@${ctx.standardsProfile.version}` : "(none)"}`,
	);
	lines.push(
		`Requirements profile: ${ctx.requirementsProfile ? ctx.requirementsProfile.profileId : "(none)"}`,
	);
	lines.push(`Upstream artifacts:`);
	lines.push(`  - PRD: ${ctx.prd ? `${ctx.prd.path}` : "missing"}`);
	lines.push(`  - RTM: ${ctx.rtm ? `${ctx.rtm.path}` : "missing"}`);
	lines.push(`  - Feasibility: ${ctx.feasibility ? `${ctx.feasibility.path}` : "missing"}`);
	if (ctx.missingInputs.length > 0) {
		lines.push(`Missing inputs: ${ctx.missingInputs.map((m) => m.kind).join(", ")}`);
	}
	return lines.join("\n");
}

// ─── helpers ────────────────────────────────────────────────────────────────

function deriveProjectName(cwd: string): string {
	const path = join(cwd, PATHS.CONFIG_DIR, "files.json");
	if (!existsSync(path)) return "";
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as { projectName?: string };
		return typeof parsed.projectName === "string" ? parsed.projectName : "";
	} catch {
		return "";
	}
}

/**
 * Read files.json directly so a missing file is reported as null (not
 * the default config from `loadFilesConfig`).
 */
function readFilesConfig(cwd: string): FilesConfig | null {
	const path = join(cwd, PATHS.CONFIG_DIR, "files.json");
	if (!existsSync(path)) return null;
	try {
		const cfg = loadFilesConfig(cwd);
		// loadFilesConfig falls back to defaults when the file is missing;
		// if we got here, the file existed but was empty/malformed — return
		// null so the missing-inputs list surfaces it.
		if (cfg.projectName === "" && !existsSync(path)) return null;
		return cfg;
	} catch {
		return null;
	}
}

function safeLoad<T>(loader: () => T | null, kind: MissingInput["kind"], cwd: string): T | null {
	try {
		return loader();
	} catch (e) {
		// Surface parse errors via the missing-inputs list rather than throwing.
		// Callers decide whether to treat them as fatal.
		void e;
		return null;
	}
}

function loadStandardsProfile(cwd: string): StandardsProfile | null {
	const path = join(cwd, ".pi", "velpari", "standards-profile.json");
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as Partial<StandardsProfile>;
		if (
			typeof parsed.id !== "string" ||
			typeof parsed.version !== "string" ||
			typeof parsed.selectedAt !== "string" ||
			typeof parsed.selectedBy !== "string"
		) {
			return null;
		}
		return parsed as StandardsProfile;
	} catch {
		return null;
	}
}

function loadDoc(path: string | undefined, kind: MissingInput["kind"], cwd: string): LoadedDoc | null {
	if (!path) return null;
	if (!existsSync(path)) return null;
	try {
		return { path, content: readFileSync(path, "utf8") };
	} catch {
		void kind;
		return null;
	}
}

function loadAgentsConfig(cwd: string): AgentsConfigSnapshot | null {
	const path = join(cwd, ".pi", "velpari", "agents.json");
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as { roles?: Record<string, string> };
		if (parsed.roles && typeof parsed.roles === "object") {
			return { roles: parsed.roles };
		}
		return null;
	} catch {
		return null;
	}
}

function collectMissingInputs(args: {
	filesConfig: FilesConfig | null;
	requirementsProfile: RequirementsProfile | null;
	standardsProfile: StandardsProfile | null;
	prd: LoadedDoc | null;
	rtm: LoadedDoc | null;
	feasibility: LoadedDoc | null;
	agentsConfig: AgentsConfigSnapshot | null;
	cwd: string;
}): MissingInput[] {
	const out: MissingInput[] = [];
	if (!args.filesConfig) {
		out.push({ kind: "filesConfig", path: join(args.cwd, PATHS.CONFIG_DIR, "files.json"), reason: "file-missing" });
	}
	if (!args.requirementsProfile) {
		out.push({
			kind: "requirementsProfile",
			path: join(args.cwd, ".pi", "velpari", "requirements-profile.json"),
			reason: "file-missing",
		});
	}
	if (!args.standardsProfile) {
		// Standards profile is optional — only report when caller asks.
	}
	if (!args.prd) out.push({ kind: "PRD", path: "(published PRD)", reason: "file-missing" });
	if (!args.rtm) out.push({ kind: "RTM", path: "(published RTM)", reason: "file-missing" });
	if (!args.feasibility)
		out.push({ kind: "feasibility", path: "(published feasibility)", reason: "file-missing" });
	if (!args.agentsConfig) {
		out.push({
			kind: "agentsConfig",
			path: join(args.cwd, ".pi", "velpari", "agents.json"),
			reason: "file-missing",
		});
	}
	return out;
}
