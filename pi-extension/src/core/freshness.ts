/**
 * Freshness stamps + stale-set machinery (B4 + A3).
 *
 * Every publish stamps SHA-256 hashes of the stage's declared input
 * artifacts — into the published artifact's frontmatter (`inputs:` as a
 * single-line JSON scalar, human-readable) and into the machine manifest
 * `.pi/velpari/freshness.json` (machine truth, one entry per published
 * artifact, overwritten on republish).
 *
 * The stale set is derived by re-hashing each manifest entry's declared
 * inputs and comparing against the stamps:
 *
 *   - input-changed  — an input artifact's content changed since publish
 *   - input-missing  — an input artifact no longer exists on disk
 *   - no-stamp       — legacy artifact published before B4 (no inputs map),
 *                      or a disk artifact with no manifest entry at all
 *
 * Consumed by the stage-start check (`stages/registry.ts`), the publish
 * gate (`doctor/gate.ts`), and the doctor freshness section
 * (`doctor/checks/freshness.ts`). Spec: Doc/velpari-sequence/03 §Layer-1.
 *
 * Layer 0: pure + synchronous; imports only core/io + node builtins. The
 * stage registry lives at L1, so declared-input lists are passed in
 * structurally (`DeclaredInput`) by the L1 callers.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "../io/atomic-write.js";
import { loadFilesConfig } from "./config.js";
import { PATHS } from "./constants.js";
import { hashFileContent, hashFileContentNormalized } from "./fingerprints.js";
import {
	GROUPED_CATEGORIES,
	resolveBrainstormArtifact,
	resolveDocArtifact,
	resolveDocArtifactAll,
} from "./paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Identity of a stamped input: `<artifactKind>:<projectName|slug>`. */
type FreshnessInputId = string;

/** One manifest entry — a published artifact plus the stamps of its inputs. */
export interface FreshnessEntry {
	/** Artifact kind, lowercase (`prd`, `rtm`, `brainstorm`, `design`, ...). */
	artifact: string;
	/** Owning project for doc artifacts. */
	projectName?: string;
	/** Topic slug for brainstorm artifacts. */
	slug?: string;
	/** Published path, relative to the project root. */
	path: string;
	/**
	 * Extra files whose content is part of this publish (D3 — the RTM JSON
	 * sidecar). Maps root-relative path → SHA-256 at publish time.
	 */
	extraPaths?: Record<string, string>;
	/** ISO timestamp of the publish. */
	publishedAt: string;
	/** Input identity → SHA-256 at publish time. Absent on legacy entries. */
	inputs?: Record<FreshnessInputId, string>;
	/**
	 * Hash-scheme version (A5/D3). `2` = normalized hashing (the
	 * `## Change Log` section is excluded, so a re-confirm audit line never
	 * cascades into downstream staleness). Absent = legacy whole-file
	 * hashing — v1 entries keep v1 checking until their next publish or
	 * re-confirm, so existing projects are NOT mass-staled.
	 */
	hashv?: 2;
	/** ISO timestamp of the last `/velpari-reconfirm` review (D5). */
	reconfirmedAt?: string;
}

export interface FreshnessManifest {
	version: 1;
	artifacts: Record<string, FreshnessEntry>;
}

type StaleReason = "input-changed" | "input-missing" | "no-stamp";

export interface StaleItem {
	/** Manifest key (`<artifactKind>:<projectName|slug>`). */
	key: string;
	artifact: string;
	/** Root-relative published path. */
	path: string;
	reason: StaleReason;
	/** Offending input identities (empty for no-stamp). */
	changedInputs: string[];
}

/** Structural mirror of `stages/registry.ts:StageInputDoc` (L1 type). */
export interface DeclaredInput {
	kind: "doc" | "brainstorm";
	artifact?: string;
	label: string;
	optional?: boolean;
}

/** A declared input resolved to a concrete identity + on-disk path. */
interface ResolvedInput {
	/** `<artifactKind>:<projectName|slug>` — the stamp key. */
	id: FreshnessInputId;
	label: string;
	/** Absolute path when found on disk, null otherwise. */
	path: string | null;
	optional: boolean;
	status: "found" | "missing";
}

/** One published artifact discovered on disk. */
interface EnumeratedArtifact {
	/** Artifact kind, lowercase (`prd`, `brainstorm`, ...). */
	artifactKind: string;
	projectName?: string;
	slug?: string;
	/** Absolute path. */
	path: string;
	exists: boolean;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Manifest/stamp key for an artifact identity. */
export function manifestKey(artifactKind: string, id: string): string {
	return `${artifactKind.toLowerCase()}:${id}`;
}

/** Manifest/stamp key for a freshness entry. */
export function entryKey(entry: FreshnessEntry): string {
	return manifestKey(entry.artifact, entry.slug ?? entry.projectName ?? "");
}

/**
 * Map a lowercase artifact kind back to the Doc/ artifact key used by
 * `resolveDocArtifact`. Only PRD/RTM use uppercase keys; the rest are
 * already lowercase in `GROUPED_CATEGORIES`.
 */
function artifactKeyForKind(kind: string): string {
	if (kind === "prd") return "PRD";
	if (kind === "rtm") return "RTM";
	return kind;
}

/** Split `<kind>:<id>`; returns null when the shape is wrong. */
function parseInputId(inputId: string): { kind: string; id: string } | null {
	const idx = inputId.indexOf(":");
	if (idx <= 0 || idx === inputId.length - 1) return null;
	return { kind: inputId.slice(0, idx), id: inputId.slice(idx + 1) };
}

/**
 * Resolve the brainstorm artifact for a topic slug (D8). The freshness
 * manifest wins when an entry exists: its `path` points at the LATEST
 * published file for the topic — including timestamp-suffixed re-run files
 * — so a re-brainstorm stales downstream artifacts through the normal A3
 * machinery. Falls back to base-slug disk resolution when no manifest
 * entry exists (legacy publishes before the manifest, or a stamped
 * publish whose manifest write failed).
 */
function resolveBrainstormInput(
	cwd: string,
	topicSlug: string,
): { path: string; layout: "grouped" | "legacy" } | null {
	const entry = loadFreshnessManifest(cwd).artifacts[manifestKey("brainstorm", topicSlug)];
	if (entry) {
		const abs = join(cwd, entry.path);
		if (existsSync(abs)) return { path: abs, layout: "grouped" };
	}
	return resolveBrainstormArtifact(topicSlug, cwd);
}

// ---------------------------------------------------------------------------
// Manifest I/O
// ---------------------------------------------------------------------------

export function emptyFreshnessManifest(): FreshnessManifest {
	return { version: 1, artifacts: {} };
}

/**
 * Load `.pi/velpari/freshness.json`. Never throws — an absent or corrupt
 * file yields an empty manifest.
 */
export function loadFreshnessManifest(cwd: string): FreshnessManifest {
	const file = join(cwd, PATHS.FRESHNESS_FILE);
	if (!existsSync(file)) return emptyFreshnessManifest();
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<FreshnessManifest>;
		if (!parsed || typeof parsed !== "object") return emptyFreshnessManifest();
		if (!parsed.artifacts || typeof parsed.artifacts !== "object") {
			return emptyFreshnessManifest();
		}
		return { version: 1, artifacts: parsed.artifacts as Record<string, FreshnessEntry> };
	} catch {
		return emptyFreshnessManifest();
	}
}

/** Persist the manifest atomically. */
export function saveFreshnessManifest(cwd: string, manifest: FreshnessManifest): void {
	atomicWriteJson(join(cwd, PATHS.FRESHNESS_FILE), manifest);
}

/**
 * Upsert one entry (overwrite same key) and persist. Config-sized: one
 * entry per published artifact, so republishing never grows the file.
 * Returns the key the entry was stored under.
 */
export function recordPublish(cwd: string, entry: FreshnessEntry): string {
	const manifest = loadFreshnessManifest(cwd);
	const key = entryKey(entry);
	manifest.artifacts[key] = entry;
	saveFreshnessManifest(cwd, manifest);
	return key;
}

// ---------------------------------------------------------------------------
// Input resolution + hashing
// ---------------------------------------------------------------------------

interface ResolveDeclaredInputsDeps {
	projectName: string;
	/** Topic slug of the run's brainstorm (slugify(mission)). */
	topicSlug: string;
}

/**
 * Resolve a stage's declared inputs (from `STAGE_REGISTRY[key].inputs`,
 * passed in by the L1 caller) to concrete identities + absolute paths.
 * Brainstorm inputs resolve per-slug; doc inputs per projectName.
 */
export function resolveDeclaredInputs(
	cwd: string,
	inputs: readonly DeclaredInput[],
	deps: ResolveDeclaredInputsDeps,
): ResolvedInput[] {
	const out: ResolvedInput[] = [];
	for (const input of inputs) {
		if (input.kind === "brainstorm") {
			const resolved = deps.topicSlug
				? resolveBrainstormInput(cwd, deps.topicSlug)
				: null;
			out.push({
				id: manifestKey("brainstorm", deps.topicSlug),
				label: input.label,
				path: resolved?.path ?? null,
				optional: input.optional === true,
				status: resolved ? "found" : "missing",
			});
			continue;
		}
		if (input.kind === "doc" && input.artifact) {
			const resolved = resolveDocArtifact(input.artifact, deps.projectName, cwd);
			out.push({
				id: manifestKey(input.artifact, deps.projectName),
				label: input.label,
				path: resolved?.path ?? null,
				optional: input.optional === true,
				status: resolved ? "found" : "missing",
			});
		}
	}
	return out;
}

/** Result of hashing a stage's declared inputs. */
type InputHashResult =
	| { ok: true; hashes: Record<FreshnessInputId, string> }
	| { ok: false; missing: string[] };

/**
 * Hash every found input. Optional inputs that are missing are skipped
 * (they were never part of the stage run); required missing inputs make
 * the whole map unusable. `hashFn` selects the hash scheme (A5/D3): new
 * publishes pass `hashFileContentNormalized` so their `hashv: 2` stamps
 * tolerate later Change Log appends; the default keeps legacy callers
 * unchanged.
 */
export function computeInputHashes(
	cwd: string,
	inputs: readonly ResolvedInput[],
	hashFn: (absolutePath: string) => string | null = hashFileContent,
): InputHashResult {
	const missing: string[] = [];
	const hashes: Record<FreshnessInputId, string> = {};
	for (const input of inputs) {
		if (!input.path) {
			if (!input.optional) missing.push(input.id);
			continue;
		}
		const hash = hashFn(input.path);
		if (hash === null) {
			if (!input.optional) missing.push(input.id);
			continue;
		}
		hashes[input.id] = hash;
	}
	return missing.length > 0 ? { ok: false, missing } : { ok: true, hashes };
}

/**
 * Brainstorm inputs (D4): the configured input documents from files.json
 * `inputDocuments`, hashed when present and readable. Best-effort —
 * unhashable entries (directories, missing files) are skipped. Empty map
 * when none are configured.
 */
export function computeBrainstormInputHashes(
	cwd: string,
	hashFn: (absolutePath: string) => string | null = hashFileContent,
): Record<FreshnessInputId, string> {
	const config = loadFilesConfig(cwd);
	const hashes: Record<FreshnessInputId, string> = {};
	for (const doc of config.inputDocuments ?? []) {
		const hash = hashFn(join(cwd, doc));
		if (hash) hashes[manifestKey("input-doc", doc)] = hash;
	}
	return hashes;
}

// ---------------------------------------------------------------------------
// Stale set
// ---------------------------------------------------------------------------

/**
 * Re-hash one input identity against the current disk state. Returns the
 * absolute path when the input artifact exists, null otherwise. Exported
 * for `/velpari-reconfirm` (A5), which reads the upstream artifact's
 * frontmatter version for the mandated Change Log line.
 */
export function resolveInputPath(cwd: string, inputId: FreshnessInputId): string | null {
	const parsed = parseInputId(inputId);
	if (!parsed) return null;
	if (parsed.kind === "brainstorm") {
		return resolveBrainstormInput(cwd, parsed.id)?.path ?? null;
	}
	if (parsed.kind === "input-doc") {
		// Configured input document (files.json inputDocuments) — id is the
		// root-relative path.
		const p = join(cwd, parsed.id);
		return existsSync(p) ? p : null;
	}
	return resolveDocArtifact(artifactKeyForKind(parsed.kind), parsed.id, cwd)?.path ?? null;
}

interface ComputeStaleSetOptions {
	/**
	 * Disk-truth enumeration (from `enumeratePublishedArtifacts`). When
	 * provided, published artifacts with NO manifest entry are reported as
	 * `no-stamp` (legacy pre-B4 publishes). Omit for manifest-only checks.
	 */
	enumerated?: readonly EnumeratedArtifact[];
}

/**
 * Compute the stale set: every tracked artifact whose declared inputs
 * changed or vanished since it was published. Entries lacking an `inputs`
 * map (legacy) are reported as `no-stamp`. Pure read — never writes.
 */
export function computeStaleSet(cwd: string, opts?: ComputeStaleSetOptions): StaleItem[] {
	const manifest = loadFreshnessManifest(cwd);
	const stale: StaleItem[] = [];

	for (const [key, entry] of Object.entries(manifest.artifacts)) {
		if (!entry.inputs) {
			stale.push({
				key,
				artifact: entry.artifact,
				path: entry.path,
				reason: "no-stamp",
				changedInputs: [],
			});
			continue;
		}
		const offenders: string[] = [];
		let anyMissing = false;
		// A5/D3: hashv-2 entries check with the normalized hash (Change Log
		// excluded); legacy entries keep the whole-file hash so existing
		// projects are not mass-staled.
		const hashFn = entry.hashv === 2 ? hashFileContentNormalized : hashFileContent;
		for (const [inputId, stampedHash] of Object.entries(entry.inputs)) {
			const inputPath = resolveInputPath(cwd, inputId);
			const current = inputPath ? hashFn(inputPath) : null;
			if (current === null) {
				anyMissing = true;
				offenders.push(inputId);
			} else if (current !== stampedHash) {
				offenders.push(inputId);
			}
		}
		for (const [extraPath, stampedHash] of Object.entries(entry.extraPaths ?? {})) {
			const current = hashFn(join(cwd, extraPath));
			if (current === null) {
				anyMissing = true;
				offenders.push(extraPath);
			} else if (current !== stampedHash) {
				offenders.push(extraPath);
			}
		}
		if (offenders.length > 0) {
			stale.push({
				key,
				artifact: entry.artifact,
				path: entry.path,
				reason: anyMissing ? "input-missing" : "input-changed",
				changedInputs: offenders,
			});
		}
	}

	if (opts?.enumerated) {
		for (const artifact of opts.enumerated) {
			const id = artifact.slug ?? artifact.projectName ?? "";
			const key = manifestKey(artifact.artifactKind, id);
			if (manifest.artifacts[key]) continue;
			stale.push({
				key,
				artifact: artifact.artifactKind,
				path: artifact.path,
				reason: "no-stamp",
				changedInputs: [],
			});
		}
	}

	return stale;
}

// ---------------------------------------------------------------------------
// Published-artifact enumeration (disk truth)
// ---------------------------------------------------------------------------

/** Artifact kinds excluded from v1 freshness (D5 — logging-plan). */
const EXCLUDED_KINDS: ReadonlySet<string> = new Set(["logging-plan"]);

/**
 * Enumerate every published artifact on disk: grouped categories ×
 * `resolveDocArtifactAll` (catches projects not in files.json) plus a
 * brainstorm special case (`Doc/brainstorm/brainstorm-*.md` with legacy
 * `Doc/brainstorm-*.md` fallback). Sorted by kind then identity for
 * stable output.
 */
export function enumeratePublishedArtifacts(cwd: string): EnumeratedArtifact[] {
	const out: EnumeratedArtifact[] = [];

	for (const artifact of Object.keys(GROUPED_CATEGORIES)) {
		if (EXCLUDED_KINDS.has(artifact)) continue;
		for (const found of resolveDocArtifactAll(cwd, artifact)) {
			out.push({
				artifactKind: artifact.toLowerCase(),
				projectName: found.projectName,
				path: found.path,
				exists: true,
			});
		}
	}

	// Brainstorm special case: slug-keyed, own folder + legacy flat files.
	// D8: timestamp-suffixed re-run files (`brainstorm-<slug>-<stamp>.md`)
	// fold into the BASE slug — the manifest keeps one entry per topic
	// (pointing at the latest file), so enumeration must not report the
	// older/younger sibling as a separate unmanifested artifact. With both
	// on disk, alphabetical order keeps the suffixed (latest) file, which
	// matches the manifest path.
	const seenSlugs = new Set<string>();
	const brainstormDirs = [join(cwd, "Doc", "brainstorm"), join(cwd, "Doc")];
	for (const dir of brainstormDirs) {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const m = entry.match(/^brainstorm-(.+?)(?:-\d{8}-\d{6})?\.md$/);
			if (!m || !m[1] || seenSlugs.has(m[1])) continue;
			const full = join(dir, entry);
			if (!existsSync(full)) continue;
			seenSlugs.add(m[1]);
			out.push({ artifactKind: "brainstorm", slug: m[1], path: full, exists: true });
		}
	}

	out.sort((a, b) => {
		const ka = a.artifactKind;
		const kb = b.artifactKind;
		if (ka !== kb) return ka < kb ? -1 : 1;
		const ia = a.slug ?? a.projectName ?? "";
		const ib = b.slug ?? b.projectName ?? "";
		return ia < ib ? -1 : ia > ib ? 1 : 0;
	});
	return out;
}
