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
import { dirname, join } from "node:path";
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
import { runDoctor, writeDoctorReport } from "../doctor/index.js";
import { PATHS, type Stage, nextCommandsFor } from "../core/constants.js";

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
		case "analyzing-atomic-functions":
		case "analyzed-atomic-functions":
			// Stage 6 — atomic function working copy lives under
			// <runDir>/atomic-functions/atomic-functions_<project>.md
			// (per buildWorkingGroupedPath's GROUPED_CATEGORIES map).
			// The publish gate (doctor/gate.ts:runPublishGate) routes
			// atomic-functions artifacts through loadReviewerVerdict (the
			// reviewer verdict is the source of truth for tier checks).
			return { workingDir: "atomic-functions", artifact: "atomic-functions" };
		default:
			return null;
	}
}

/**
 * Map the current in-progress stage to its v1.6.0 per-stage approve
 * command. Used as the actor string passed to `advanceStage` (and
 * therefore recorded in state.json:history). STAGE_TRANSITIONS rows
 * for each publishable stage use the exact string returned here.
 */
function perStageApproveCommand(stage: Stage): string {
	switch (stage) {
		case "drafting-prd":
			return "/velpari-prd-approve";
		case "building-rtm":
			return "/velpari-rtm-approve";
		case "analyzing-feasibility":
			return "/velpari-feasibility-approve";
		case "designing":
			return "/velpari-architecture-generator-approve";
		case "analyzing-atomic-functions":
			return "/velpari-atomic-function-approve";
		case "writing-pseudocode":
			return "/velpari-pseudocode-approve";
		case "planning-tests":
			return "/velpari-testplan-approve";
		case "ordering-development":
			return "/velpari-development-order-approve";
		case "finalizing-design":
			return "/velpari-final-design-approve";
		default:
			return "/velpari-brainstorm-approve";
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

export interface ApproveOpts {
	/**
	 * Skip the v1.2.1 post-publish full doctor audit. Production callers
	 * never set this; tests that build minimal cwds (lacking `files.json`,
	 * agent mapping, etc.) opt in here. The publish gate still runs
	 * — only the supplementary full audit is skipped. Documented and
	 * covered by `approve-doctor-skip.test.ts`.
	 */
	skipAutoDoctor?: boolean;
}

const AUTO_DOCTOR_SKIP_ENV = "VELPARI_SKIP_AUTO_DOCTOR";

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

	if (state.currentStage === "brainstorming" || state.currentStage === "brainstormed") {
		ctx.ui.notify(
			`Use /velpari-feasibility-approve-brainstorm for the brainstorm stage. ` +
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
				ctx.ui.notify(`RTM JSON sidecar ${jsonFile} is not valid JSON. Fix it, then re-run /velpari-architecture-generator-approve.`, "error");
				return;
			}
			const validation = validateRtmData(parsed);
			if (!validation.ok) {
				ctx.ui.notify(
					`RTM JSON sidecar is invalid. Fix these issues, then re-run /velpari-atomic-function-approve:\n` +
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
		const input: {
							artifact: string;
							project: string;
							stage: string;
							run: string;
							supersedes?: string;
							sunset?: string;
							deprecatedAt?: string;
					  } = {
			artifact: target.fileArtifact,
			project: projectName,
			stage: state.currentStage,
			run: state.runId,
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
		ctx.ui.notify(
			target.publishedPath
				? `Published revision of ${target.fileArtifact} to ${target.groupedAbs}`
				: `Published to ${target.groupedAbs}`,
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
	if (pi) appendStageEntry(pi, next);
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
	const nextHint = `Next: ${nextCommands.join(" or ")}`;
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

function updateVersionInBody(content: string, newVersion: string): string {
	return content.replace(/^version:\s*.*$/m, `version: ${newVersion}`);
}

function updateStatusInBody(content: string, newStatus: string): string {
	return content.replace(/^status:\s*.*$/m, `status: ${newStatus}`);
}
