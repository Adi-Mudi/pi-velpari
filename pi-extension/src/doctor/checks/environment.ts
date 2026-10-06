/**
 * Environment check — Phase C (G2a), Doctor v2.
 *
 * SHAPE copied from Senai's `checks-environment.ts`; content is 100%
 * velpari. Five probes:
 *
 *   1. node vs `package.json:engines.node` — read FROM DISK (never
 *      hardcoded) via `findPackageRoot` walking up from this module, so
 *      it works in the extension checkout and in node_modules alike.
 *   2. `git --version` via spawnSync — publish commits cannot run
 *      without it.
 *   3. `pi --version` via spawnSync — RPC/e2e tooling needs the binary.
 *   4. Phase B config accessors via the contract adapter — absent → ONE
 *      `info` line (defaults remote / 3 / backend); present → `ok`
 *      lines; a throwing accessor (B's throw-on-invalid) → `warning`
 *      naming the key.
 *   5. Multiplexer/peer-dep coverage is NOT duplicated here — it stays
 *      in the existing `buildMultiplexerSection` (doctor/index.ts).
 *
 * Whole function try/catch-wrapped (doctor ALWAYS renders). Read-only:
 * spawnSync probes only, no writes anywhere.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "../../core/paths.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { resolveConfigApi } from "../contract.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Environment";

/** Component tuple (major.minor.patch); missing components compare as 0. */
type Tuple = readonly [number, number, number];

/**
 * Read `engines.node` from the velpari package.json on disk.
 * @returns {string | null} The declared range (e.g. `>=22.13.0`), or `null` when unreadable/undeclared.
 */
function readEnginesNode(): string | null {
	try {
		const start = dirname(fileURLToPath(import.meta.url));
		const root = findPackageRoot(start);
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
			engines?: { node?: unknown };
		};
		return typeof pkg?.engines?.node === "string" ? pkg.engines.node : null;
	} catch {
		return null;
	}
}

/**
 * Parse a dotted version (optionally prefixed with `>=`, `v`, …) into a tuple.
 * @param {string} v - Version or range string; non-numeric prefix stripped.
 * @returns {Tuple | null} Parsed tuple, or `null` when any component is not a number.
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
 * Does `current` satisfy a simple `>=x.y.z` style engines range?
 * Supports the prefix shapes npm engines realistically use here (`>=`,
 * `^`, bare). Anything unparseable → `null` (skip the gate, never a false warning).
 * @param {string} current - e.g. `22.14.0` (process.versions.node).
 * @param {string} range - e.g. `>=22.13.0` (package.json engines.node).
 * @returns {boolean | null} `true`/`false` verdict, or `null` when either side is unparseable.
 */
export function meetsEngines(current: string, range: string): boolean | null {
	const min = toTuple(range);
	const cur = toTuple(current);
	if (min === null || cur === null) return null;
	for (let i = 0; i < 3; i++) {
		if (cur[i]! > min[i]!) return true;
		if (cur[i]! < min[i]!) return false;
	}
	return true;
}

/**
 * Run one CLI probe fail-soft.
 * @param {string} cmd - Binary name (e.g. `git`, `pi`).
 * @param {string[]} args - Arguments (e.g. `["--version"]`).
 * @returns {{ ok: boolean; version: string | null }} `ok` = exit 0; `version` = first output line when available.
 */
function probe(cmd: string, args: string[]): { ok: boolean; version: string | null } {
	try {
		const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10_000 });
		if (r.error || r.status !== 0) return { ok: false, version: null };
		const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n")[0] ?? "";
		return { ok: true, version: out === "" ? null : out };
	} catch {
		return { ok: false, version: null };
	}
}

/**
 * Build the "Environment" section (read-only).
 * @param {string} cwd - Project root. Feeds the Phase B config-accessor probes
 *   (testing.runner / velpari.maxWorktrees / projectType — the `probes` array
 *   below); the node/pi probes instead resolve the *extension's* own
 *   package.json (`readEnginesNode` resolves it from `import.meta.url`).
 * @returns {DiagnosticSection} One section; degraded contract states are `info`, missing tooling is `warning`.
 */
export function checkEnvironmentSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		// 1. node vs engines (read from disk)
		const engines = readEnginesNode();
		if (engines === null) {
			items.push({ status: "info", message: "engines.node not declared/readable — node version gate skipped." });
		} else {
			const verdict = meetsEngines(process.versions.node, engines);
			if (verdict === null) {
				items.push({
					status: "info",
					message: `engines.node "${engines}" unparseable — node version gate skipped (running ${process.versions.node}).`,
				});
			} else if (verdict) {
				items.push({
					status: "ok",
					message: `node ${process.versions.node} satisfies engines.node ${engines}.`,
				});
			} else {
				items.push({
					status: "warning",
					message: `environment-node-old: node ${process.versions.node} is below engines.node ${engines}.`,
					suggestion: suggestionFor("environment-node-old"),
				});
			}
		}

		// 2. git
		const git = probe("git", ["--version"]);
		if (git.ok) {
			items.push({ status: "ok", message: `${git.version ?? "git"} on PATH.` });
		} else {
			items.push({
				status: "warning",
				message:
					"environment-git-missing: git not found on PATH — publish commits, backups, and store protection cannot run.",
				suggestion: suggestionFor("environment-git-missing"),
			});
		}

		// 3. pi
		const pi = probe("pi", ["--version"]);
		if (pi.ok) {
			items.push({ status: "ok", message: `${pi.version ?? "pi"} on PATH.` });
		} else {
			items.push({
				status: "warning",
				message:
					"environment-pi-missing: pi binary not found on PATH — RPC/e2e tooling and the extension host need it.",
				suggestion: suggestionFor("environment-pi-missing"),
			});
		}

		// 4. Phase B config accessors (contract)
		const api = resolveConfigApi();
		if (api === null) {
			items.push({
				status: "info",
				message: "Phase B config accessors not present — defaults remote / 3 / backend.",
			});
		} else {
			const probes: ReadonlyArray<readonly [string, () => unknown]> = [
				["testing.runner", () => api.testingRunnerConfig(cwd)],
				["velpari.maxWorktrees", () => api.maxWorktreesConfig(cwd)],
				["projectType", () => api.projectTypeConfig(cwd)],
			];
			for (const [key, read] of probes) {
				try {
					items.push({ status: "ok", message: `${key} = ${String(read())}` });
				} catch (err) {
					items.push({
						status: "warning",
						message: `environment-config-invalid: ${key} rejected — ${(err as Error)?.message ?? String(err)}`,
						suggestion: suggestionFor("environment-config-invalid"),
					});
				}
			}
		}
	} catch (err) {
		items.push({
			status: "warning",
			message: `environment check skipped (${(err as Error)?.message ?? String(err)})`,
		});
	}
	return { title: SECTION_TITLE, items };
}
