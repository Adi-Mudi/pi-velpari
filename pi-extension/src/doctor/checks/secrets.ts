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
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export interface ScanHit {
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
	{ name: "Google API Key", regex: /AIza[0-9A-Za-z_\-]{20,}/g },
	{ name: "PEM private key", regex: /BEGIN [A-Z ]+PRIVATE KEY/g },
	{ name: "Bearer token", regex: /Bearer\s+[A-Za-z0-9_\-.]{20,}/g },
	{ name: "Generic key=value secret", regex: /(?:api[_-]?key|secret|password|token)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-.]{8,}/gi },
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
