/**
 * Feasibility session tool (feasibility v2, Phase 3).
 *
 * The parent LLM drives the feasibility v2 flow (reuse scan → decision →
 * language selection/spikes) through conversation, but the mid-stage
 * state must live in state.json — not in chat memory — so handleApprove
 * (called by the publish tool or `/velpari-feasibility-approve`
 * fall-back) can hard-block on a pending decision or a missing
 * language. This tool is the LLM-callable bridge to the feasibility
 * helpers in core/state.ts:
 *
 *   - set-consent:     persist the web-research consent for the reuse scan
 *   - set-decision:    persist the build-vs-reuse verdict + chat summary rows
 *   - set-candidates:  persist the candidate languages for spikes
 *   - add-spike-result: append one validated spike result
 *   - select-language: persist the final language choice + who picked it
 *
 * Gated on an active feasibility stage (currentStage === "analyzing-feasibility").
 * Mirrors stages/brainstorm-state-tool.ts.
 */

import { join } from "node:path";
import { Type } from "typebox";
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadState, setFeasibilitySession, type FeasibilitySession, type RunState } from "../core/state.js";
import { validateSpikeResult, type SpikeResult } from "../core/spike.js";
import { PATHS } from "../core/constants.js";

const SELECTED_BY = ["clone", "config", "auto", "user"] as const;

export function registerFeasibilitySessionTool(pi: ExtensionAPI): void {
	const persistEntry = (state: RunState) => {
		try {
			pi.appendEntry("velpari-feasibility", snapshot(state));
		} catch {
			// Headless or read-only session — state.json already has the truth.
		}
	};

	pi.registerTool({
		name: "velpari_feasibility_session",
		label: "Update feasibility session state",
		description:
			"Update the active feasibility session during /velpari-feasibility. Actions: " +
			"set-consent (record web-research consent for the reuse scan), " +
			"set-decision (record the reuse-scan verdict: reuse/partial/build, plus chat summary rows), " +
			"set-candidates (record candidate languages for spikes), " +
			"add-spike-result (append one validated spike result), " +
			"select-language (record the final language + selectedBy: clone/config/auto/user). " +
			"Returns the updated session snapshot.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("set-consent"),
				Type.Literal("set-decision"),
				Type.Literal("set-candidates"),
				Type.Literal("add-spike-result"),
				Type.Literal("select-language"),
			]),
			consent: Type.Optional(Type.Boolean({ description: "Required for set-consent." })),
			decision: Type.Optional(
				Type.Union([Type.Literal("reuse"), Type.Literal("partial"), Type.Literal("build")], {
					description: "Required for set-decision.",
				}),
			),
			reuseSummary: Type.Optional(
				Type.Array(Type.String(), {
					description: "Optional for set-decision: short chat-summary rows.",
				}),
			),
			languageCandidates: Type.Optional(Type.Array(Type.String(), { description: "Required for set-candidates." })),
			spike: Type.Optional(
				Type.Object(
					{
						language: Type.String(),
						coreFunction: Type.String(),
						buildOk: Type.Boolean(),
						runOk: Type.Boolean(),
						notes: Type.String(),
						evidencePath: Type.String(),
						timestamp: Type.Optional(Type.String()),
					},
					{ description: "Required for add-spike-result." },
				),
			),
			selectedLanguage: Type.Optional(Type.String({ description: "Required for select-language." })),
			selectedBy: Type.Optional(
				Type.Union(
					SELECTED_BY.map((s) => Type.Literal(s)),
					{
						description: "Required for select-language.",
					},
				),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return withFileMutationQueue(join(ctx.cwd, PATHS.STATE_FILE), async () => {
				const state = loadState(ctx.cwd);
				if (!state.runId || state.currentStage !== "analyzing-feasibility") {
					return errorResult("No active feasibility stage. Run /velpari-feasibility first.");
				}

				let patch: Partial<FeasibilitySession>;
				switch (params.action) {
					case "set-consent": {
						if (typeof params.consent !== "boolean") {
							return errorResult("set-consent needs consent: boolean.");
						}
						patch = { reuseConsent: params.consent };
						break;
					}
					case "set-decision": {
						if (!params.decision) {
							return errorResult("set-decision needs decision: reuse|partial|build.");
						}
						patch = {
							decision: params.decision,
							...(params.reuseSummary ? { reuseSummary: params.reuseSummary } : {}),
						};
						break;
					}
					case "set-candidates": {
						if (!params.languageCandidates || params.languageCandidates.length === 0) {
							return errorResult("set-candidates needs a non-empty languageCandidates array.");
						}
						patch = { languageCandidates: [...new Set(params.languageCandidates)] };
						break;
					}
					case "add-spike-result": {
						if (!params.spike) {
							return errorResult("add-spike-result needs a spike object.");
						}
						const problems = validateSpikeResult(params.spike);
						if (problems.length > 0) {
							return errorResult(`Invalid spike result: ${problems.join("; ")}`);
						}
						const spike = params.spike as SpikeResult;
						const existing = state.feasibilitySession?.spikeResults ?? [];
						patch = {
							spikeResults: [...existing.filter((s) => s.language !== spike.language), spike],
						};
						break;
					}
					case "select-language": {
						if (!params.selectedLanguage?.trim() || !params.selectedBy) {
							return errorResult("select-language needs selectedLanguage and selectedBy (clone|config|auto|user).");
						}
						patch = {
							selectedLanguage: params.selectedLanguage.trim(),
							selectedBy: params.selectedBy,
						};
						break;
					}
				}

				const next = setFeasibilitySession(state, patch, ctx.cwd);
				persistEntry(next);
				return okResult(snapshot(next));
			});
		},
	});
}

/** Session snapshot returned to the LLM and mirrored via pi.appendEntry. */
function snapshot(state: RunState) {
	return {
		runId: state.runId,
		feasibilitySession: state.feasibilitySession ?? {},
	};
}

type Snapshot = ReturnType<typeof snapshot>;

function okResult(state: Snapshot) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }],
		details: state,
	};
}

function errorResult(reason: string) {
	return {
		content: [{ type: "text" as const, text: reason }],
		details: null,
		isError: true,
	};
}
