/**
 * Sidecar registry (B3 — D3, generalized publish machinery; L1).
 *
 * One entry per sidecar-backed artifact. The publish branch in
 * `ops/approve.ts` consumes the registry instead of per-artifact
 * hardcoded blocks: detect the LLM-authored sidecar in the working copy
 * → parse + validate (hard-block on invalid, actionable issues) → diff
 * against the published baseline (revision rules) → RE-RENDER the
 * published markdown from the data → attach the serialized sidecar →
 * stamp both files (extraPaths). RTM is the first entry; its behavior is
 * unchanged (including the dual-read `.yaml` → `.json` fallback of D4
 * and the PSRS fingerprint stamping).
 *
 * D6: for every registry artifact the publish REQUIRES the sidecar —
 * a markdown-only working copy of a sidecar artifact is blocked with an
 * actionable message. Legacy PUBLISHED artifacts without sidecars stay
 * doctor warnings (never blocks).
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
import {
	diffRtmData,
	renderRtmMarkdown,
	resolveRtmSidecar,
	validateRtmData,
	type RtmData,
} from "../core/rtm-data.js";
import {
	diffAfData,
	renderAfMarkdown,
	resolveAfSidecar,
	validateAfData,
	type AfData,
} from "../core/af-data.js";
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
import {
	extractRequirementFingerprints,
	stampFingerprints,
} from "../core/fingerprints.js";
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
	loadPublishedBaseline(
		cwd: string,
		projectName: string,
	): { path: string; data: unknown | null } | null;
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
	detectWorkingSidecar(workingFiles) {
		return (
			workingFiles.find((f) => f.startsWith("RTM_") && f.endsWith(".yaml")) ??
			workingFiles.find((f) => f.startsWith("RTM_") && f.endsWith(".json")) ??
			null
		);
	},
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
	diff(baseline, updated) {
		return diffRtmData(baseline as RtmData, updated as RtmData).issues;
	},
	render(data) {
		return renderRtmMarkdown(data as RtmData);
	},
	sidecarName(projectName) {
		return `RTM_${projectName}.yaml`;
	},
	serialize(data) {
		return toYamlString(data);
	},
	loadPublishedBaseline(cwd, projectName) {
		const md = resolveDocArtifact("RTM", projectName, cwd);
		const mdPath = md?.path ?? join(cwd, "Doc", "requirements", `RTM_${projectName}.md`);
		const sidecar = resolveRtmSidecar(mdPath);
		if (!sidecar) return null;
		const data = readYamlFile(sidecar.path);
		return { path: sidecar.path, data };
	},
	postValidate(data, { cwd, projectName }) {
		// Stamp requirement fingerprints from the published PSRS (Phase 3).
		// The LLM never hashes; rows with unknown ids stay unstamped and
		// are reported by doctor.
		const rtmData = data as RtmData;
		const psrs = resolveDocArtifact("PRD", projectName, cwd);
		if (psrs) {
			rtmData.rows = stampFingerprints(
				rtmData.rows,
				extractRequirementFingerprints(readFileSync(psrs.path, "utf8")),
			);
		}
		return rtmData;
	},
};

const afEntry: SidecarEntry = {
	artifact: "atomic-functions",
	label: "Atomic-functions",
	detectWorkingSidecar(workingFiles) {
		return (
			workingFiles.find((f) => f.startsWith("atomic-functions_") && f.endsWith(".yaml")) ??
			null
		);
	},
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
	validateWithCtx(data, { cwd }) {
		const tier = deriveAtomicProfile(loadFilesConfig(cwd)).tier;
		const afData = data as AfData;
		// Stamp the tier so the rendered table carries the tier columns.
		afData.tier = afData.tier ?? tier;
		return validateAfData(afData, { tier }).issues;
	},
	diff(baseline, updated) {
		return diffAfData(baseline as AfData, updated as AfData).issues;
	},
	render(data) {
		return renderAfMarkdown(data as AfData);
	},
	sidecarName(projectName) {
		return `atomic-functions_${projectName}.yaml`;
	},
	serialize(data) {
		return toYamlString(data);
	},
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
	detectWorkingSidecar(workingFiles) {
		return (
			workingFiles.find((f) => f.startsWith("test-cases_") && f.endsWith(".yaml")) ??
			null
		);
	},
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
	diff(baseline, updated) {
		return diffTestCasesData(baseline as TestCasesData, updated as TestCasesData).issues;
	},
	render(data) {
		return renderTestCasesMarkdown(data as TestCasesData);
	},
	sidecarName(projectName) {
		return `test-cases_${projectName}.yaml`;
	},
	serialize(data) {
		return toYamlString(data);
	},
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
	detectWorkingSidecar(workingFiles) {
		return (
			workingFiles.find((f) => f.startsWith("development-order_") && f.endsWith(".yaml")) ??
			null
		);
	},
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
	diff(baseline, updated) {
		return diffDevOrderData(baseline as DevOrderData, updated as DevOrderData).issues;
	},
	render(data) {
		return renderDevOrderMarkdown(data as DevOrderData);
	},
	sidecarName(projectName) {
		return `development-order_${projectName}.yaml`;
	},
	serialize(data) {
		return toYamlString(data);
	},
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
