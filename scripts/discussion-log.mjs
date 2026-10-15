#!/usr/bin/env node
/**
 * discussion-log.mjs — deterministic discussion tracker (DDT).
 *
 * Every session that ends with developer decisions/clarifications appends
 * one row here (AGENTS.md → "Discussion tracking (DDT)"). The database is
 * the single source of truth for discussions; it is a SEPARATE file at the
 * project root (./DISCUSSIONS.db) so the developer can remove it at any
 * time without touching artifacts.
 *
 * Scope split (developer ruling, 2026-10-15):
 *   - DB (this tool)      → decisions, clarifications, status rulings
 *   - DISCUSSIONS.md doc  → open points (never the DB)
 *
 * Zero dependencies — built-in node:sqlite (Node 22+, same driver the
 * store uses; see pi-extension/src/io/db.ts RES-2).
 *
 * Usage:
 *   node scripts/discussion-log.mjs add --topic "T" --summary "S" \
 *       [--decisions "D1; D2"] [--kind decision|clarification|status]
 *   node scripts/discussion-log.mjs list [--limit N] [--json]
 *
 * Env:
 *   DISCUSSIONS_DB — override DB path (tests point it at a temp dir).
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Default DB location: project root, next to package.json. */
export const DEFAULT_DB_PATH = resolve(process.cwd(), "DISCUSSIONS.db");

/** Allowed kinds — open-point is rejected on purpose (document-only). */
export const ALLOWED_KINDS = ["decision", "clarification", "status"];

export function dbPath() {
	return process.env.DISCUSSIONS_DB
		? resolve(process.env.DISCUSSIONS_DB)
		: DEFAULT_DB_PATH;
}

/** Open (creating parents if needed) and idempotently migrate the schema. */
export function openDb(path = dbPath()) {
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec(`
    CREATE TABLE IF NOT EXISTS discussions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      at         TEXT NOT NULL,
      kind       TEXT NOT NULL CHECK (kind IN ('decision','clarification','status')),
      topic      TEXT NOT NULL,
      summary    TEXT NOT NULL,
      decisions  TEXT
    );
  `);
	return db;
}

/** Append one discussion row. Returns { id, at, kind, topic }. */
export function addDiscussion(db, { kind, topic, summary, decisions = null }) {
	if (!ALLOWED_KINDS.includes(kind)) {
		throw new Error(
			`invalid kind "${kind}" — open points belong in DISCUSSIONS.md (document only); allowed: ${ALLOWED_KINDS.join(", ")}`,
		);
	}
	if (!topic?.trim()) throw new Error("topic is required");
	if (!summary?.trim()) throw new Error("summary is required");
	const at = new Date().toISOString();
	const res = db
		.prepare(
			"INSERT INTO discussions (at, kind, topic, summary, decisions) VALUES (?, ?, ?, ?, ?)",
		)
		.run(at, kind, topic.trim(), summary.trim(), decisions ?? null);
	return { id: Number(res.lastInsertRowid), at, kind, topic: topic.trim() };
}

/** Read back the newest N rows (newest first). */
export function listDiscussions(db, limit = 20) {
	return db
		.prepare("SELECT id, at, kind, topic, summary, decisions FROM discussions ORDER BY id DESC LIMIT ?")
		.all(Number(limit));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
			out[key] = val;
		} else out._.push(a);
	}
	return out;
}

function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	const args = parseArgs(rest);

	if (cmd === "add") {
		const db = openDb();
		try {
			const row = addDiscussion(db, {
				kind: args.kind ?? "decision",
				topic: args.topic,
				summary: args.summary,
				decisions: args.decisions ?? null,
			});
			console.log(`recorded #${row.id} [${row.kind}] ${row.topic} (${row.at})`);
		} finally {
			db.close();
		}
		return;
	}

	if (cmd === "list") {
		const db = openDb();
		try {
			const rows = listDiscussions(db, args.limit ?? 20);
			if (args.json === "true") {
				console.log(JSON.stringify(rows, null, 2));
				return;
			}
			if (rows.length === 0) {
				console.log("(no discussions recorded yet)");
				return;
			}
			for (const r of rows) {
				console.log(`#${r.id} [${r.kind}] ${r.at}`);
				console.log(`  topic:   ${r.topic}`);
				console.log(`  summary: ${r.summary}`);
				if (r.decisions) console.log(`  decided: ${r.decisions}`);
				console.log("");
			}
		} finally {
			db.close();
		}
		return;
	}

	console.log(
		"usage:\n  node scripts/discussion-log.mjs add --topic T --summary S [--decisions D] [--kind decision|clarification|status]\n  node scripts/discussion-log.mjs list [--limit N] [--json]",
	);
	process.exitCode = cmd ? 1 : 0;
}

// Run only when invoked directly (tests import the functions above).
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
	main();
}
