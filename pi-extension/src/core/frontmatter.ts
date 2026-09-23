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
	"supersedes",
	"sunset",
	"deprecatedAt",
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
		...Object.keys(fields).filter((k) => !(ARTIFACT_FRONTMATTER_FIELDS as readonly string[]).includes(k)),
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
	/**
	 * Optional id of the prior published artifact this one supersedes.
	 * When present, rendered as `supersedes: <id>` in the frontmatter
	 * (Phase 7 of the architecture-generator upgrade plan). Lets review
	 * tools follow the history: "design_TodoApp_2026-09-14 supersedes
	 * design_TodoApp_2026-09-13".
	 */
	supersedes?: string;
	/**
	 * Optional ISO 8601 date (`YYYY-MM-DD`) when this artifact is
	 * formally deprecated (RFC 8594). The doctor emits an error
	 * (ShapeCompatibility) once the date is past. v1.2.2: informational
	 * only — enforcement is v1.3+.
	 */
	sunset?: string;
	/**
	 * v1.3.0: ISO 8601 date this design was auto-archived by the
	 * sunset past-date flow. Written by handleApprove when the
	 * published `sunset:` is in the past. Once set, the design's
	 * `status` becomes `deprecated`. The doctor downgrades the
	 * past-sunset finding from `error` to `info` for already-archived
	 * designs.
	 */
	deprecatedAt?: string;
	/**
	 * B4 freshness stamp: single-line JSON scalar mapping each declared
	 * input identity (`<artifactKind>:<projectName|slug>`) to its SHA-256
	 * at publish time. Rendered as an extra key after the canonical
	 * fields; the parser's flat scalar dialect round-trips it losslessly.
	 */
	inputs?: string;
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
	// Phase 7: `supersedes` is taken from the input — never from the prior
	// published content, since the LLM publishes a fresh value.
	if (input.supersedes !== undefined) merged.supersedes = input.supersedes;
	// v1.2.2: `sunset` is informational on publish. Rendered when set.
	if (input.sunset !== undefined) merged.sunset = input.sunset;
	// v1.3.0: `deprecatedAt` (ISO date) marks the design as archived
	// after a past-sunset auto-archive. Written by handleApprove's
	// sunset auto-archive logic.
	if (input.deprecatedAt !== undefined) merged.deprecatedAt = input.deprecatedAt;
	// B4: freshness stamp always refreshes at publish time — a stale
	// `inputs:` line carried into the working copy is overwritten.
	if (input.inputs !== undefined) merged.inputs = input.inputs;

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
