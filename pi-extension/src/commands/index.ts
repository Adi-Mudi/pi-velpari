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

/**
 * All 41 user-facing commands. v1.6.0 replaced the generic
 * `the publish tool` command (which the parent LLM invokes via the
 * `velpari_stage_publish` tool during preview-yes) with 9 per-stage
 * `/velpari-<stage>-approve` fall-back commands for stages 2–10. Brainstorm
 * keeps its bespoke `/velpari-approve-brainstorm` chain. The previous
 * 30-command baseline came from `/velpari-generate-sub-agents` (Phase 8)
 * on top of the 29-command baseline (see CHANGELOG.md for the v1.0
 * entry).
 * 9 per-stage /velpari-<stage>-approve commands (manual recovery only).
 * v1.4.0 added /velpari-design-logging (discipline) and
 * /velpari-show-logging (view). The previous 30-command baseline came
 * from /velpari-generate-sub-agents (Phase 8) on top of the
 * 29-command baseline (see CHANGELOG.md for the v1.0 entry).
 * A5 added /velpari-reconfirm (the 41st command — stale-set re-confirm
 * path, spec 02:92-100).
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
}
