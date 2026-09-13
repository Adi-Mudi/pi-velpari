/**
 * Stage enum and transition table. The single source of truth for "where
 * is this run" in the Velpari pipeline.
 *
 * Stages flow through brainstorming → brainstormed → drafting-prd → ... →
 * handoff-ready. Each transition is triggered by a /velpari-* command.
 */

export type Stage =
	| "none"
	| "brainstorming"
	| "brainstormed"
	| "drafting-prd"
	| "drafted-prd"
	| "building-rtm"
	| "built-rtm"
	| "analyzing-feasibility"
	| "analyzed-feasibility"
	| "designing"
	| "designed"
	| "writing-pseudocode"
	| "wrote-pseudocode"
	| "planning-tests"
	| "planned-tests"
	| "analyzing-atomic-functions"
	| "analyzed-atomic-functions"
	| "ordering-development"
	| "ordered-development"
	| "finalizing-design"
	| "finalized-design"
	| "handoff-ready";

/**
 * Each transition: { from, to, command }.
 * The `command` is the /velpari-* slash command that triggers the transition.
 * `from` is the current stage; `to` is the next stage after the command.
 */
export interface StageTransition {
	from: Stage;
	to: Stage;
	command: string;
}

export const STAGE_TRANSITIONS: ReadonlyArray<StageTransition> = [
	{ from: "none", to: "brainstorming", command: "/velpari-brainstorm" },
	{ from: "brainstorming", to: "brainstormed", command: "/velpari-approve-brainstorm" },
	{ from: "brainstormed", to: "drafting-prd", command: "/velpari-prd" },
	{ from: "drafting-prd", to: "drafted-prd", command: "/velpari-approve" },
	{ from: "drafted-prd", to: "building-rtm", command: "/velpari-rtm" },
	{ from: "building-rtm", to: "built-rtm", command: "/velpari-approve" },
	{ from: "built-rtm", to: "analyzing-feasibility", command: "/velpari-feasibility" },
	// Feasibility skip: allowed only when a published feasibility doc exists
	// (enforced by the registry gate + nextCommandsFor filtering).
	{ from: "built-rtm", to: "designing", command: "/velpari-architecture-generator" },
	{ from: "analyzing-feasibility", to: "analyzed-feasibility", command: "/velpari-approve" },
	{ from: "analyzed-feasibility", to: "designing", command: "/velpari-architecture-generator" },
	{ from: "designing", to: "designed", command: "/velpari-approve" },
	{ from: "designed", to: "writing-pseudocode", command: "/velpari-pseudocode" },
	{ from: "writing-pseudocode", to: "wrote-pseudocode", command: "/velpari-approve" },
	{ from: "wrote-pseudocode", to: "planning-tests", command: "/velpari-testplan" },
	{ from: "planning-tests", to: "planned-tests", command: "/velpari-approve" },
	{ from: "planned-tests", to: "analyzing-atomic-functions", command: "/velpari-atomic-function" },
	{
		from: "analyzing-atomic-functions",
		to: "analyzed-atomic-functions",
		command: "/velpari-approve",
	},
	{ from: "analyzed-atomic-functions", to: "ordering-development", command: "/velpari-development-order" },
	{ from: "ordering-development", to: "ordered-development", command: "/velpari-approve" },
	{ from: "ordered-development", to: "handoff-ready", command: "/velpari-handoff" },
	{ from: "planned-tests", to: "finalizing-design", command: "/velpari-design" },
	{ from: "planned-tests", to: "handoff-ready", command: "/velpari-handoff" },
	{
		from: "finalizing-design",
		to: "finalized-design",
		command: "/velpari-approve",
	},
];

/**
 * Commands that may be run next from a stage (every transition whose
 * `from` is the stage). Used by hard stage gates and the per-turn
 * status injection to name the correct command in error messages.
 */
export function nextCommandsFor(
	stage: Stage,
	opts?: { feasibilitySkip?: boolean },
): string[] {
	const commands = STAGE_TRANSITIONS.filter((t) => t.from === stage)
		.filter(
			(t) =>
				opts?.feasibilitySkip ||
				!(t.from === "built-rtm" && t.to === "designing"),
		)
		.map((t) => t.command);
	return commands.length > 0 ? commands : ["/velpari-status"];
}

/**
 * In-progress stage → working-copy folder under the run dir. While a run
 * sits in one of these stages, the tool_call guard locks edit/write to
 * `<runDir>/<folder>/` and the scout spawn guard requires every subagent
 * task to name its `-report.json` report path. Completed stages and
 * "brainstorming" (handled by its own mutation guard) are absent.
 */
export const STAGE_FOLDERS: Readonly<Partial<Record<Stage, string>>> = {
	"drafting-prd": "prd",
	"building-rtm": "rtm",
	"analyzing-feasibility": "feasibility",
	designing: "design",
	"writing-pseudocode": "pseudocode",
	"planning-tests": "tests",
	"analyzing-atomic-functions": "atomic-function",
	"ordering-development": "development-order",
	"finalizing-design": "final-design",
};

/** Path helpers (Phase A stubs — full implementation in Phase E). */
export const PATHS = {
	RUN_STATE_DIR: ".IDE_Plans/velpari",
	STATE_FILE: ".IDE_Plans/velpari/state.json",
	DOCTOR_REPORT: ".IDE_Plans/velpari/doctor-report.md",
	RUNS_DIR: ".IDE_Plans/velpari/runs",
	DOC_DIR: "Doc",
	CONFIG_DIR: ".pi/velpari",
	HANDOFF_TARGET: ".pi/senai/architect-inputs.json",
} as const;
