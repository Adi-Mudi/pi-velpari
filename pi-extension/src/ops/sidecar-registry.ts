/**
 * Sidecar registry (B3 — D3, generalized publish machinery; L1).
 *
 * **LEGACY — READ-ONLY FALLBACK (Phase 6, decision §14.3).**
 *
 * As of Phase 6 (`/IDE_Plans/dbstore_phase6_plan_*.md`), the database is the
 * single machine source of truth for all 9 stage kinds (PRD onward). The
 * YAML/JSON sidecars (`RTM_<project>.yaml`, `atomic-functions_<project>.yaml`,
 * `test-cases_<project>.yaml`, `development-order_<project>.yaml`,
 * `feasibility-decision_<project>.yaml`) are **no longer the source of
 * truth** — the publish path writes the structured rows to the store DB and
 * exports YAML only as a download view (`exportArtifactYaml`). Nothing in
 * the publish path reads from these sidecars; nothing writes them.
 *
 * This module's exports stay so the core engines + doctor checks can still
 * **read** a published sidecar from a pre-v002 / pre-Phase-6 project
 * (one place per engine, factored through a shared loader — see
 * `core/{rtm-data,af-data,test-cases-data,dev-order-data}.ts` and the
 * `resolve*Sidecar` helpers). The DB-first readers are wired in
 * Subphase 2.4 and prefer the store rows; this registry is the
 * LEGACY fallback ONLY — when the store has no published rows for the
 * kind. Full removal is Phase 11 (`/velpari-migrate-store`).
 *
 * The render/serialize methods remain on each entry as a code reference
 * (the legacy fallback chain uses them to materialize a markdown view
 * when the engine must produce one) — but they are NOT consumed by
 * `ops/approve.ts` anymore. Approve ignores sidecar files in working
 * copies entirely (decision §14.3); the publish source is the stage
 * payload (`ops/stage-payloads.ts`).
 *
 * D6 (legacy): for every registry artifact the **legacy** publish path
 * required the sidecar — a markdown-only working copy was blocked. After
 * Phase 6 the publish path no longer reads sidecars; the block message is
 * gone. New working copies must ship a payload JSON instead.
 *
 * Entries are keyed by artifact kind as it appears in target
 * `fileArtifact` (`RTM`, `atomic-functions`, `test-cases`,
 * `development-order`). Note `test-cases` publishes inside the testplan
 * stage, so the publish branch keys on the target artifact, not only on
 * the stage mapping.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDocArtifact } from "../core/paths.js";
import { diffRtmData, renderRtmMarkdown, resolveRtmSidecar, validateRtmData, type RtmData } from "../core/rtm-data.js";
import { diffAfData, renderAfMarkdown, resolveAfSidecar, validateAfData, type AfData } from "../core/af-data.js";
import {
	diffTestCasesData,
	renderTestCasesMarkdown,
	resolveTestCasesSidecar,
	validateTestCasesData,
	type TestCasesData,
} from "../core/test-cases-data.js";
import {
	diffDevOrderData,
	renderDevOrderMarkdown,
	resolveDevOrderSidecar,
	validateDevOrderData,
	type DevOrderData,
} from "../core/dev-order-data.js";
import { deriveAtomicProfile } from "../core/atomic-tier.js";
import { loadFilesConfig } from "../core/config.js";
import { extractRequirementFingerprints, stampFingerprints } from "../core/fingerprints.js";
import { parseYaml, readYamlFile, toYamlString } from "../core/yaml-data.js";

interface SidecarParseResult {
	ok: boolean;
	/** Validated data (unknown — entries cast internally). */
	data?: unknown;
	/** Actionable, line/field-level issues when ok === false. */
	issues: string[];
}

interface SidecarEntry {
	/** Artifact kind matching target `fileArtifact` (e.g. "RTM"). */
	artifact: string;
	/** Human label for error messages (e.g. "RTM"). */
	label: string;
	/** Find the LLM-authored sidecar file in the working directory listing. */
	detectWorkingSidecar(workingFiles: readonly string[]): string | null;
	/** Parse + validate the working sidecar text. */
	parseAndValidate(text: string): SidecarParseResult;
	/** Revision rules vs the published baseline. */
	diff(baseline: unknown, updated: unknown): string[];
	/** Render the published markdown from validated data. */
	render(data: unknown): string;
	/** Published sidecar file name. */
	sidecarName(projectName: string): string;
	/** Serialize validated data for the published sidecar. */
	serialize(data: unknown): string;
	/**
	 * Load the published baseline sidecar data. Returns:
	 *  - null when no published sidecar exists (fresh publish — no diff);
	 *  - { path, data: null } when a sidecar exists but is unreadable
	 *    (the publish branch reports it as a revision-gate issue);
	 *  - { path, data } otherwise.
	 */
	loadPublishedBaseline(cwd: string, projectName: string): { path: string; data: unknown | null } | null;
	/** Post-validation hook (RTM: stamp PSRS fingerprints into the rows). */
	postValidate?(data: unknown, ctx: { cwd: string; projectName: string }): unknown;
	/**
	 * Context-aware validation hook (AF: tier-required fields derived
	 * from `.pi/velpari/files.json`). Returned issues hard-block the
	 * publish. Runs after `parseAndValidate` succeeds.
	 */
	validateWithCtx?(data: unknown, ctx: { cwd: string; projectName: string }): string[];
}

const rtmEntry: SidecarEntry = {
	artifact: "RTM",
	label: "RTM",
	/**
	 * Find the LLM-authored RTM sidecar in the working copy. Prefers
	 * `.yaml` (D4); falls back to the legacy `.json` format.
	 * @param {readonly string[]} workingFiles - Directory listing of the working copy.
	 * @returns {string | null} The matching file name, or null when absent.
	 */
	detectWorkingSidecar(workingFiles) {
		return (
			workingFiles.find((f) => f.startsWith("RTM_") && f.endsWith(".yaml")) ??
			workingFiles.find((f) => f.startsWith("RTM_") && f.endsWith(".json")) ??
			null
		);
	},
	/**
	 * Parse + validate the working sidecar text. Returns either a typed
	 * RtmData payload or an actionable list of issues.
	 * @param {string} text - The raw sidecar file contents.
	 * @returns {SidecarParseResult} ok=true with data on success; ok=false with issues on failure.
	 */
	parseAndValidate(text) {
		const parsed = parseYaml(text);
		if (!parsed.ok) {
			return {
				ok: false,
				issues: parsed.error.split("\n").map((e) => `YAML: ${e}`),
			};
		}
		const validation = validateRtmData(parsed.data);
		return validation.ok
			? { ok: true, data: parsed.data as RtmData, issues: [] }
			: { ok: false, issues: validation.issues };
	},
	/**
	 * Diff an updated RtmData against a published baseline; returns the
	 * list of revision-rule issues that block a publish.
	 * @param {unknown} baseline - The published RtmData (or null fallback).
	 * @param {unknown} updated - The newly validated RtmData.
	 * @returns {string[]} Issue strings; empty array means revision-clean.
	 */
	diff(baseline, updated) {
		return diffRtmData(baseline as RtmData, updated as RtmData).issues;
	},
	/**
	 * Render the published RTM markdown from validated RtmData.
	 * @param {unknown} data - Validated RtmData payload.
	 * @returns {string} The full RTM markdown body.
	 */
	render(data) {
		return renderRtmMarkdown(data as RtmData);
	},
	/**
	 * The published sidecar file name (always YAML post-D4).
	 * @param {string} projectName - Project name suffix for the filename.
	 * @returns {string} The full sidecar file name.
	 */
	sidecarName(projectName) {
		return `RTM_${projectName}.yaml`;
	},
	/**
	 * Serialize validated RtmData to the published YAML sidecar bytes.
	 * @param {unknown} data - Validated RtmData payload.
	 * @returns {string} Deterministic YAML text (G5).
	 */
	serialize(data) {
		return toYamlString(data);
	},
	/**
	 * Locate and parse the previously published RTM sidecar (legacy
	 * pre-v002 fallback — the DB-primary readers in `core/rtm-data.ts`
	 * prefer the store rows when present).
	 * @param {string} cwd - Project root.
	 * @param {string} projectName - Project name suffix.
	 * @returns {{ path: string; data: unknown | null } | null} null when no published sidecar exists; otherwise the path and parsed YAML (or null when unreadable).
	 */
	loadPublishedBaseline(cwd, projectName) {
		const md = resolveDocArtifact("RTM", projectName, cwd);
		const mdPath = md?.path ?? join(cwd, "Doc", "requirements", `RTM_${projectName}.md`);
		const sidecar = resolveRtmSidecar(mdPath);
		if (!sidecar) return null;
		const data = readYamlFile(sidecar.path);
		return { path: sidecar.path, data };
	},
	/**
	 * Post-validation hook: stamp PSRS-derived requirement fingerprints
	 * into the RtmData rows (Phase 3).
	 * @param {unknown} data - Validated RtmData payload.
	 * @param {{ cwd: string; projectName: string }} ctx - Project context.
	 * @returns {unknown} The stamped RtmData payload (mutates in place).
	 */
	postValidate(data, { cwd, projectName }) {
		// Stamp requirement fingerprints from the published PSRS (Phase 3).
		// The LLM never hashes; rows with unknown ids stay unstamped and
		// are reported by doctor.
		const rtmData = data as RtmData;
		const psrs = resolveDocArtifact("PRD", projectName, cwd);
		if (psrs) {
			rtmData.rows = stampFingerprints(rtmData.rows, extractRequirementFingerprints(readFileSync(psrs.path, "utf8")));
		}
		return rtmData;
	},
};

const afEntry: SidecarEntry = {
	artifact: "atomic-functions",
	label: "Atomic-functions",
	/**
	 * Find the LLM-authored AF sidecar in the working copy (YAML only).
	 * @param {readonly string[]} workingFiles - Directory listing of the working copy.
	 * @returns {string | null} The matching file name, or null when absent.
	 */
	detectWorkingSidecar(workingFiles) {
		return workingFiles.find((f) => f.startsWith("atomic-functions_") && f.endsWith(".yaml")) ?? null;
	},
	/**
	 * Parse + validate the working sidecar text. Base validation only;
	 * tier-required fields are checked in `validateWithCtx` (needs the
	 * configured profile from `files.json`).
	 * @param {string} text - The raw sidecar file contents.
	 * @returns {SidecarParseResult} ok=true with data on success; ok=false with issues on failure.
	 */
	parseAndValidate(text) {
		const parsed = parseYaml(text);
		if (!parsed.ok) {
			return {
				ok: false,
				issues: parsed.error.split("\n").map((e) => `YAML: ${e}`),
			};
		}
		// Base validation only — the tier-required fields need the
		// configured profile, which validateWithCtx supplies.
		const validation = validateAfData(parsed.data);
		return validation.ok
			? { ok: true, data: parsed.data as AfData, issues: [] }
			: { ok: false, issues: validation.issues };
	},
	/**
	 * Context-aware validation: stamps the configured tier (from
	 * `.pi/velpari/files.json`) onto the AF data when absent, then runs
	 * tier-aware validation. Returned issues hard-block the publish.
	 * @param {unknown} data - Validated AfData payload (from parseAndValidate).
	 * @param {{ cwd: string; projectName: string }} ctx - Project context.
	 * @returns {string[]} Issue strings; empty array means tier-clean.
	 */
	validateWithCtx(data, { cwd }) {
		const tier = deriveAtomicProfile(loadFilesConfig(cwd)).tier;
		const afData = data as AfData;
		// Stamp the tier so the rendered table carries the tier columns.
		afData.tier = afData.tier ?? tier;
		return validateAfData(afData, { tier }).issues;
	},
	/**
	 * Diff an updated AfData against a published baseline; returns the
	 * list of revision-rule issues that block a publish.
	 * @param {unknown} baseline - The published AfData (or null fallback).
	 * @param {unknown} updated - The newly validated AfData.
	 * @returns {string[]} Issue strings; empty array means revision-clean.
	 */
	diff(baseline, updated) {
		return diffAfData(baseline as AfData, updated as AfData).issues;
	},
	/**
	 * Render the published AF markdown from validated AfData.
	 * @param {unknown} data - Validated AfData payload.
	 * @returns {string} The full atomic-functions markdown body.
	 */
	render(data) {
		return renderAfMarkdown(data as AfData);
	},
	/**
	 * The published AF sidecar file name (always YAML).
	 * @param {string} projectName - Project name suffix for the filename.
	 * @returns {string} The full sidecar file name.
	 */
	sidecarName(projectName) {
		return `atomic-functions_${projectName}.yaml`;
	},
	/**
	 * Serialize validated AfData to the published YAML sidecar bytes.
	 * @param {unknown} data - Validated AfData payload.
	 * @returns {string} Deterministic YAML text (G5).
	 */
	serialize(data) {
		return toYamlString(data);
	},
	/**
	 * Locate and parse the previously published AF sidecar (legacy
	 * pre-v002 fallback — the DB-primary readers in `core/af-data.ts`
	 * prefer the store rows when present).
	 * @param {string} cwd - Project root.
	 * @param {string} projectName - Project name suffix.
	 * @returns {{ path: string; data: unknown | null } | null} null when no published sidecar exists; otherwise the path and parsed YAML (or null when unreadable).
	 */
	loadPublishedBaseline(cwd, projectName) {
		const md = resolveDocArtifact("atomic-functions", projectName, cwd);
		const mdPath = md?.path ?? join(cwd, "Doc", "atomic-functions", `atomic-functions_${projectName}.md`);
		const sidecar = resolveAfSidecar(mdPath);
		if (!sidecar) return null;
		const data = readYamlFile(sidecar);
		return { path: sidecar, data };
	},
};

const testCasesEntry: SidecarEntry = {
	artifact: "test-cases",
	label: "Test-cases",
	/**
	 * Find the LLM-authored test-cases sidecar in the working copy
	 * (YAML only).
	 * @param {readonly string[]} workingFiles - Directory listing of the working copy.
	 * @returns {string | null} The matching file name, or null when absent.
	 */
	detectWorkingSidecar(workingFiles) {
		return workingFiles.find((f) => f.startsWith("test-cases_") && f.endsWith(".yaml")) ?? null;
	},
	/**
	 * Parse + validate the working sidecar text. Returns either a typed
	 * TestCasesData payload or an actionable list of issues.
	 * @param {string} text - The raw sidecar file contents.
	 * @returns {SidecarParseResult} ok=true with data on success; ok=false with issues on failure.
	 */
	parseAndValidate(text) {
		const parsed = parseYaml(text);
		if (!parsed.ok) {
			return {
				ok: false,
				issues: parsed.error.split("\n").map((e) => `YAML: ${e}`),
			};
		}
		const validation = validateTestCasesData(parsed.data);
		return validation.ok
			? { ok: true, data: parsed.data as TestCasesData, issues: [] }
			: { ok: false, issues: validation.issues };
	},
	/**
	 * Diff an updated TestCasesData against a published baseline; returns
	 * the list of revision-rule issues that block a publish.
	 * @param {unknown} baseline - The published TestCasesData (or null fallback).
	 * @param {unknown} updated - The newly validated TestCasesData.
	 * @returns {string[]} Issue strings; empty array means revision-clean.
	 */
	diff(baseline, updated) {
		return diffTestCasesData(baseline as TestCasesData, updated as TestCasesData).issues;
	},
	/**
	 * Render the published test-cases markdown from validated TestCasesData.
	 * @param {unknown} data - Validated TestCasesData payload.
	 * @returns {string} The full test-cases markdown body.
	 */
	render(data) {
		return renderTestCasesMarkdown(data as TestCasesData);
	},
	/**
	 * The published test-cases sidecar file name (always YAML).
	 * @param {string} projectName - Project name suffix for the filename.
	 * @returns {string} The full sidecar file name.
	 */
	sidecarName(projectName) {
		return `test-cases_${projectName}.yaml`;
	},
	/**
	 * Serialize validated TestCasesData to the published YAML sidecar bytes.
	 * @param {unknown} data - Validated TestCasesData payload.
	 * @returns {string} Deterministic YAML text (G5).
	 */
	serialize(data) {
		return toYamlString(data);
	},
	/**
	 * Locate and parse the previously published test-cases sidecar
	 * (legacy pre-v002 fallback — the DB-primary readers in
	 * `core/test-cases-data.ts` prefer the store rows when present).
	 * @param {string} cwd - Project root.
	 * @param {string} projectName - Project name suffix.
	 * @returns {{ path: string; data: unknown | null } | null} null when no published sidecar exists; otherwise the path and parsed YAML (or null when unreadable).
	 */
	loadPublishedBaseline(cwd, projectName) {
		const md = resolveDocArtifact("test-cases", projectName, cwd);
		const mdPath = md?.path ?? join(cwd, "Doc", "tests", `test-cases_${projectName}.md`);
		const sidecar = resolveTestCasesSidecar(mdPath);
		if (!sidecar) return null;
		const data = readYamlFile(sidecar);
		return { path: sidecar, data };
	},
};

const devOrderEntry: SidecarEntry = {
	artifact: "development-order",
	label: "Development-order",
	/**
	 * Find the LLM-authored development-order sidecar in the working
	 * copy (YAML only).
	 * @param {readonly string[]} workingFiles - Directory listing of the working copy.
	 * @returns {string | null} The matching file name, or null when absent.
	 */
	detectWorkingSidecar(workingFiles) {
		return workingFiles.find((f) => f.startsWith("development-order_") && f.endsWith(".yaml")) ?? null;
	},
	/**
	 * Parse + validate the working sidecar text. Returns either a typed
	 * DevOrderData payload or an actionable list of issues.
	 * @param {string} text - The raw sidecar file contents.
	 * @returns {SidecarParseResult} ok=true with data on success; ok=false with issues on failure.
	 */
	parseAndValidate(text) {
		const parsed = parseYaml(text);
		if (!parsed.ok) {
			return {
				ok: false,
				issues: parsed.error.split("\n").map((e) => `YAML: ${e}`),
			};
		}
		const validation = validateDevOrderData(parsed.data);
		return validation.ok
			? { ok: true, data: parsed.data as DevOrderData, issues: [] }
			: { ok: false, issues: validation.issues };
	},
	/**
	 * Diff an updated DevOrderData against a published baseline; returns
	 * the list of revision-rule issues that block a publish.
	 * @param {unknown} baseline - The published DevOrderData (or null fallback).
	 * @param {unknown} updated - The newly validated DevOrderData.
	 * @returns {string[]} Issue strings; empty array means revision-clean.
	 */
	diff(baseline, updated) {
		return diffDevOrderData(baseline as DevOrderData, updated as DevOrderData).issues;
	},
	/**
	 * Render the published development-order markdown from validated DevOrderData.
	 * @param {unknown} data - Validated DevOrderData payload.
	 * @returns {string} The full development-order markdown body.
	 */
	render(data) {
		return renderDevOrderMarkdown(data as DevOrderData);
	},
	/**
	 * The published development-order sidecar file name (always YAML).
	 * @param {string} projectName - Project name suffix for the filename.
	 * @returns {string} The full sidecar file name.
	 */
	sidecarName(projectName) {
		return `development-order_${projectName}.yaml`;
	},
	/**
	 * Serialize validated DevOrderData to the published YAML sidecar bytes.
	 * @param {unknown} data - Validated DevOrderData payload.
	 * @returns {string} Deterministic YAML text (G5).
	 */
	serialize(data) {
		return toYamlString(data);
	},
	/**
	 * Locate and parse the previously published development-order
	 * sidecar (legacy pre-v002 fallback — the DB-primary readers in
	 * `core/dev-order-data.ts` prefer the store rows when present).
	 * @param {string} cwd - Project root.
	 * @param {string} projectName - Project name suffix.
	 * @returns {{ path: string; data: unknown | null } | null} null when no published sidecar exists; otherwise the path and parsed YAML (or null when unreadable).
	 */
	loadPublishedBaseline(cwd, projectName) {
		const md = resolveDocArtifact("development-order", projectName, cwd);
		const mdPath = md?.path ?? join(cwd, "Doc", "development-order", `development-order_${projectName}.md`);
		const sidecar = resolveDevOrderSidecar(mdPath);
		if (!sidecar) return null;
		const data = readYamlFile(sidecar);
		return { path: sidecar, data };
	},
};

/** Registry keyed by artifact kind (`fileArtifact`). */
export const SIDECAR_REGISTRY: Readonly<Record<string, SidecarEntry>> = {
	RTM: rtmEntry,
	"atomic-functions": afEntry,
	"test-cases": testCasesEntry,
	"development-order": devOrderEntry,
};
