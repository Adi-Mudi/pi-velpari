/**
 * /velpari-generate-sub-agents command (L3) — generator v2, per-phase.
 *
 * Combines the UX flow (shrunk interview → resource match → preview →
 * ONE confirm → write + agents.json merge) with the slash-command wiring.
 *
 * Per-phase model (spec Doc/velpari-sequence/05-sub-agent-generation.md):
 * the phase is auto-detected from the run's current stage
 * (`phaseForStage(state.currentStage)`) with a `--phase N` override.
 * Phase 1 keeps the hand-authored brainstorm role table; Phases 2–4
 * assemble role definitions from the bundled `skills/agents/<role>.md`
 * templates (`scoutTemplateRoleDef`) so the real scout contract survives
 * into the generated copy. Project context comes from published `Doc/`
 * artifacts only (`loadProjectContext`, sidecar-first). The interview
 * asks only what is not already on disk (feasibility decision record for
 * Phase 3+, files.json framework).
 *
 * Lives in L3 because it composes L2 UI widgets (runSimpleConfirm /
 * runSimplePicker) with L1 / L0 generator primitives. The pure helpers
 * (classifyTargets, resolveResources, roleDefsForPhase) are kept local —
 * they are too small to warrant a separate L1 module.
 *
 * Mirrors pi-seani's `commands/generate-sub-agents.ts`. Velpari standalone:
 * no runtime dep on Senai.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_AGENTS,
	GENERATION_PHASES,
	VELPARI_BRAINSTORM_GENERATED_ROLES,
	loadAgentConfig,
	phaseForStage,
	resolveAgentName,
	type GenerationPhase,
	type VelpariRole,
} from "../core/agents-config.js";
import {
	discoverTechnologyResources,
	getProjectSlug,
	matchTechnologies,
	planAgentGeneration,
	previewRegeneration,
	scoutTemplateRoleDef,
	updateAgentsJson,
	writeGeneratedAgents,
	type GeneratedRoleDef,
} from "../core/agents-generator.js";
import { loadFilesConfig } from "../core/config.js";
import { loadFeasibilityRecord } from "../core/feasibility-record.js";
import { loadProjectContext } from "../core/project-context.js";
import { loadState } from "../core/state.js";
import { runSimpleConfirm, runSimplePicker } from "../ui/simple-picker.js";
import { renderWriteSetPreview } from "../ui/write-set-preview.js";

interface AgentGeneratorResult {
	created: number;
	regenerated: number;
	keptDrifted: number;
	skipped: number;
	mappingsAdded: number;
	cancelled: boolean;
}

interface RunAgentGeneratorOptions {
	/** Explicit phase override (the command's `--phase N`). Defaults to
	 *  auto-detect from the run's current stage. */
	phase?: GenerationPhase;
}

interface TargetSet {
	fresh: GeneratedRoleDef[];
	regen: GeneratedRoleDef[];
	custom: GeneratedRoleDef[];
}

/** Role definitions for one generation phase. Phase 1 uses the
 *  hand-authored brainstorm table; Phases 2–4 derive every role (stage
 *  scouts + reviewers) from its bundled `skills/agents/<role>.md`
 *  template. Roles whose template is missing are skipped — the bundled
 *  scout remains the permanent fallback for them. */
function roleDefsForPhase(phase: GenerationPhase): GeneratedRoleDef[] {
	if (phase === 1) return [...VELPARI_BRAINSTORM_GENERATED_ROLES];
	const defs: GeneratedRoleDef[] = [];
	for (const role of GENERATION_PHASES[phase].roles) {
		const def = scoutTemplateRoleDef(role);
		if (def) defs.push(def);
	}
	return defs;
}

/** Classify every role definition:
 *   - `fresh`:  the role resolves to its built-in default
 *   - `regen`:  the role is mapped to `<slug>-<role>` (a previous gen)
 *   - `custom`: the role has any other mapping (the user owns it)
 */
function classifyTargets(cwd: string, slug: string, defs: readonly GeneratedRoleDef[]): TargetSet {
	const config = loadAgentConfig(cwd);
	const fresh: GeneratedRoleDef[] = [];
	const regen: GeneratedRoleDef[] = [];
	const custom: GeneratedRoleDef[] = [];

	for (const def of defs) {
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
		ctx.ui.notify("No technology resources found. Check resources/technologies/ in the extension.", "error");
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
export async function runAgentGenerator(
	ctx: ExtensionContext,
	opts?: RunAgentGeneratorOptions,
): Promise<AgentGeneratorResult> {
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
	const state = loadState(cwd);
	const phase: GenerationPhase = opts?.phase ?? phaseForStage(state.currentStage);

	// 1. Role definitions for the phase (P1 table; P2–4 from templates).
	const defs = roleDefsForPhase(phase);
	if (defs.length === 0) {
		ctx.ui.notify(
			`No generatable roles resolved for Phase ${phase} (scout templates missing?). The bundled scouts remain the fallback.`,
			"warning",
		);
		return emptyResult;
	}

	// 2. Classify targets (fresh / regen / custom).
	const targets = classifyTargets(cwd, slug, defs);
	const targetRoles = [...targets.fresh, ...targets.regen];

	if (targetRoles.length === 0) {
		ctx.ui.notify(`All Phase ${phase} roles already have custom agents. Nothing to generate.`, "info");
		return emptyResult;
	}

	// 3. Project context from published Doc/ artifacts (sidecar-first) —
	//    the ArchitectReport slot, fed per phase.
	const report = loadProjectContext(cwd, state, phase);

	// 4. Interview (D3) — ask only what is not already on disk:
	//    language from the feasibility decision record (Phase 3+) or the
	//    files.json framework; framework from files.json. Project type is
	//    never persisted, so it is always asked.
	const filesConfig = loadFilesConfig(cwd);
	const projectName = filesConfig.projectName || filesConfig.projectNames?.[0] || "";
	const record = phase >= 3 && projectName ? loadFeasibilityRecord(cwd, projectName) : null;
	const languageOnDisk = record?.selectedLanguage?.trim() || filesConfig.framework?.language?.trim() || "";
	const frameworkOnDisk =
		(filesConfig.framework?.libraries?.length ?? 0) > 0 || !!filesConfig.framework?.runtime?.trim();

	const stackHints: string[] = [...report.techStack];

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
	stackHints.push(projectType);

	if (!languageOnDisk) {
		const language = await ctx.ui.input("Primary language? (e.g., typescript, python, apps script)");
		if (!language || language.trim() === "") {
			ctx.ui.notify("Primary language is required. Aborting.", "error");
			return { ...emptyResult, cancelled: true };
		}
		stackHints.push(language.trim());
	}

	if (!frameworkOnDisk) {
		const framework = await ctx.ui.input(
			"Framework or platform? (e.g., fastapi, react, google sheets) — optional, press Enter to skip",
		);
		if (framework && framework.trim() !== "") stackHints.push(framework.trim());
	}

	// 5. Discover + match resources.
	const matched = await resolveResources(ctx, cwd, stackHints);
	if (!matched) {
		return { ...emptyResult, cancelled: true };
	}

	// 6. Plans through the standard deterministic-assembly machinery —
	//    reviewers included (their verdict contract rides the bundled
	//    template body; the tier gate decides at spawn time, not here).
	const plans = planAgentGeneration(cwd, targetRoles, matched, report);
	if (plans.length === 0) {
		ctx.ui.notify("Nothing to plan — target set resolved to 0 plans.", "info");
		return emptyResult;
	}

	// 7. Build the write-set preview. Always classify via previewRegeneration
	//    so the dialog matches what the user will actually see after write.
	const preview = previewRegeneration(
		cwd,
		plans.map((p) => p.agentName),
	);
	const previewText = renderWriteSetPreview(preview, { regenerateMode: true });

	// 8. ONE confirmation gate (Rule 7).
	const confirmed = await runSimpleConfirm(ctx, `Generate Phase ${phase} sub-agents?`, previewText);
	if (!confirmed) {
		ctx.ui.notify("Agent generation cancelled.", "info");
		return { ...emptyResult, cancelled: true };
	}

	// 9. Write — pass `regenerate: true` whenever we're touching any
	//    pre-existing generated file so the manifest check kicks in.
	const needsRegenerate = targets.regen.length > 0 || preview.overwrite.length > 0;
	const writeResult = writeGeneratedAgents(cwd, plans, { regenerate: needsRegenerate });

	// 10. Update agents.json — every generated role whose mapping still
	//     points at the built-in default (D4); custom mappings preserved.
	const mappingsAdded = updateAgentsJson(cwd, plans);

	// 11. Post-write summary + doctor hint.
	ctx.ui.notify(formatSummary(writeResult, mappingsAdded), "info");
	ctx.ui.notify("Run /velpari-doctor afterwards to verify the generator completeness section is clean.", "info");

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
		parts.push(`${mappingsAdded} mapping${mappingsAdded === 1 ? "" : "s"} added to .pi/velpari/agents.json`);
	}
	if (parts.length === 0) {
		return "No changes made.";
	}
	return `Done. ${parts.join("; ")}.`;
}

/** Parse the `--phase N` override from raw command args. Returns the
 *  phase, null when the flag is absent, or "invalid" for a malformed
 *  value (so a typo never silently falls back to auto-detect). */
export function parsePhaseArg(args: string): GenerationPhase | null | "invalid" {
	const flag = args.match(/(?:^|\s)--phase(?:\s|=|$)/);
	if (!flag) return null;
	const value = args.match(/(?:^|\s)--phase(?:=|\s)\s*(\d+)/);
	if (!value || value[1] === undefined) return "invalid";
	const n = Number(value[1]);
	if (n === 1 || n === 2 || n === 3 || n === 4) return n;
	return "invalid";
}

export function registerGenerateSubAgentsCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-generate-sub-agents", {
		description:
			"Generate project-specific sub-agents for the current pipeline phase (auto-detected from run state; --phase N overrides).",
		handler: async (args, ctx) => {
			const parsed = parsePhaseArg(args ?? "");
			if (parsed === "invalid") {
				ctx.ui.notify("Invalid --phase value. Use --phase 1, 2, 3, or 4.", "error");
				return;
			}
			await runAgentGenerator(ctx, parsed === null ? undefined : { phase: parsed });
		},
	});
}
