/**
 * Herdr integration-readiness check (herdr integration initiative, Phase 3).
 *
 * Three findings, all read-only:
 *
 *   1. Version floor — `herdr --version` vs `HERDR_MIN_VERSION_PLACEHOLDER`
 *      (overridable at runtime; see `resolveHerdrFloor`). Below the floor is
 *      a warning; an absent or unparseable probe is NEVER a warning (the
 *      "no false warning" rule borrowed from `checks/environment.ts`).
 *   2. `herdr integration install pi` — an info recommendation when the pi
 *      integration is not detected. Herdr uses it to restore the pi session
 *      after a server restart and to report pi's agent state, which
 *      velpari's scout waits read from Phase 5 on.
 *   3. Subagents herdr backend — when the active multiplexer is herdr, the
 *      subagents plugin must actually be able to spawn panes there. Today
 *      `pi-interactive-subagents` supports cmux/tmux/zellij/WezTerm only, so
 *      the gate passes but scouts cannot spawn yet. This is a CAPABILITY
 *      probe (a bounded marker scan of the installed package), not a version
 *      guess: whichever package Phase 2 picks (fork, upstream PR, or a new
 *      pi-herdr-subagents) flips this to `ok` with no constant to bump.
 *
 * Severity contract: this module NEVER emits `error` items, so the doctor's
 * overall verdict is unaffected. A missing multiplexer is already an error
 * and a missing plugin already a warning in the Multiplexer section — no
 * duplicate finding here (N24-15: one defect, one severity).
 *
 * The whole check is try/catch-wrapped: the doctor ALWAYS renders.
 */

import { spawnSync } from "node:child_process";
import { type Dirent, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { PATHS } from "../../core/constants.js";
import { detectMultiplexer } from "../../core/multiplexer.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";
import { detectInteractiveSubagentsVersion, resolveInteractiveSubagentsRoot } from "./multiplexer.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Herdr (integration readiness)";

/**
 * PLACEHOLDER — the minimum herdr version velpari supports.
 *
 * OWNER: Phase 2 (`herdr-plugin-research`) confirms the real floor from the
 * herdr CLI/socket surface the scout pattern needs (split / start /
 * prompt-wait / read). Updating it is a one-line change here.
 *
 * Without a rebuild, override at runtime via either
 * `PI_VELPARI_HERDR_MIN_VERSION` (env) or `files.json` →
 * `velpari.herdrMinVersion` — see `resolveHerdrFloor`.
 */
export const HERDR_MIN_VERSION_PLACEHOLDER = "0.9.0";

/** Env var that overrides the floor without a rebuild (also the test seam). */
export const HERDR_MIN_VERSION_ENV = "PI_VELPARI_HERDR_MIN_VERSION";

/** Capability-probe bounds — keep the doctor fast on a large checkout. */
const MARKER_MAX_FILES = 500;
/** Total characters of file content the capability probe will read. */
const MARKER_MAX_BYTES = 256 * 1024;
/** Directories never walked by the capability probe. */
const MARKER_SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", ".cache", "coverage"]);
/** File extensions the marker scan reads. */
const MARKER_EXTS = /\.(ts|js|mjs|cjs|json|md)$/;
/** Case-insensitive marker meaning "this package can drive herdr panes". */
const HERDR_MARKER = "herdr";

/** Component tuple (major.minor.patch); missing components compare as 0. */
type Tuple = readonly [number, number, number];

/**
 * Parse the first `major.minor.patch` token out of a version string.
 * Handles `herdr 0.9.3`, `herdr v1.0.0-beta.1`, bare `0.9.3`.
 * @param {string | null | undefined} raw - Raw probe output.
 * @returns {string | null} `x.y.z`, or `null` when there is no semver token.
 */
export function parseHerdrVersion(raw: string | null | undefined): string | null {
	if (typeof raw !== "string") return null;
	const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
	return match === null ? null : `${match[1]}.${match[2]}.${match[3]}`;
}

/**
 * Parse a dotted version (numeric prefix tolerated) into a tuple.
 * @param {string} v - Version string, e.g. `0.9.0` or `>=0.9.0`.
 * @returns {Tuple | null} Parsed tuple, or `null` when a component is not a number.
 */
function toTuple(v: string): Tuple | null {
	const bare = v.trim().replace(/^[^0-9]*/, "");
	const parts = bare
		.split(/[.\-+]/)
		.slice(0, 3)
		.map((p) => Number.parseInt(p, 10));
	if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return null;
	while (parts.length < 3) parts.push(0);
	return [parts[0]!, parts[1]!, parts[2]!] as Tuple;
}

/**
 * Is `current` below `floor`?
 * @param {string} current - Installed version, e.g. `0.8.9`.
 * @param {string} floor - Required minimum, e.g. `0.9.0`.
 * @returns {boolean | null} Verdict, or `null` when either side is unparseable
 *   (the caller skips the gate rather than raising a false warning).
 */
export function isBelowFloor(current: string, floor: string): boolean | null {
	const cur = toTuple(current);
	const min = toTuple(floor);
	if (cur === null || min === null) return null;
	for (let i = 0; i < 3; i++) {
		if (cur[i]! > min[i]!) return false;
		if (cur[i]! < min[i]!) return true;
	}
	return false;
}

/** Where the effective herdr floor came from (shown in the report details). */
export interface HerdrFloorResolution {
	floor: string;
	source: string;
}

/**
 * Resolve the effective herdr minimum version, highest precedence first:
 *   1. `PI_VELPARI_HERDR_MIN_VERSION` (runtime override, no rebuild)
 *   2. `files.json` → `velpari.herdrMinVersion` (per-project pin)
 *   3. `HERDR_MIN_VERSION_PLACEHOLDER` (the single built-in constant)
 *
 * Never throws: an absent / unreadable / invalid files.json falls through.
 * @param {string} [cwd] - Project root holding `.pi/velpari/files.json`.
 * @param {NodeJS.ProcessEnv} [env] - Env to read the override from.
 * @returns {HerdrFloorResolution} The floor plus a human-readable source label.
 */
export function resolveHerdrFloor(
	cwd: string = process.cwd(),
	env: NodeJS.ProcessEnv = process.env,
): HerdrFloorResolution {
	const fromEnv = env[HERDR_MIN_VERSION_ENV];
	if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
		return { floor: fromEnv.trim(), source: HERDR_MIN_VERSION_ENV };
	}
	try {
		const path = join(cwd, PATHS.CONFIG_DIR, "files.json");
		if (existsSync(path)) {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as { velpari?: { herdrMinVersion?: unknown } };
			const pinned = parsed?.velpari?.herdrMinVersion;
			if (typeof pinned === "string" && pinned.trim() !== "") {
				return { floor: pinned.trim(), source: "files.json velpari.herdrMinVersion" };
			}
		}
	} catch {
		// absent / unreadable / invalid config → fall through to the constant
	}
	return { floor: HERDR_MIN_VERSION_PLACEHOLDER, source: "built-in placeholder (HERDR_MIN_VERSION_PLACEHOLDER)" };
}

/**
 * Run one CLI probe fail-soft (same shape as `checks/environment.ts:probe`).
 * @param {string} cmd - Binary name.
 * @param {string[]} args - Arguments.
 * @returns {string | null} Trimmed combined output when the command exits 0, else `null`.
 */
function spawnProbe(cmd: string, args: string[]): string | null {
	try {
		const result = spawnSync(cmd, args, { encoding: "utf8", timeout: 10_000 });
		if (result.error || result.status !== 0) return null;
		const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
		return out === "" ? null : out;
	} catch {
		return null;
	}
}

/** Default probe: raw `herdr --version` output. */
export function probeHerdrVersion(): string | null {
	return spawnProbe("herdr", ["--version"]);
}

/** Default probe: raw `herdr integration status` output. */
export function probeHerdrIntegrationStatus(): string | null {
	return spawnProbe("herdr", ["integration", "status"]);
}

/**
 * Read the pi integration's state out of `herdr integration status`.
 *
 * The CLI prints one line per integration:
 *   `pi: current (v9) (/home/<user>/.pi/agent/extensions/herdr-agent-state.ts)`
 *   `omp: not installed (/home/<user>/.omp/agent/extensions/…)`
 *
 * Only the `pi:` line is considered (the `^` anchor keeps sibling names such
 * as `antigravity-cli` out). An unknown output format degrades to `null` — the
 * caller then shows the (harmless, idempotent) install recommendation rather
 * than a false `ok`.
 *
 * @param {string | null} raw - Raw `herdr integration status` output.
 * @returns {string | null} The status text (`current (v9)`), or `null` when the
 *   integration is absent / not installed / the output is unrecognised.
 */
export function piIntegrationStatus(raw: string | null): string | null {
	if (raw === null) return null;
	for (const line of raw.split("\n")) {
		const match = line.match(/^\s*pi\s*:\s*(.+)$/i);
		if (match === null) continue;
		const state = (match[1] ?? "").trim();
		if (state === "" || /not\s+installed|absent|missing/i.test(state)) return null;
		// Drop the trailing install path: `current (v9) (/home/u/…)` → `current (v9)`.
		const withoutPath = state.replace(/\s*\(\/[^)]*\)\s*$/, "").trim();
		return withoutPath === "" ? state : withoutPath;
	}
	return null;
}

/**
 * Does the installed subagents package contain a herdr backend?
 *
 * Bounded, read-only walk of the package root, looking for the literal
 * `herdr` in source/docs/config files. The bounds (500 files / 256 KB) keep
 * doctor latency flat; `node_modules`, `.git`, `dist`, `.cache` and
 * `coverage` are skipped.
 *
 * @param {string | null} root - Resolved plugin directory (`null` = not installed).
 * @returns {boolean} True when a herdr marker was found.
 */
export function detectSubagentHerdrBackend(root: string | null): boolean {
	if (root === null) return false;
	let files = 0;
	let bytes = 0;
	let found = false;

	const walk = (dir: string): void => {
		if (found || files >= MARKER_MAX_FILES || bytes >= MARKER_MAX_BYTES) return;
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (found || files >= MARKER_MAX_FILES || bytes >= MARKER_MAX_BYTES) return;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (MARKER_SKIP_DIRS.has(entry.name)) continue;
				walk(path);
				continue;
			}
			if (!entry.isFile() || !MARKER_EXTS.test(entry.name)) continue;
			files++;
			try {
				if (statSync(path).size > MARKER_MAX_BYTES) continue;
				const text = readFileSync(path, "utf8");
				bytes += text.length;
				if (text.toLowerCase().includes(HERDR_MARKER)) {
					found = true;
					return;
				}
			} catch {
				// unreadable file → skip it, keep walking
			}
		}
	};

	walk(root);
	return found;
}

/**
 * Read the package's own `name` from its package.json — a more useful label
 * than the directory name (a bundled/aliased install path is not the
 * package identity).
 * @param {string} root - Resolved plugin directory.
 * @returns {string | null} The declared name, or `null` when unreadable.
 */
function readPluginName(root: string): string | null {
	try {
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: unknown };
		return typeof pkg.name === "string" && pkg.name !== "" ? pkg.name : null;
	} catch {
		return null;
	}
}

/**
 * Injection seam for `checkHerdrSection`. Every field is optional; omitted
 * fields fall back to the real probe. `subagentsRoot` / `subagentsVersion`
 * distinguish "not provided" (`undefined` → resolve from disk) from
 * "explicitly absent" (`null`).
 */
export interface HerdrCheckOptions {
	env?: NodeJS.ProcessEnv;
	versionProbe?: () => string | null;
	integrationProbe?: () => string | null;
	subagentsRoot?: string | null;
	subagentsVersion?: string | null;
	floor?: string;
}

/**
 * Build the "Herdr (integration readiness)" section.
 *
 * When herdr is not the active multiplexer the section is a single `info`
 * line and no probes run — so tmux/zellij users pay nothing.
 *
 * @param {string} [cwd] - Project root.
 * @param {HerdrCheckOptions} [opts] - Probe / floor injection (tests).
 * @returns {DiagnosticSection} One section; worst case is a warning, never an error.
 */
export function checkHerdrSection(cwd: string = process.cwd(), opts: HerdrCheckOptions = {}): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		const env = opts.env ?? process.env;
		const mux = detectMultiplexer(env);

		// Branch A — herdr is not in play. Cheap, probe-free, one info line.
		if (mux.mux !== "herdr") {
			items.push({
				status: "info",
				message: `herdr not detected (mux=${mux.mux} via ${mux.source}) — herdr checks skipped.`,
			});
			return { title: SECTION_TITLE, items };
		}

		// --- 1. herdr version floor ------------------------------------------
		const floorResolution =
			opts.floor !== undefined ? { floor: opts.floor, source: "explicit override" } : resolveHerdrFloor(cwd, env);
		const floor = floorResolution.floor;

		const versionProbe = opts.versionProbe ?? probeHerdrVersion;
		const rawVersion = versionProbe();
		const cliVersion = parseHerdrVersion(rawVersion);

		if (rawVersion === null) {
			items.push({
				status: "warning",
				message:
					"herdr-cli-missing: herdr is the active multiplexer but the `herdr` CLI is not on PATH — pane automation (scout panes, agent waits) cannot run.",
				details: [`Detected via ${mux.source}.`],
				suggestion: suggestionFor("herdr-cli-missing"),
			});
		} else if (cliVersion === null) {
			items.push({
				status: "info",
				message:
					"herdr version could not be parsed from `herdr --version` — version gate skipped (never a false warning).",
				details: [`Raw output: ${rawVersion.split("\n")[0]}`],
			});
		} else {
			const below = isBelowFloor(cliVersion, floor);
			if (below === true) {
				items.push({
					status: "warning",
					message: `herdr-version-below-floor: herdr ${cliVersion} is below the supported floor ${floor}.`,
					details: [
						`floor source: ${floorResolution.source}`,
						"herdr is pre-1.0; the floor is the oldest version velpari's pane automation is verified against.",
					],
					suggestion: suggestionFor("herdr-version-below-floor"),
				});
			} else if (below === null) {
				items.push({
					status: "info",
					message: `herdr ${cliVersion} detected, but the configured floor "${floor}" is not a parsable version — version gate skipped.`,
				});
			} else {
				items.push({
					status: "ok",
					message: `herdr ${cliVersion} ≥ floor ${floor}.`,
					details: [`floor source: ${floorResolution.source}`, "upgrade with `herdr update`."],
				});
			}
		}

		// --- 2. pi integration recommendation --------------------------------
		const integrationProbe = opts.integrationProbe ?? probeHerdrIntegrationStatus;
		const piStatus = piIntegrationStatus(integrationProbe());
		if (piStatus !== null) {
			items.push({
				status: "ok",
				message: `herdr pi integration installed (status: ${piStatus}) — herdr can restore the pi session after a server restart.`,
				details: [`Re-check with \`herdr integration status\`; update with \`herdr integration install pi\`.`],
			});
		} else {
			items.push({
				status: "info",
				message:
					"Recommended: run `herdr integration install pi` — without the integration herdr cannot resume the pi session after a server restart and cannot report pi's agent state, which velpari's scout waits read from Phase 5 on.",
				details: [
					"Writes ~/.pi/agent/extensions/herdr-agent-state.ts ($PI_CODING_AGENT_DIR/extensions when set). Idempotent; undo with `herdr integration uninstall pi`.",
				],
				suggestion: suggestionFor("herdr-integration-missing"),
			});
		}

		// --- 3. subagents herdr backend (capability probe) --------------------
		const root = opts.subagentsRoot === undefined ? resolveInteractiveSubagentsRoot(cwd) : opts.subagentsRoot;
		const pluginVersion =
			opts.subagentsVersion === undefined ? detectInteractiveSubagentsVersion(cwd) : opts.subagentsVersion;
		const rootLabel = root === null ? "(none)" : (readPluginName(root) ?? basename(root));
		const label = `${rootLabel}${pluginVersion ? ` ${pluginVersion}` : ""}`;

		if (root === null) {
			items.push({
				status: "warning",
				message:
					"herdr-backend-missing: mux is herdr but no subagents plugin was found — the gate passes, scouts cannot spawn yet.",
				details: [
					"Install pi-velpari (which bundles pi-interactive-subagents), or the herdr-capable plugin Phase 4 ships.",
				],
				suggestion: suggestionFor("herdr-backend-missing"),
			});
		} else if (detectSubagentHerdrBackend(root)) {
			items.push({
				status: "ok",
				message: `herdr backend detected in ${label}.`,
				details: [root],
			});
		} else {
			items.push({
				status: "warning",
				message: `herdr-backend-missing: mux is herdr but no herdr backend was detected in the active subagents plugin (${label}) — the gate passes, scouts cannot spawn yet (herdr integration initiative Phase 4 delivers the backend).`,
				details: [root],
				suggestion: suggestionFor("herdr-backend-missing"),
			});
		}
	} catch (err) {
		items.push({
			status: "warning",
			message: `herdr check skipped (${(err as Error)?.message ?? String(err)})`,
		});
	}
	return { title: SECTION_TITLE, items };
}
