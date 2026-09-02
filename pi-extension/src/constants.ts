/**
 * Stage enum and transition table. The single source of truth for "where
 * is this run" in the Velpari pipeline.
 *
 * Stages flow through discussing → discussed → drafting-prd → ... →
 * handoff-ready. Each transition is triggered by a /velpari-* command.
 */

export type Stage =
	| "none"
	| "discussing"
	| "discussed"
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
	{ from: "none", to: "discussing", command: "/velpari-discuss" },
	{ from: "discussing", to: "discussed", command: "/velpari-approve-discuss" },
	{ from: "discussed", to: "drafting-prd", command: "/velpari-prd" },
	{ from: "drafting-prd", to: "drafted-prd", command: "/velpari-approve" },
	{ from: "drafted-prd", to: "building-rtm", command: "/velpari-rtm" },
	{ from: "building-rtm", to: "built-rtm", command: "/velpari-approve" },
	{ from: "built-rtm", to: "analyzing-feasibility", command: "/velpari-feasibility" },
	{ from: "analyzing-feasibility", to: "analyzed-feasibility", command: "/velpari-approve" },
	{ from: "analyzed-feasibility", to: "designing", command: "/velpari-design" },
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
	{ from: "planned-tests", to: "handoff-ready", command: "/velpari-handoff" },
];

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
