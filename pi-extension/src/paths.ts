/**
 * Path helpers for project-derived output paths (FR-67..FR-71, NFR-15).
 *
 * All Doc/ artifacts use `<projectName>` suffix, not hardcoded "Pi-Velpari".
 * Discussion outputs use `<topic-slug>` (per FR-69).
 */

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
 * Build a Doc/<artifact>_<projectName>.md path.
 * Example: buildOutputPath("PRD", "TodoApp") === "Doc/PRD_TodoApp.md"
 */
export function buildOutputPath(artifact: string, projectName: string): string {
	const safeArtifact = artifact.replace(/[^A-Za-z0-9]+/g, "");
	const safeProject = projectName.replace(/[^A-Za-z0-9_-]+/g, "-");
	return `Doc/${safeArtifact}_${safeProject}.md`;
}

/**
 * Build a Doc/discussion-<topic-slug>.md path.
 * Optional suffix for re-runs of the same topic (FR-69).
 * Example: buildDiscussionPath("cli-todo", "20260902-224000")
 *   === "Doc/discussion-cli-todo-20260902-224000.md"
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
