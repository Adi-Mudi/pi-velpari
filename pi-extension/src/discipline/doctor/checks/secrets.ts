/**
 * Secret scanner check (NFR-04).
 *
 * Pure functions; no IO. Used by:
 *   - discipline/doctor/index.ts: appendDocArtifactsSection (scans every .md under Doc/)
 *   - Doctor test suite
 */

const SECRET_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
	{ name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
	{ name: "GitHub PAT", regex: /ghp_[A-Za-z0-9]{36}/g },
	{ name: "OpenAI API Key", regex: /sk-[A-Za-z0-9]{48}/g },
	{ name: "Generic Bearer Token", regex: /Bearer\s+[A-Za-z0-9_\-.]{20,}/g },
];

/**
 * One hit produced by scanForSecrets.
 */
export interface ScanHit {
	pattern: string;
	line: number;
	match: string;
}

/**
 * Scan text for accidental secrets. Returns an array of
 * `{ pattern, line, match }` for each match.
 */
export function scanForSecrets(text: string): ScanHit[] {
	const hits: ScanHit[] = [];
	const lines = text.split("\n");
	for (const { name, regex } of SECRET_PATTERNS) {
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
