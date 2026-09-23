/**
 * Secret scan (Phase 5 expansion).
 *
 * Pure scanner — no IO. Walks every .md under Doc/, every .md under
 * .pi/agents/, every SKILL.md under .pi/skills/, and every .json under
 * .pi/velpari/. Reports each hit with file path + line + pattern name.
 *
 * 7 patterns (NFR-04):
 *   1. AWS Access Key (AKIA...)
 *   2. GitHub PAT (ghp_...)
 *   3. OpenAI API Key (sk-...)
 *   4. Google API Key (AIza...)
 *   5. PEM private key (BEGIN ... PRIVATE KEY)
 *   6. Generic Bearer token (Bearer xxx)
 *   7. Generic key=value (api_key/secret/password/token = "..." or =xxx)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getEffectiveProjectNames } from "../../core/projectnames.js";
import { loadFilesConfig, validateFilesConfig } from "../../core/config.js";
import { buildStoreDbPath } from "../../core/paths.js";
import { openStoreDb, closeStoreDb } from "../../io/db.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

interface ScanHit {
	pattern: string;
	line: number;
	match: string;
}

interface Pattern {
	name: string;
	regex: RegExp;
}

const PATTERNS: ReadonlyArray<Pattern> = [
	{ name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
	{ name: "GitHub PAT", regex: /ghp_[A-Za-z0-9]{36}/g },
	{ name: "OpenAI API Key", regex: /sk-[A-Za-z0-9]{48}/g },
	{ name: "Google API Key", regex: /AIza[0-9A-Za-z_-]{20,}/g },
	{ name: "PEM private key", regex: /BEGIN [A-Z ]+PRIVATE KEY/g },
	{ name: "Bearer token", regex: /Bearer\s+[A-Za-z0-9_\-.]{20,}/g },
	{
		name: "Generic key=value secret",
		regex: /(?:api[_-]?key|secret|password|token)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-.]{8,}/gi,
	},
];

/**
 * Pure scanner. Returns one hit per match with file + line + pattern.
 */
export function scanForSecrets(text: string): ScanHit[] {
	const hits: ScanHit[] = [];
	const lines = text.split("\n");
	for (const { name, regex } of PATTERNS) {
		for (const [i, line] of lines.entries()) {
			const matches = line.match(regex);
			if (matches) {
				for (const m of matches) {
					hits.push({ pattern: name, line: i + 1, match: m });
				}
			}
		}
	}
	return hits;
}

// ---------------------------------------------------------------------------
// DB text-column sweep (G9 — Phase 7; OQ4a: newest published version only)
// ---------------------------------------------------------------------------

/**
 * The TEXT prose columns secrets could hide in (G9: spike results,
 * reuse-scan URLs, requirement/test prose). Readable column list per
 * row-set — the store reader maps camelCase keys from these tables.
 * Newest published version per kind only (OQ4a).
 */
const DB_TEXT_COLUMNS: ReadonlyArray<{ key: string; table: string; columns: ReadonlyArray<string> }> = [
	{ key: "fr", table: "fr", columns: ["text"] },
	{ key: "nfr", table: "nfr", columns: ["text"] },
	{ key: "prdSection", table: "prd_section", columns: ["body"] },
	{ key: "pseudocodeBlock", table: "pseudocode_block", columns: ["content"] },
	{ key: "testCase", table: "test_case", columns: ["steps", "objective", "expected"] },
	{ key: "designModule", table: "design_module", columns: ["description"] },
	{
		key: "atomicFunction",
		table: "atomic_function",
		columns: ["purpose", "source", "cohesion", "verification", "testable"],
	},
	{ key: "devStep", table: "dev_step", columns: ["description"] },
	{ key: "adr", table: "adr", columns: ["options", "chosen", "rationale"] },
	{ key: "diagram", table: "diagram", columns: ["mermaid_text"] },
	{ key: "feasibilityDecision", table: "feasibility_decision", columns: [] },
	{ key: "feasibilitySpike", table: "feasibility_spike", columns: ["result_ref"] },
	{ key: "reuseScan", table: "reuse_scan", columns: ["candidate"] },
];

interface DbSecretHit {
	kind: string;
	rowKey: string;
	column: string;
	pattern: string;
	match: string;
}

/** Sweep the newest published version's text columns of one project DB. */
function sweepDbTextColumns(dbPath: string): DbSecretHit[] {
	const hits: DbSecretHit[] = [];
	if (!existsSync(dbPath)) return hits;
	const db = openStoreDb(dbPath);
	try {
		for (const entry of DB_TEXT_COLUMNS) {
			let rows: Array<Record<string, unknown>>;
			try {
				rows = db.prepare(`SELECT * FROM ${entry.table} WHERE status = 'published'`).all() as unknown as Array<
					Record<string, unknown>
				>;
			} catch {
				continue; // table absent (older schema) — nothing to sweep
			}
			for (const row of rows) {
				for (const col of entry.columns) {
					const camel = col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
					const value = row[camel] ?? row[col];
					if (typeof value !== "string" || value === "") continue;
					for (const hit of scanForSecrets(value)) {
						hits.push({
							kind: entry.table,
							rowKey: String(row.id ?? row.no ?? row.language ?? row.candidate ?? "?"),
							column: col,
							pattern: hit.pattern,
							match: hit.match,
						});
					}
				}
			}
		}
	} finally {
		closeStoreDb(db);
	}
	return hits;
}

/**
 * Run the DB sweep across every effective projectName's store DB
 * (multi-design: one sweep per DB). Returns hits + which DBs scanned.
 */
function sweepAllStores(cwd: string): { hits: DbSecretHit[]; scanned: string[] } {
	const hits: DbSecretHit[] = [];
	const scanned: string[] = [];
	try {
		const cfg = loadFilesConfig(cwd);
		if (!validateFilesConfig(cfg)) return { hits, scanned };
		for (const projectName of getEffectiveProjectNames(cfg)) {
			const dbPath = buildStoreDbPath(projectName, cwd);
			if (!existsSync(dbPath)) continue;
			scanned.push(`Doc/store/${projectName}/index.db`);
			hits.push(...sweepDbTextColumns(dbPath));
		}
	} catch {
		// degrade silently — the file scan result still stands
	}
	return { hits, scanned };
}

/**
 * Walk the 4 locations, run scanForSecrets on each file, return a
 * DiagnosticSection with one warning item per hit plus a summary.
 */
export function checkSecretScan(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	const targets: Array<{ rel: string; abs: string }> = [];
	const docDir = join(cwd, "Doc");
	const agentsDir = join(cwd, ".pi", "agents");
	const skillsDir = join(cwd, ".pi", "skills");
	const velpariDir = join(cwd, ".pi", "velpari");

	if (existsSync(docDir)) {
		for (const f of walkFiles(docDir, [".md"])) {
			targets.push({ rel: `Doc/${f.rel}`, abs: f.abs });
		}
	}
	if (existsSync(agentsDir)) {
		for (const f of walkFiles(agentsDir, [".md"])) {
			targets.push({ rel: `.pi/agents/${f.rel}`, abs: f.abs });
		}
	}
	if (existsSync(skillsDir)) {
		for (const f of walkFiles(skillsDir, [".md"])) {
			targets.push({ rel: `.pi/skills/${f.rel}`, abs: f.abs });
		}
	}
	if (existsSync(velpariDir)) {
		for (const f of walkFiles(velpariDir, [".json"])) {
			targets.push({ rel: `.pi/velpari/${f.rel}`, abs: f.abs });
		}
	}

	let totalHits = 0;
	for (const target of targets) {
		let content: string;
		try {
			content = readFileSync(target.abs, "utf8");
		} catch {
			continue;
		}
		const hits = scanForSecrets(content);
		if (hits.length === 0) continue;
		totalHits += hits.length;
		const details = hits.map((h) => `  - ${h.pattern} at line ${h.line}`);
		items.push({
			status: "warning",
			message: `${target.rel}: ${hits.length} potential secret(s)`,
			details,
			suggestion: suggestionFor("secret-detected"),
		});
	}

	if (totalHits === 0) {
		items.push({
			status: "ok",
			message: `No secrets detected across ${targets.length} file(s) in 4 locations.`,
		});
	} else {
		items.push({
			status: "warning",
			message: `Secret scan: ${totalHits} potential secret(s) across ${targets.length} file(s).`,
		});
	}

	// G9 (Phase 7, OQ4a): sweep the store DBs' text columns — newest
	// published version per kind, multi-design aware.
	const dbSweep = sweepAllStores(cwd);
	for (const hit of dbSweep.hits) {
		items.push({
			status: "warning",
			message: `${hit.kind}[${hit.rowKey}].${hit.column}: ${hit.pattern} — "${hit.match}"`,
			details: dbSweep.scanned,
			suggestion: suggestionFor("secret-detected"),
		});
	}
	if (dbSweep.scanned.length > 0) {
		items.push({
			status: dbSweep.hits.length === 0 ? "ok" : "warning",
			message:
				dbSweep.hits.length === 0
					? `Store DB sweep: no secrets in text columns (${dbSweep.scanned.length} DB(s) scanned).`
					: `Store DB sweep: ${dbSweep.hits.length} potential secret(s) in DB text columns.`,
		});
	}

	return { title: "Secret scan (NFR-04)", items };
}

interface FileEntry {
	rel: string;
	abs: string;
}

function walkFiles(dir: string, exts: ReadonlyArray<string>): FileEntry[] {
	const out: FileEntry[] = [];
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const abs = join(dir, entry.name);
		if (entry.isDirectory()) {
			for (const child of walkFiles(abs, exts)) {
				out.push({ rel: `${entry.name}/${child.rel}`, abs: child.abs });
			}
		} else if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) {
			out.push({ rel: entry.name, abs });
		}
	}
	return out;
}
