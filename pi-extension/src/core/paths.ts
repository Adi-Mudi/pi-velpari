/**
 * Path helpers for project-derived output paths (FR-67..FR-71, NFR-15).
 *
 * Two families of helpers:
 *
 * 1. **Legacy flat paths** (preserved for compatibility):
 *    `buildOutputPath(artifact, projectName)` → `Doc/<artifact>_<project>.md`.
 *    `buildDiscussionPath(topicSlug)` → `Doc/discussion-<slug>.md`.
 *    These are still readable as fallback by Doctor and the show/approve
 *    handlers. New writes use the grouped helpers.
 *
 * 2. **Grouped category paths** (preferred for new writes):
 *    `buildGroupedPath(artifact, projectName)` → `Doc/<group>/<artifact>_<project>.md`.
 *    `buildGroupedDiscussionPath(topicSlug)` → `Doc/discussion/discussion-<slug>.md`.
 *
 * Categories are documented in `Doc/velpari-requirements-orchestration-design.md`
 * §7–§9. The grouped layout keeps Doc/ organized by document family so
 * discussions do not collide with requirements, and so each artifact can
 * have many siblings (e.g. discussion + multiple discussion re-runs).
 */

import { existsSync } from "node:fs";

/**
 * Slugify a string for use in file names.
 * Rules: lowercase, hyphens for non-alphanumeric, max 64 chars.
 */
export function slugify(input: string): string {
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || "untitled";
}

/**
 * Build a Doc/<artifact>_<projectName>.md path (legacy, flat).
 * Example: buildOutputPath("PRD", "TodoApp") === "Doc/PRD_TodoApp.md"
 * Example: buildOutputPath("feasibility-study", "TodoApp") === "Doc/feasibility-study_TodoApp.md"
 *
 * Retained for compatibility. New code should prefer `buildGroupedPath`.
 */
export function buildOutputPath(artifact: string, projectName: string): string {
	const safeArtifact = artifact.replace(/[^A-Za-z0-9_-]+/g, "");
	const safeProject = projectName.replace(/[^A-Za-z0-9_-]+/g, "-");
	return `Doc/${safeArtifact}_${safeProject}.md`;
}

/**
 * Build a Doc/discussion-<topic-slug>.md path (legacy, flat).
 * Optional suffix for re-runs of the same topic (FR-69).
 * Example: buildDiscussionPath("cli-todo", "20260902-224000")
 *   === "Doc/discussion-cli-todo-20260902-224000.md"
 *
 * Retained for compatibility. New code should prefer
 * `buildGroupedDiscussionPath` or `buildDiscussionGroupPath`.
 */
export function buildDiscussionPath(topicSlug: string, suffix?: string): string {
	const slug = slugify(topicSlug);
	if (!suffix) {
		return `Doc/discussion-${slug}.md`;
	}
	return `Doc/discussion-${slug}-${suffix}.md`;
}

/**
 * Build the working-copy directory for a run.
 * Example: buildRunDir("2026-09-02-22-40-cli-todo")
 *   === ".IDE_Plans/velpari/runs/2026-09-02-22-40-cli-todo"
 */
export function buildRunDir(runId: string, cwd: string = process.cwd()): string {
	const safe = runId.replace(/[^A-Za-z0-9_-]+/g, "-");
	return `${cwd}/.IDE_Plans/velpari/runs/${safe}`;
}

// ---------------------------------------------------------------------------
// Grouped category layout (Velpari Requirements Factory design §7-§9).
// ---------------------------------------------------------------------------

/**
 * Map each artifact to its category subfolder under Doc/.
 * `null` means the artifact is grouped but lives at the Doc/ root
 * (none today). The map is the single source of truth for the
 * grouped path helpers below.
 */
export const GROUPED_CATEGORIES: Readonly<Record<string, string>> = {
	PRD: "requirements",
	RTM: "requirements",
	"feasibility-study": "feasibility",
	design: "design",
	pseudocode: "pseudocode",
	"test-plan": "tests",
	"test-cases": "tests",
	"atomic-functions": "atomic-functions",
	"development-order": "development-order",
};

/**
 * Build the new grouped published path for a project artifact.
 * Example: buildGroupedPath("PRD", "TodoApp") === "Doc/requirements/PRD_TodoApp.md".
 */
export function buildGroupedPath(artifact: string, projectName: string): string {
	const safeArtifact = artifact.replace(/[^A-Za-z0-9_-]+/g, "");
	const safeProject = projectName.replace(/[^A-Za-z0-9_-]+/g, "-");
	const category = GROUPED_CATEGORIES[safeArtifact] ?? "uncategorized";
	return `Doc/${category}/${safeArtifact}_${safeProject}.md`;
}

/**
 * Build the new grouped published path for a discussion artifact.
 * Example: buildGroupedDiscussionPath("cli-todo") === "Doc/discussion/discussion-cli-todo.md".
 */
export function buildGroupedDiscussionPath(topicSlug: string, suffix?: string): string {
	const slug = slugify(topicSlug);
	if (!suffix) {
		return `Doc/discussion/discussion-${slug}.md`;
	}
	return `Doc/discussion/discussion-${slug}-${suffix}.md`;
}

/**
 * Map each artifact to its category subfolder under the working-copy
 * `.IDE_Plans/velpari/runs/<run-id>/` directory. Mirrors `GROUPED_CATEGORIES`.
 */
export const WORKING_GROUPED_CATEGORIES: Readonly<Record<string, string>> = {
	PRD: "prd",
	RTM: "rtm",
	"feasibility-study": "feasibility",
	design: "design",
	pseudocode: "pseudocode",
	"test-plan": "tests",
	"test-cases": "tests",
	"atomic-functions": "atomic-functions",
	"development-order": "development-order",
};

/**
 * Build the working-copy grouped path for a project artifact.
 * Example: buildWorkingGroupedPath(cwd, runId, "PRD", "TodoApp")
 *   === "<cwd>/.IDE_Plans/velpari/runs/<runId>/prd/PRD_TodoApp.md"
 */
export function buildWorkingGroupedPath(
	cwd: string,
	runId: string,
	artifact: string,
	projectName: string,
): string {
	const safeArtifact = artifact.replace(/[^A-Za-z0-9_-]+/g, "");
	const safeProject = projectName.replace(/[^A-Za-z0-9_-]+/g, "-");
	const safeRunId = runId.replace(/[^A-Za-z0-9_-]+/g, "-");
	const category = WORKING_GROUPED_CATEGORIES[safeArtifact] ?? "uncategorized";
	return `${cwd}/.IDE_Plans/velpari/runs/${safeRunId}/${category}/${safeArtifact}_${safeProject}.md`;
}

/**
 * Map an artifact to the relative category subfolder under Doc/ for the
 * grouped layout. Returns null when the artifact is unknown.
 */
export function categoryFor(artifact: string): string | null {
	const safe = artifact.replace(/[^A-Za-z0-9_-]+/g, "");
	return GROUPED_CATEGORIES[safe] ?? null;
}

/**
 * Resolve a Doc/ artifact path, preferring the grouped layout and
 * falling back to the legacy flat path. Returns null when neither
 * exists on disk.
 */
export function resolveDocArtifact(
	artifact: string,
	projectName: string,
	cwd: string = process.cwd(),
): { path: string; layout: "grouped" | "legacy" } | null {
	const grouped = `${cwd}/${buildGroupedPath(artifact, projectName)}`;
	const legacy = `${cwd}/${buildOutputPath(artifact, projectName)}`;
	try {
		if (existsSync(grouped)) return { path: grouped, layout: "grouped" };
		if (existsSync(legacy)) return { path: legacy, layout: "legacy" };
		return null;
	} catch {
		return null;
	}
}

/**
 * Resolve a Doc/discussion-* artifact path, preferring the grouped
 * layout and falling back to the legacy flat path. Returns null when
 * neither exists on disk.
 */
export function resolveDiscussionArtifact(
	topicSlug: string,
	cwd: string = process.cwd(),
	suffix?: string,
): { path: string; layout: "grouped" | "legacy" } | null {
	const grouped = `${cwd}/${buildGroupedDiscussionPath(topicSlug, suffix)}`;
	const legacy = `${cwd}/${buildDiscussionPath(topicSlug, suffix)}`;
	try {
		if (existsSync(grouped)) return { path: grouped, layout: "grouped" };
		if (existsSync(legacy)) return { path: legacy, layout: "legacy" };
		return null;
	} catch {
		return null;
	}
}