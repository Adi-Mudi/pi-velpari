/**
 * Generic artifact frontmatter (RTM traceability upgrade, Phase 1).
 *
 * The PRD/PSRS carries its own YAML frontmatter schema (see psrs.ts).
 * This module gives EVERY published artifact a uniform metadata block so
 * doctor and future tooling can read artifact type, project, version,
 * stage, and timestamps without parsing prose:
 *
 *   ---
 *   artifact: RTM
 *   project: TodoApp
 *   version: 1.0.0
 *   status: published
 *   stage: built-rtm
 *   run: 2026-09-12-22-00-todo-app
 *   created: 2026-09-12T22:10:00.000Z
 *   updated: 2026-09-12T22:10:00.000Z
 *   ---
 *
 * Merge rules (withArtifactFrontmatter):
 *  - fields already present in the working copy win (LLM-written values
 *    like the PSRS schema are never overwritten);
 *  - `version` falls back to the previously published copy, then "1.0.0";
 *  - `created` falls back to the previously published copy, then now;
 *  - `updated` is always refreshed to the publish time;
 *  - extra keys (documentType, profile, ...) are preserved as-is.
 */

/** Canonical field order for rendered blocks. Extras follow in parse order. */
export const ARTIFACT_FRONTMATTER_FIELDS = [
	"artifact",
	"project",
	"version",
	"status",
	"stage",
	"run",
	"created",
	"updated",
] as const;

export interface ParsedFrontmatter {
	fields: Record<string, string>;
	/** Content after the frontmatter block (leading blank lines stripped). */
	body: string;
}

/**
 * Parse the `---\nkey: value\n---` block at the very top of a markdown
 * document. Returns null when no block is present. Same simple line-based
 * `key: value` dialect as psrs.ts:readFrontmatter — no nested YAML.
 */
export function parseFrontmatterBlock(content: string): ParsedFrontmatter | null {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) return null;
	const fields: Record<string, string> = {};
	for (const line of match[1]!.split("\n")) {
		const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
		if (m) fields[m[1]!] = m[2]!.trim();
	}
	return { fields, body: content.slice(match[0].length).replace(/^\n+/, "") };
}

/** Render a frontmatter block: canonical fields first, extras after. */
export function renderFrontmatter(fields: Record<string, string>): string {
	const keys = [
		...ARTIFACT_FRONTMATTER_FIELDS.filter((k) => k in fields),
		...Object.keys(fields).filter(
			(k) => !(ARTIFACT_FRONTMATTER_FIELDS as readonly string[]).includes(k),
		),
	];
	const lines = keys.map((k) => `${k}: ${fields[k]}`);
	return `---\n${lines.join("\n")}\n---\n\n`;
}

export interface ArtifactFrontmatterInput {
	/** Artifact key, e.g. "PRD", "RTM", "test-plan", "brainstorm". */
	artifact: string;
	/** Configured project name. */
	project: string;
	/** Stage that produced the artifact (state value, e.g. "built-rtm"). */
	stage: string;
	/** Run id. */
	run: string;
	/** ISO timestamp for created/updated. Injectable for tests. */
	now?: string;
}

/**
 * Return `content` with a complete artifact frontmatter block. Existing
 * fields are preserved; missing fields are filled from `input` and (for
 * `version`/`created`) from the previously published copy when given.
 */
export function withArtifactFrontmatter(
	content: string,
	input: ArtifactFrontmatterInput,
	publishedContent?: string | null,
): string {
	const now = input.now ?? new Date().toISOString();
	const existing = parseFrontmatterBlock(content);
	const published = publishedContent ? parseFrontmatterBlock(publishedContent) : null;

	const merged: Record<string, string> = { ...(existing?.fields ?? {}) };
	if (!merged.artifact) merged.artifact = input.artifact;
	if (!merged.project) merged.project = input.project;
	if (!merged.version) merged.version = published?.fields.version ?? "1.0.0";
	if (!merged.status) merged.status = "published";
	if (!merged.stage) merged.stage = input.stage;
	if (!merged.run) merged.run = input.run;
	if (!merged.created) merged.created = published?.fields.created ?? now;
	merged.updated = now;

	return renderFrontmatter(merged) + (existing?.body ?? content.replace(/^\n+/, ""));
}

/**
 * List the canonical fields missing from the document's frontmatter.
 * Returns all fields when no block is present at all.
 */
export function missingFrontmatterFields(content: string): string[] {
	const parsed = parseFrontmatterBlock(content);
	if (!parsed) return [...ARTIFACT_FRONTMATTER_FIELDS];
	return ARTIFACT_FRONTMATTER_FIELDS.filter((k) => !(k in parsed.fields));
}
