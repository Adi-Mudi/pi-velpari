/**
 * /velpari-generate-sub-agents command (L3 — Phase 5 + Phase 6).
 *
 * Combines the UX flow (3-question interview → scan-gate consent → preview
 * → ONE confirm → write + agents.json merge) with the slash-command wiring.
 *
 * Lives in L3 because it composes L2 UI widgets (runSimpleConfirm /
 * runSimplePicker) with L1 / L0 generator primitives. The pure helpers
 * (classifyTargets, resolveResources) are kept local — they are too small
 * to warrant a separate L1 module.
 *
 * Mirrors pi-seani's `commands/generate-sub-agents.ts`. Velpari standalone:
 * no runtime dep on Senai.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_AGENTS,
	VELPARI_BRAINSTORM_GENERATED_ROLES,
	VELPARI_REVIEWER_GENERATED_ROLES,
	loadAgentConfig,
	resolveAgentName,
	type VelpariRole,
} from "../core/agents-config.js";
import {
	discoverTechnologyResources,
	getProjectSlug,
	matchTechnologies,
	planAgentGeneration,
	previewRegeneration,
	updateAgentsJson,
	writeGeneratedAgents,
	type GeneratedAgentPlan,
	type GeneratedRoleDef,
} from "../core/agents-generator.js";
import { runSimpleConfirm, runSimplePicker } from "../ui/simple-picker.js";
import { renderWriteSetPreview } from "../ui/write-set-preview.js";

export interface AgentGeneratorResult {
	created: number;
	regenerated: number;
	keptDrifted: number;
	skipped: number;
	mappingsAdded: number;
	cancelled: boolean;
}

interface TargetSet {
	fresh: GeneratedRoleDef[];
	regen: GeneratedRoleDef[];
	custom: GeneratedRoleDef[];
}

/** Plan E — combined role table (brainstorm + reviewer). The generator
 *  now emits per-stage reviewer copies too. */
const ALL_GENERATED_ROLES: readonly GeneratedRoleDef[] = [
	...VELPARI_BRAINSTORM_GENERATED_ROLES,
	...VELPARI_REVIEWER_GENERATED_ROLES,
];

/** Classify every row in `ALL_GENERATED_ROLES`:
 *   - `fresh`:  the role resolves to its built-in default
 *   - `regen`:  the role is mapped to `<slug>-<role>` (a previous gen)
 *   - `custom`: the role has any other mapping (the user owns it)
 */
function classifyTargets(cwd: string, slug: string): TargetSet {
	const config = loadAgentConfig(cwd);
	const fresh: GeneratedRoleDef[] = [];
	const regen: GeneratedRoleDef[] = [];
	const custom: GeneratedRoleDef[] = [];

	for (const def of ALL_GENERATED_ROLES) {
		const role = def.role as VelpariRole;
		if (!(role in DEFAULT_AGENTS)) continue;
		const currentResolved = resolveAgentName(config, role);
		const generatedName = `${slug}-${role}`;
		if (currentResolved === DEFAULT_AGENTS[role]) {
			fresh.push(def);
		} else if (currentResolved === generatedName) {
			regen.push(def);
		} else {
			custom.push(def);
		}
	}

	return { fresh, regen, custom };
}

/** Filter resources down to the matched set, falling back to `generic`
 *  with a 3-way consent picker when ONLY generic matches. Mirrors the
 *  pi-seani scan-gate UX. Returns null on cancel. */
async function resolveResources(
	ctx: ExtensionContext,
	cwd: string,
	stackHints: string[],
): Promise<ReturnType<typeof matchTechnologies> | null> {
	const resources = discoverTechnologyResources(cwd);
	const matched = matchTechnologies(stackHints, resources);

	if (matched.length === 0) {
		ctx.ui.notify(
			"No technology resources found. Check resources/technologies/ in the extension.",
			"error",
		);
		return null;
	}

	const onlyGeneric = matched.every((r) => r.id === "generic");
	if (onlyGeneric) {
		const hintText = stackHints.length > 0 ? ` (${stackHints.join(", ")})` : "";
		const choice = await runSimplePicker(ctx, {
			title: `No technology resource matches this project${hintText}. What do you want to do?`,
			items: [
				{ id: "fetch", label: "Fetch from official docs (recommended)" },
				{ id: "generic", label: "Use generic resource" },
				{ id: "cancel", label: "Cancel" },
			],
		});
		if (!choice || choice === "cancel") {
			ctx.ui.notify("Agent generation cancelled.", "info");
			return null;
		}
		if (choice === "fetch") {
			// v1: same UX as Senai — fetch is offered but the actual fetch
			// helper is v2+. For now, fall through to the generic resource
			// and tell the user what would happen next.
			ctx.ui.notify(
				"Fetch from official docs is not yet wired in v1 (planned for v2). Falling back to the generic resource; run /velpari-doctor afterwards to inspect the output.",
				"warning",
			);
			return matched; // currently the generic fallback
		}
		// choice === "generic" → continue with what we have
	}

	return matched;
}

/** Main orchestration. Exported so the test suite can drive it directly
 *  without going through `registerGenerateSubAgentsCommand`. */
export async function runAgentGenerator(ctx: ExtensionContext): Promise<AgentGeneratorResult> {
	const emptyResult: AgentGeneratorResult = {
		created: 0,
		regenerated: 0,
		keptDrifted: 0,
		skipped: 0,
		mappingsAdded: 0,
		cancelled: false,
	};

	if (ctx.hasUI === false) {
		ctx.ui.notify(
			"/velpari-generate-sub-agents needs an interactive terminal (TUI). It does nothing in headless mode.",
			"warning",
		);
		return emptyResult;
	}

	const cwd = ctx.cwd;
	const slug = getProjectSlug(cwd);

	// 1. Classify targets (fresh / regen / custom) — Plan E includes both
	// brainstorm AND reviewer roles.
	const targets = classifyTargets(cwd, slug);
	const targetRoles = [...targets.fresh, ...targets.regen];

	if (targetRoles.length === 0) {
		// Plan E — the "all custom" branch still refers to the 4 brainstorm
		// roles (the original wording). Reviewer roles are never the reason
		// to bail; they have their own defaults and would always be fresh.
		ctx.ui.notify(
			"All 4 brainstorm roles already have custom agents. Nothing to generate.",
			"info",
		);
		return emptyResult;
	}

	// 1a. Plan E — split targets into brainstorm vs reviewer. Reviewer
	// copies are written WITHOUT going through the 3-question interview
	// (they're deterministic, same pattern as the brainstorm defaults).
	const brainstormTargets = [
		...targets.fresh,
		...targets.regen,
	].filter((def) => isBrainstormRole(def.role));
	const reviewerTargets = [
		...targets.fresh,
		...targets.regen,
	].filter((def) => isReviewerRole(def.role));

	if (brainstormTargets.length === 0) {
		// No brainstorm work — but reviewer roles may still need to be
		// written. Skip the interview and write reviewer copies directly.
		return writeReviewerCopiesOnly(ctx, cwd, slug, reviewerTargets);
	}

	// 2. 3-question basic-mode interview (matches pi-seani's basic mode UX)
	const projectType = await runSimplePicker(ctx, {
		title: "Project type?",
		items: [
			{ id: "automation / scripts", label: "automation / scripts" },
			{ id: "web application", label: "web application" },
			{ id: "cli tool", label: "cli tool" },
			{ id: "library / package", label: "library / package" },
			{ id: "other", label: "other" },
		],
	});
	if (!projectType) {
		ctx.ui.notify("Agent generation cancelled.", "info");
		return { ...emptyResult, cancelled: true };
	}
	const language = await ctx.ui.input("Primary language? (e.g., typescript, python, apps script)");
	if (!language || language.trim() === "") {
		ctx.ui.notify("Primary language is required. Aborting.", "error");
		return { ...emptyResult, cancelled: true };
	}
	const framework = await ctx.ui.input(
		"Framework or platform? (e.g., fastapi, react, google sheets) — optional, press Enter to skip",
	);
	const stackHints: string[] = [projectType, language];
	if (framework && framework.trim() !== "") stackHints.push(framework);

	// 3. Discover + match resources
	const matched = await resolveResources(ctx, cwd, stackHints);
	if (!matched) {
		return { ...emptyResult, cancelled: true };
	}

	// 4. Split targets into brainstorm (interview-driven) and reviewer
	// (deterministic). Reviewer copies skip the interview and don't
	// add mappings to agents.json — they're stage-scoped, not brainstorm-scoped.
	const brainstormRoles = targetRoles.filter((def) => isBrainstormRole(def.role));
	const reviewerRoles = targetRoles.filter((def) => isReviewerRole(def.role));

	const plans: GeneratedAgentPlan[] = [
		...planAgentGeneration(cwd, brainstormRoles, matched, null),
		...reviewerRoles.map((def) => ({
			role: def.role,
			agentName: `${slug}-${def.role}`,
			description: def.label,
			tools: [...def.tools],
			content: buildReviewerAgentMarkdown(def),
		})),
	];
	if (plans.length === 0) {
		ctx.ui.notify("Nothing to plan — target set resolved to 0 plans.", "info");
		return emptyResult;
	}

	// 5. Build the write-set preview. Always classify via previewRegeneration
	// so the dialog matches what the user will actually see after write.
	const preview = previewRegeneration(cwd, plans.map((p) => p.agentName));
	const previewText = renderWriteSetPreview(preview, { regenerateMode: true });

	// 6. ONE confirmation gate (Rule 7)
	const confirmed = await runSimpleConfirm(
		ctx,
		"Generate sub-agents?",
		previewText,
	);
	if (!confirmed) {
		ctx.ui.notify("Agent generation cancelled.", "info");
		return { ...emptyResult, cancelled: true };
	}

	// 7. Write — pass `regenerate: true` whenever we're touching any
	// pre-existing generated file so the manifest check kicks in.
	const needsRegenerate = targets.regen.length > 0 || preview.overwrite.length > 0;
	const writeResult = writeGeneratedAgents(cwd, plans, { regenerate: needsRegenerate });

	// 8. Update agents.json — only brainstorm roles get mappings added.
	const mappingsAdded = updateAgentsJson(cwd, plans.filter((p) => isBrainstormRole(p.role)));

	// 9. Post-write summary
	ctx.ui.notify(formatSummary(writeResult, mappingsAdded), "info");

	// 10. Doctor hint
	ctx.ui.notify(
		"Run /velpari-doctor afterwards to verify the generator completeness section is clean.",
		"info",
	);

	return {
		created: writeResult.created.length,
		regenerated: writeResult.regenerated.length,
		keptDrifted: writeResult.keptDrifted.length,
		skipped: writeResult.skipped.length,
		mappingsAdded,
		cancelled: false,
	};
}

function formatSummary(
	write: { created: string[]; regenerated: string[]; keptDrifted: string[]; skipped: string[] },
	mappingsAdded: number,
): string {
	const parts: string[] = [];
	const total = write.created.length + write.regenerated.length;
	if (total > 0) {
		parts.push(`${total} agent${total === 1 ? "" : "s"} written`);
	}
	if (write.keptDrifted.length > 0) {
		parts.push(`${write.keptDrifted.length} kept (user edits)`);
	}
	if (write.skipped.length > 0) {
		parts.push(`${write.skipped.length} skipped (unknown origin)`);
	}
	if (mappingsAdded > 0) {
		parts.push(
			`${mappingsAdded} mapping${mappingsAdded === 1 ? "" : "s"} added to .pi/velpari/agents.json`,
		);
	}
	if (parts.length === 0) {
		return "No changes made.";
	}
	return `Done. ${parts.join("; ")}.`;
}

/** Plan E — true if a role is one of the 4 brainstorm roles. */
function isBrainstormRole(role: string): boolean {
	return (
		role === "extractor" ||
		role === "prd-checker" ||
		role === "rtm-checker" ||
		role === "web-search-agent"
	);
}

/** Plan E — true if a role is one of the 4 reviewer roles. */
function isReviewerRole(role: string): boolean {
	return (
		role === "reviewer" ||
		role === "pseudocode-reviewer" ||
		role === "testplan-reviewer" ||
		role === "design-reviewer"
	);
}

/** Plan E — write only reviewer copies (no interview, no mappings).
 *  Used when all brainstorm roles are custom but reviewer roles still
 *  need their default copies. */
async function writeReviewerCopiesOnly(
	ctx: ExtensionContext,
	cwd: string,
	slug: string,
	reviewerDefs: readonly GeneratedRoleDef[],
): Promise<AgentGeneratorResult> {
	if (reviewerDefs.length === 0) {
		return {
			created: 0,
			regenerated: 0,
			keptDrifted: 0,
			skipped: 0,
			mappingsAdded: 0,
			cancelled: false,
		};
	}
	const plans: GeneratedAgentPlan[] = reviewerDefs.map((def) => ({
		role: def.role,
		agentName: `${slug}-${def.role}`,
		description: def.label,
		tools: [...def.tools],
		content: buildReviewerAgentMarkdown(def),
	}));
	const writeResult = writeGeneratedAgents(cwd, plans, { regenerate: true });
	const summary = formatSummary(writeResult, 0);
	ctx.ui.notify(summary, writeResult.created.length > 0 ? "info" : "warning");
	return {
		created: writeResult.created.length,
		regenerated: writeResult.regenerated.length,
		keptDrifted: writeResult.keptDrifted.length,
		skipped: writeResult.skipped.length,
		mappingsAdded: 0,
		cancelled: false,
	};
}

/** Plan E — build a minimal reviewer agent markdown from a definition.
 *  Reviewer roles don't need project context; the contract is fully
 *  captured by tools + mandate + invocationHint + outOfScope. */
function buildReviewerAgentMarkdown(def: GeneratedRoleDef): string {
	const lines: string[] = [];
	lines.push("---");
	lines.push(`name: ${def.role}`);
	lines.push(`description: ${def.label}`);
	lines.push(`tools: ${def.tools.join(", ")}`);
	lines.push("thinking: high");
	lines.push("session-mode: standalone");
	lines.push("auto-exit: true");
	lines.push("spawning: false");
	lines.push("---");
	lines.push("");
	lines.push(`# ${def.label}`);
	lines.push("");
	lines.push(def.mandate);
	lines.push("");
	lines.push("## When to spawn");
	lines.push("");
	lines.push(def.invocationHint);
	lines.push("");
	lines.push("## Out of scope");
	lines.push("");
	for (const item of def.outOfScope) {
		lines.push(`- ${item}`);
	}
	return lines.join("\n");
}

export function registerGenerateSubAgentsCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-generate-sub-agents", {
		description:
			"Generate project-specific sub-agents for the 4 brainstorm roles from your tech stack.",
		handler: async (_args, ctx) => {
			await runAgentGenerator(ctx);
		},
	});
}
