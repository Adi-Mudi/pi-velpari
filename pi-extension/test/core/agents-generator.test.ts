/**
 * agents-generator tests (Phase 2 surface).
 *
 * Covers: GENERATOR_VERSION, parseKeywords, getBundledTechnologiesDir,
 * getProjectTechnologiesDir, discoverTechnologyResources,
 * matchTechnologies, getProjectSlug, hashFile, buildGeneratedAgentMarkdown,
 * planAgentGeneration, resolveBodyFilePath, loadCanonicalBody.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { findPackageRoot } from "../../src/core/paths.js";
import {
	GENERATOR_VERSION,
	buildGeneratedAgentMarkdown,
	discoverTechnologyResources,
	getBundledTechnologiesDir,
	getProjectSlug,
	getProjectTechnologiesDir,
	loadCanonicalBody,
	matchTechnologies,
	parseKeywords,
	planAgentGeneration,
	resolveBodyFilePath,
	scoutTemplateRoleDef,
	type GeneratedRoleDef,
} from "../../src/core/agents-generator.js";
import {
	GENERATION_PHASES,
	VELPARI_BRAINSTORM_GENERATED_ROLES,
} from "../../src/core/agents-config.js";

const REPO_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

describe("agents-generator (Phase 2 surface)", () => {
	it("GENERATOR_VERSION is 2 (per-phase generation)", () => {
		assert.equal(GENERATOR_VERSION, 2);
	});

	describe("VELPARI_BRAINSTORM_GENERATED_ROLES (Phase 3, 4-row table)", () => {
		it("has exactly 4 rows (Phase-1 scope of the v2 generator)", () => {
			assert.equal(VELPARI_BRAINSTORM_GENERATED_ROLES.length, 4);
		});

		it("row ids match the 4 brainstorm scout roles in BRAINSTORM_ROLES", () => {
			const ids = VELPARI_BRAINSTORM_GENERATED_ROLES.map((r) => r.role);
			assert.deepEqual(ids, ["extractor", "prd-checker", "rtm-checker", "web-search-agent"]);
		});

		it("every row carries a non-empty invocationHint (Phase 3 v1 contract)", () => {
			for (const row of VELPARI_BRAINSTORM_GENERATED_ROLES) {
				assert.ok(
					typeof row.invocationHint === "string" && row.invocationHint.length > 10,
					`${row.role} missing invocationHint (v1 contract requires it for auto-spawn)`,
				);
			}
		});

		it("every row has at least 2 out-of-scope bullets", () => {
			for (const row of VELPARI_BRAINSTORM_GENERATED_ROLES) {
				assert.ok(
					row.outOfScope.length >= 2,
					`${row.role} has ${row.outOfScope.length} out-of-scope bullets (need ≥2)`,
				);
				for (const item of row.outOfScope) {
					assert.ok(
						typeof item === "string" && item.length > 0,
						`${row.role} has an empty out-of-scope bullet`,
					);
				}
			}
		});

		it("every row declares a non-empty tools list", () => {
			for (const row of VELPARI_BRAINSTORM_GENERATED_ROLES) {
				assert.ok(
					row.tools.length > 0,
					`${row.role} must declare ≥1 tool (runtime dispatcher may strip)`,
				);
				for (const t of row.tools) {
					assert.ok(typeof t === "string" && t.length > 0, `${row.role} has an empty tool entry`);
				}
			}
		});

		it("every row carries a non-empty mandate (1-line job description)", () => {
			for (const row of VELPARI_BRAINSTORM_GENERATED_ROLES) {
				assert.ok(
					typeof row.mandate === "string" && row.mandate.length > 10,
					`${row.role} mandate too short (${row.mandate.length} chars): ${row.mandate}`,
				);
			}
		});

		it("every row carries a non-empty label", () => {
			for (const row of VELPARI_BRAINSTORM_GENERATED_ROLES) {
				assert.ok(row.label.length > 0, `${row.role} missing label`);
			}
		});

		it("web-search-agent row carries bodyFile = 'web-search-agent-body.md'", () => {
			const ws = VELPARI_BRAINSTORM_GENERATED_ROLES.find((r) => r.role === "web-search-agent");
			assert.ok(ws, "web-search-agent row missing");
			assert.equal(ws!.bodyFile, "web-search-agent-body.md");
		});

		it("the other 3 rows do NOT carry bodyFile (use the standard template)", () => {
			const standardRoles = ["extractor", "prd-checker", "rtm-checker"];
			for (const roleId of standardRoles) {
				const row = VELPARI_BRAINSTORM_GENERATED_ROLES.find((r) => r.role === roleId);
				assert.ok(row, `${roleId} row missing`);
				assert.equal(
					row!.bodyFile,
					undefined,
					`${roleId} should use the standard template (no bodyFile)`,
				);
			}
		});

		it("web-search-agent carries WebSearch + FetchURL (the only role that does web research)", () => {
			const ws = VELPARI_BRAINSTORM_GENERATED_ROLES.find((r) => r.role === "web-search-agent");
			assert.ok(ws);
			assert.ok(ws!.tools.includes("WebSearch"), "web-search-agent must carry WebSearch");
			assert.ok(ws!.tools.includes("FetchURL"), "web-search-agent must carry FetchURL");
		});

		it("the 3 read-only roles do NOT carry WebSearch (dispatcher would strip anyway)", () => {
			const standardRoles = ["extractor", "prd-checker", "rtm-checker"];
			for (const roleId of standardRoles) {
				const row = VELPARI_BRAINSTORM_GENERATED_ROLES.find((r) => r.role === roleId);
				assert.ok(row);
				assert.ok(
					!row!.tools.includes("WebSearch"),
					`${roleId} should not carry WebSearch (consent-gated role only)`,
				);
				assert.ok(
					!row!.tools.includes("FetchURL"),
					`${roleId} should not carry FetchURL (consent-gated role only)`,
				);
			}
		});
	});

	describe("parseKeywords", () => {
		it("handles arrays", () => {
			assert.deepEqual(parseKeywords(["TypeScript", "Node", "", "   "]), ["typescript", "node"]);
		});
		it("handles comma-separated strings", () => {
			assert.deepEqual(parseKeywords("typescript, node, react"), ["typescript", "node", "react"]);
		});
		it("returns [] for null / undefined / numbers", () => {
			assert.deepEqual(parseKeywords(null), []);
			assert.deepEqual(parseKeywords(undefined), []);
			assert.deepEqual(parseKeywords(42), []);
		});
		it("returns [] for empty string", () => {
			assert.deepEqual(parseKeywords(""), []);
		});
	});

	describe("technology-resource path helpers", () => {
		it("getBundledTechnologiesDir resolves to <pkgRoot>/resources/technologies", () => {
			const dir = getBundledTechnologiesDir();
			assert.equal(dir, join(REPO_ROOT, "resources", "technologies"));
		});

		it("getProjectTechnologiesDir returns <cwd>/.pi/velpari/technologies", () => {
			assert.equal(getProjectTechnologiesDir("/tmp/proj"), "/tmp/proj/.pi/velpari/technologies");
		});
	});

	describe("discoverTechnologyResources + matchTechnologies", () => {
		it("discovers the 3 bundled resources (generic, typescript, node)", () => {
			const resources = discoverTechnologyResources(REPO_ROOT);
			const ids = resources.map((r) => r.id).sort();
			assert.deepEqual(ids, ["generic", "node", "typescript"]);
		});

		it("each bundled resource carries parsed name + keywords + body", () => {
			const resources = discoverTechnologyResources(REPO_ROOT);
			for (const r of resources) {
				assert.ok(r.name.length > 0, `${r.id} missing name`);
				assert.ok(Array.isArray(r.keywords), `${r.id} missing keywords array`);
				assert.ok(r.body.length > 100, `${r.id} body too short`);
				assert.equal(r.source, "bundle");
			}
		});

		it("matchTechnologies returns typescript for ['typescript'] hint", () => {
			const resources = discoverTechnologyResources(REPO_ROOT);
			const matched = matchTechnologies(["typescript"], resources);
			assert.equal(matched.length, 1);
			assert.equal(matched[0]!.id, "typescript");
		});

		it("matchTechnologies returns typescript + node for compound hints (any order)", () => {
			const resources = discoverTechnologyResources(REPO_ROOT);
			const matched = matchTechnologies(["typescript", "node"], resources);
			const ids = matched.map((r) => r.id).sort();
			assert.deepEqual(ids, ["node", "typescript"]);
		});

		it("matchTechnologies falls back to generic when nothing matches", () => {
			const resources = discoverTechnologyResources(REPO_ROOT);
			const matched = matchTechnologies(["crystal-lang"], resources);
			assert.equal(matched.length, 1);
			assert.equal(matched[0]!.id, "generic");
		});

		it("matchTechnologies returns [] when nothing matches AND no generic fallback", () => {
			const matched = matchTechnologies(["typescript"], [
				{ id: "rust", name: "Rust", keywords: ["rust"], body: "...", source: "bundle" },
			]);
			assert.equal(matched.length, 0);
		});

		it("project resources override bundled on matching id", () => {
			// Create a temp project tree with a project override
			const tmpProject = join(REPO_ROOT, ".tmp", "test-project-resources");
			try {
				const projectTechDir = join(tmpProject, ".pi", "velpari", "technologies");
				mkdirSync(projectTechDir, { recursive: true });
				writeFileSync(
					join(projectTechDir, "typescript.md"),
					[
						"---",
						'id: typescript',
						'name: TypeScript (project override)',
						'keywords: ["typescript"]',
						"---",
						"",
						"# PROJECT OVERRIDE BODY",
					].join("\n"),
					"utf8",
				);
				const resources = discoverTechnologyResources(tmpProject);
				const ts = resources.find((r) => r.id === "typescript");
				assert.ok(ts, "typescript resource should exist");
				assert.equal(ts!.source, "project");
				assert.match(ts!.body, /PROJECT OVERRIDE BODY/);
				assert.equal(ts!.name, "TypeScript (project override)");
			} finally {
				// Best-effort cleanup
				try {
					rmSync(tmpProject, { recursive: true, force: true });
				} catch {
					/* ignore */
				}
			}
		});
	});

	describe("getProjectSlug", () => {
		it("uses package.json name when present", () => {
			const slug = getProjectSlug(REPO_ROOT);
			// package.json has `"name": "@adi-mudi/pi-velpari"`; slugify strips
			// `@` and `/` to hyphens, then collapses double hyphens.
			assert.equal(slug, "adi-mudi-pi-velpari");
		});

		it("falls back to folder basename when no package.json", () => {
			// /tmp/proj-no-pkg should not have package.json in cwd
			const slug = getProjectSlug("/tmp");
			// /tmp basename is "tmp"
			assert.equal(slug, "tmp");
		});
	});

	describe("buildGeneratedAgentMarkdown", () => {
		const sampleDef: GeneratedRoleDef = {
			role: "test-scout",
			label: "Test Scout",
			tools: ["read", "write"],
			mandate: "Verify test coverage.",
			invocationHint: "Spawn after unit tests run.",
			outOfScope: ["Do not edit source.", "Do not modify CI configs."],
		};

		it("produces well-formed YAML frontmatter + standard sections", () => {
			const md = buildGeneratedAgentMarkdown(sampleDef, "demo-test-scout", "demo", [], null);
			assert.match(md, /^---\n/);
			assert.match(md, /\n---\n/);
			assert.match(md, /name: demo-test-scout/);
			assert.match(
				md,
				/description: Spawn after unit tests run\. — Test Scout for demo\. Generated by pi-velpari\./,
			);
			assert.match(md, /tools: read, write/);
			assert.match(md, /session-mode: lineage-only/);
			assert.match(md, /auto-exit: true/);
			assert.match(md, /spawning: false/);
			assert.match(md, /## Your mandate/);
			assert.match(md, /Verify test coverage\./);
			assert.match(md, /## Out of scope/);
			assert.match(md, /Do not edit source\./);
			assert.match(md, /Do not modify CI configs\./);
			assert.match(md, /## Completion contract/);
			assert.match(md, new RegExp(`generator v${GENERATOR_VERSION}`));
		});

		it("omits Out-of-scope section when outOfScope is empty (defensive)", () => {
			const def: GeneratedRoleDef = {
				role: "noop",
				label: "Noop",
				tools: ["read"],
				mandate: "Do nothing.",
				invocationHint: "Never.",
				outOfScope: [],
			};
			const md = buildGeneratedAgentMarkdown(def, "demo-noop", "demo", [], null);
			assert.ok(!md.includes("## Out of scope"), "should omit empty Out-of-scope section");
		});

		it("includes interactive: true when def.interactive is true", () => {
			const def: GeneratedRoleDef = {
				role: "ask",
				label: "Ask",
				tools: ["read"],
				mandate: "Ask the user.",
				invocationHint: "When user input is needed.",
				outOfScope: ["Do not auto-decide."],
				interactive: true,
			};
			const md = buildGeneratedAgentMarkdown(def, "demo-ask", "demo", [], null);
			assert.match(md, /interactive: true/);
		});

		it("renders technology-craft sections when resources are provided", () => {
			const resources = discoverTechnologyResources(REPO_ROOT).filter((r) => r.id === "typescript");
			assert.equal(resources.length, 1);
			const md = buildGeneratedAgentMarkdown(sampleDef, "demo-test-scout", "demo", resources, null);
			assert.match(md, /## Technology craft \(TypeScript\)/);
			assert.match(md, new RegExp(`\\(generator v${GENERATOR_VERSION}\\) from technology resource\\(s\\): \`typescript\``));
		});

		it("renders project-context block when report carries techStack", () => {
			const md = buildGeneratedAgentMarkdown(
				sampleDef,
				"demo-test-scout",
				"demo",
				[],
				{ techStack: ["typescript", "react"], atomicFunctions: [], constraints: [] },
			);
			assert.match(md, /## Project context/);
			assert.match(md, /Technology stack:/);
			assert.match(md, /- typescript/);
		});

		it("falls through to standard template when bodyFile is missing", () => {
			const def: GeneratedRoleDef = {
				...sampleDef,
				role: "missing-body",
				bodyFile: "does-not-exist-body-file.md",
			};
			const md = buildGeneratedAgentMarkdown(def, "demo-missing", "demo", [], null);
			assert.match(md, /## Your mandate/);
			// No canonical-body footer; uses technology-resource footer instead
			assert.match(md, new RegExp(`\\(generator v${GENERATOR_VERSION}\\) from technology resource\\(s\\)`));
		});
	});

	describe("planAgentGeneration", () => {
		it("produces one plan per role; agentName = <slug>-<role>", () => {
			const def: GeneratedRoleDef = {
				role: "test",
				label: "Test",
				tools: ["read"],
				mandate: "Test.",
				invocationHint: "Run.",
				outOfScope: ["Do not."],
			};
			const plans = planAgentGeneration(REPO_ROOT, [def], [], null);
			assert.equal(plans.length, 1);
			assert.equal(plans[0]!.role, "test");
			assert.match(plans[0]!.agentName, /^adi-mudi-pi-velpari-test$/);
			assert.ok(plans[0]!.content.includes("name: adi-mudi-pi-velpari-test"));
		});

		it("produces no plans for an empty role list", () => {
			const plans = planAgentGeneration(REPO_ROOT, [], [], null);
			assert.equal(plans.length, 0);
		});
	});

	describe("body-file resolution", () => {
		it("resolveBodyFilePath returns null for a nonexistent file", () => {
			assert.equal(resolveBodyFilePath("nonexistent-body-file.md"), null);
		});

		it("loadCanonicalBody returns null for a nonexistent file", () => {
			assert.equal(loadCanonicalBody("nonexistent-body-file.md"), null);
		});

		it("loadCanonicalBody returns null for an unreadable file (defensive)", () => {
			// Path that resolves to nothing
			assert.equal(loadCanonicalBody(""), null);
		});

		it("loadCanonicalBody loads the real web-search-agent-body.md (Phase 3 ships it)", () => {
			const body = loadCanonicalBody("web-search-agent-body.md");
			assert.ok(body, "web-search-agent-body.md must load (Phase 3 ships it under pi-extension/src/agents/)");
			assert.ok(body!.length > 100, "body content must be substantive");
			assert.match(body!, /## Activation \(FR-52\)/);
			assert.match(body!, /## Hard rules/);
			// Body content is what came AFTER the frontmatter — frontmatter
			// itself should have been stripped.
			assert.ok(!body!.startsWith("---"), "frontmatter must be stripped from the loaded body");
		});

		it("resolveBodyFilePath resolves to a real file on disk for web-search-agent-body.md", () => {
			const p = resolveBodyFilePath("web-search-agent-body.md");
			assert.ok(p, "resolveBodyFilePath must return a path for the shipped body file");
			assert.ok(existsSync(p!), `body file must exist on disk at ${p}`);
		});
	});

	describe("buildGeneratedAgentMarkdown with the real 4-row table (Phase 3 integration)", () => {
		it("emits a valid agent for every brainstorm role", () => {
			assert.equal(VELPARI_BRAINSTORM_GENERATED_ROLES.length, 4);
			for (const row of VELPARI_BRAINSTORM_GENERATED_ROLES) {
				const md = buildGeneratedAgentMarkdown(
					row,
					`demo-${row.role}`,
					"demo",
					[],
					null,
				);
				assert.match(md, new RegExp(`name: demo-${row.role}`));
				assert.match(md, /session-mode: lineage-only/);
				assert.match(md, /auto-exit: true/);
				assert.match(md, /spawning: false/);
				assert.match(md, new RegExp(`\\(generator v${GENERATOR_VERSION}\\) from`));
			}
		});

		it("uses the canonical body for web-search-agent (footer references body file)", () => {
			const ws = VELPARI_BRAINSTORM_GENERATED_ROLES.find((r) => r.role === "web-search-agent");
			assert.ok(ws);
			const md = buildGeneratedAgentMarkdown(ws!, "demo-ws", "demo", [], null);
			// Footer marker for canonical-body roles
			assert.match(
				md,
				new RegExp(`\\(generator v${GENERATOR_VERSION}\\) from canonical body file: web-search-agent-body\\.md\\._`),
			);
			// Body content is present
			assert.match(md, /## Activation \(FR-52\)/);
			assert.match(md, /Rate-limit: max \*\*10 requests per brainstorm\*\*/);
			// Pi-seani parity: the canonical body is APPENDED, not replacing
			// the standard template. The standard `## Your mandate` /
			// `## Out of scope` / `## Completion contract` sections are still
			// emitted (the generator controls them); the canonical body adds
			// the specialist contract AFTER them.
			assert.match(md, /## Your mandate/);
			assert.match(md, /## Completion contract/);
			// But the canonical-body footer (NOT the tech-resource footer) is the final marker
			assert.ok(
				!md.includes("from technology resource("),
				"canonical-body roles must not emit the technology-resource footer",
			);
		});

		it("uses the standard template + tech-resource footer for the 3 non-canonical roles", () => {
			const standardRoles = ["extractor", "prd-checker", "rtm-checker"];
			for (const roleId of standardRoles) {
				const row = VELPARI_BRAINSTORM_GENERATED_ROLES.find((r) => r.role === roleId);
				assert.ok(row);
				const md = buildGeneratedAgentMarkdown(row!, `demo-${roleId}`, "demo", [], null);
				// Standard sections present
				assert.match(md, /## Your mandate/);
				assert.match(md, /## Out of scope/);
				assert.match(md, /## Completion contract/);
				// No canonical-body footer
				assert.ok(
					!md.includes("from canonical body file"),
					`${roleId} should use the standard template (no canonical-body footer)`,
				);
				// Tech-resource footer present (resources = [] → still emits footer with empty list)
				assert.match(md, new RegExp(`\\(generator v${GENERATOR_VERSION}\\) from technology resource\\(s\\)`));
			}
		});

		it("emits the exact invocationHint into the YAML description frontmatter", () => {
			const extractor = VELPARI_BRAINSTORM_GENERATED_ROLES.find((r) => r.role === "extractor");
			assert.ok(extractor);
			const md = buildGeneratedAgentMarkdown(extractor!, "demo-extractor", "demo", [], null);
			// The description is `invocationHint — Label for project. Generated by pi-velpari.`
			const expectedDesc = `${extractor!.invocationHint} — ${extractor!.label} for demo. Generated by pi-velpari.`;
			assert.ok(md.includes(expectedDesc), `description not found in:\n${md.slice(0, 300)}`);
		});
	});
});

describe("scoutTemplateRoleDef (generator v2 — Phases 2–4)", () => {
	it("returns null for an unknown role", () => {
		assert.equal(scoutTemplateRoleDef("no-such-role"), null);
	});

	it("derives a def from the bundled template (fr-extractor)", () => {
		const def = scoutTemplateRoleDef("fr-extractor");
		assert.ok(def, "fr-extractor template should resolve");
		assert.equal(def!.role, "fr-extractor");
		assert.ok(def!.label.length > 0);
		assert.deepEqual(def!.tools, ["read", "write", "bash"]);
		assert.ok(def!.mandate.length > 0);
		assert.equal(def!.invocationHint, def!.mandate);
		assert.equal(def!.bodyFile, "fr-extractor.md");
	});

	it("resolves defs for the 4 reviewer roles", () => {
		for (const role of ["reviewer", "pseudocode-reviewer", "testplan-reviewer", "design-reviewer"]) {
			assert.ok(scoutTemplateRoleDef(role), `${role} template missing`);
		}
	});

	it("resolves a def for every Phase 2–4 role in GENERATION_PHASES", () => {
		for (const phase of [2, 3, 4] as const) {
			for (const role of GENERATION_PHASES[phase].roles) {
				assert.ok(
					scoutTemplateRoleDef(role),
					`phase ${phase} role "${role}" has no bundled skills/agents template`,
				);
			}
		}
	});

	it("generated markdown carries the canonical template body + current-version footer", () => {
		const def = scoutTemplateRoleDef("fr-extractor");
		assert.ok(def);
		const md = buildGeneratedAgentMarkdown(def!, "demo-fr-extractor", "demo", [], null);
		assert.match(md, /name: demo-fr-extractor/);
		// Canonical body from skills/agents/fr-extractor.md survives verbatim.
		assert.match(md, /# FR EXTRACTOR/);
		assert.match(md, /from canonical body file: fr-extractor\.md/);
		assert.match(md, new RegExp(`generator v${GENERATOR_VERSION}`));
	});
});

// Ensure dependencies are referenced (the bundler may strip otherwise)
void existsSync;
