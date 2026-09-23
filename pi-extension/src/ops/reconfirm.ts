/**
 * /velpari-reconfirm ops logic (A5 — re-confirm path; L1).
 *
 * The second of the two stale-resolution paths (spec
 * Doc/velpari-sequence/02-revision-workflows.md:92-100): when a declared
 * input changed but the change has NO impact on the published artifact,
 * the human reviewer re-confirms the artifact instead of republishing it.
 * Per spec 03:142 the assessment is individual — one artifact at a time,
 * never whole-chain.
 *
 * Write triple per re-confirm (D5):
 *   a. the mandated Change Log line is appended to the published artifact
 *      (`Reviewed after `<artifact>` vX.Y — no changes required.`, with the
 *      upstream version read from its frontmatter, `unknown-version`
 *      fallback — never a block);
 *   b. the freshness manifest entry is re-stamped with current hashes
 *      (`hashv: 2` normalized hashing per D3, `reconfirmedAt` marker,
 *      `extraPaths` recomputed per D6);
 *   c. a history.jsonl entry is appended when a run is active.
 *
 * D4: only `input-changed` items are re-confirmable — `input-missing` and
 * `no-stamp` require a real republish and are refused here.
 *
 * D7: this module edits a published artifact under Doc/ directly from
 * code (the Change Log append) — a stated, narrow exception to the
 * "Doc/ only via publish" invariant. The LLM tool_call lock is unaffected
 * (it governs LLM writes, not command code). The artifact is re-read and
 * atomically rewritten on every call — never cached.
 *
 * The interactive picker lives in the L3 command (`commands/reconfirm.ts`)
 * because L1 cannot import L2 UI (doctor fix-picker split precedent).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "../io/atomic-write.js";
import { hashFileContentNormalized } from "../core/fingerprints.js";
import {
	computeStaleSet,
	loadFreshnessManifest,
	recordPublish,
	resolveInputPath,
	type FreshnessEntry,
	type StaleItem,
} from "../core/freshness.js";
import { parseFrontmatterBlock } from "../core/frontmatter.js";
import { appendHistory } from "../core/history.js";
import type { Stage } from "../core/constants.js";

/** Exact Change Log line mandated by spec 02:97 (D5). */
export function reconfirmChangeLogLine(artifact: string, version: string): string {
	return `Reviewed after \`${artifact}\` v${version} — no changes required.`;
}

export interface ReconfirmSet {
	/** `input-changed` items — the only re-confirmable ones (D2/D4). */
	actionable: StaleItem[];
	/** `input-missing` + `no-stamp` items — republish-only (D4). */
	refused: StaleItem[];
}

/** Split the current stale set into re-confirmable and republish-only items. */
export function computeReconfirmSet(cwd: string): ReconfirmSet {
	const stale = computeStaleSet(cwd);
	return {
		actionable: stale.filter((s) => s.reason === "input-changed"),
		refused: stale.filter((s) => s.reason !== "input-changed"),
	};
}

/**
 * Insert `lines` at the end of the artifact's `## Change Log` section
 * (before the next `## ` heading or EOF). When the artifact has no such
 * section, one is appended at the end of the document. Pure — returns the
 * new content.
 */
export function appendToChangeLog(content: string, lines: readonly string[]): string {
	const all = content.split("\n");
	const start = all.findIndex((line) => /^## Change Log\s*$/.test(line));
	if (start === -1) {
		const trimmed = content.replace(/\n*$/, "");
		return `${trimmed}\n\n## Change Log\n\n${lines.join("\n")}\n`;
	}
	let end = all.length;
	for (let i = start + 1; i < all.length; i++) {
		if (/^## /.test(all[i]!)) {
			end = i;
			break;
		}
	}
	// Drop blank lines at the edges of the section body, append, re-pad.
	const section = all.slice(start + 1, end);
	while (section.length > 0 && section[section.length - 1]!.trim() === "") section.pop();
	while (section.length > 0 && section[0]!.trim() === "") section.shift();
	const next = [...all.slice(0, start + 1), "", ...section, ...lines, "", ...all.slice(end)];
	return next.join("\n");
}

/** Upstream version for the Change Log line — frontmatter `version`, else
 *  `unknown-version` (D5: never block on a missing version). */
function upstreamVersion(cwd: string, inputId: string): string {
	const path = resolveInputPath(cwd, inputId) ?? join(cwd, inputId);
	try {
		const parsed = parseFrontmatterBlock(readFileSync(path, "utf8"));
		return parsed?.fields.version?.trim() || "unknown-version";
	} catch {
		return "unknown-version";
	}
}

interface ReconfirmResult {
	key: string;
	path: string;
	/** The Change Log lines appended to the published artifact. */
	changeLogLines: string[];
	reconfirmedAt: string;
}

interface ReconfirmOptions {
	/** Injectable timestamp (tests). */
	now?: string;
	/** Active-run context for the history entry (D5c). Omit when no run. */
	history?: { runId: string; stage: Stage };
}

/**
 * Re-confirm one stale artifact: append the mandated Change Log line per
 * changed input, re-stamp the manifest entry (hashv: 2, reconfirmedAt,
 * extraPaths recomputed), and append a history entry when a run is
 * active. Throws when the item is not `input-changed` (D4) or the
 * published artifact is unreadable.
 */
export function reconfirmArtifact(cwd: string, item: StaleItem, opts?: ReconfirmOptions): ReconfirmResult {
	if (item.reason !== "input-changed") {
		throw new Error(
			`${item.key} is ${item.reason} — re-confirm is only valid for input-changed items; republish instead.`,
		);
	}
	const now = opts?.now ?? new Date().toISOString();
	const artifactAbs = join(cwd, item.path);
	const content = readFileSync(artifactAbs, "utf8");

	// (a) Mandated Change Log line per changed input. extraPaths entries
	// (root-relative paths, e.g. the RTM JSON sidecar) are named as-is.
	const lines = item.changedInputs.map((inputId) => reconfirmChangeLogLine(inputId, upstreamVersion(cwd, inputId)));
	atomicWriteFile(artifactAbs, appendToChangeLog(content, lines), "utf8");

	// (b) Re-stamp the manifest entry with current normalized hashes (D3/D6).
	const manifest = loadFreshnessManifest(cwd);
	const entry = manifest.artifacts[item.key];
	if (entry) {
		const inputs: FreshnessEntry["inputs"] = {};
		for (const inputId of Object.keys(entry.inputs ?? {})) {
			const path = resolveInputPath(cwd, inputId);
			const hash = path ? hashFileContentNormalized(path) : null;
			if (hash) inputs[inputId] = hash;
		}
		const extraPaths: FreshnessEntry["extraPaths"] = {};
		for (const extraPath of Object.keys(entry.extraPaths ?? {})) {
			const hash = hashFileContentNormalized(join(cwd, extraPath));
			if (hash) extraPaths[extraPath] = hash;
		}
		recordPublish(cwd, {
			...entry,
			inputs,
			...(Object.keys(extraPaths).length > 0 ? { extraPaths } : {}),
			hashv: 2,
			reconfirmedAt: now,
		});
	}

	// (c) History entry (best-effort context — only when a run is active).
	if (opts?.history) {
		appendHistory(cwd, opts.history.runId, {
			stage: opts.history.stage,
			command: "velpari-reconfirm",
			timestamp: now,
		});
	}

	return { key: item.key, path: item.path, changeLogLines: lines, reconfirmedAt: now };
}
