/**
 * Architecture alignment test (Phase 0 reorg).
 *
 * Walks the compiled `dist/pi-extension/src/**` output, extracts the
 * import statements from every .js file, and asserts the 4-layer rule
 * documented in `src/layers.ts`:
 *
 *   L0 (core/, io/)                    → may import nothing from
 *                                        stages/, ops/, doctor/, view/,
 *                                        ui/, hooks/, commands/
 *   L1 (stages/, ops/, doctor/, view/) → may import nothing from
 *                                        ui/, hooks/, commands/
 *   L2 (ui/, hooks/)                   → may import nothing from commands/
 *   L3 (commands/, src/index.ts)       → composition root; unrestricted
 *
 * `src/index.ts` (the extension entry point) is exempt — it is the L3
 * composition root and sits outside any layer folder.
 *
 * Runs against the compiled output (the seani convention): `npm test`
 * builds first, so dist/ always reflects the current sources.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const L0 = ["core", "io"];
const L1 = ["stages", "ops", "doctor", "view"];
const L2 = ["ui", "hooks"];
const L3 = ["commands"];

/** Layers each layer folder is forbidden to import from. */
const FORBIDDEN: Record<string, string[]> = {
	core: [...L1, ...L2, ...L3],
	io: [...L1, ...L2, ...L3],
	stages: [...L2, ...L3],
	ops: [...L2, ...L3],
	doctor: [...L2, ...L3],
	view: [...L2, ...L3],
	ui: [...L3],
	hooks: [...L3],
	commands: [],
};

function listJsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listJsFiles(full));
		} else if (entry.isFile() && entry.name.endsWith(".js")) {
			out.push(full);
		}
	}
	return out;
}

/** Extract relative import specifiers from a compiled JS file. */
function importSpecifiers(source: string): string[] {
	const out: string[] = [];
	const patterns = [
		/from\s+["']([^"']+)["']/g,
		/import\s*\(\s*["']([^"']+)["']\s*\)/g,
		/import\s+["']([^"']+)["']/g,
	];
	for (const re of patterns) {
		for (const match of source.matchAll(re)) {
			const spec = match[1];
			if (spec && spec.startsWith(".")) out.push(spec);
		}
	}
	return out;
}

/** First path segment of a src/-relative path, or "" for src root files. */
function topFolder(srcRelPath: string): string {
	const segments = normalize(srcRelPath).split("/");
	return segments.length > 1 ? (segments[0] ?? "") : "";
}

describe("architecture-alignment", () => {
	const files = listJsFiles(SRC_DIR);

	it("dist/pi-extension/src has compiled output to check", () => {
		assert.ok(files.length > 0, `no compiled .js files found under ${SRC_DIR}`);
	});

	it("no file imports upward across the layer boundary", () => {
		const violations: string[] = [];
		for (const file of files) {
			const rel = normalize(file.slice(SRC_DIR.length + 1));
			const fromFolder = topFolder(rel);
			if (fromFolder === "") continue; // src root (index.ts, layers.ts): L3 composition, exempt
			const forbidden = FORBIDDEN[fromFolder];
			if (!forbidden) continue; // unknown folder — not part of the layer map
			const source = readFileSync(file, "utf8");
			for (const spec of importSpecifiers(source)) {
				const targetRel = normalize(join(dirname(rel), spec));
				const targetFolder = topFolder(targetRel);
				if (forbidden.includes(targetFolder)) {
					violations.push(`${rel} imports ${spec} (forbidden layer folder: ${targetFolder}/)`);
				}
			}
		}
		assert.deepStrictEqual(
			violations,
			[],
			`layer rule violations:\n${violations.join("\n")}`,
		);
	});
});
