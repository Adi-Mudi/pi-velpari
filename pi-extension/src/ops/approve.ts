/**
 * Generic /velpari-approve handler for stages 2-7 (Phase 7 update).
 *
 * Per CHANGELOG v1.6 (FR-59):
 * - /velpari-approve-brainstorm handles the brainstorm stage (separate command).
 * - /velpari-approve handles stages 2-7 (prd, rtm, feasibility, design,
 *   pseudocode, testplan).
 *
 * Flow:
 * 1. Read current state; determine current stage.
 * 2. Refuse if current stage is `brainstorming` or `brainstormed` (use
 *    /velpari-approve-brainstorm for those).
 * 3. Map current stage → working-copy dir name and published artifact name.
 * 4. Read working copy from the grouped working-copy path; if missing,
 *    fall back to the legacy flat working-copy layout.
 * 5. Write to the grouped Doc/ path; if a legacy flat copy exists,
 *    preserve it. Stage transitions and two-file testplan approval
 *    are unchanged.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { atomicWriteFile } from "../io/atomic-write.js";
import { advanceStage, appendStageEntry, clearFeasibilitySession, loadState } from "../core/state.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import {
	buildRunDir,
	GROUPED_CATEGORIES,
	hasPublishedFeasibility,
	resolveDocArtifact,
} from "../core/paths.js";
import { comparePsrs, readSectionBody } from "../core/psrs.js";
import { withArtifactFrontmatter } from "../core/frontmatter.js";
import {
	diffRtmData,
	renderRtmMarkdown,
	validateRtmData,
	type RtmData,
} from "../core/rtm-data.js";
import {
	extractRequirementFingerprints,
	stampFingerprints,
} from "../core/fingerprints.js";
import { runPublishGate } from "../doctor/gate.js";
import type { Stage } from "../core/constants.js";

/**
 * Map a stage to (working-copy category, published artifact name,
 * additional published artifacts for testplan).
 */
function stageToArtifact(stage: Stage): {
	workingDir: string;
	artifact: string;
	extras?: string[];
} | null {
	switch (stage) {
		case "drafting-prd":
		case "drafted-prd":
			return { workingDir: "prd", artifact: "PRD" };
		case "building-rtm":
		case "built-rtm":
			return { workingDir: "rtm", artifact: "RTM" };
		case "analyzing-feasibility":
		case "analyzed-feasibility":
			return { workingDir: "feasibility", artifact: "feasibility-study" };
		case "designing":
		case "designed":
			return { workingDir: "design", artifact: "design" };
		case "finalizing-design":
		case "finalized-design":
			return { workingDir: "final-design", artifact: "final-design" };
		case "writing-pseudocode":
		case "wrote-pseudocode":
			return { workingDir: "pseudocode", artifact: "pseudocode" };
		case "planning-tests":
		case "planned-tests":
			return {
				workingDir: "tests",
				artifact: "test-plan",
				extras: ["test-cases"],
			};
		default:
			return null;
	}
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

export async function handleApprove(
	ctx: ExtensionCommandContext,
	pi?: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	const state = loadState(cwd);
	if (!state.runId || state.currentStage === "none") {
		ctx.ui.notify("No active run to approve.", "error");
		return;
	}

	if (state.currentStage === "brainstorming" || state.currentStage === "brainstormed") {
		ctx.ui.notify(
			`Use /velpari-approve-brainstorm for the brainstorm stage. ` +
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
	const projectName = validateFilesConfig(config) && config.projectName
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
		/** JSON sidecar published next to the markdown (RTM, Phase 2). */
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
	// Set inside the RTM block below; consumed by the publish gate.
	let rtmDataForGate: RtmData | null = null;

	// RTM JSON sidecar (RTM traceability upgrade, Phase 2). When the
	// working copy carries RTM_<project>.json, the JSON is the source of
	// truth: it is validated, the published markdown is REGENERATED from
	// it (never the LLM's hand-written table), and revisions must satisfy
	// the living-document rules against the previously published JSON.
	if (mapping.artifact === "RTM") {
		const jsonFile = readdirSync(workingDirPath).find(
			(f) => f.startsWith("RTM_") && f.endsWith(".json"),
		);
		if (jsonFile) {
			const jsonText = readFileSync(join(workingDirPath, jsonFile), "utf8");
			let parsed: unknown;
			try {
				parsed = JSON.parse(jsonText);
			} catch {
				ctx.ui.notify(`RTM JSON sidecar ${jsonFile} is not valid JSON. Fix it, then re-run /velpari-approve.`, "error");
				return;
			}
			const validation = validateRtmData(parsed);
			if (!validation.ok) {
				ctx.ui.notify(
					`RTM JSON sidecar is invalid. Fix these issues, then re-run /velpari-approve:\n` +
						validation.issues.map((i) => `  - ${i}`).join("\n"),
					"error",
				);
				return;
			}
			const rtmData = parsed as RtmData;
			const rtmTarget = targets.find((t) => t.fileArtifact === "RTM");
			const publishedJsonPath = join(cwd, "Doc", "requirements", `RTM_${projectName}.json`);
			if (existsSync(publishedJsonPath)) {
				try {
					const baseline = JSON.parse(readFileSync(publishedJsonPath, "utf8")) as RtmData;
					for (const issue of diffRtmData(baseline, rtmData).issues) {
						revisionIssues.push(`[${jsonFile}] ${issue}`);
					}
				} catch {
					revisionIssues.push(`[${jsonFile}] published RTM JSON at ${publishedJsonPath} is not readable JSON — cannot verify revision rules.`);
				}
			}
			// Stamp requirement fingerprints from the published PSRS
			// (Phase 3). The LLM never hashes; rows with unknown ids stay
			// unstamped and are reported by doctor.
			const psrs = resolveDocArtifact("PRD", projectName, cwd);
			if (psrs) {
				rtmData.rows = stampFingerprints(
					rtmData.rows,
					extractRequirementFingerprints(readFileSync(psrs.path, "utf8")),
				);
			}
			const rendered = renderRtmMarkdown(rtmData);
			rtmDataForGate = rtmData;
			const sidecar = {
				name: `RTM_${projectName}.json`,
				content: JSON.stringify(rtmData, null, 2) + "\n",
			};
			if (rtmTarget) {
				rtmTarget.content = rendered;
				rtmTarget.sidecar = sidecar;
			} else {
				// The LLM wrote only the JSON — synthesize the markdown target.
				targets.push({
					file: jsonFile,
					fileArtifact: "RTM",
					content: rendered,
					groupedAbs: join(cwd, "Doc", "requirements", `RTM_${projectName}.md`),
					publishedPath: resolveDocArtifact("RTM", projectName, cwd)?.path ?? null,
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
			`Revision gate blocked the publish. Fix these issues in the working copy, then re-run /velpari-approve:\n` +
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
			`Publish gate blocked the publish. Fix these issues in the working copy, then re-run /velpari-approve:\n` +
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

	for (const target of targets) {
		// Stamp the uniform artifact frontmatter at publish time (RTM
		// traceability upgrade, Phase 1). Existing fields (e.g. the PSRS
		// schema on the PRD) are preserved; `created` carries over from
		// the previously published copy on revisions.
		const publishedContent = target.publishedPath
			? readFileSync(target.publishedPath, "utf8")
			: null;
		const stamped = withArtifactFrontmatter(
			target.content,
			{
				artifact: target.fileArtifact,
				project: projectName,
				stage: state.currentStage,
				run: state.runId,
			},
			publishedContent,
		);
		atomicWriteFile(target.groupedAbs, stamped, "utf8");
		if (target.sidecar) {
			atomicWriteFile(join(dirname(target.groupedAbs), target.sidecar.name), target.sidecar.content, "utf8");
		}
		ctx.ui.notify(
			target.publishedPath
				? `Published revision of ${target.fileArtifact} to ${target.groupedAbs}`
				: `Published to ${target.groupedAbs}`,
			"info",
		);
	}


	// Transition state via /velpari-approve
	let next = advanceStage(state, "/velpari-approve", cwd, pi);
	if (mapping.artifact === "feasibility-study") {
		// Feasibility v2: the publish gate passed, so the session (decision,
		// language, spikes) is settled — clear it so a later re-run starts clean.
		next = clearFeasibilitySession(next, cwd);
	}
	if (pi) appendStageEntry(pi, next);
	// v0.5.1 Phase J.2: reflect the new stage in the footer status bar
	// via the documented ctx.ui.setStatus(key, text) API.
	ctx.ui.setStatus("velpari", `stage: ${next.currentStage} | run: ${next.runId}`);
	ctx.ui.notify(`Stage advanced to "${next.currentStage}".`, "info");
	if (next.currentStage === "built-rtm") {
		ctx.ui.notify(
			hasPublishedFeasibility(cwd, projectName)
				? "Next: /velpari-architecture-generator (feasibility already published — skip ahead) or /velpari-feasibility (revise feasibility)."
				: "Next: /velpari-feasibility",
			"info",
		);
	}
}