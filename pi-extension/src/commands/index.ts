import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
 * Command composition root. Registers every command in COMMAND_NAMES
 * order (unchanged from the pre-split single-file implementation).
 */
export function registerCommands(pi: ExtensionAPI): void {
	// Stage commands (10)
	registerBrainstormCommand(pi);
	registerPrdCommand(pi);
	registerRtmCommand(pi);
	registerFeasibilityCommand(pi);
	registerArchitectureGeneratorCommand(pi);
	registerPseudocodeCommand(pi);
	registerTestplanCommand(pi);
	registerAtomicFunctionCommand(pi);
	registerDevelopmentOrderCommand(pi);
	registerFinalDesignCommand(pi);
	// Per-stage approve commands (9 — v1.6.0)
	registerPrdApproveCommand(pi);
	registerRtmApproveCommand(pi);
	registerFeasibilityApproveCommand(pi);
	registerArchitectureGeneratorApproveCommand(pi);
	registerPseudocodeApproveCommand(pi);
	registerAtomicFunctionApproveCommand(pi);
	registerTestplanApproveCommand(pi);
	registerDevelopmentOrderApproveCommand(pi);
	registerFinalDesignApproveCommand(pi);
	// Discipline commands (13 — A5 added /velpari-reconfirm)
	registerApproveBrainstormCommand(pi);
	registerStatusCommand(pi);
	registerResetCommand(pi);
	registerConfigureInputsCommand(pi);
	registerConfigureRequirementsCommand(pi);
	registerConfigureStandardsCommand(pi);
	registerGenerateSubAgentsCommand(pi);
	registerDoctorCommand(pi);
	registerHandoffCommand(pi);
	registerDesignLoggingCommand(pi);
	registerReconfirmCommand(pi);
	// Agent commands (2 — one file registers both)
	registerAgentCommands(pi);
	// Wrapper command (1)
	registerPrdRtmCommand(pi);
	// View commands (8 — v1.4.0 added /velpari-show-logging)
	registerShowBrainstormCommand(pi);
	registerShowPrdCommand(pi);
	registerShowRtmCommand(pi);
	registerShowFeasibilityCommand(pi);
	registerShowDesignCommand(pi);
	registerShowPseudocodeCommand(pi);
	registerShowTestplanCommand(pi);
	registerShowLoggingCommand(pi);
	// View/ops — Phase 5 on-demand DB export
	registerExportCommand(pi);
	// View/ops — Phase 6 backfill import (43rd command)
	registerBackfillCommand(pi);
	// Ops — Phase 10 portfolio registry (44th command)
	registerPortfolioCommand(pi);
	// Ops — Phase 11 one-time migration (45th command, §15.6)
	registerMigrateCommand(pi);
	// Ops — versioning, locking & recovery (Phases 2/4/6; 46th–52nd commands)
	registerDbResetCommand(pi);
	registerFreezeCommand(pi);
	registerTombstoneCommand(pi);
	registerRollbackCommand(pi);
	registerRetentionPruneCommand(pi);
	registerMergeBackCommand(pi);
	// Ops — v1.2 revision status view + restore (52nd command)
	registerRevisionStatusCommand(pi);
}
