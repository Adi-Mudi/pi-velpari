/**
 * Path helpers for project-derived output paths (FR-67..FR-71, NFR-15).
 *
 * Two families of helpers:
 *
 * 1. **Legacy flat paths** (preserved for compatibility):
 *    `buildOutputPath(artifact, projectName)` → `Doc/<artifact>_<project>.md`.
 *    `buildBrainstormPath(topicSlug)` → `Doc/brainstorm-<slug>.md`.
 *    These are still readable as fallback by Doctor and the show/approve
 *    handlers. New writes use the grouped helpers.
 *
 * 2. **Grouped category paths** (preferred for new writes):
 *    `buildGroupedPath(artifact, projectName)` → `Doc/<group>/<artifact>_<project>.md`.
 *    `buildGroupedBrainstormPath(topicSlug)` → `Doc/brainstorm/brainstorm-<slug>.md`.
 *
 * Categories are documented in `Doc/velpari-requirements-orchestration-design.md`
 * §7–§9. The grouped layout keeps Doc/ organized by document family so
 * brainstorms do not collide with requirements, and so each artifact can
 * have many siblings (e.g. brainstorm + multiple brainstorm re-runs).
 *
 * 3. **Store (DB-primary) paths** (G10/RES-4, LOCKED):
 *    `buildStoreDbPath(projectName)` → `Doc/store/<project>/index.db`.
 *    `buildStoreYamlPath(projectName, artifact)` → the YAML sidecar beside it.
 *    Per-project silo (Q5): the directory IS the project key — no project_id
 *    inside the DB. DB committed raw (D7); YAML sidecar = reviewable diff
 *    (RES-1). Phase 2 defines the layout; Phase 3's Store API is the first
 *    consumer.
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join, parse } from "node:path";

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
 * Build a Doc/brainstorm-<topic-slug>.md path (legacy, flat).
 * Optional suffix for re-runs of the same topic (FR-69).
 * Example: buildBrainstormPath("cli-todo", "20260902-224000")
 *   === "Doc/brainstorm-cli-todo-20260902-224000.md"
 *
 * Retained for compatibility. New code should prefer
 * `buildGroupedBrainstormPath` or `buildBrainstormGroupPath`.
 */
export function buildBrainstormPath(topicSlug: string, suffix?: string): string {
	const slug = slugify(topicSlug);
	if (!suffix) {
		return `Doc/brainstorm-${slug}.md`;
	}
	return `Doc/brainstorm-${slug}-${suffix}.md`;
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
	"final-design": "design",
	// v1.4.0 — logging-plan lives under Doc/observability/. Cross-cutting
	// discipline command (/velpari-design-logging) emits here.
	"logging-plan": "observability",
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
 * Build the new grouped published path for a brainstorm artifact.
 * Example: buildGroupedBrainstormPath("cli-todo") === "Doc/brainstorm/brainstorm-cli-todo.md".
 */
export function buildGroupedBrainstormPath(topicSlug: string, suffix?: string): string {
	const slug = slugify(topicSlug);
	if (!suffix) {
		return `Doc/brainstorm/brainstorm-${slug}.md`;
	}
	return `Doc/brainstorm/brainstorm-${slug}-${suffix}.md`;
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
	"final-design": "final-design",
	// v1.4.0 — mirrors the grouped Doc/observability/ folder for the
	// working copy at <runDir>/observability/logging-plan_<project>.md.
	"logging-plan": "observability",
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
 * v1.3.0+ multi-design: scan `Doc/<group>/` for all `*_<projectName>.md`
 * files matching the artifact and return them with their projectNames
 * extracted from the filename. Each result has a full path + the
 * projectName that owns the design.
 */
export function resolveDocArtifactAll(
	cwd: string,
	artifact: string,
): Array<{ path: string; projectName: string; layout: "grouped" | "legacy" }> {
	const category = categoryFor(artifact);
	const results: Array<{
		path: string;
		projectName: string;
		layout: "grouped" | "legacy";
	}> = [];
	if (!cwd) return results;
	let groupedDir: string | null = null;
	let legacyDir: string | null = null;
	try {
		if (category) groupedDir = join(cwd, "Doc", category);
		legacyDir = join(cwd, "Doc");
	} catch {
		return results;
	}
	// Filenames look like: <artifact>_<projectName>.md  (projectName may
	// contain hyphens). Pull the substring after the artifact + "_".
	const safeArtifact = artifact.replace(/[^A-Za-z0-9_-]+/g, "");
	const fileRe = new RegExp(`^${safeArtifact}_(.+)\\.md$`);

	const dirs: Array<{ dir: string; layout: "grouped" | "legacy" }> = [];
	if (groupedDir) dirs.push({ dir: groupedDir, layout: "grouped" });
	if (legacyDir) {
		try {
			for (const entry of readdirSync(legacyDir)) {
				if (entry === category) continue;
				dirs.push({ dir: join(legacyDir, entry), layout: "legacy" });
			}
		} catch {
			// ignore
		}
	}

	const seen = new Set<string>();
	for (const { dir, layout } of dirs) {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const m = entry.match(fileRe);
			if (!m) continue;
			const projectName = m[1];
			if (!projectName || seen.has(projectName)) continue;
			seen.add(projectName);
			results.push({ path: join(dir, entry), projectName, layout });
		}
	}
	return results;
}

/**
 * Resolve a Doc/brainstorm-* artifact path, preferring the grouped
 * layout and falling back to the legacy flat path. Returns null when
 * neither exists on disk.
 */
export function resolveBrainstormArtifact(
	topicSlug: string,
	cwd: string = process.cwd(),
	suffix?: string,
): { path: string; layout: "grouped" | "legacy" } | null {
	const grouped = `${cwd}/${buildGroupedBrainstormPath(topicSlug, suffix)}`;
	const legacy = `${cwd}/${buildBrainstormPath(topicSlug, suffix)}`;
	try {
		if (existsSync(grouped)) return { path: grouped, layout: "grouped" };
		if (existsSync(legacy)) return { path: legacy, layout: "legacy" };
		return null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Store (DB-primary) paths (G10/RES-4 — LOCKED layout, Phase 2).
// ---------------------------------------------------------------------------

/**
 * The locked store folder under Doc/ (RES-4 Choice A). Every project's
 * SQLite store lives at `Doc/store/<projectName>/index.db`.
 */
export const STORE_DB_DIR = "Doc/store";

/**
 * Build the store DB path for a project (G10/RES-4, LOCKED).
 * Example: buildStoreDbPath("TodoApp", cwd)
 *   === "<cwd>/Doc/store/TodoApp/index.db".
 *
 * Per-project silo (Q5): the directory IS the project key — the DB itself
 * carries no project_id. The DB is committed raw (D7).
 */
export function buildStoreDbPath(projectName: string, cwd: string = process.cwd()): string {
	const safeProject = projectName.replace(/[^A-Za-z0-9_-]+/g, "-");
	return join(cwd, STORE_DB_DIR, safeProject, "index.db");
}

/**
 * Build the YAML sidecar path for a store artifact (RES-1).
 * The sidecar lands beside the DB so each publish produces a
 * reviewable, git-friendly diff next to the raw committed `index.db`
 * (D7). Consumed from Phase 4 on; the locked layout is defined and
 * tested here so the location never drifts.
 * Example: buildStoreYamlPath("TodoApp", "PRD", cwd)
 *   === "<cwd>/Doc/store/TodoApp/PRD_TodoApp.yaml".
 */
export function buildStoreYamlPath(
	projectName: string,
	artifact: string,
	cwd: string = process.cwd(),
): string {
	const safeProject = projectName.replace(/[^A-Za-z0-9_-]+/g, "-");
	const safeArtifact = artifact.replace(/[^A-Za-z0-9_-]+/g, "");
	return join(cwd, STORE_DB_DIR, safeProject, `${safeArtifact}_${safeProject}.yaml`);
}

/**
 * Walk up from `startDir` to the filesystem root, returning the directory
 * containing the nearest `package.json`. This is the canonical
 * layout-independent way to find the package root for an ESM source file:
 * `import.meta.url` already resolves symlinks, so `dirname(...)` gives the
 * real on-disk location of the calling module.
 *
 * Used by core/prompt.ts and io/agents-install.ts to resolve bundled
 * `skills/` and `skills/agents/` paths regardless of whether the code
 * runs from the dist tree, the source tree (npm install), or a symlinked
 * dev install.
 *
 * Throws when no package.json is found above `startDir` (defensive — this
 * should never happen for a real npm package).
 */
export function findPackageRoot(startDir: string): string {
	let dir = startDir;
	const { root } = parse(dir);
	while (dir !== root) {
		if (existsSync(join(dir, "package.json"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(`findPackageRoot: no package.json found above ${startDir}`);
}

/**
 * True when a published feasibility study exists for this project
 * (grouped layout or legacy fallback). Gates the built-rtm → designing
 * skip: update cycles may jump straight to /velpari-architecture-generator.
 */
export function hasPublishedFeasibility(cwd: string, projectName: string): boolean {
	return resolveDocArtifact("feasibility-study", projectName, cwd) !== null;
}
