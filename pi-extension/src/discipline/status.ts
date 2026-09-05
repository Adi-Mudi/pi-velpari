/**
 * /velpari-status handler (Phase 7 update; FR-09; Phase E entry-renderer).
 *
 * Pure read-only. Loads the current run state and emits a structured
 * status entry via `pi.appendEntry`. Never modifies state.
 *
 * Phase E: switched the output from a single ctx.ui.notify blob (which
 * truncated past ~8000 chars) to a `velpari-status` entry. The default Pi
 * JSON renderer shows the entry; a styled Box+Text renderer is deferred
 * to a follow-up until @earendil-works/pi-tui is added as a peer dep.
 *
 * Scans the grouped Doc/ layout for each artifact, falling back to
 * legacy flat Doc/ paths when present. Uses projectName from
 * `.pi/velpari/files.json` to derive the per-project file names.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadState } from "../core/state.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import {
	GROUPED_CATEGORIES,
	buildGroupedDiscussionPath,
	buildGroupedPath,
	resolveDiscussionArtifact,
	resolveDocArtifact,
	slugify,
} from "../core/paths.js";
import {
	compactProfileMetadata,
	loadRequirementsProfile,
} from "../core/profile.js";

const MAX_NOTIFY_LENGTH = 8000;

const ARTIFACT_ORDER: ReadonlyArray<{ artifact: string; label: string }> = [
	{ artifact: "PRD", label: "PSRS" },
	{ artifact: "RTM", label: "RTM" },
	{ artifact: "feasibility-study", label: "Feasibility" },
	{ artifact: "design", label: "Design" },
	{ artifact: "pseudocode", label: "Pseudocode" },
	{ artifact: "test-plan", label: "Test Plan" },
	{ artifact: "test-cases", label: "Test Cases" },
	{ artifact: "atomic-functions", label: "Atomic Functions" },
	{ artifact: "development-order", label: "Development Order" },
];

export async function handleStatus(
	ctx: ExtensionCommandContext,
	pi?: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	const state = loadState(cwd);
	if (state.currentStage === "none") {
		ctx.ui.notify("No active Velpari run.", "info");
		return;
	}

	const projectName = (() => {
		const cfg = loadFilesConfig(cwd);
		return validateFilesConfig(cfg) ? cfg.projectName : "";
	})();
	const topicSlug = slugify(state.mission);

	const lines: string[] = [
		`# Velpari run ${state.runId}`,
		``,
		`Mission: ${state.mission || "(none)"}`,
		`Current stage: ${state.currentStage}`,
		`Updated: ${state.updatedAt || "(unknown)"}`,
		``,
		`## Profile`,
	];

	const profile = loadRequirementsProfile(cwd);
	const compact = compactProfileMetadata(profile);
	if (compact) {
		lines.push(
			`Profile: ${compact.profileId}@${compact.profileVersion} ` +
				`(${compact.applicationType}/${compact.domain}, ${compact.developmentMethod}, regulated=${compact.regulated ? "yes" : "no"}, variant=${compact.outputVariant})`,
		);
	} else {
		lines.push("Profile: (none — run /velpari-configure-requirements)");
	}

	lines.push(``, `## History`, ...state.history.map((h) => `- ${h.timestamp} — ${h.command} → ${h.stage}`));
	lines.push(``, `## Published artifacts (Doc/)`);

	if (projectName) {
		for (const { artifact, label } of ARTIFACT_ORDER) {
			const resolved = resolveDocArtifact(artifact, projectName, cwd);
			if (resolved) {
				lines.push(`- ${label}: ${resolved.path} (${resolved.layout})`);
			}
		}
		const groupedDiscussion = resolveDiscussionArtifact(topicSlug, cwd);
		if (groupedDiscussion) {
			lines.push(`- Discussion: ${groupedDiscussion.path} (${groupedDiscussion.layout})`);
		} else {
			lines.push(`- Discussion: (none at topic slug "${topicSlug}")`);
		}
	} else {
		lines.push("- (no projectName — cannot scan per-project artifacts)");
	}

	// Surface legacy flat Doc/ files that are NOT covered by the
	// grouped scan so users know they exist and may want to migrate.
	const docDir = join(cwd, "Doc");
	if (existsSync(docDir)) {
		const groupedSet = new Set<string>();
		for (const category of Object.values(GROUPED_CATEGORIES)) {
			groupedSet.add(`${category}/`);
		}
		const groupedDiscussionPrefix = `discussion/`;
		const flat = readdirSync(docDir).filter((f) => f.endsWith(".md") && !f.includes("/"));
		const legacyFlat = flat.filter((f) => {
			// A flat discussion-<slug>.md file (no subfolder prefix) is
			// also legacy-flat and only surfaced by the scan above.
			if (f.startsWith("discussion-")) return false;
			return true;
		});
		if (legacyFlat.length > 0) {
			lines.push(``, `## Legacy flat artifacts (Doc/ root)`);
			for (const f of legacyFlat) {
				lines.push(`- ${f}`);
			}
		}
		// Also note legacy discussion files explicitly.
		const legacyDiscussion = flat.filter((f) => f.startsWith("discussion-"));
		if (legacyDiscussion.length > 0) {
			lines.push(``, `## Legacy flat discussions`);
			for (const f of legacyDiscussion) {
				lines.push(`- ${f}`);
			}
		}
		void groupedSet;
		void groupedDiscussionPrefix;
	}

	const summary = lines.join("\n");

	if (pi) {
		// Phase E: persist the status as a session entry. The default Pi
		// JSON renderer shows it expandable in the TUI; a styled renderer
		// is deferred until @earendil-works/pi-tui is added as a peer dep.
		const profile = loadRequirementsProfile(cwd);
		const profileMeta = compactProfileMetadata(profile);
		pi.appendEntry("velpari-status", {
			runId: state.runId,
			mission: state.mission,
			stage: state.currentStage,
			updatedAt: state.updatedAt,
			profileId: profileMeta?.profileId ?? "(none)",
			profileKind: profileMeta?.profileKind ?? "(none)",
			profileVersion: profileMeta?.profileVersion ?? "(none)",
			applicationType: profileMeta?.applicationType ?? "(none)",
			domain: profileMeta?.domain ?? "(none)",
			developmentMethod: profileMeta?.developmentMethod ?? "(none)",
			regulated: profileMeta?.regulated ?? false,
			outputVariant: profileMeta?.outputVariant ?? "(none)",
			body: summary,
		});
		ctx.ui.notify("Velpari status entry added. Expand it in the session tree for the full body.", "info");
	} else if (summary.length <= MAX_NOTIFY_LENGTH) {
		// Fallback: no `pi` available (test rig, RPC mode), emit the legacy
		// single-blob notify with truncation, matching pre-Phase-E behavior.
		ctx.ui.notify(summary, "info");
	} else {
		const TRUNCATION_MARKER = "\n... [truncated]";
		const truncated = summary.slice(0, MAX_NOTIFY_LENGTH - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
		ctx.ui.notify(truncated, "info");
	}

	void buildGroupedPath;
	void buildGroupedDiscussionPath;
}