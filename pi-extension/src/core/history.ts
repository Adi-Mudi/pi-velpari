/**
 * Per-run stage history store (B2).
 *
 * History lives in `.IDE_Plans/velpari/runs/<run-id>/history.jsonl` — one
 * JSON object per line — instead of inline in state.json, keeping
 * state.json config-sized (spec Doc/velpari-sequence/07-state-and-locking-files.md).
 *
 * Layer 0: imports only the io atomic-write helper, constants, the
 * HistoryEntry type, and node builtins.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "../io/atomic-write.js";
import { PATHS } from "./constants.js";
import type { HistoryEntry } from "./state.js";

export type { HistoryEntry } from "./state.js";

/** Absolute path of a run's history.jsonl. */
export function historyFilePath(cwd: string, runId: string): string {
	return join(cwd, PATHS.RUNS_DIR, runId, "history.jsonl");
}

/**
 * Load a run's history. Missing file → `[]`. Parses one JSON object per
 * line; corrupt lines are skipped (tolerant parse — a truncated final
 * line after a crash must not lose the rest of the trail).
 */
export function loadHistory(cwd: string, runId: string): HistoryEntry[] {
	const filePath = historyFilePath(cwd, runId);
	if (!existsSync(filePath)) return [];
	const raw = readFileSync(filePath, "utf8");
	const entries: HistoryEntry[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			entries.push(JSON.parse(trimmed) as HistoryEntry);
		} catch {
			// Corrupt line — skip.
		}
	}
	return entries;
}

/** Append one entry: read existing + concat + atomic rewrite. */
export function appendHistory(cwd: string, runId: string, entry: HistoryEntry): void {
	const existing = loadHistory(cwd, runId);
	const lines = [...existing, entry].map((e) => JSON.stringify(e));
	atomicWriteFile(historyFilePath(cwd, runId), `${lines.join("\n")}\n`, "utf8");
}

/** Seed a run's history.jsonl from a legacy inline `history` array (B1/B2 migration). */
export function migrateInlineHistory(cwd: string, runId: string, entries: HistoryEntry[]): void {
	if (entries.length === 0) return;
	const lines = entries.map((e) => JSON.stringify(e));
	atomicWriteFile(historyFilePath(cwd, runId), `${lines.join("\n")}\n`, "utf8");
}
