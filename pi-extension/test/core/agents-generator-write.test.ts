/**
 * writeGeneratedAgents + previewRegeneration + updateAgentsJson tests
 * (Phase 4 — drift manifest + write-with-safety contract + agents.json merge).
 *
 * Mirrors the Senai `agents/generator.test.ts` write-side suite.
 * Each test uses a fresh temp dir under `mkdtempSync`; no shared
 * filesystem state.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildGeneratedAgentMarkdown,
	getProjectSlug,
	planAgentGeneration,
	previewRegeneration,
	updateAgentsJson,
	writeGeneratedAgents,
	type GeneratedAgentPlan,
	type GeneratedRoleDef,
} from "../../src/core/agents-generator.js";
import { VELPARI_BRAINSTORM_GENERATED_ROLES } from "../../src/core/agents-config.js";
import {
	addToGeneratedManifest,
	loadGeneratedManifest,
} from "../../src/core/generated-manifest.js";

function freshTmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-write-"));
}

const SAMPLE_DEF: GeneratedRoleDef = {
	role: "extractor",
	label: "Brainstorm — Answer Extractor",
	tools: ["read", "write", "bash"],
	mandate: "Test mandate.",
	invocationHint: "Test hint.",
	outOfScope: ["Do not.", "Do not edit."],
};

function plan(cwd: string, role = SAMPLE_DEF): GeneratedAgentPlan[] {
	return planAgentGeneration(cwd, [role], [], null);
}

function hash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

describe("agents-generator-write (Phase 4 — write-with-safety contract)", () => {
	describe("writeGeneratedAgents", () => {
		it("on a clean dir: all plans are created; manifest is written; agents.json is NOT touched", () => {
			const cwd = freshTmp();
			try {
				const plans = plan(cwd);
				const result = writeGeneratedAgents(cwd, plans);

				assert.equal(result.created.length, 1, "1 plan → 1 created");
				assert.equal(result.regenerated.length, 0);
				assert.equal(result.keptDrifted.length, 0);
				assert.equal(result.skipped.length, 0);

				// The agent file actually exists on disk
				const slug = getProjectSlug(cwd);
				const filePath = join(cwd, ".pi", "agents", `${slug}-extractor.md`);
				assert.ok(existsSync(filePath), `agent file must exist at ${filePath}`);

				// Manifest written with 1 sha256
				const manifest = loadGeneratedManifest(cwd);
				const rel = `.pi/agents/${slug}-extractor.md`;
				assert.ok(manifest.files[rel], `manifest should contain ${rel}`);
				assert.match(manifest.files[rel]!, /^[0-9a-f]{64}$/);

				// agents.json NOT created — that's updateAgentsJson's job
				assert.ok(
					!existsSync(join(cwd, ".pi", "velpari", "agents.json")),
					"writeGeneratedAgents must not touch agents.json",
				);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("regenerate: false + existing file → SKIPPED (never overwrites by default)", () => {
			const cwd = freshTmp();
			try {
				const slug = getProjectSlug(cwd);
				const filePath = join(cwd, ".pi", "agents", `${slug}-extractor.md`);
				mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
				const originalContent = "# user-edited content (must not be touched)";
				writeFileSync(filePath, originalContent, "utf8");

				const plans = plan(cwd);
				const result = writeGeneratedAgents(cwd, plans);

				assert.equal(result.created.length, 0);
				assert.equal(result.regenerated.length, 0);
				assert.equal(result.keptDrifted.length, 0);
				assert.deepEqual(result.skipped, [`.pi/agents/${slug}-extractor.md`]);

				// File untouched
				assert.equal(readFileSync(filePath, "utf8"), originalContent);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("regenerate: true + file NOT in manifest → SKIPPED (unknown origin)", () => {
			const cwd = freshTmp();
			try {
				const slug = getProjectSlug(cwd);
				const filePath = join(cwd, ".pi", "agents", `${slug}-extractor.md`);
				mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
				const originalContent = "# hand-made agent (no manifest entry)";
				writeFileSync(filePath, originalContent, "utf8");

				// No manifest entry for this file. regenerate: true should still skip.
				const plans = plan(cwd);
				const result = writeGeneratedAgents(cwd, plans, { regenerate: true });

				assert.equal(result.regenerated.length, 0);
				assert.deepEqual(result.skipped, [`.pi/agents/${slug}-extractor.md`]);

				// File untouched
				assert.equal(readFileSync(filePath, "utf8"), originalContent);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("regenerate: true + manifest hash matches → REGENERATED", () => {
			const cwd = freshTmp();
			try {
				const slug = getProjectSlug(cwd);
				const filePath = join(cwd, ".pi", "agents", `${slug}-extractor.md`);
				const rel = `.pi/agents/${slug}-extractor.md`;
				mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });

				// Generate the content that the generator will write.
				const md = buildGeneratedAgentMarkdown(
					SAMPLE_DEF,
					`${slug}-extractor`,
					slug,
					[],
					null,
				);
				writeFileSync(filePath, md, "utf8");

				// Pre-populate manifest with the matching sha256
				addToGeneratedManifest(cwd, [filePath]);

				// Now run writeGeneratedAgents with regenerate: true.
				const plans = plan(cwd);
				const result = writeGeneratedAgents(cwd, plans, { regenerate: true });

				assert.equal(result.created.length, 0);
				assert.deepEqual(result.regenerated, [rel]);
				assert.equal(result.keptDrifted.length, 0);
				assert.equal(result.skipped.length, 0);

				// Manifest hash updated to the (still-matching) hash
				const manifest = loadGeneratedManifest(cwd);
				assert.equal(manifest.files[rel], hash(md));
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("regenerate: true + manifest hash drift (user edited) → KEPT_DRIFTED", () => {
			const cwd = freshTmp();
			try {
				const slug = getProjectSlug(cwd);
				const filePath = join(cwd, ".pi", "agents", `${slug}-extractor.md`);
				const rel = `.pi/agents/${slug}-extractor.md`;
				mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });

				// Initial file + manifest hash (simulating a previous generation round)
				const priorMd = buildGeneratedAgentMarkdown(
					SAMPLE_DEF,
					`${slug}-extractor`,
					slug,
					[],
					null,
				);
				writeFileSync(filePath, priorMd, "utf8");
				addToGeneratedManifest(cwd, [filePath]);

				// User edits the file (content drifts from the manifest hash)
				const editedContent = priorMd + "\n\n# user edit\n";
				writeFileSync(filePath, editedContent, "utf8");

				// Run writeGeneratedAgents with regenerate: true — should KEEP the edit
				const plans = plan(cwd);
				const result = writeGeneratedAgents(cwd, plans, { regenerate: true });

				assert.equal(result.regenerated.length, 0);
				assert.deepEqual(result.keptDrifted, [rel]);
				assert.equal(result.skipped.length, 0);

				// File untouched
				assert.equal(readFileSync(filePath, "utf8"), editedContent);

				// Manifest hash NOT updated (keptDrifted files keep the old hash)
				const manifest = loadGeneratedManifest(cwd);
				assert.equal(manifest.files[rel], hash(priorMd));
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("missing file with a surviving mapping → RECREATED (counts as created)", () => {
			const cwd = freshTmp();
			try {
				const slug = getProjectSlug(cwd);
				const filePath = join(cwd, ".pi", "agents", `${slug}-extractor.md`);
				const rel = `.pi/agents/${slug}-extractor.md`;

				// Pre-populate manifest (file is missing, but mapping exists)
				addToGeneratedManifest(cwd, [filePath]);

				const plans = plan(cwd);
				const result = writeGeneratedAgents(cwd, plans, { regenerate: true });

				assert.equal(result.created.length, 1);
				assert.deepEqual(result.created, [rel]);

				// File now exists
				assert.ok(existsSync(filePath));
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("manifest is MERGED — unrelated pre-existing entries survive a write", () => {
			const cwd = freshTmp();
			try {
				// Seed manifest with an unrelated entry
				const unrelatedAbs = join(cwd, ".pi", "agents", "unrelated.md");
				mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
				mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
				writeFileSync(unrelatedAbs, "unrelated", "utf8");
				addToGeneratedManifest(cwd, [unrelatedAbs]);

				const plans = plan(cwd);
				writeGeneratedAgents(cwd, plans);

				const manifest = loadGeneratedManifest(cwd);
				assert.ok(
					manifest.files[".pi/agents/unrelated.md"],
					"unrelated entry must survive the merge",
				);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});

	describe("previewRegeneration", () => {
		it("classifies missing files as `recreate`", () => {
			const cwd = freshTmp();
			try {
				const preview = previewRegeneration(cwd, ["nonexistent-agent"]);
				assert.deepEqual(preview.recreate, [".pi/agents/nonexistent-agent.md"]);
				assert.equal(preview.overwrite.length, 0);
				assert.equal(preview.keptDrifted.length, 0);
				assert.equal(preview.unknown.length, 0);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("classifies unknown-origin files as `unknown`", () => {
			const cwd = freshTmp();
			try {
				const agentsDir = join(cwd, ".pi", "agents");
				mkdirSync(agentsDir, { recursive: true });
				writeFileSync(join(agentsDir, "hand-made.md"), "no manifest entry", "utf8");

				const preview = previewRegeneration(cwd, ["hand-made"]);
				assert.deepEqual(preview.unknown, [".pi/agents/hand-made.md"]);
				assert.equal(preview.recreate.length, 0);
				assert.equal(preview.overwrite.length, 0);
				assert.equal(preview.keptDrifted.length, 0);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("classifies manifest-matched files as `overwrite`; drifted as `keptDrifted`", () => {
			const cwd = freshTmp();
			try {
				const slug = getProjectSlug(cwd);
				const fileMatched = join(cwd, ".pi", "agents", `${slug}-extractor.md`);
				const fileDrifted = join(cwd, ".pi", "agents", `${slug}-prd-checker.md`);
				const relMatched = `.pi/agents/${slug}-extractor.md`;
				const relDrifted = `.pi/agents/${slug}-prd-checker.md`;
				mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
				writeFileSync(fileMatched, "content v1", "utf8");
				writeFileSync(fileDrifted, "content v1", "utf8");
				addToGeneratedManifest(cwd, [fileMatched, fileDrifted]);

				// Drift the second one
				writeFileSync(fileDrifted, "content v1 (user edit)", "utf8");

				const preview = previewRegeneration(cwd, [
					`${slug}-extractor`,
					`${slug}-prd-checker`,
				]);
				assert.deepEqual(preview.overwrite, [relMatched]);
				assert.deepEqual(preview.keptDrifted, [relDrifted]);
				assert.equal(preview.recreate.length, 0);
				assert.equal(preview.unknown.length, 0);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("mirrors writeGeneratedAgents({regenerate: true}) classification for the same input set", () => {
			const cwd = freshTmp();
			try {
				const plans = plan(cwd);
				// Write first to set up the on-disk + manifest state
				writeGeneratedAgents(cwd, plans);

				const agentNames = plans.map((p) => p.agentName);
				const preview = previewRegeneration(cwd, agentNames);

				// Right after creation: hash matches → all should be `overwrite`
				assert.equal(preview.overwrite.length, agentNames.length);
				assert.equal(preview.recreate.length, 0);
				assert.equal(preview.keptDrifted.length, 0);
				assert.equal(preview.unknown.length, 0);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});

	describe("updateAgentsJson", () => {
		it("no agents.json + plans → creates one with the generated mappings; count = plans.length", () => {
			const cwd = freshTmp();
			try {
				const plans = plan(cwd);
				const added = updateAgentsJson(cwd, plans);
				assert.equal(added, plans.length);

				const configPath = join(cwd, ".pi", "velpari", "agents.json");
				assert.ok(existsSync(configPath), "agents.json should be created");
				const content = JSON.parse(readFileSync(configPath, "utf8")) as {
					agents: Record<string, string>;
				};
				assert.equal(Object.keys(content.agents).length, plans.length);
				assert.equal(content.agents[SAMPLE_DEF.role], plans[0]!.agentName);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("custom mapping is NEVER overwritten (the user owns the custom column)", () => {
			const cwd = freshTmp();
			try {
				const agentConfigDir = join(cwd, ".pi", "velpari");
				mkdirSync(agentConfigDir, { recursive: true });
				// Seed agents.json with a CUSTOM mapping for extractor
				writeFileSync(
					join(agentConfigDir, "agents.json"),
					JSON.stringify({
						version: 1,
						agents: { extractor: "my-custom-extractor-agent" },
					}),
					"utf8",
				);

				const plans = plan(cwd);
				const added = updateAgentsJson(cwd, plans);
				assert.equal(added, plans.length - 1, "extractor's mapping was custom → skipped");

				const content = JSON.parse(
					readFileSync(join(agentConfigDir, "agents.json"), "utf8"),
				) as { agents: Record<string, string> };
				assert.equal(
					content.agents.extractor,
					"my-custom-extractor-agent",
					"custom mapping MUST be preserved",
				);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("all-custom mappings → no file write (addedCount = 0)", () => {
			const cwd = freshTmp();
			try {
				const agentConfigDir = join(cwd, ".pi", "velpari");
				mkdirSync(agentConfigDir, { recursive: true });
				writeFileSync(
					join(agentConfigDir, "agents.json"),
					JSON.stringify({
						version: 1,
						agents: {
							extractor: "my-custom-1",
							"prd-checker": "my-custom-2",
							"rtm-checker": "my-custom-3",
							"web-search-agent": "my-custom-4",
						},
					}),
					"utf8",
				);

				const plans = planAgentGeneration(
					cwd,
					[...VELPARI_BRAINSTORM_GENERATED_ROLES],
					[],
					null,
				);
				const added = updateAgentsJson(cwd, plans);
				assert.equal(added, 0);

				const content = JSON.parse(
					readFileSync(join(agentConfigDir, "agents.json"), "utf8"),
				) as { agents: Record<string, string> };
				assert.deepEqual(content.agents, {
					extractor: "my-custom-1",
					"prd-checker": "my-custom-2",
					"rtm-checker": "my-custom-3",
					"web-search-agent": "my-custom-4",
				});
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("idempotent: re-running updateAgentsJson with the same plans adds 0", () => {
			const cwd = freshTmp();
			try {
				const plans = plan(cwd);
				const first = updateAgentsJson(cwd, plans);
				assert.equal(first, plans.length);
				const second = updateAgentsJson(cwd, plans);
				assert.equal(second, 0, "re-running with the same plans must not re-write");
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("skips plans whose role is not in the Velpari role registry (defensive)", () => {
			const cwd = freshTmp();
			try {
				const foreignPlan: GeneratedAgentPlan = {
					role: "some-future-role-not-yet-registered",
					agentName: "demo-some-future-role",
					description: "future",
					tools: [],
					content: "noop",
				};
				const added = updateAgentsJson(cwd, [foreignPlan]);
				assert.equal(added, 0);

				const configPath = join(cwd, ".pi", "velpari", "agents.json");
				assert.ok(
					!existsSync(configPath),
					"no agents.json should be written when nothing changed",
				);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});

	describe("integration: writeGeneratedAgents + updateAgentsJson together", () => {
		it("end-to-end: write 4 agents + update agents.json (default mappings) + manifest", () => {
			const cwd = freshTmp();
			try {
				const roles = [...VELPARI_BRAINSTORM_GENERATED_ROLES];
				const plans = planAgentGeneration(cwd, roles, [], null);
				assert.equal(plans.length, 4);

				const writeResult = writeGeneratedAgents(cwd, plans);
				assert.equal(writeResult.created.length, 4);
				assert.equal(writeResult.skipped.length, 0);

				const added = updateAgentsJson(cwd, plans);
				assert.equal(added, 4);

				const configPath = join(cwd, ".pi", "velpari", "agents.json");
				const config = JSON.parse(readFileSync(configPath, "utf8")) as {
					agents: Record<string, string>;
				};
				const slug = getProjectSlug(cwd);
				assert.equal(config.agents.extractor, `${slug}-extractor`);
				assert.equal(config.agents["prd-checker"], `${slug}-prd-checker`);
				assert.equal(config.agents["rtm-checker"], `${slug}-rtm-checker`);
				assert.equal(config.agents["web-search-agent"], `${slug}-web-search-agent`);

				// Manifest has all 4 entries
				const manifest = loadGeneratedManifest(cwd);
				assert.equal(Object.keys(manifest.files).length, 4);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});
});
