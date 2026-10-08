import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runCommandPreflight } from "../doctor/preflight.js";
import { registerBrainstormCommand } from "./brainstorm.js";
import { registerPrdCommand } from "./prd.js";
import { registerRtmCommand } from "./rtm.js";
import { registerFeasibilityCommand } from "./feasibility.js";
import { registerArchitectureGeneratorCommand } from "./architecture-generator.js";
import { registerPseudocodeCommand } from "./pseudocode.js";
import { registerTestplanCommand } from "./testplan.js";
import { registerAtomicFunctionCommand } from "./atomic-function.js";
import { registerDevelopmentOrderCommand } from "./development-order.js";
import { registerFinalDesignCommand } from "./final-design.js";
import { registerPrdApproveCommand } from "./approve-prd.js";
import { registerRtmApproveCommand } from "./approve-rtm.js";
import { registerFeasibilityApproveCommand } from "./approve-feasibility.js";
import { registerArchitectureGeneratorApproveCommand } from "./approve-architecture-generator.js";
import { registerPseudocodeApproveCommand } from "./approve-pseudocode.js";
import { registerAtomicFunctionApproveCommand } from "./approve-atomic-function.js";
import { registerTestplanApproveCommand } from "./approve-testplan.js";
import { registerDevelopmentOrderApproveCommand } from "./approve-development-order.js";
import { registerFinalDesignApproveCommand } from "./approve-final-design.js";
import { registerApproveBrainstormCommand } from "./approve-brainstorm.js";
import { registerStatusCommand } from "./status.js";
import { registerResetCommand } from "./reset.js";
import { registerConfigureInputsCommand } from "./configure-inputs.js";
import { registerConfigureRequirementsCommand } from "./configure-requirements.js";
import { registerConfigureStandardsCommand } from "./configure-standards.js";
import { registerAgentCommands } from "./configure-agents.js";
import { registerGenerateSubAgentsCommand } from "./generate-sub-agents.js";
import { registerDoctorCommand } from "./doctor.js";
import { registerHandoffCommand } from "./handoff.js";
import { registerReconfirmCommand } from "./reconfirm.js";
import { registerDesignLoggingCommand } from "./design-logging.js";
import { registerPrdRtmCommand } from "./prd-rtm.js";
import { registerShowBrainstormCommand } from "./show-brainstorm.js";
import { registerShowPrdCommand } from "./show-prd.js";
import { registerShowRtmCommand } from "./show-rtm.js";
import { registerShowFeasibilityCommand } from "./show-feasibility.js";
import { registerShowDesignCommand } from "./show-design.js";
import { registerShowPseudocodeCommand } from "./show-pseudocode.js";
import { registerShowTestplanCommand } from "./show-testplan.js";
import { registerShowLoggingCommand } from "./show-logging.js";
import { registerExportCommand } from "./export.js";
import { registerBackfillCommand } from "./backfill.js";
import { registerPortfolioCommand } from "./portfolio.js";
import { registerMigrateCommand } from "./migrate.js";
// Ops — versioning, locking & recovery surface (Phases 2/4/6)
import { registerDbResetCommand } from "./db-reset.js";
import { registerFreezeCommand } from "./freeze.js";
import { registerTombstoneCommand } from "./tombstone.js";
import { registerRollbackCommand } from "./rollback.js";
import { registerRetentionPruneCommand } from "./retention-prune.js";
import { registerMergeBackCommand } from "./merge-back.js";
import { registerRevisionStatusCommand } from "./revision-status.js";

/**
 * All 52 user-facing commands (Phase I reconciliation — the canonical
 * registry; no per-phase blocks remain). v1.6.0 replaced the generic
 * `the publish tool` command (which the parent LLM invokes via the
 * `velpari_stage_publish` tool during preview-yes) with 9 per-stage
 * `/velpari-<stage>-approve` fall-back commands for stages 2–10. Brainstorm
 * keeps its bespoke `/velpari-approve-brainstorm` chain.
 * Later additions (history): /velpari-design-logging + /velpari-show-logging
 * (v1.4.0), /velpari-generate-sub-agents (Phase 8), /velpari-reconfirm (A5),
 * /velpari-export (42nd), /velpari-backfill (43rd), /velpari-portfolio
 * (44th), /velpari-migrate-store (45th), then the versioning/locking/
 * recovery surface — /velpari-db-reset, /velpari-freeze, /velpari-tombstone,
 * /velpari-rollback (46th–49th), /velpari-retention-prune (50th),
 * /velpari-merge-back (51st),
 * /velpari-revision-status (52nd).
 *
 * /velpari-final-design (renamed from /velpari-html-design on 2026-09-14;
 * today produces Doc/design/final-design_<project>.md, not actual HTML) and
 * /velpari-configure-standards (added in Phase 3) live alongside it.
 *
 * Wiring only — each command lives in its own file in this folder
 * (official orchestrator rule: one file per command, thin handlers).
 */
export const COMMAND_NAMES = [
	// Stage commands (10)
	"velpari-brainstorm",
	"velpari-prd",
	"velpari-rtm",
	"velpari-feasibility",
	"velpari-architecture-generator",
	"velpari-pseudocode",
	"velpari-testplan",
	"velpari-atomic-function",
	"velpari-development-order",
	"velpari-final-design",
	// Per-stage approve commands (9 — v1.6.0; replaced generic the publish tool)
	"velpari-prd-approve",
	"velpari-rtm-approve",
	"velpari-feasibility-approve",
	"velpari-architecture-generator-approve",
	"velpari-pseudocode-approve",
	"velpari-atomic-function-approve",
	"velpari-testplan-approve",
	"velpari-development-order-approve",
	"velpari-final-design-approve",
	// Discipline commands (13 — A5 added /velpari-reconfirm)
	"velpari-approve-brainstorm",
	"velpari-status",
	"velpari-reset",
	"velpari-configure-inputs",
	"velpari-configure-requirements",
	"velpari-configure-standards",
	"velpari-configure-agents",
	"velpari-agents",
	"velpari-generate-sub-agents",
	"velpari-doctor",
	"velpari-handoff",
	"velpari-design-logging",
	// Discipline — A5 re-confirm path (41st command)
	"velpari-reconfirm",
	// Wrapper command (1)
	"velpari-prd-rtm",
	// View commands (8 — v1.4.0 added /velpari-show-logging)
	"velpari-show-brainstorm",
	"velpari-show-prd",
	"velpari-show-rtm",
	"velpari-show-feasibility",
	"velpari-show-design",
	"velpari-show-pseudocode",
	"velpari-show-testplan",
	"velpari-show-logging",
	// View/ops — Phase 5 on-demand DB export (42nd command)
	"velpari-export",
	// View/ops — Phase 6 backfill import (43rd command)
	"velpari-backfill",
	// Ops — Phase 10 portfolio registry (44th command)
	"velpari-portfolio",
	// Ops — Phase 11 one-time migration (45th command, §15.6)
	"velpari-migrate-store",
	// Ops — versioning, locking & recovery (Phases 2/4/6; 46th–52nd commands)
	"velpari-db-reset", // F23 — DB-only reset (draft rows of one run)
	"velpari-freeze", // N4 — freeze/unfreeze with a mandatory unfreeze reason
	"velpari-tombstone", // F16 — delete-as-modification (withdraw a revision)
	"velpari-rollback", // F21 — rollback-as-new-revision
	"velpari-retention-prune", // N7 — keep-last-N retention cleanup (confirmed + audited)
	"velpari-merge-back", // N12 — guided merge-back (N12/G-4)
	"velpari-revision-status", // v1.2 B6 — status view + withdrawn→published restore (52nd)
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

/**
 * Command-start preflight classification — Q4 locked ruling, the SINGLE
 * SOURCE OF TRUTH (replaces the old 3-command exempt set).
 *
 * - "wrapped" (22): mutate store/Doc/.pi/git → run command-start preflight.
 * - "exempt-stage" (11): stage-start preflight already runs (runStage via
 *   `runStagePreflight`) — wrapping would double-gate.
 * - "exempt-recovery" (8): FIX broken state — preflight would hard-stop on
 *   the very corruption they repair (e.g. configure-inputs rebuilds a
 *   corrupt files.json that preflight blocks on; doctor re-runs the
 *   auditor itself).
 * - "exempt-view" (11): pure readers.
 *
 * `satisfies Record<CommandName, CommandClass>` is the build-time guard: a
 * future 53rd command with no class FAILS tsc.
 */
export type CommandClass = "wrapped" | "exempt-stage" | "exempt-recovery" | "exempt-view";

export const COMMAND_PREFLIGHT_CLASS = {
	// wrapped (22 — mutate store/Doc/.pi/git): run command-start preflight
	"velpari-prd-approve": "wrapped",
	"velpari-rtm-approve": "wrapped",
	"velpari-feasibility-approve": "wrapped",
	"velpari-architecture-generator-approve": "wrapped",
	"velpari-pseudocode-approve": "wrapped",
	"velpari-atomic-function-approve": "wrapped",
	"velpari-testplan-approve": "wrapped",
	"velpari-development-order-approve": "wrapped",
	"velpari-final-design-approve": "wrapped",
	"velpari-approve-brainstorm": "wrapped",
	"velpari-generate-sub-agents": "wrapped",
	"velpari-handoff": "wrapped",
	"velpari-design-logging": "wrapped",
	"velpari-reconfirm": "wrapped",
	"velpari-portfolio": "wrapped",
	"velpari-migrate-store": "exempt-recovery",
	"velpari-db-reset": "wrapped",
	"velpari-freeze": "wrapped",
	"velpari-tombstone": "wrapped",
	"velpari-rollback": "wrapped",
	"velpari-retention-prune": "wrapped",
	"velpari-merge-back": "wrapped",
	// exempt-stage (11 — stage-start preflight already runs)
	"velpari-brainstorm": "exempt-stage",
	"velpari-prd": "exempt-stage",
	"velpari-rtm": "exempt-stage",
	"velpari-feasibility": "exempt-stage",
	"velpari-architecture-generator": "exempt-stage",
	"velpari-pseudocode": "exempt-stage",
	"velpari-testplan": "exempt-stage",
	"velpari-atomic-function": "exempt-stage",
	"velpari-development-order": "exempt-stage",
	"velpari-final-design": "exempt-stage",
	"velpari-prd-rtm": "exempt-stage",
	// exempt-recovery (8 — FIX broken state; preflight would block the repair)
	"velpari-reset": "exempt-recovery",
	"velpari-configure-inputs": "exempt-recovery",
	"velpari-configure-requirements": "exempt-recovery",
	"velpari-configure-standards": "exempt-recovery",
	"velpari-configure-agents": "exempt-recovery",
	"velpari-agents": "exempt-view",
	"velpari-backfill": "exempt-recovery",
	"velpari-doctor": "exempt-recovery",
	// exempt-view (11 — pure readers)
	"velpari-status": "exempt-view",
	"velpari-show-brainstorm": "exempt-view",
	"velpari-show-prd": "exempt-view",
	"velpari-show-rtm": "exempt-view",
	"velpari-show-feasibility": "exempt-view",
	"velpari-show-design": "exempt-view",
	"velpari-show-pseudocode": "exempt-view",
	"velpari-show-testplan": "exempt-view",
	"velpari-show-logging": "exempt-view",
	"velpari-export": "exempt-view",
	"velpari-revision-status": "wrapped",
} as const satisfies Record<CommandName, CommandClass>;

/**
 * Marker stamped on every gated ("wrapped") registration — read back by
 * the observed-set registry-coverage test in test/commands/index.test.ts.
 */
export const PREFLIGHT_WRAPPED_MARK = Symbol("velpari.preflight.wrapped");

/**
 * Class lookup for registration; an unknown name defaults to "wrapped"
 * (fail-safe: gate anyway).
 * @param name - Registered command name.
 * @returns {CommandClass} The preflight class for `name`.
 */
function commandClass(name: string): CommandClass {
	return (COMMAND_PREFLIGHT_CLASS as Record<string, CommandClass | undefined>)[name] ?? "wrapped";
}

/**
 * Command composition root + registration-time preflight interception (E#3).
 * Registers every command in COMMAND_NAMES order (unchanged from the
 * pre-split single-file implementation).
 *
 * `Object.create(pi)` intercepts only `registerCommand`; every other member
 * passes straight through to the real API. "wrapped"-class handlers gate
 * behind `runCommandPreflight` (mode `command-start`); exempt classes
 * register unchanged. Unknown names (not in COMMAND_NAMES) fail closed → gated.
 *
 * Design note — E#4 investigation (v1.3): every one of the 52 commands
 * registers through this composition root (`src/index.ts:39` is the only
 * caller; each `registerXCommand` registers exactly one COMMAND_NAMES
 * entry), the agent configs are markdown agent files with no code-level
 * command surface, and Pi's ExtensionAPI hands the extension the API
 * directly (no per-agent clone/documented intercept surface) — so
 * intercepting here covers 100% of the command list with one wrapper.
 *
 * Reconciliation (Q4): N22 says preflight at "every command/stage start";
 * the Q4 ruling narrows it — readers/recovery exempt (table above).
 * Preflight stays milliseconds (master-outline risk #2): heavy checks
 * (hash chain, digest, G4 integrity) run at publish/stage-start only,
 * never in command-start preflight.
 */
export function registerCommands(pi: ExtensionAPI): void {
	const gated: ExtensionAPI = Object.create(pi) as ExtensionAPI;
	gated.registerCommand = ((name: string, def: Parameters<ExtensionAPI["registerCommand"]>[1]) => {
		const defToRegister =
			commandClass(name) === "wrapped"
				? {
						...def,
						[PREFLIGHT_WRAPPED_MARK]: true,
						handler: async (args: unknown, ctx: Parameters<NonNullable<typeof def.handler>>[1]) => {
							const outcome = await runCommandPreflight(`/${name}`, ctx, pi, ctx.cwd);
							if (!outcome.continue) return;
							return def.handler(args as never, ctx);
						},
					}
				: def;
		pi.registerCommand(name, defToRegister);
	}) as ExtensionAPI["registerCommand"];

	// Stage commands (10)
	registerBrainstormCommand(gated);
	registerPrdCommand(gated);
	registerRtmCommand(gated);
	registerFeasibilityCommand(gated);
	registerArchitectureGeneratorCommand(gated);
	registerPseudocodeCommand(gated);
	registerTestplanCommand(gated);
	registerAtomicFunctionCommand(gated);
	registerDevelopmentOrderCommand(gated);
	registerFinalDesignCommand(gated);
	// Per-stage approve commands (9 — v1.6.0)
	registerPrdApproveCommand(gated);
	registerRtmApproveCommand(gated);
	registerFeasibilityApproveCommand(gated);
	registerArchitectureGeneratorApproveCommand(gated);
	registerPseudocodeApproveCommand(gated);
	registerAtomicFunctionApproveCommand(gated);
	registerTestplanApproveCommand(gated);
	registerDevelopmentOrderApproveCommand(gated);
	registerFinalDesignApproveCommand(gated);
	// Discipline commands (13 — A5 added /velpari-reconfirm)
	registerApproveBrainstormCommand(gated);
	registerStatusCommand(gated);
	registerResetCommand(gated);
	registerConfigureInputsCommand(gated);
	registerConfigureRequirementsCommand(gated);
	registerConfigureStandardsCommand(gated);
	registerGenerateSubAgentsCommand(gated);
	registerDoctorCommand(gated);
	registerHandoffCommand(gated);
	registerDesignLoggingCommand(gated);
	registerReconfirmCommand(gated);
	// Agent commands (2 — one file registers both)
	registerAgentCommands(gated);
	// Wrapper command (1)
	registerPrdRtmCommand(gated);
	// View commands (8 — v1.4.0 added /velpari-show-logging)
	registerShowBrainstormCommand(gated);
	registerShowPrdCommand(gated);
	registerShowRtmCommand(gated);
	registerShowFeasibilityCommand(gated);
	registerShowDesignCommand(gated);
	registerShowPseudocodeCommand(gated);
	registerShowTestplanCommand(gated);
	registerShowLoggingCommand(gated);
	// View/ops — Phase 5 on-demand DB export
	registerExportCommand(gated);
	// View/ops — Phase 6 backfill import (43rd command)
	registerBackfillCommand(gated);
	// Ops — Phase 10 portfolio registry (44th command)
	registerPortfolioCommand(gated);
	// Ops — Phase 11 one-time migration (45th command, §15.6)
	registerMigrateCommand(gated);
	// Ops — versioning, locking & recovery (Phases 2/4/6; 46th–52nd commands)
	registerDbResetCommand(gated);
	registerFreezeCommand(gated);
	registerTombstoneCommand(gated);
	registerRollbackCommand(gated);
	registerRetentionPruneCommand(gated);
	registerMergeBackCommand(gated);
	// Ops — v1.2 revision status view + restore (52nd command)
	registerRevisionStatusCommand(gated);
}
