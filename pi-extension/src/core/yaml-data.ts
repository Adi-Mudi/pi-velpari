/**
 * YAML sidecar I/O (B3 — YAML sidecars; D1/D2).
 *
 * The ONLY module family allowed to import the `yaml` package (D1: L0
 * data modules). Everything else consumes parsed data structures.
 *
 * Semantics: schema-validate-then-accept. LLM-authored sidecars must
 * fail loudly on malformed YAML, so the strict entry point
 * (`parseYaml`) returns line/column-numbered errors instead of throwing
 * or silently returning null. `readYamlFile` is the loose reader for
 * "load if present and parseable" call sites (doctor, id-coverage) —
 * validation paths use `readFileSync` + `parseYaml` directly so the
 * diagnostics reach the user.
 *
 * Schemas stay flat (D2): lists of flat maps with scalar/short-list
 * values. `stringify` runs with `lineWidth: 0` so long strings are
 * never folded mid-token.
 */

import { existsSync, readFileSync } from "node:fs";
import { parseDocument, stringify } from "yaml";
import { atomicWriteFile } from "../io/atomic-write.js";

type YamlParseResult =
	| { ok: true; data: unknown }
	| { ok: false; error: string };

/**
 * Strict YAML parse. Returns the parsed data, or a human-actionable
 * error carrying line/column positions for every parser diagnostic.
 * Positions are computed from the parser's character offsets so the
 * output stays a plain one-line-per-error string (no pretty snippets).
 */
export function parseYaml(text: string): YamlParseResult {
	const doc = parseDocument(text, { prettyErrors: false });
	if (doc.errors.length > 0) {
		const details = doc.errors.map((err) => {
			const offset = err.pos?.[0];
			if (typeof offset !== "number") return `unknown position: ${err.message}`;
			let line = 1;
			let lineStart = 0;
			for (let i = 0; i < offset && i < text.length; i++) {
				if (text[i] === "\n") {
					line++;
					lineStart = i + 1;
				}
			}
			return `line ${line}, column ${offset - lineStart + 1}: ${err.message}`;
		});
		return { ok: false, error: details.join("\n") };
	}
	return { ok: true, data: doc.toJS() };
}

/**
 * Loose reader: parsed data when the file exists and parses, null when
 * it is missing or malformed. Callers that need malformed-input
 * diagnostics must use `readFileSync` + `parseYaml` instead.
 */
export function readYamlFile(absolutePath: string): unknown | null {
	if (!existsSync(absolutePath)) return null;
	try {
		const result = parseYaml(readFileSync(absolutePath, "utf8"));
		return result.ok ? result.data : null;
	} catch {
		return null;
	}
}

/** Serialize `data` as a YAML string (no folding of long lines). */
export function toYamlString(data: unknown): string {
	return stringify(data, { lineWidth: 0 });
}

/** Serialize `data` as YAML and write it atomically. */
export function writeYamlFile(absolutePath: string, data: unknown): void {
	atomicWriteFile(absolutePath, toYamlString(data), "utf8");
}

/**
 * Compare two semver-ish versions shared by every sidecar data module.
 * >0 when a > b, 0 equal, <0 when a < b. Missing segments count as 0.
 */
export function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}
