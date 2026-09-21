/**
 * Sub-agent generator core (Phase 2 of /velpari-generate-sub-agents).
 *
 * Deterministic assembly: agent content is built from
 *   role template  +  technology resource(s)  +  project-context block
 *
 * No LLM content generation. The generator is a pure function of its
 * inputs; the harness's job is to supply good inputs.
 *
 * Layer 0 (L0 domain primitive). Imports only `node:*`, same-layer
 * (`./paths.js` for slugify / findPackageRoot), and peer-dependency
 * symbols from `@earendil-works/pi-coding-agent`. Never imports upward
 * to ops/, stages/, ui/, hooks/, commands/.
 *
 * Mirrors `pi-seani/pi-extension/src/agents/generator.ts` (Senai parity).
 * Velpari-specific simplifications:
 *   - No runtime dep on `@adi-mudi/pi-chirpi` (Velpari standalone)
 *   - `GENERATOR_VERSION = 2` (per-phase generation — v1 was brainstorm-only)
 *   - The `ArchitectReport` slot is fed by `core/project-context.ts:
 *     loadProjectContext(cwd, state, phase)` from published `Doc/`
 *     artifacts (sidecar-first), per spec
 *     `Doc/velpari-sequence/05-sub-agent-generation.md`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { findPackageRoot, slugify } from "./paths.js";
import { atomicWriteFile } from "../io/atomic-write.js";
import {
	addToGeneratedManifest,
	loadGeneratedManifest,
} from "./generated-manifest.js";
import {
	DEFAULT_AGENTS,
	ROLE_LABELS,
	loadAgentConfig,
	resolveAgentName,
	saveAgentConfig,
	type VelpariRole,
} from "./agents-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Bump when the generated agent format changes. Footer carries this number so
 *  doctor can flag files from an older format. v1: brainstorm-only release.
 *  v2: per-phase generation (Phases 1–4 via GENERATION_PHASES). */
export const GENERATOR_VERSION = 2;

export interface GeneratedRoleDef {
	role: string;
	label: string;
	tools: string[];
	mandate: string;
	/** When the harness should spawn this agent. Becomes part of the YAML
	 *  description: frontmatter so the harness auto-invokes correctly.
	 *  Required — every role has one. */
	invocationHint: string;
	/** What this agent MUST NOT do, even if asked. Rendered as the
	 *  `## Out of scope` section in the body. Required — every role has
	 *  at least one entry. */
	outOfScope: string[];
	interactive?: boolean;
	/** When set, the generator loads the file at this path (relative to
	 *  the agents source directory) and uses ITS content as the agent body
	 *  — replacing the standard mandate + outOfScope + completion contract
	 *  template. Used for specialists whose contract is too specific to
	 *  fit the standard template (e.g. web-search-agent). */
	bodyFile?: string;
}

/** Architect report shape — the generator's project-context input slot.
 *  Structurally identical to `core/project-context.ts:ProjectContext`
 *  (the v2 loader's return type); kept as a separate name so the
 *  generator's contract reads in domain terms. */
export interface ArchitectReport {
	techStack: string[];
	atomicFunctions: string[];
	constraints: string[];
}

export interface TechnologyResource {
	id: string;
	name: string;
	keywords: string[];
	body: string;
	source: "bundle" | "project";
}

export interface GeneratedAgentPlan {
	role: string;
	agentName: string;
	description: string;
	tools: string[];
	content: string;
}

/** Result of `writeGeneratedAgents`. */
export interface WriteAgentsResult {
	created: string[];
	regenerated: string[];
	keptDrifted: string[];
	skipped: string[];
}

/** Result of `previewRegeneration`. Same as `WriteAgentsResult` with the
 *  keys renamed to match the confirmation dialog copy. */
export interface RegenerationPreview {
	recreate: string[];
	overwrite: string[];
	keptDrifted: string[];
	unknown: string[];
}

// ─── Resource loading ─────────────────────────────────────────────────────

export function getBundledTechnologiesDir(): string {
	const pkgRoot = findPackageRoot(__dirname);
	return path.join(pkgRoot, "resources", "technologies");
}

export function getProjectTechnologiesDir(cwd: string): string {
	return path.join(cwd, ".pi", "velpari", "technologies");
}

/** Convert the `keywords:` frontmatter value into a normalized string[].
 *  Accepts a YAML list (`["a", "b"]`) or a comma-separated string
 *  (`a, b`). Anything else returns []. Surrounding single/double quotes
 *  on individual items are stripped (YAML lists commonly quote values). */
export function parseKeywords(raw: unknown): string[] {
	const strip = (s: string) => s.trim().toLowerCase().replace(/^["']|["']$/g, "");
	if (Array.isArray(raw)) {
		return raw.map((k) => strip(String(k))).filter(Boolean);
	}
	if (typeof raw === "string") {
		return raw
			.split(",")
			.map((k) => strip(k))
			.filter(Boolean);
	}
	return [];
}

/** Minimal YAML-frontmatter parser tailored to the resource shape:
 *  ---
 *  id: ...
 *  name: ...
 *  keywords: ["a", "b"]
 *  ---
 *  Returns null when the frontmatter block is missing or any required
 *  field is absent. */
function parseResourceFrontmatter(
	content: string,
): { id: string; name: string; keywords: string[]; body: string } | null {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return null;
	const fm = match[1];
	if (fm === undefined || match[2] === undefined) return null;
	const idMatch = fm.match(/^id:\s*(.+)$/m);
	const nameMatch = fm.match(/^name:\s*(.+)$/m);
	const kwMatch = fm.match(/^keywords:\s*\[(.*)\]$/m);
	if (!idMatch || !nameMatch || !kwMatch) return null;
	if (idMatch[1] === undefined || nameMatch[1] === undefined || kwMatch[1] === undefined) return null;
	const id = idMatch[1].trim();
	const name = nameMatch[1].trim();
	const keywords = parseKeywords(kwMatch[1]);
	const body = match[2].trim();
	return { id, name, keywords, body };
}

function loadResourcesFromDir(dir: string, source: TechnologyResource["source"]): TechnologyResource[] {
	if (!fs.existsSync(dir)) return [];
	const resources: TechnologyResource[] = [];
	for (const entry of fs.readdirSync(dir)) {
		if (!entry.endsWith(".md") || entry === "_template.md") continue;
		const filePath = path.join(dir, entry);
		try {
			const content = fs.readFileSync(filePath, "utf8");
			const parsed = parseResourceFrontmatter(content);
			if (!parsed) continue;
			if (!parsed.body) continue;
			resources.push({
				id: parsed.id,
				name: parsed.name,
				keywords: parsed.keywords,
				body: parsed.body,
				source,
			});
		} catch {
			// Skip unreadable resource files.
		}
	}
	return resources;
}

/** Bundled resources ship with the extension at `resources/technologies/`;
 *  a project can add or override them at `<cwd>/.pi/velpari/technologies/`
 *  (project wins on matching id). */
export function discoverTechnologyResources(cwd: string): TechnologyResource[] {
	const bundled = loadResourcesFromDir(getBundledTechnologiesDir(), "bundle");
	const project = loadResourcesFromDir(getProjectTechnologiesDir(cwd), "project");
	const projectIds = new Set(project.map((r) => r.id));
	return [...bundled.filter((r) => !projectIds.has(r.id)), ...project];
}

/** Score resources by keyword hits against `stackHints`. Returns matched
 *  resources ordered by score (high to low). Falls back to the `generic`
 *  resource when nothing matches so generation never dead-ends. Returns
 *  [] if nothing matches AND `generic` is absent. */
export function matchTechnologies(
	stackHints: string[],
	resources: TechnologyResource[],
): TechnologyResource[] {
	const haystack = stackHints.join(" ").toLowerCase();
	const scored = resources
		.filter((r) => r.id !== "generic" && r.id !== "_template")
		.map((r) => ({
			resource: r,
			score: r.keywords.reduce(
				(acc, keyword) => (keyword && haystack.includes(keyword) ? acc + 1 : acc),
				0,
			),
		}))
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score);

	if (scored.length > 0) {
		return scored.map((s) => s.resource);
	}
	const generic = resources.find((r) => r.id === "generic");
	return generic ? [generic] : [];
}

// ─── Slug + hash helpers ──────────────────────────────────────────────────

/** Derive a stable slug from the project's package.json name (or folder
 *  basename when no package.json is present). Used as `<slug>-<role>`
 *  in the generated agent file name. */
export function getProjectSlug(cwd: string): string {
	const pkgPath = path.join(cwd, "package.json");
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
		if (typeof pkg.name === "string" && pkg.name.trim()) {
			return slugify(pkg.name);
		}
	} catch {
		// Fall through to the folder name.
	}
	return slugify(path.basename(cwd));
}

/** Returns the sha256 of a file, or null when the file cannot be read.
 *  Used by the manifest drift detector. */
export function hashFile(filePath: string): string | null {
	try {
		return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
	} catch {
		return null;
	}
}

// ─── Agent markdown assembly ──────────────────────────────────────────────

function buildProjectContextBlock(report: ArchitectReport | null): string {
	if (!report) return "";
	if (
		report.techStack.length === 0 &&
		report.atomicFunctions.length === 0 &&
		report.constraints.length === 0
	) {
		return "";
	}
	const lines: string[] = ["## Project context", ""];
	if (report.techStack.length > 0) {
		lines.push("Technology stack:");
		for (const tech of report.techStack) lines.push(`- ${tech}`);
		lines.push("");
	}
	if (report.atomicFunctions.length > 0) {
		lines.push("Key functions in this project:");
		for (const fn of report.atomicFunctions) lines.push(`- ${fn}`);
		lines.push("");
	}
	if (report.constraints.length > 0) {
		lines.push("Constraints you must respect:");
		for (const c of report.constraints) lines.push(`- ${c}`);
	}
	return lines.join("\n").trim();
}

/** Resolve the canonical body file path for a `bodyFile` entry.
 *  Returns null when the file cannot be found. The caller falls back to
 *  the standard template in that case (never a dead-end). */
export function resolveBodyFilePath(bodyFile: string): string | null {
	const pkgRoot = findPackageRoot(__dirname);
	const candidates = [
		// source layout (npm-installed src mode)
		path.join(pkgRoot, "pi-extension", "src", "agents", bodyFile),
		// compiled layout (dist/pi-extension/src/agents/ — would require a
		// build step to copy the .md file; included for completeness)
		path.join(pkgRoot, "dist", "pi-extension", "src", "agents", bodyFile),
		// bundled stage-scout templates (generator v2 — Phases 2–4 derive
		// their canonical bodies from skills/agents/<role>.md)
		path.join(pkgRoot, "skills", "agents", bodyFile),
	];
	for (const c of candidates) {
		if (fs.existsSync(c)) return c;
	}
	return null;
}

/** Load a canonical body file and return its content (frontmatter
 *  stripped). Returns null when the file is missing or unreadable. */
export function loadCanonicalBody(bodyFile: string): string | null {
	const filePath = resolveBodyFilePath(bodyFile);
	if (!filePath) return null;
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
	if (raw.startsWith("---")) {
		const end = raw.indexOf("\n---", 3);
		if (end !== -1) return raw.slice(end + 4).trim();
	}
	return raw.trim();
}

/**
 * Build a `GeneratedRoleDef` from a bundled stage-scout template
 * (`skills/agents/<role>.md`). The template's frontmatter supplies the
 * tools + description; its body becomes the canonical body via
 * `bodyFile` (the real scout contract — report paths, output JSON
 * shape — survives verbatim into the generated copy).
 *
 * Used by the v2 per-phase generator for every Phase 2–4 role (stage
 * scouts + reviewers); Phase 1 keeps the hand-authored
 * `VELPARI_BRAINSTORM_GENERATED_ROLES` table.
 *
 * Returns null when the template is missing or malformed — the caller
 * skips the role (the bundled scout remains the permanent fallback).
 */
export function scoutTemplateRoleDef(role: string): GeneratedRoleDef | null {
	const pkgRoot = findPackageRoot(__dirname);
	const filePath = path.join(pkgRoot, "skills", "agents", `${role}.md`);
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
	const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match || match[1] === undefined) return null;
	const fm = match[1];
	const descMatch = fm.match(/^description:\s*(.+)$/m);
	if (!descMatch || descMatch[1] === undefined) return null;
	const description = descMatch[1].trim();
	if (!description) return null;
	const toolsMatch = fm.match(/^tools:\s*(.+)$/m);
	const tools =
		toolsMatch?.[1] !== undefined
			? toolsMatch[1]
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean)
			: ["read", "write", "bash"];
	return {
		role,
		label: ROLE_LABELS[role as VelpariRole] ?? role,
		tools: tools.length > 0 ? tools : ["read", "write", "bash"],
		mandate: description,
		invocationHint: description,
		outOfScope: [
			"Do not call other subagents (you are a leaf specialist).",
			"Do not write or modify anything outside the report path assigned in your task.",
		],
		bodyFile: `${role}.md`,
	};
}

/** Assemble a single agent's markdown. The output is deterministic for
 *  a given (def, agentName, projectName, resources, report) tuple. */
export function buildGeneratedAgentMarkdown(
	def: GeneratedRoleDef,
	agentName: string,
	projectName: string,
	resources: TechnologyResource[],
	report: ArchitectReport | null,
): string {
	const description = `${def.invocationHint} — ${def.label} for ${projectName}. Generated by pi-velpari.`;

	const lines: string[] = [
		"---",
		`name: ${agentName}`,
		`description: ${description}`,
		`tools: ${def.tools.join(", ")}`,
		"session-mode: lineage-only",
		"auto-exit: true",
		"spawning: false",
		...(def.interactive ? ["interactive: true"] : []),
		"---",
		"",
		`# ${agentName}`,
		"",
		`You are the ${def.label} for the ${projectName} project.`,
		"",
		"## Your mandate",
		"",
		`- ${def.mandate}`,
		"- Report results with exact file paths and evidence. Do not modify anything outside your mandate.",
		"",
	];

	if (def.outOfScope.length > 0) {
		lines.push("## Out of scope", "");
		for (const item of def.outOfScope) {
			lines.push(`- ${item}`);
		}
		lines.push("");
	}

	lines.push(
		"## Completion contract",
		"",
		"- Write your deliverable to the artifact path given in your task. The file on disk is the deliverable.",
		"- Your FINAL message must be at most 10 lines: outcome + artifact path(s). Never paste the deliverable content into the final message.",
	);

	const contextBlock = buildProjectContextBlock(report);
	if (contextBlock) {
		lines.push("", contextBlock);
	}

	// Canonical-body roles: replace the standard template with the body
	// from the canonical file. The frontmatter above is still
	// generator-controlled, but the body comes from the specialist's
	// own contract.
	if (def.bodyFile) {
		const customBody = loadCanonicalBody(def.bodyFile);
		if (customBody) {
			lines.push("", customBody);
			lines.push(
				"",
				"---",
				`_Generated by pi-velpari (generator v${GENERATOR_VERSION}) from canonical body file: ${def.bodyFile}._`,
			);
			return lines.join("\n");
		}
		// Fall through to the standard template if the body file is missing.
	}

	for (const resource of resources) {
		lines.push("", `## Technology craft (${resource.name})`, "", resource.body);
	}

	const resourceIds = resources.map((r) => `\`${r.id}\``).join(", ");
	lines.push(
		"",
		"---",
		`_Generated by pi-velpari (generator v${GENERATOR_VERSION}) from technology resource(s): ${resourceIds}._`,
	);

	return lines.join("\n");
}

/** Plan a generation run. Returns one GeneratedAgentPlan per role. */
export function planAgentGeneration(
	cwd: string,
	roles: GeneratedRoleDef[],
	resources: TechnologyResource[],
	report: ArchitectReport | null,
): GeneratedAgentPlan[] {
	const slug = getProjectSlug(cwd);
	const projectName = slug;
	return roles.map((def) => {
		const agentName = `${slug}-${def.role}`;
		return {
			role: def.role,
			agentName,
			description: `${def.label} for ${projectName}. Generated by pi-velpari.`,
			tools: def.tools,
			content: buildGeneratedAgentMarkdown(def, agentName, projectName, resources, report),
		};
	});
}

// ─── Generated-manifest re-export ─────────────────────────────────────────

export { addToGeneratedManifest, loadGeneratedManifest, saveGeneratedManifest } from "./generated-manifest.js";

// ─── Write-with-safety contract (Phase 4) ────────────────────────────────

/**
 * Write agent files into `.pi/agents/`. Safety contract:
 *
 * 1. Files of unknown origin are NEVER overwritten — they are reported
 *    as `skipped` so the user keeps their own custom agents. The
 *    generator's authority comes only from the manifest: a file is
 *    eligible for regeneration iff it carries a sha256 in
 *    `.pi/velpari/generated-manifest.json` matching its current content.
 * 2. With `regenerate: true`, files the manifest proves we generated
 *    AND the user never edited (hash still matches) are overwritten
 *    in place; user-edited files (hash drift) are kept and reported
 *    as `keptDrifted`. A missing file with a surviving mapping is
 *    recreated.
 * 3. Without `regenerate`, an existing file is always skipped (no
 *    overwrite), regardless of manifest membership. This is the
 *    safe default — the user must pass `regenerate: true` to actually
 *    overwrite anything.
 * 4. New files are always written; they are added to the manifest so
 *    future regen passes can update them safely.
 * 5. Manifest writes are merged (never wiped) — pre-existing entries
 *    for unrelated files survive.
 *
 * Project-relative paths are returned in the result so the caller can
 * render them in a confirmation dialog.
 */
export function writeGeneratedAgents(
	cwd: string,
	plans: readonly GeneratedAgentPlan[],
	opts?: { regenerate?: boolean },
): WriteAgentsResult {
	const agentsDir = path.join(cwd, ".pi", "agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	const regenerate = opts?.regenerate === true;
	const manifest = regenerate ? loadGeneratedManifest(cwd) : null;

	const created: string[] = [];
	const regenerated: string[] = [];
	const keptDrifted: string[] = [];
	const skipped: string[] = [];
	const writtenAbsolute: string[] = [];

	for (const plan of plans) {
		const filePath = path.join(agentsDir, `${plan.agentName}.md`);
		const rel = path.relative(cwd, filePath);
		if (fs.existsSync(filePath)) {
			if (!regenerate) {
				skipped.push(rel);
				continue;
			}
			// regenerate === true → check manifest membership + current hash
			const expectedHash = manifest?.files[rel];
			if (expectedHash === undefined) {
				// Not in the manifest — unknown origin (possibly hand-made
				// or installed from a third-party source). Never touch.
				skipped.push(rel);
				continue;
			}
			const currentHash = hashFile(filePath);
			if (currentHash !== expectedHash) {
				// User edited the file after generation. Keep their edits.
				keptDrifted.push(rel);
				continue;
			}
			atomicWriteFile(filePath, plan.content, "utf8");
			regenerated.push(rel);
			writtenAbsolute.push(filePath);
			continue;
		}
		// File does not exist — write it (this is also how a "missing
		// but mapped" file gets recreated).
		atomicWriteFile(filePath, plan.content, "utf8");
		created.push(rel);
		writtenAbsolute.push(filePath);
	}

	if (writtenAbsolute.length > 0) {
		addToGeneratedManifest(cwd, writtenAbsolute);
	}

	return { created, regenerated, keptDrifted, skipped };
}

/**
 * Classify existing generated agent files exactly like
 * `writeGeneratedAgents({regenerate: true})`, but write nothing. Used
 * to preview the write set in the confirmation dialog.
 *
 * Project-relative paths. The four buckets correspond to the four
 * actions the dialog can take:
 *   - `recreate`     — file is missing; will be created
 *   - `overwrite`    — file is in the manifest AND hash matches; will
 *                      be regenerated
 *   - `keptDrifted`  — file is in the manifest BUT hash differs; user
 *                      edited it, will NOT be touched
 *   - `unknown`      — file exists but is NOT in the manifest; will
 *                      NOT be touched (preserves hand-made agents)
 */
export function previewRegeneration(
	cwd: string,
	agentNames: readonly string[],
): RegenerationPreview {
	const manifest = loadGeneratedManifest(cwd);
	const preview: RegenerationPreview = { recreate: [], overwrite: [], keptDrifted: [], unknown: [] };
	for (const agentName of agentNames) {
		const filePath = path.join(cwd, ".pi", "agents", `${agentName}.md`);
		const rel = path.relative(cwd, filePath);
		if (!fs.existsSync(filePath)) {
			preview.recreate.push(rel);
			continue;
		}
		const expectedHash = manifest.files[rel];
		if (expectedHash === undefined) {
			preview.unknown.push(rel);
			continue;
		}
		const currentHash = hashFile(filePath);
		if (currentHash !== expectedHash) {
			preview.keptDrifted.push(rel);
		} else {
			preview.overwrite.push(rel);
		}
	}
	return preview;
}

/**
 * Update `.pi/velpari/agents.json` to map every plan's role to its
 * generated agent name — but only for roles currently on a built-in
 * default. Existing custom mappings are NEVER overwritten; existing
 * custom agents (file present but mapping NOT pointing at them) are
 * also left alone. This is the second half of the safety contract:
 * the generator owns the default column of `agents.json`, the user
 * owns the custom column.
 *
 * Returns the count of NEW mappings added (existing mappings don't count).
 */
export function updateAgentsJson(cwd: string, plans: readonly GeneratedAgentPlan[]): number {
	const config = loadAgentConfig(cwd) ?? { version: 1, agents: {} };
	let addedCount = 0;
	for (const plan of plans) {
		// Skip roles that are not in the Velpari role registry (defensive:
		// project-defined custom roles are not mapped into agents.json).
		if (!(plan.role in DEFAULT_AGENTS)) continue;
		const role = plan.role as VelpariRole;
		const currentResolved = resolveAgentName(config, role);
		if (currentResolved !== DEFAULT_AGENTS[role]) {
			// Custom mapping — the user already owns this row. Skip.
			continue;
		}
		// Already on a built-in default → safe to set the generated name.
		// Idempotent: setting the same value twice is a no-op for the
		// config shape but we still bump the counter only on a real add.
		const previous = config.agents[role];
		if (previous !== plan.agentName) {
			config.agents[role] = plan.agentName;
			addedCount++;
		}
	}
	if (addedCount > 0) {
		saveAgentConfig(cwd, config);
	}
	return addedCount;
}
