/**
 * Publish handler for Stages 2–10 (v1.6.0).
 *
 * Per CHANGELOG v1.6.0:
 * - `/velpari-prd-approve-brainstorm` handles the brainstorm stage (separate
 *   bespoke command).
 * - `/velpari-<stage>-approve` is the per-stage fall-back publish command
 *   for each of Stages 2–10 (prd, rtm, feasibility, design, atomic-
 *   function, pseudocode, testplan, development-order, final-design).
 * - The `velpari_stage_publish` LLM-callable tool also invokes this
 *   function on the parent LLM's preview-yes path. Both surfaces call
 *   the same `handleApprove`, so the gate chain is identical.
 *
 * Flow:
 * 1. Read current state; refuse if current stage is `brainstorming` /
 *    `brainstormed` (use `/velpari-rtm-approve-brainstorm` for those).
 * 2. Map current stage → working-copy dir name and published artifact
 *    name via `stageToArtifact`.
 * 3. Read working copy from the grouped working-copy path; if missing,
 *    fall back to the legacy flat working-copy layout.
 * 4. Write to the grouped Doc/ path with a uniform frontmatter stamp;
 *    if a legacy flat copy exists, preserve it.
 * 5. Run the revision gate (per-artifact) + the publish gate
 *    (doctor/gate.ts:runPublishGate) + the post-publish doctor audit.
 * 6. Advance state via `advanceStage`, recording the per-stage approve
 *    command as the actor in `state.json:history`.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { atomicWriteFile } from "../io/atomic-write.js";
import { advanceStage, appendStageEntry, clearFeasibilitySession, loadState } from "../core/state.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { isSunsetPast } from "../core/shape.js";
import { parseFrontmatterBlock } from "../core/frontmatter.js";
import {
	buildRunDir,
	GROUPED_CATEGORIES,
	hasPublishedFeasibility,
	resolveDocArtifact,
	slugify,
} from "../core/paths.js";
import { comparePsrs, readSectionBody } from "../core/psrs.js";
import { withArtifactFrontmatter, type ArtifactFrontmatterInput } from "../core/frontmatter.js";
import type { RtmData } from "../core/rtm-data.js";
import { writeFeasibilityRecord } from "../core/feasibility-record.js";
import {
	hashFileContent,
	hashFileContentNormalized,
} from "../core/fingerprints.js";
import { SIDECAR_REGISTRY } from "./sidecar-registry.js";
import {
	computeInputHashes,
	recordPublish,
	resolveDeclaredInputs,
} from "../core/freshness.js";
import { runPublishGate } from "../doctor/gate.js";
import {
	buildFeasibilityRowsFromSession,
	kindForWorkingDir,
	loadStagePayload,
} from "./stage-payloads.js";
import {
	precheckGitForPublish,
	publishedPrdPath,
	runDbPublish,
} from "./db-publish.js";
import type { ArtifactEnvelopeInput, ArtifactPayload } from "../io/store.js";
import { runDoctor, writeDoctorReport } from "../doctor/index.js";
import { PATHS, type Stage, nextCommandsFor, STAGE_TRANSITIONS } from "../core/constants.js";
import {
	generationHintForPhase,
	phaseBoundaryCrossed,
} from "../core/agent-freshness.js";
import { STAGE_REGISTRY, STAGE_LOCK_SPECS, type StageSpec } from "../stages/registry.js";
import { computeLegalCommands } from "../stages/transition-lock.js";

/**
 * One stage→approve mapping (D4 — audit item c7). Single source consumed by
 * both `stageToArtifact` (working-copy category + published artifact name)
 * and `perStageApproveCommand` (the actor string passed to `advanceStage`,
 * recorded in state history). The table-driven regression guard in
 * test/ops/approve-development-order.test.ts now guards this one table:
 * every publishable stage in STAGE_TRANSITIONS must appear here.
 *
 * `stages[0]` is the in-progress stage enum (e.g. "designing"); `stages[1]`
 * is the rest state right after that stage's approve (e.g. "designed") —
 * a re-publish from the rest state still stamps.
 */
interface StageApproveSpec {
	/** v1.6.0 per-stage approve command (STAGE_TRANSITIONS rows use this
	 *  exact string). */
	readonly command: string;
	/** Working-copy category under <runDir>/ (GROUPED_CATEGORIES key). */
	readonly workingDir: string;
	/** Published artifact name passed to runPublishGate. */
	readonly artifact: string;
	/** Additional published artifacts (testplan publishes test-cases too). */
	readonly extras?: readonly string[];
	/** [in-progress stage, rest state] pair this row covers. */
	readonly stages: readonly [Stage, Stage];
}

const STAGE_APPROVE_MAP: readonly StageApproveSpec[] = [
	{ command: "/velpari-prd-approve", workingDir: "prd", artifact: "PRD", stages: ["drafting-prd", "drafted-prd"] },
	{ command: "/velpari-rtm-approve", workingDir: "rtm", artifact: "RTM", stages: ["building-rtm", "built-rtm"] },
	{ command: "/velpari-feasibility-approve", workingDir: "feasibility", artifact: "feasibility-study", stages: ["analyzing-feasibility", "analyzed-feasibility"] },
	{ command: "/velpari-architecture-generator-approve", workingDir: "design", artifact: "design", stages: ["designing", "designed"] },
	// Stage 6 — atomic function working copy lives under
	// <runDir>/atomic-functions/atomic-functions_<project>.md
	// (per buildWorkingGroupedPath's GROUPED_CATEGORIES map).
	// The publish gate (doctor/gate.ts:runPublishGate) routes
	// atomic-functions artifacts through the reviewer verdict (the
	// reviewer verdict is the source of truth for tier checks).
	{ command: "/velpari-atomic-function-approve", workingDir: "atomic-functions", artifact: "atomic-functions", stages: ["analyzing-atomic-functions", "analyzed-atomic-functions"] },
	{ command: "/velpari-pseudocode-approve", workingDir: "pseudocode", artifact: "pseudocode", stages: ["writing-pseudocode", "wrote-pseudocode"] },
	{ command: "/velpari-testplan-approve", workingDir: "tests", artifact: "test-plan", extras: ["test-cases"], stages: ["planning-tests", "planned-tests"] },
	{ command: "/velpari-development-order-approve", workingDir: "development-order", artifact: "development-order", stages: ["ordering-development", "ordered-development"] },
	{ command: "/velpari-final-design-approve", workingDir: "final-design", artifact: "final-design", stages: ["finalizing-design", "finalized-design"] },
];

/**
 * Map a stage to (working-copy category, published artifact name,
 * additional published artifacts for testplan). Derived from
 * STAGE_APPROVE_MAP. Exported for the table-driven regression guard in
 * test/ops/approve-development-order.test.ts.
 */
export function stageToArtifact(stage: Stage): {
	workingDir: string;
	artifact: string;
	extras?: string[];
} | null {
	const row = STAGE_APPROVE_MAP.find((r) => r.stages.includes(stage));
	if (!row) return null;
	return {
		workingDir: row.workingDir,
		artifact: row.artifact,
		...(row.extras ? { extras: [...row.extras] } : {}),
	};
}

/**
 * Map the current in-progress stage to its v1.6.0 per-stage approve
 * command. Used as the actor string passed to `advanceStage` (and
 * therefore recorded in state.json:history). STAGE_TRANSITIONS rows
 * for each publishable stage use the exact string returned here.
 * Derived from STAGE_APPROVE_MAP (D4) — keyed on the in-progress stage
 * (`stages[0]`) only, so rest-state lookups keep the legacy default.
 */
function perStageApproveCommand(stage: Stage): string {
	return (
		STAGE_APPROVE_MAP.find((r) => r.stages[0] === stage)?.command ??
		"/velpari-brainstorm-approve"
	);
}

/**
 * Find the registry spec whose stage the current state belongs to. Matches
 * the in-progress stage enum (e.g. "designing") AND the rest state right
 * after that stage's approve (e.g. "designed") — a re-publish from the
 * rest state still stamps. Returns null for stages outside the registry;
 * callers skip freshness stamping then (publish stays intact, per the B4
 * failure policy).
 */
function specForStage(stage: Stage): StageSpec | null {
	return (
		Object.values(STAGE_REGISTRY).find((s) => {
			if (s.stageEnum === stage) return true;
			return STAGE_TRANSITIONS.some(
				(t) => t.from === s.stageEnum && t.to === stage && t.command.endsWith("-approve"),
			);
		}) ?? null
	);
}

/**
 * True when the updated document's Change Log section contains at least
 * one line the published document does not have. Mirrors the
 * changelog check inside comparePsrs for non-PRD artifacts.
 */
function hasNewChangeLogEntry(published: string, updated: string): boolean {
	const publishedLines = new Set(
		readSectionBody(published, "Change Log")
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0),
	);
	const updatedLines = readSectionBody(updated, "Change Log")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	return updatedLines.some((l) => !publishedLines.has(l));
}

export interface ApproveOpts {
	/**
	 * Skip the v1.2.1 post-publish full doctor audit. Production callers
	 * never set this; tests that build minimal cwds (lacking `files.json`,
	 * agent mapping, etc.) opt in here. The publish gate still runs
	 * — only the supplementary full audit is skipped. Documented and
	 * covered by `approve-doctor-skip.test.ts`.
	 */
	skipAutoDoctor?: boolean;
	/**
	 * Skip the Phase-4 DB publish chain (stage payload pre-check + DB
	 * write/YAML export/git commit). Production callers never set this;
	 * pre-Phase-4 tests that build minimal cwds (no payload files, no git
	 * repo) opt in here so the markdown publish path stays testable on its
	 * own. Mirrors `skipAutoDoctor`. With this set, the publish behaves
	 * exactly as before Phase 4 (markdown only).
	 */
	skipDbPublish?: boolean;
}

const AUTO_DOCTOR_SKIP_ENV = "VELPARI_SKIP_AUTO_DOCTOR";
const DB_PUBLISH_SKIP_ENV = "VELPARI_SKIP_DB_PUBLISH";

export async function handleApprove(
	ctx: ExtensionCommandContext,
	pi?: ExtensionAPI,
	cwd: string = process.cwd(),
	opts: ApproveOpts = {},
): Promise<void> {
	const state = loadState(cwd);
	if (!state.runId || state.currentStage === "none") {
		ctx.ui.notify("No active run to approve.", "error");
		return;
	}

	if (state.currentStage === "brainstorming") {
		// A1: the refusal routes through the transition lock — the guide
		// message names the two doors and the discard path.
		const lock = computeLegalCommands(cwd, STAGE_LOCK_SPECS);
		ctx.ui.notify(
			lock.reasonFor("/velpari-prd") ??
				`Use /velpari-approve-brainstorm for the brainstorm stage. ` +
					`Current stage: "${state.currentStage}".`,
			"error",
		);
		return;
	}

	if (state.currentStage === "brainstormed") {
		ctx.ui.notify(
			`The brainstorm is already approved. Run /velpari-prd to start the PRD stage. ` +
				`Current stage: "${state.currentStage}".`,
			"error",
		);
		return;
	}

	const mapping = stageToArtifact(state.currentStage);
	if (!mapping) {
		ctx.ui.notify(`No artifact mapping for stage "${state.currentStage}".`, "error");
		return;
	}

	const config = loadFilesConfig(cwd);
	// v1.3.0+ multi-design: prefer the projectName persisted in the
	// architecture sub-life cycle prelude (when the federation has
	// multiple projectNames). Fall back to the legacy single projectName
	// from files.json, then to the mission.
	const archProject = state.archSubCycle?.projectName;
	const projectName = archProject
		? archProject
		: validateFilesConfig(config) && config.projectName
			? config.projectName
			: state.mission || "Project";
	const runDir = buildRunDir(state.runId, cwd);

	// Try the grouped working-copy directory first, then the legacy
	// flat working-copy directory (Phase 7 backwards compatibility).
	const groupedWorkingDir = join(runDir, mapping.workingDir);
	const legacyWorkingDir = join(runDir, mapping.artifact);
	const workingDirPath = existsSync(groupedWorkingDir) ? groupedWorkingDir : legacyWorkingDir;
	if (!existsSync(workingDirPath)) {
		ctx.ui.notify(`Working copy dir not found at ${groupedWorkingDir} or ${legacyWorkingDir}.`, "error");
		return;
	}

	const { readdirSync } = await import("node:fs");
	const files = readdirSync(workingDirPath).filter((f) => f.endsWith(".md"));
	if (files.length === 0) {
		ctx.ui.notify(`No working-copy file found in ${workingDirPath}.`, "error");
		return;
	}

	// Feasibility v2 session gate (Phase 3): a feasibility publish must
	// carry a settled build-vs-reuse decision AND a chosen language in
	// state.json (the parent LLM persists both via the
	// velpari_feasibility_session tool during the stage). A pending
	// decision or missing language blocks the publish — nothing is
	// written, the stage does not advance.
	if (
		state.currentStage === "analyzing-feasibility" ||
		state.currentStage === "analyzed-feasibility"
	) {
		const session = state.feasibilitySession;
		const sessionProblems: string[] = [];
		if (!session?.decision) {
			sessionProblems.push(
				"build-vs-reuse decision missing — run the reuse scan and persist it " +
					"(velpari_feasibility_session set-decision). Re-run /velpari-feasibility to continue.",
			);
		}
		if (!session?.selectedLanguage) {
			sessionProblems.push(
				"language not selected — pick one via the language-selection step " +
					"(velpari_feasibility_session select-language). Re-run /velpari-feasibility to continue.",
			);
		}
		if (sessionProblems.length > 0) {
			ctx.ui.notify(
				`Feasibility stage is not settled. Publish blocked:\n` +
					sessionProblems.map((p) => `  - ${p}`).join("\n"),
				"error",
			);
			return;
		}
	}

	// Testplan publishes both test-plan and test-cases to the same
	// `tests/` subfolder. Keep the two-file behavior intact.

	// Resolve every publish target first so the revision gate can run
	// BEFORE anything is written (all-or-nothing publish).
	interface PublishTarget {
		file: string;
		fileArtifact: string;
		content: string;
		groupedAbs: string;
		/** Absolute path of the already-published copy, when one exists. */
		publishedPath: string | null;
		/** Sidecar published next to the markdown (B3 registry artifacts). */
		sidecar?: { name: string; content: string };
	}
	const targets: PublishTarget[] = [];
	for (const file of files) {
		const content = readFileSync(join(workingDirPath, file), "utf8");
		// Pick the category subfolder based on the artifact embedded in
		// the working-copy file name (e.g. "test-cases_TestApp.md"
		// → "tests/test-cases_TestApp.md"). Rename the published file
		// to the configured projectName.
		const fileArtifact = file.replace(/_\w+\.md$/, "").replace(/\.md$/, "");
		let category = GROUPED_CATEGORIES[mapping.artifact] ?? "";
		if (mapping.artifact === "test-plan" && file.startsWith("test-cases_")) {
			category = GROUPED_CATEGORIES["test-cases"] ?? "";
		} else if (fileArtifact && fileArtifact !== mapping.artifact) {
			category = GROUPED_CATEGORIES[fileArtifact] ?? category;
		}
		const artifactKey = fileArtifact || mapping.artifact;
		const outputFile = `${artifactKey}_${projectName}.md`;
		const groupedRel = category ? `${category}/${outputFile}` : outputFile;
		const groupedAbs = join(cwd, "Doc", groupedRel);
		const published = resolveDocArtifact(artifactKey, projectName, cwd);
		targets.push({
			file,
			fileArtifact: artifactKey,
			content,
			groupedAbs,
			publishedPath: published?.path ?? null,
		});
	}

	// Revision gate (living documents): when a published copy already
	// exists, the working copy is a REVISION and must prove it first.
	//   PRD     → comparePsrs(published, working) must pass (append-only
	//             IDs, version bump, new Change Log entry).
	//   Others  → the working copy's Change Log must gain at least one
	//             new line versus the published copy.
	// Any failure → notify the exact issues, publish NOTHING, do not
	// advance the stage.
	const revisionIssues: string[] = [];
	// Set inside the sidecar registry loop below; consumed by the publish
	// gate (the gate API takes rtmData specifically — RTM-only plumbing).
	let rtmDataForGate: RtmData | null = null;

	// Sidecar registry (B3/D3): one entry per sidecar-backed artifact.
	// When the working copy carries the LLM-authored sidecar, the data is
	// the source of truth: it is validated, the published markdown is
	// RE-RENDERED from it (never the LLM's hand-written table), and
	// revisions must satisfy the living-document rules against the
	// previously published sidecar. D6: the publish REQUIRES the sidecar —
	// a markdown-only working copy of a sidecar artifact is blocked.
	const triggeredArtifacts = new Set<string>();
	if (SIDECAR_REGISTRY[mapping.artifact]) triggeredArtifacts.add(mapping.artifact);
	for (const t of targets) {
		if (SIDECAR_REGISTRY[t.fileArtifact]) triggeredArtifacts.add(t.fileArtifact);
	}
	if (triggeredArtifacts.size > 0) {
		const workingFiles = readdirSync(workingDirPath);
		for (const artifactKey of triggeredArtifacts) {
			const entry = SIDECAR_REGISTRY[artifactKey]!;
			const sidecarFile = entry.detectWorkingSidecar(workingFiles);
			if (!sidecarFile) {
				ctx.ui.notify(
					`${entry.label} publish requires a sidecar (${entry.sidecarName(projectName)}) in the working copy — ` +
						`the data file is the source of truth and the published markdown is re-rendered from it. ` +
						`Add it, then re-run the approve.`,
					"error",
				);
				return;
			}
			const sidecarText = readFileSync(join(workingDirPath, sidecarFile), "utf8");
			const parsed = entry.parseAndValidate(sidecarText);
			if (!parsed.ok) {
				ctx.ui.notify(
					`${entry.label} sidecar is invalid. Fix these issues, then re-run the approve:\n` +
						parsed.issues.map((i) => `  - ${i}`).join("\n"),
					"error",
				);
				return;
			}
			let data = parsed.data;
			if (entry.validateWithCtx) {
				const ctxIssues = entry.validateWithCtx(data, { cwd, projectName });
				if (ctxIssues.length > 0) {
					ctx.ui.notify(
						`${entry.label} sidecar failed tier/profile validation. Fix these issues, then re-run the approve:\n` +
							ctxIssues.map((i) => `  - ${i}`).join("\n"),
						"error",
					);
					return;
				}
			}
			// Diff against the previously published sidecar.
			const baseline = entry.loadPublishedBaseline(cwd, projectName);
			if (baseline) {
				if (baseline.data) {
					for (const issue of entry.diff(baseline.data, data)) {
						revisionIssues.push(`[${sidecarFile}] ${issue}`);
					}
				} else {
					revisionIssues.push(`[${sidecarFile}] published ${entry.label} sidecar at ${baseline.path} is not readable — cannot verify revision rules.`);
				}
			}
			if (entry.postValidate) {
				data = entry.postValidate(data, { cwd, projectName });
			}
			const rendered = entry.render(data);
			if (artifactKey === "RTM") rtmDataForGate = data as RtmData;
			const sidecar = {
				name: entry.sidecarName(projectName),
				content: entry.serialize(data),
			};
			const mdTarget = targets.find((t) => t.fileArtifact === artifactKey);
			if (mdTarget) {
				mdTarget.content = rendered;
				mdTarget.sidecar = sidecar;
			} else {
				// The LLM wrote only the sidecar — synthesize the markdown target.
				const category = GROUPED_CATEGORIES[artifactKey] ?? "";
				targets.push({
					file: sidecarFile,
					fileArtifact: artifactKey,
					content: rendered,
					groupedAbs: join(cwd, "Doc", category, `${artifactKey}_${projectName}.md`),
					publishedPath: resolveDocArtifact(artifactKey, projectName, cwd)?.path ?? null,
					sidecar,
				});
			}
		}
	}

	for (const target of targets) {
		if (!target.publishedPath) continue; // fresh publish — no gate
		const publishedContent = readFileSync(target.publishedPath, "utf8");
		if (target.fileArtifact === "PRD") {
			const comparison = comparePsrs(publishedContent, target.content);
			if (!comparison.ok) {
				for (const issue of comparison.issues) {
					revisionIssues.push(`[${target.file}] ${issue.code}: ${issue.message}`);
				}
			}
		} else if (!hasNewChangeLogEntry(publishedContent, target.content)) {
			revisionIssues.push(
				`[${target.file}] revision-changelog-missing: the revision adds no new Change Log entry. ` +
					`Record what changed and why before approving.`,
			);
		}
	}
	if (revisionIssues.length > 0) {
		ctx.ui.notify(
			`Revision gate blocked the publish. Fix these issues in the working copy, then re-run /velpari-pseudocode-approve:\n` +
				revisionIssues.map((i) => `  - ${i}`).join("\n"),
			"error",
		);
		return;
	}

	// Publish gate (RTM traceability upgrade, Phase 5): the doctor's
	// artifact checks run INSIDE approve — the user never has to remember
	// /velpari-doctor. Errors block the publish (nothing is written, the
	// stage does not advance); warnings are shown but allowed.
	const gateIssues: string[] = [];
	const gateWarnings: string[] = [];
	for (const target of targets) {
		const gate = runPublishGate({
			artifact: target.fileArtifact,
			workingContent: target.content,
			rtmData: target.fileArtifact === "RTM" ? rtmDataForGate : null,
			cwd,
			projectName,
		});
		for (const e of gate.errors) gateIssues.push(`[${target.file}] ${e}`);
		for (const w of gate.warnings) gateWarnings.push(`[${target.file}] ${w}`);
	}
	if (gateIssues.length > 0) {
		ctx.ui.notify(
			`Publish gate blocked the publish. Fix these issues in the working copy, then re-run /velpari-testplan-approve:\n` +
				gateIssues.map((i) => `  - ${i}`).join("\n"),
			"error",
		);
		return;
	}
	if (gateWarnings.length > 0) {
		ctx.ui.notify(
			`Publish gate warnings (publish allowed):\n` +
				gateWarnings.map((w) => `  - ${w}`).join("\n"),
			"warning",
		);
	}

	// ---- Phase 4 (DB-primary storage): payload + git pre-checks (Q6a) ----
	// Run BEFORE anything is written: the LLM-written payload must be valid
	// and git must be usable, or nothing publishes. `skipDbPublish` is the
	// test-only escape hatch (pre-Phase-4 minimal cwds, mirror of
	// `skipAutoDoctor`); production never sets it.
	const skipDbPublish =
		opts.skipDbPublish === true || process.env[DB_PUBLISH_SKIP_ENV] === "1";
	const storeKind = kindForWorkingDir(mapping.workingDir);
	if (!skipDbPublish && !storeKind) {
		ctx.ui.notify(
			`No store kind for working dir "${mapping.workingDir}" — publish blocked (Phase 4 payload convention).`,
			"error",
		);
		return;
	}
	const payloadResult = skipDbPublish
		? null
		: loadStagePayload(workingDirPath, storeKind!);
	if (payloadResult && !payloadResult.ok) {
		ctx.ui.notify(
			`Stage payload invalid — publish blocked (Phase 4). Fix it and re-run the approve:\n` +
				payloadResult.problems.map((p) => `  - ${p}`).join("\n"),
			"error",
		);
		return;
	}
	if (!skipDbPublish) {
		const gitPre = precheckGitForPublish(cwd);
		if (!gitPre.ok) {
			ctx.ui.notify(
				`Git pre-check failed — publish blocked (Q6a):\n` +
					gitPre.problems.map((p) => `  - ${p}`).join("\n"),
				"error",
			);
			return;
		}
	}

	// Freshness stamps (B4): hash the stage's declared inputs (registry
	// is the single source of truth — D2) so every published artifact is
	// self-describing (frontmatter `inputs:` JSON scalar) and the stale
	// set is machine-checkable (.pi/velpari/freshness.json). Failure
	// policy: a hash failure warns and publishes unstamped — it never
	// corrupts or blocks the publish.
	const publishNow = new Date().toISOString();
	let inputHashes: Record<string, string> | null = null;
	const stageSpec = specForStage(state.currentStage);
	if (stageSpec) {
		const hashed = computeInputHashes(
			cwd,
			resolveDeclaredInputs(cwd, stageSpec.inputs, {
				projectName,
				topicSlug: slugify(state.mission),
			}),
			hashFileContentNormalized,
		);
		if (!hashed.ok) {
			ctx.ui.notify(
				`Freshness stamp skipped: declared inputs not hashable (${hashed.missing.join(", ")}). ` +
					`Publishing without stamp; republish after the inputs exist to stamp.`,
				"warning",
			);
		} else {
			inputHashes = hashed.hashes;
		}
	}

	for (const target of targets) {
		// Stamp the uniform artifact frontmatter at publish time (RTM
		// traceability upgrade, Phase 1). Existing fields (e.g. the PSRS
		// schema on the PRD) are preserved; `created` carries over from
		// the previously published copy on revisions.
		const publishedContent = target.publishedPath
			? readFileSync(target.publishedPath, "utf8")
			: null;
		// v1.3.0 sunset auto-archive: if the working-copy carries a
		// past `sunset:` and the published status is still `published`
		// (i.e., not already archived), bump the major version, set
		// `status: deprecated`, and stamp `deprecatedAt: <today>`.
		// Re-read the working-copy frontmatter to make the decision.
		const sunsetInfo = readSunsetInfo(target.content);
		const todayIso = new Date().toISOString().slice(0, 10);
		const sunsetPast =
			sunsetInfo !== null &&
			sunsetInfo.sunset !== null &&
			isSunsetPast(sunsetInfo.sunset, new Date().toISOString());
		const alreadyArchived = sunsetInfo?.status === "deprecated";
		const input: ArtifactFrontmatterInput = {
			artifact: target.fileArtifact,
			project: projectName,
			stage: state.currentStage,
			run: state.runId,
			now: publishNow,
			...(inputHashes ? { inputs: JSON.stringify(inputHashes) } : {}),
		};
		if (sunsetInfo?.supersedes !== undefined) input.supersedes = sunsetInfo.supersedes;
		if (sunsetInfo?.sunset) input.sunset = sunsetInfo.sunset;
		if (sunsetPast && !alreadyArchived) {
			// Bump MAJOR: e.g. 1.2.3 -> 2.0.0
			if (sunsetInfo) {
				const majorStr = sunsetInfo.version.split(".")[0] ?? "0";
				const major = Number.parseInt(majorStr, 10) || 0;
				const nextMajor = major + 1;
				const newVersion = `${nextMajor}.0.0`;
				input.supersedes = sunsetInfo.version;
				// Mutate the working-copy content's version line too so the
				// stamped body matches the new frontmatter.
				target.content = updateVersionInBody(target.content, newVersion);
				// Reflect into the body the status: deprecated.
				target.content = updateStatusInBody(target.content, "deprecated");
				// Update the version we pass in to the stamp.
				input.sunset = todayIso; // keep the date; archive marker
			}
		}
		if (sunsetPast) {
			// First-time archive OR idempotent re-archive: stamp today's
			// date. The "already deprecated" path still re-stamps so the
			// design is always marked with the most recent archive date.
			input.deprecatedAt = todayIso;
		}
		const stamped = withArtifactFrontmatter(target.content, input, publishedContent);
		atomicWriteFile(target.groupedAbs, stamped, "utf8");
		if (target.sidecar) {
			atomicWriteFile(join(dirname(target.groupedAbs), target.sidecar.name), target.sidecar.content, "utf8");
		}
		// B3/D9 — code-generated feasibility decision record: serialize
		// the settled session BEFORE clearFeasibilitySession destroys it
		// below, so the decision data survives the publish.
		let decisionRecordAbs: string | null = null;
		if (target.fileArtifact === "feasibility-study" && state.feasibilitySession) {
			decisionRecordAbs = writeFeasibilityRecord(cwd, projectName, state.feasibilitySession, publishNow);
		}
		if (inputHashes) {
			try {
				// D3 — the manifest entry also records the sidecar hash
				// (both files are the publish). D9 — the feasibility record
				// joins the study's own extraPaths the same way.
				const extraPaths: Record<string, string> = {};
				if (target.sidecar) {
					const sidecarAbs = join(dirname(target.groupedAbs), target.sidecar.name);
					const sidecarHash = hashFileContent(sidecarAbs);
					if (sidecarHash) extraPaths[relative(cwd, sidecarAbs)] = sidecarHash;
				}
				if (decisionRecordAbs) {
					const recordHash = hashFileContent(decisionRecordAbs);
					if (recordHash) extraPaths[relative(cwd, decisionRecordAbs)] = recordHash;
				}
				recordPublish(cwd, {
					artifact: target.fileArtifact.toLowerCase(),
					projectName,
					path: relative(cwd, target.groupedAbs),
					...(Object.keys(extraPaths).length > 0 ? { extraPaths } : {}),
					publishedAt: publishNow,
					inputs: inputHashes,
					hashv: 2,
				});
			} catch {
				ctx.ui.notify(
					`Freshness manifest write failed for ${target.fileArtifact} — the publish is intact, only the stamp was skipped.`,
					"warning",
				);
			}
		}
		ctx.ui.notify(
			target.publishedPath
				? `Published revision of ${target.fileArtifact} to ${target.groupedAbs}`
				: `Published to ${target.groupedAbs}`,
			"info",
		);
	}

	// ---- Phase 4 (DB-primary storage): the DB publish chain (Q6) ----
	// Markdown targets are on disk (Q3: read-authoritative). Now: DB write
	// (draft) → checksum verify → Q2 flip → YAML export beside the DB →
	// G8 PRD mirror → checkpoint → explicit-path git commit. Any failure
	// reverts the DB rows to draft, deletes the YAML, and blocks the
	// stage advance; markdown stays (accepted risk R1).
	if (!skipDbPublish && storeKind && payloadResult && payloadResult.envelope && payloadResult.payload) {
		// Feasibility adapter (4.3): decision + spike rows come from the
		// settled session (the gate above guaranteed decision + language).
		// The payload JSON carries envelope + optional reuseScan rows only.
		let envelope: ArtifactEnvelopeInput = payloadResult.envelope;
		let rows: ArtifactPayload = payloadResult.payload;
		if (storeKind === "feasibility" && state.feasibilitySession) {
			rows = {
				...rows,
				...buildFeasibilityRowsFromSession(
					state.feasibilitySession,
					publishNow,
				),
			} as ArtifactPayload;
		}
		const dbOutcome = runDbPublish({
			cwd,
			projectName,
			runId: state.runId!,
			kind: storeKind,
			yamlArtifact: mapping.artifact,
			envelope,
			payload: rows,
			publishedPaths: targets.map((t) => t.groupedAbs),
			...(storeKind === "prd"
				? { prdPublishedPath: publishedPrdPath(projectName, cwd) ?? undefined }
				: {}),
		});
		for (const w of dbOutcome.warnings) ctx.ui.notify(w, "warning");
		if (!dbOutcome.ok) {
			ctx.ui.notify(
				`DB publish chain failed — stage does NOT advance (Q6d). Fix and re-run the approve:\n` +
					dbOutcome.problems.map((p) => `  - ${p}`).join("\n"),
				"error",
			);
			return;
		}
		ctx.ui.notify(
			`Store: ${storeKind} rows published (v${envelope.version}) + YAML exported + committed.`,
			"info",
		);
	}

	// Post-publish doctor audit (v1.2.1). The publish gate above already
	// enforced the "subset" subset (artifact correctness + revision
	// rules). The full doctor audit catches everything the gate
	// misses — agent wiring, file-structure drift, configuration
	// readiness, cross-section coherence, etc. Per the v1.2.1
	// decision, BOTH errors and warnings block state advance so the
	// user must fix every item before the sequence can proceed. The
	// full report is written to disk; user runs /velpari-doctor
	// manually to view it again.
	//
	// Escape hatches (deliberate, documented):
	//   - opts.skipAutoDoctor=true (programmatic)
	//   - VELPARI_SKIP_AUTO_DOCTOR=1 (env var)
	// Both are intended for the test suite. Production callers never
	// opt out; the standalone `/velpari-doctor` command is the
	// ad-hoc audit path.
	const skipAutoDoctor =
		opts.skipAutoDoctor === true || process.env[AUTO_DOCTOR_SKIP_ENV] === "1";
	if (!skipAutoDoctor) {
		const doctorReport = runDoctor(cwd);
		writeDoctorReport(doctorReport, cwd);
		const doctorReportPath = join(cwd, PATHS.DOCTOR_REPORT);
		if (doctorReport.summary.error > 0 || doctorReport.summary.warning > 0) {
			// v1.2.3 UI tweak: group findings by section title instead of a
			// flat list. Each section gets one line with its title + a count
			// of error vs warning findings + a short list of status codes.
			// The full list of items still goes into the on-disk report;
			// the notify stays a glance.
			interface GroupedSection {
				title: string;
				errorCount: number;
				warningCount: number;
				sampleStatuses: string[]; // e.g. ["ERROR", "WARN", "WARN"]
			}
			const grouped = new Map<string, GroupedSection>();
			for (const section of doctorReport.sections) {
				let errCount = 0;
				let warnCount = 0;
				const statuses: string[] = [];
				for (const item of section.items) {
					if (item.status === "error") {
						errCount++;
						statuses.push("ERROR");
					} else if (item.status === "warning") {
						warnCount++;
						statuses.push("WARN");
					}
				}
				if (errCount + warnCount > 0) {
					grouped.set(section.title, {
						title: section.title,
						errorCount: errCount,
						warningCount: warnCount,
						sampleStatuses: statuses.slice(0, 6),
					});
				}
			}
			const groupedLines: string[] = [];
			for (const g of grouped.values()) {
				const tags: string[] = [];
				if (g.errorCount > 0) tags.push(`${g.errorCount} error(s)`);
				if (g.warningCount > 0) tags.push(`${g.warningCount} warning(s)`);
				const sample = g.sampleStatuses.join(",");
				groupedLines.push(`- ${g.title}: ${tags.join(", ")} [${sample}]`);
			}
			const capped = groupedLines.length > 30 ? groupedLines.slice(0, 30) : groupedLines;
			const more =
				groupedLines.length > 30
					? `\n…and ${groupedLines.length - 30} more section(s). See ${doctorReportPath} for the full report.`
					: "";
			ctx.ui.notify(
				`Doctor stopped the advance. ${doctorReport.summary.error} error(s), ` +
					`${doctorReport.summary.warning} warning(s) found across ${groupedLines.length} section(s). ` +
					`Fix and re-run /velpari-development-order-approve.\n` +
					`\n${capped.join("\n")}${more}\n\n` +
					`Full report: ${doctorReportPath}.`,
				"error",
			);
			return; // state does NOT advance; user must fix the file and re-approve
		}
		ctx.ui.notify(
			`Doctor: clean — ${doctorReport.summary.ok} check(s) passed.`,
			"info",
		);
	}

	// Transition state via handleApprove (v1.6.0+).
	// The actor recorded in state.json:history is the per-stage approve
	// command for `currentStage`. The publish tool and the per-stage fall-
	// back commands both call handleApprove, so the actor string is uniform
	// regardless of which surface invoked the publish.
	let next = advanceStage(state, perStageApproveCommand(state.currentStage), cwd, pi);
	if (mapping.artifact === "feasibility-study") {
		// Feasibility v2: the publish gate passed, so the session (decision,
		// language, spikes) is settled — clear it so a later re-run starts clean.
		next = clearFeasibilitySession(next, cwd);
	}
	if (pi) appendStageEntry(pi, next, cwd);
	// v0.5.1 Phase J.2: reflect the new stage in the footer status bar
	// via the documented ctx.ui.setStatus(key, text) API.
	ctx.ui.setStatus("velpari", `stage: ${next.currentStage} | run: ${next.runId}`);
	ctx.ui.notify(`Stage advanced to "${next.currentStage}".`, "info");

	// v1.6.2: surface a clear "Next: /velpari-<cmd>" suggestion for every
	// stage so the user always knows which command to run by hand. The
	// auto-chain to the next command was removed in v1.6.2 — every stage
	// boundary is a manual confirm-then-write step. Special case for
	// post-RTM (`built-rtm`): the feasibility-skip shortcut is offered
	// alongside the default `/velpari-feasibility` next command.
	const feasibilitySkip =
		next.currentStage === "built-rtm" && hasPublishedFeasibility(cwd, projectName);
	const nextCommands = nextCommandsFor(next.currentStage, { feasibilitySkip });
	// Generator v2 (D5): an approve that crosses into a new phase prepends
	// the generation step to the next-hint when the target phase lacks
	// fresh generated agents. Informational only — the bundled scouts
	// remain the permanent fallback, legality is untouched.
	const enteredPhase = phaseBoundaryCrossed(state.currentStage, next.currentStage);
	const genHint = enteredPhase !== null ? generationHintForPhase(cwd, enteredPhase) : null;
	const nextHint = genHint
		? `Next: ${genHint}, then ${nextCommands.join(" or ")}`
		: `Next: ${nextCommands.join(" or ")}`;
	if (next.currentStage === "built-rtm") {
		ctx.ui.notify(
			feasibilitySkip
				? `${nextHint} — feasibility already published; you may skip ahead to architecture.`
				: nextHint,
			"info",
		);
	} else {
		ctx.ui.notify(nextHint, "info");
	}
}
/**
 * v1.3.0+ helpers for the sunset auto-archive flow. Pure string ops.
 */

interface SunsetInfo {
	version: string;
	sunset: string | null;
	status: string | null;
	supersedes: string | undefined;
}

/**
 * Read the v1.3.0 sunset fields (version, sunset, status, supersedes) from
 * a working copy's frontmatter.
 * @param {string} content - Working-copy markdown (frontmatter + body).
 * @returns {SunsetInfo | null} Parsed sunset fields, or null when there is
 *   no frontmatter block or no version field.
 */
function readSunsetInfo(content: string): SunsetInfo | null {
	const parsed = parseFrontmatterBlock(content);
	if (!parsed) return null;
	const v = parsed.fields.version;
	if (!v) return null;
	return {
		version: v,
		sunset: typeof parsed.fields.sunset === "string" ? parsed.fields.sunset : null,
		status: typeof parsed.fields.status === "string" ? parsed.fields.status : null,
		supersedes: typeof parsed.fields.supersedes === "string" ? parsed.fields.supersedes : undefined,
	};
}

/**
 * Rewrite the `version:` line inside the artifact body (sunset archive
 * bumps the major version and mirrors it into the stamped body).
 * @param {string} content - Artifact markdown with a `version:` line.
 * @param {string} newVersion - Version to write (e.g. "2.0.0").
 * @returns {string} Content with the version line replaced.
 */
function updateVersionInBody(content: string, newVersion: string): string {
	return content.replace(/^version:\s*.*$/m, `version: ${newVersion}`);
}

/**
 * Rewrite the `status:` line inside the artifact body (sunset archive sets
 * `deprecated` and mirrors it into the stamped body).
 * @param {string} content - Artifact markdown with a `status:` line.
 * @param {string} newStatus - Status to write (e.g. "deprecated").
 * @returns {string} Content with the status line replaced.
 */
function updateStatusInBody(content: string, newStatus: string): string {
	return content.replace(/^status:\s*.*$/m, `status: ${newStatus}`);
}
