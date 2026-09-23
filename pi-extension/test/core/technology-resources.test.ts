/**
 * Technology-resource file-level smoke tests (Phase 1).
 *
 * Phase 1 ships the markdown files only; Phase 2 will add the
 * `discoverTechnologyResources` / `matchTechnologies` modules that
 * consume them. This test verifies the file shape so the Phase 2
 * loaders can rely on it.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function getRepoRoot(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	// Test file at: dist/pi-extension/test/core/technology-resources.test.js
	// Repo root sits 4 levels up from `dist/pi-extension/test/core/`.
	let dir = here;
	for (let i = 0; i < 6; i++) {
		const candidate = join(dir, "package.json");
		if (existsSync(candidate)) return dir;
		dir = dirname(dir);
	}
	throw new Error(`Could not locate repo root from ${here}`);
}

function techDir(): string {
	return join(getRepoRoot(), "resources", "technologies");
}

interface ParsedFrontmatter {
	id: string;
	name: string;
	keywords: string[];
	body: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter | null {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (match === null || match[1] === undefined || match[2] === undefined) return null;
	const fm = match[1];
	const body = match[2];
	const idMatch = fm.match(/^id:\s*(.+)$/m);
	const nameMatch = fm.match(/^name:\s*(.+)$/m);
	const kwMatch = fm.match(/^keywords:\s*\[(.*)\]$/m);
	if (idMatch === null || nameMatch === null || kwMatch === null) return null;
	if (idMatch[1] === undefined || nameMatch[1] === undefined || kwMatch[1] === undefined) return null;
	const id = idMatch[1].trim();
	const name = nameMatch[1].trim();
	const keywords = kwMatch[1]
		.split(",")
		.map((s) => s.trim().replace(/^["']|["']$/g, ""))
		.filter(Boolean);
	return { id, name, keywords, body };
}

/** Assert that `content` has frontmatter and return the parsed object; fail the test if not. */
function requireFrontmatter(content: string, fileName: string): ParsedFrontmatter {
	const fm = parseFrontmatter(content);
	assert.ok(fm, `${fileName} must have valid YAML frontmatter (id, name, keywords)`);
	if (!fm) throw new Error(`unreachable: ${fileName} frontmatter parse returned null after assert.ok`);
	return fm;
}

const REQUIRED_FILES = ["_template.md", "generic.md", "typescript.md", "node.md"] as const;

describe("technology-resources (Phase 1 file-level smoke)", () => {
	it("ships the 4 expected resource files", () => {
		const dir = techDir();
		assert.ok(existsSync(dir), `${dir} should exist`);
		for (const f of REQUIRED_FILES) {
			const p = join(dir, f);
			assert.ok(existsSync(p), `${f} should exist at ${p}`);
		}
	});

	it("_template.md has valid frontmatter + all 4 required sections", () => {
		const content = readFileSync(join(techDir(), "_template.md"), "utf8");
		const fm = requireFrontmatter(content, "_template.md");
		assert.equal(fm.id, "_template");
		assert.ok(fm.name.length > 0);
		assert.ok(Array.isArray(fm.keywords));
		assert.ok(fm.body.includes("## Core rules"));
		assert.ok(fm.body.includes("## Testing patterns"));
		assert.ok(fm.body.includes("### Integration testing"));
		assert.ok(fm.body.includes("## Tooling and limits"));
		assert.ok(fm.body.includes("## Common mistakes"));
		assert.ok(fm.body.includes("(source: https://"), "template must demonstrate (source: ...) citation format");
	});

	it("generic.md has valid frontmatter + non-trivial body", () => {
		const content = readFileSync(join(techDir(), "generic.md"), "utf8");
		const fm = requireFrontmatter(content, "generic.md");
		assert.equal(fm.id, "generic");
		assert.ok(fm.name.length > 0);
		assert.ok(
			fm.keywords.some((k) => k === "generic" || k === "fallback"),
			"generic must include 'generic' or 'fallback' in keywords",
		);
		assert.ok(fm.body.length > 200, "generic body must be substantive");
	});

	it("typescript.md has valid frontmatter + typescript keyword", () => {
		const content = readFileSync(join(techDir(), "typescript.md"), "utf8");
		const fm = requireFrontmatter(content, "typescript.md");
		assert.equal(fm.id, "typescript");
		assert.ok(
			fm.keywords.some((k) => k.toLowerCase().includes("typescript")),
			"typescript must include 'typescript' in keywords",
		);
	});

	it("node.md has valid frontmatter + node keyword", () => {
		const content = readFileSync(join(techDir(), "node.md"), "utf8");
		const fm = requireFrontmatter(content, "node.md");
		assert.equal(fm.id, "node");
		assert.ok(
			fm.keywords.some((k) => k.toLowerCase().includes("node")),
			"node must include 'node' in keywords",
		);
	});

	it("every resource body (except _template) cites at least one official source URL", () => {
		for (const f of REQUIRED_FILES) {
			if (f === "_template.md") continue;
			const content = readFileSync(join(techDir(), f), "utf8");
			const fm = requireFrontmatter(content, f);
			assert.match(fm.body, /\(source: https?:\/\/[^\s)]+\)/, `${f} must cite at least one (source: https://...) URL`);
		}
	});

	it("every resource body is dated (Last updated footer)", () => {
		for (const f of REQUIRED_FILES) {
			const content = readFileSync(join(techDir(), f), "utf8");
			assert.match(content, /_Last updated: \d{4}-\d{2}-\d{2}_/, `${f} must carry _Last updated: YYYY-MM-DD_ footer`);
		}
	});
});
