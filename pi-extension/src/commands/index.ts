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
import { registerApproveCommand } from "./approve.js";
import { registerApproveBrainstormCommand } from "./approve-brainstorm.js";
import { registerStatusCommand } from "./status.js";
import { registerResetCommand } from "./reset.js";
import { registerConfigureInputsCommand } from "./configure-inputs.js";
import { registerConfigureRequirementsCommand } from "./configure-requirements.js";
import { registerAgentCommands } from "./configure-agents.js";
import { registerDoctorCommand } from "./doctor.js";
import { registerHandoffCommand } from "./handoff.js";
import { registerPrdRtmCommand } from "./prd-rtm.js";
import { registerShowBrainstormCommand } from "./show-brainstorm.js";
import { registerShowPrdCommand } from "./show-prd.js";
import { registerShowRtmCommand } from "./show-rtm.js";
import { registerShowFeasibilityCommand } from "./show-feasibility.js";
import { registerShowDesignCommand } from "./show-design.js";
import { registerShowPseudocodeCommand } from "./show-pseudocode.js";
import { registerShowTestplanCommand } from "./show-testplan.js";

/**
 * All 28 commands. Adds /velpari-design (final-design consolidation,
 * plan 3) on top of the 27 stage + discipline + wrapper + view commands.
 *
 * Wiring only — each command lives in its own file in this folder
 * (official orchestrator rule: one file per command, thin handlers).
 */
export const COMMAND_NAMES = [
	// Stage commands (9)
	"velpari-brainstorm",
	"velpari-prd",
	"velpari-rtm",
	"velpari-feasibility",
	"velpari-architecture-generator",
	"velpari-pseudocode",
	"velpari-testplan",
	"velpari-atomic-function",
	"velpari-development-order",
	"velpari-design",
	// Discipline commands (10)
	"velpari-approve",
	"velpari-approve-brainstorm",
	"velpari-status",
	"velpari-reset",
	"velpari-configure-inputs",
	"velpari-configure-requirements",
	"velpari-configure-agents",
	"velpari-agents",
	"velpari-doctor",
	"velpari-handoff",
	// Wrapper command (1)
	"velpari-prd-rtm",
	// View commands (7)
	"velpari-show-brainstorm",
	"velpari-show-prd",
	"velpari-show-rtm",
	"velpari-show-feasibility",
	"velpari-show-design",
	"velpari-show-pseudocode",
	"velpari-show-testplan",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

/**
 * Command composition root. Registers every command in COMMAND_NAMES
 * order (unchanged from the pre-split single-file implementation).
 */
export function registerCommands(pi: ExtensionAPI): void {
	// Stage commands (9)
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
	// Discipline commands (8)
	registerApproveCommand(pi);
	registerApproveBrainstormCommand(pi);
	registerStatusCommand(pi);
	registerResetCommand(pi);
	registerConfigureInputsCommand(pi);
	registerConfigureRequirementsCommand(pi);
	registerDoctorCommand(pi);
	registerHandoffCommand(pi);
	// Agent commands (2 — one file registers both)
	registerAgentCommands(pi);
	// Wrapper command (1)
	registerPrdRtmCommand(pi);
	// View commands (7)
	registerShowBrainstormCommand(pi);
	registerShowPrdCommand(pi);
	registerShowRtmCommand(pi);
	registerShowFeasibilityCommand(pi);
	registerShowDesignCommand(pi);
	registerShowPseudocodeCommand(pi);
	registerShowTestplanCommand(pi);
}
