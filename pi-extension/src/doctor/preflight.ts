/**
 * Fast preflight runner — Phase C (G1), Doctor v2.
 *
 * Fires BEFORE `loadState` in `runStage`, so a broken config, an
 * unreadable state file, a binding mismatch, or a lost stage-flag
 * advance surfaces with a fix path instead of mid-command. The decision
 * table in the plan (Subphase 4.1) is the unit-test oracle:
 *
 *   1/2. session gate mismatch/conflict → `hardStop` (N18 / stop+ask),
 *        NO fix offered (C+A rule: the binding fix is "restart there").
 *   3.   `--velpari-skip-doctor` → session gate only, then pass.
 *   4.   files.json JSON-invalid → blocking `config-restore-git` when the
 *        file is git-tracked (auto), else manual `config-unreadable`.
 *   5.   files.json invalid shape → blocking, manual (`/velpari-configure-inputs`).
 *   6.   state.json unreadable → blocking, manual (names the file).
 *   7.   bookkeeping drift (evidence) → blocking, auto `bookkeeping-advance`.
 *   8.   scaffold missing → NON-blocking (`info`), auto `scaffold-missing`.
 *   9.   clean → pass.
 *   10.  Non-interactive degrade is handled by `runStagePreflight`
 *        (notify + `continue: false` for blocking rows — no hang).
 *
 * FAST — a ms budget, no heavy checks (no store digest walk, no
 * hash-chain verification, no full doctor run). Read-only commands never
 * call this; only stage starts do. **No static import of
 * `doctor/index.ts`** (the fix-dispatch dynamic-import precedent) — that
 * would create an import cycle with `stages/registry.ts`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticItem } from "./_types.js";
import { PATHS } from "../core/constants.js";
import { sessionGateVerdict } from "../core/plan-binding.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { loadState } from "../core/state.js";
import { detectBookkeepingDrift, scaffoldMissingPaths } from "../ops/self-heal.js";
import { suggestionFor } from "./checks/fix-suggestions.js";
import { runFixFlow, type PreflightUi } from "./fix-flow.js";

/** Where the preflight was triggered from (only stage starts today). */
export type PreflightMode = "stage-start" | "command-start";

/** One preflight finding: the diagnostic item + how it can be fixed. */
export interface PreflightFinding {
	/** Blocking findings stop the command until repaired or aborted. */
	blocking: boolean;
	/** The FIX fingerprint (whitelist fn name for auto rows; a marker for manual rows). */
	fingerprint: string;
	/** The rendered diagnostic item (status/message/details/suggestion). */
	item: DiagnosticItem;
	/** True when the confirm-gated batch can repair this without a manual command. */
	autoFixable: boolean;
}

/** Result of one preflight run (timing on EVERY result — the ms budget). */
export interface PreflightResult {
	/** True when nothing blocks (hard stops count as not-ok). */
	ok: boolean;
	/** N18 hard-stop text (session gate rows 1/2) or `null`. */
	hardStop: string | null;
	/** Findings in decision-table order (rows 4–8); empty for hard stops. */
	findings: PreflightFinding[];
	/** Wall-clock ms measured from before the first read. */
	durationMs: number;
}

/** Options for one preflight run. */
export interface PreflightOptions {
	/** The command being gated (e.g. `/velpari-prd`) — for messages/tests. */
	command: string;
	/** Trigger context — stage start today, command start reserved. */
	mode: PreflightMode;
	/** `--velpari-skip-doctor` flag value (row 3). */
	skipDoctor?: boolean;
}

/**
 * Is `rel` tracked by git? (Row 4: `config-restore-git` only auto-runs
 * when the blob exists at HEAD.)
 * @param {string} cwd - Project root.
 * @param {string} rel - Repo-relative path to probe.
 * @returns {boolean} True when git has the path tracked (fail-soft false).
 */
function gitTracked(cwd: string, rel: string): boolean {
	try {
		const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", rel], {
			cwd,
			encoding: "utf8",
		});
		return r.status === 0;
	} catch {
		return false;
	}
}

/**
 * The fast preflight — read-only probes + the decision table above.
 * Never throws: an internal probe error degrades to a non-blocking
 * `preflight-degraded` info finding (fail-open, doctor-always-renders).
 * @param {string} cwd - Project root.
 * @param {PreflightOptions} opts - Command/mode/skip-flag context.
 * @returns {PreflightResult} Findings + hard stop + duration.
 */
export function runPreflight(cwd: string, opts: PreflightOptions): PreflightResult {
	const t0 = performance.now();
	/**
	 * Stamp `durationMs` (measured from `t0`) onto one result and return it.
	 * @param {Omit<PreflightResult, "durationMs">} partial - Result fields without the timing stamp.
	 * @returns {PreflightResult} The complete result including elapsed ms.
	 */
	const done = (partial: Omit<PreflightResult, "durationMs">): PreflightResult => ({
		...partial,
		durationMs: performance.now() - t0,
	});
	try {
		// Rows 1–2 — session gate first; NO fix offered (C+A rule).
		const verdict = sessionGateVerdict(cwd);
		if (verdict.kind === "mismatch" || verdict.kind === "conflict") {
			return done({ ok: false, hardStop: verdict.reason, findings: [] });
		}

		// Row 3 — flag honored after the session gate (rows 1–2 still apply).
		if (opts.skipDoctor === true) {
			return done({ ok: true, hardStop: null, findings: [] });
		}

		const findings: PreflightFinding[] = [];

		// Row 4/5 — files.json readability, then shape.
		const configPath = join(cwd, PATHS.STATE_FILE.replace("state.json", "files.json"));
		if (existsSync(configPath)) {
			let parseOk = true;
			try {
				JSON.parse(readFileSync(configPath, "utf8"));
			} catch {
				parseOk = false;
			}
			if (!parseOk) {
				// Row 4 — tracked → auto restore; else manual (no restore source).
				const tracked = gitTracked(cwd, ".pi/velpari/files.json");
				findings.push({
					blocking: true,
					fingerprint: tracked ? "config-restore-git" : "config-unreadable",
					autoFixable: tracked,
					item: {
						status: "error",
						message: `config-unreadable: .pi/velpari/files.json is not valid JSON`,
						details: [tracked ? "git: tracked (HEAD restore available)" : "git: no HEAD version to restore"],
						suggestion: tracked ? suggestionFor("config-restore-git") : suggestionFor("config-unreadable"),
					},
				});
			} else {
				// Row 5 — validate the DEFAULTS-MERGED config (the same object
				// `runStage` sees): raw files.json may legitimately omit the
				// arrays, which `defaultConfig()` fills.
				const cfg = loadFilesConfig(cwd);
				const valid = validateFilesConfig(cfg);
				const hasProject = typeof cfg.projectName === "string" && cfg.projectName.length > 0;
				if (!valid || !hasProject) {
					// Row 5 — shape is wrong: rebuild via configure, never auto.
					findings.push({
						blocking: true,
						fingerprint: "config-invalid",
						autoFixable: false,
						item: {
							status: "error",
							message: `config-invalid: .pi/velpari/files.json parses but has no usable projectName`,
							suggestion: suggestionFor("config-invalid"),
						},
					});
				}
			}
		}

		// Row 6 — state.json readability (loadState JSON.parses bare → can throw).
		const statePath = join(cwd, PATHS.STATE_FILE);
		let stateReadable = true;
		if (existsSync(statePath)) {
			try {
				loadState(cwd);
			} catch (err) {
				stateReadable = false;
				findings.push({
					blocking: true,
					fingerprint: "state-unreadable",
					autoFixable: false,
					item: {
						status: "error",
						message: `state-unreadable: ${PATHS.STATE_FILE} cannot be read (${(err as Error)?.message ?? String(err)})`,
						suggestion: `Repair the JSON in \`${PATHS.STATE_FILE}\` by hand (or delete it to start a fresh run with /velpari-brainstorm). No auto-fix: run state is never guessed.`,
					},
				});
			}
		}

		// Row 7 — bookkeeping drift (evidence-gated; skips unreadable state).
		if (stateReadable) {
			for (const drift of detectBookkeepingDrift(cwd)) {
				findings.push({
					blocking: true,
					fingerprint: "bookkeeping-advance",
					autoFixable: true,
					item: {
						status: "error",
						message: `bookkeeping-drift: stage flag sits on ${drift.from} but ${drift.command} already published (${drift.evidence})`,
						details: [`${drift.from} → ${drift.to} via ${drift.command}`],
						suggestion: suggestionFor("bookkeeping-advance"),
					},
				});
			}
		}

		// Row 8 — scaffold missing (NON-blocking info; batch-included).
		const missing = scaffoldMissingPaths(cwd);
		if (missing.length > 0) {
			findings.push({
				blocking: false,
				fingerprint: "scaffold-missing",
				autoFixable: true,
				item: {
					status: "info",
					message: `scaffold-missing: ${missing.length} standard path(s) absent`,
					details: missing,
					suggestion: suggestionFor("scaffold-missing"),
				},
			});
		}

		// Row 9 — clean (no blocking findings).
		const blocking = findings.some((f) => f.blocking);
		return done({ ok: !blocking, hardStop: null, findings });
	} catch (err) {
		// Fail-open: an internal preflight error never hard-stops the run.
		return done({
			ok: true,
			hardStop: null,
			findings: [
				{
					blocking: false,
					fingerprint: "preflight-degraded",
					autoFixable: false,
					item: {
						status: "info",
						message: `preflight-degraded: probe failed (${(err as Error)?.message ?? String(err)}) — preflight passed fail-open`,
					},
				},
			],
		});
	}
}

/** Structural view of the command context the preflight needs (G2b UI). */
export interface PreflightCtx {
	/** The Pi UI primitives — notify always; select/confirm absent in tests/mocks. */
	ui: PreflightUi;
}

/** Structural view of the extension API the preflight needs (flags only). */
export interface PreflightPi {
	/** Flag lookup (the `--velpari-skip-doctor` opt-out, row 3). */
	getFlag?(name: string): unknown;
}

/**
 * Orchestrate one stage-start preflight: session-gate hard stop →
 * `runPreflight` → chat fix flow (interactive) or notify-and-stop
 * (non-interactive, row 10) → caller re-checks via the flow's reRun.
 * Max ONE fix-flow attempt per command start (no infinite loop).
 * @param {string} stageKey - Stage key being started (e.g. `prd`).
 * @param {PreflightCtx} ctx - Command context (ui primitives).
 * @param {PreflightPi} pi - Extension API (flag lookup only).
 * @param {string} cwd - Project root.
 * @returns {Promise<{ continue: boolean }>} True = proceed into `runStage`.
 */
/**
 * Shared preflight flow body — stage starts and command starts run the
 * SAME decision table (v1.3 extraction; max ONE fix-flow attempt per
 * call, B#7). The only mode difference lives in `opts.mode` + `label`.
 * @param label - Stop-message prefix (`Stage "prd"` / `Command "/velpari-handoff"`).
 * @param opts - Preflight options (command, mode, skipDoctor).
 * @param ctx - Command context (ui primitives).
 * @param cwd - Project root.
 * @returns True = proceed into the caller's handler.
 */
async function runPreflightFlow(
	label: string,
	opts: PreflightOptions,
	ctx: PreflightCtx,
	cwd: string,
): Promise<{ continue: boolean }> {
	const result = runPreflight(cwd, opts);

	// Rows 1–2 — hard stop, no fix offered.
	if (result.hardStop !== null) {
		ctx.ui.notify(result.hardStop, "error");
		return { continue: false };
	}
	// Rows 3/9 — pass through (row 8 info findings pass too).
	if (result.ok) {
		return { continue: true };
	}

	const blocking = result.findings.filter((f) => f.blocking);

	// Row 10 — non-interactive degrade: notify + stop, never hang.
	if (typeof ctx.ui.select !== "function") {
		for (const f of result.findings) {
			ctx.ui.notify(f.item.message, f.blocking ? "error" : "info");
		}
		return { continue: false };
	}

	// Interactive — resolve projectName for the remediates (fail-soft "").
	let projectName = "";
	try {
		const cfg = loadFilesConfig(cwd);
		if (validateFilesConfig(cfg)) projectName = cfg.projectName;
	} catch {
		/* unreadable config — remediate fns short-circuit on "" */
	}

	const flow = await runFixFlow({
		ui: ctx.ui,
		cwd,
		projectName,
		source: { kind: "preflight", findings: result.findings },
		reRun: async () => {
			const fresh = runPreflight(cwd, opts);
			const actionable = fresh.findings.filter((f) => f.blocking || f.autoFixable).length;
			return { ok: fresh.ok && fresh.hardStop === null, actionableCount: actionable };
		},
	});

	if (flow.action === "fixed" && flow.remainingManual === 0) {
		return { continue: true };
	}
	if (flow.action === "no-actionables") {
		// Nothing to fix but something blocked — stop rather than loop.
		for (const f of blocking) ctx.ui.notify(`${f.item.message} — ${f.item.suggestion ?? ""}`, "error");
		return { continue: false };
	}
	// aborted (user) or fixed-with-remainders — stop with the reason.
	const reason = flow.action === "aborted" ? flow.reason : `${flow.remainingManual} item(s) still need manual fixes`;
	ctx.ui.notify(`${label} stopped by preflight: ${reason}`, "warning");
	if (flow.action === "fixed") {
		for (const f of blocking) {
			if (!f.autoFixable) ctx.ui.notify(`${f.item.message} — ${f.item.suggestion ?? ""}`, "error");
		}
	}
	return { continue: false };
}

export async function runStagePreflight(
	stageKey: string,
	ctx: PreflightCtx,
	pi: PreflightPi,
	cwd: string,
): Promise<{ continue: boolean }> {
	return runPreflightFlow(
		`Stage "${stageKey}"`,
		{
			command: `/velpari-${stageKey}`,
			mode: "stage-start",
			skipDoctor: pi.getFlag?.("velpari-skip-doctor") === true,
		},
		ctx,
		cwd,
	);
}

/**
 * Command-start preflight (E#3): the same rows 1-10 gate every non-exempt
 * command, in `mode: "command-start"` (the reserved PreflightMode).
 * Stage-start safety is unchanged — stage commands additionally keep the
 * `stages/registry.ts` guard. Max ONE fix-flow attempt (B#7 bound).
 * @param command - Command name (e.g. `/velpari-handoff`).
 * @param ctx - Command context (ui primitives).
 * @param pi - Extension API (flag lookup only).
 * @param cwd - Project root.
 * @returns False = skip the command handler.
 */
export async function runCommandPreflight(
	command: string,
	ctx: PreflightCtx,
	pi: PreflightPi,
	cwd: string,
): Promise<{ continue: boolean }> {
	return runPreflightFlow(
		`Command "${command}"`,
		{
			command,
			mode: "command-start",
			skipDoctor: pi.getFlag?.("velpari-skip-doctor") === true,
		},
		ctx,
		cwd,
	);
}
