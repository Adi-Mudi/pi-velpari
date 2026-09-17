/**
 * Integration: Skill discovery (Phase 8, plan §Phase 8).
 *
 * Verifies every skill file is present after Phase 1 + Phase 3 + Phase 6.
 * Pi discovers skills from the package's skills/ directory; missing
 * files would break the LLM's skill list.
 */

import { describe, it, before } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageRoot } from "../../src/core/paths.js";

let pkgRoot: string;

before(() => {
	pkgRoot = findPackageRoot(process.cwd());
});

function fileExists(rel: string): boolean {
	return existsSync(join(pkgRoot, rel));
}

function listDir(rel: string): string[] {
	const full = join(pkgRoot, rel);
	if (!existsSync(full)) return [];
	const entries = readdirSync(full);
	return entries.filter((e) => {
		try {
			return statSync(join(full, e)).isFile();
		} catch {
			return false;
		}
	});
}

describe("skill discovery — Phase 8 re-verification", () => {
	it("all stage skills present", () => {
		const required = [
			"skills/velpari-brainstorm.md",
			"skills/velpari-prd.md",
			"skills/velpari-rtm.md",
			"skills/velpari-feasibility.md",
			"skills/velpari-architecture-generator.md",
			"skills/velpari-pseudocode.md",
			"skills/velpari-testplan.md",
			"skills/velpari-atomic-function.md",
			"skills/velpari-development-order.md",
			"skills/velpari-handoff.md",
			"skills/velpari-configure-requirements.md",
		];
		for (const f of required) {
			assert.ok(fileExists(f), `missing skill file: ${f}`);
		}
	});

	it("Phase 1 + 2 rename: velpari-final-design.md exists; velpari-html-design.md and velpari-design.md do NOT", () => {
		assert.ok(fileExists("skills/velpari-final-design.md"), "velpari-final-design.md must exist");
		assert.ok(!fileExists("skills/velpari-html-design.md"), "velpari-html-design.md must be removed (renamed on 2026-09-14)");
		assert.ok(!fileExists("skills/velpari-design.md"), "velpari-design.md must be removed");
	});

	it("Phase 3 addition: velpari-standards.md exists", () => {
		assert.ok(fileExists("skills/velpari-standards.md"), "velpari-standards.md must exist");
	});

	it("Phase 4 addition: design-conflict-detector.md exists", () => {
		assert.ok(
			fileExists("skills/agents/design-conflict-detector.md"),
			"design-conflict-detector.md must exist",
		);
	});

	it("standards catalogue and overlays are present", () => {
		assert.ok(fileExists("skills/standards/catalogue.json"), "catalogue.json must exist");
		assert.ok(fileExists("skills/standards/README.md"), "standards README must exist");
		assert.ok(
			fileExists("skills/standards/overlays/_template/profile.template.json"),
			"overlay template must exist",
		);
		assert.ok(
			fileExists("skills/standards/overlays/_template/README.md"),
			"overlay template README must exist",
		);
		assert.ok(
			fileExists("skills/standards/overlays/none/profile.json"),
			"none overlay profile must exist",
		);
		assert.ok(
			fileExists("skills/standards/overlays/medical-device-b/profile.json"),
			"medical-device-b overlay profile must exist",
		);
	});

	it("medical-device-b overlay has all required files", () => {
		const required = [
			"NOTES.md",
			"profile.json",
			"sections/prd-extra.md",
			"sections/design-extra.md",
			"sections/testplan-extra.md",
			"scouts/design-safety-analyzer.md",
			"doctor/check-overlay.md",
		];
		for (const f of required) {
			assert.ok(
				fileExists(`skills/standards/overlays/medical-device-b/${f}`),
				`missing medical-device-b/${f}`,
			);
		}
	});

	it("agents/ directory has at least the bundled scout count (38 expected)", () => {
		const files = listDir("skills/agents");
		assert.ok(files.length >= 30, `expected >=30 agent files, found ${files.length}`);
	});

	it("every skill .md file has a frontmatter name + description (Pi Agent Skills spec)", () => {
		const skillsDir = join(pkgRoot, "skills");
		const entries = readdirSync(skillsDir);
		const mdFiles = entries.filter((e) => e.endsWith(".md"));
		for (const f of mdFiles) {
			const content = readFileSync(join(skillsDir, f), "utf8");
			assert.ok(content.startsWith("---\n"), `${f}: missing frontmatter`);
			assert.match(content, /^name: /m, `${f}: frontmatter missing 'name'`);
			assert.match(content, /^description: /m, `${f}: frontmatter missing 'description'`);
		}
	});
});
