/**
 * Digest-vs-git check — Phase C (G5), N21 layer 4 detect half.
 *
 * Consumes Phase B's stamped store-content digest through the contract
 * adapter (`../contract.ts`) — never B's internals. The detection is a
 * three-way comparison:
 *
 *   1. stamp (store_meta `store-content-v1`) — what velpari last wrote;
 *   2. recomputed content digest — what the store file actually holds;
 *   3. `git status --porcelain` on the DB path — whether the file moved
 *      outside the publish flow.
 *
 * Outcomes (severity policy: a real finding blocks, a degraded contract
 * never does):
 *
 *   - contract absent (batch-1 pre-merge)      → info  `digest-contract-unavailable`
 *   - no project / no store DB                 → info  (nothing to compare)
 *   - no stamp (never stamped / legacy)        → info  `digest-not-stamped`
 *   - stamp ≠ recomputed content               → error `digest-mismatch`
 *     (foreign in-process/file edit, or a velpari writer that skipped
 *     its re-stamp — D11's two failure modes; git details tell them apart)
 *   - stamp == content, file dirty vs HEAD     → warning `store-uncommitted`
 *   - stamp == content, git clean/unavailable  → ok
 *
 * Every path is wrapped — the doctor ALWAYS renders (hash-chain.ts rule).
 * Read-only: opens the store for reading and never writes anything.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { buildStoreDbPath } from "../../core/paths.js";
import { closeStoreDb, openStoreDb } from "../../io/db.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { resolveDigestApi } from "../contract.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Store digest vs git (foreign modification, N21 layer 4)";

/**
 * Fail-soft git status of one root-relative path.
 * @param {string} cwd - Project root (the git work tree).
 * @param {string} relPath - Root-relative path (the store DB).
 * @returns {string | null} Trimmed porcelain output ("" = clean), or `null` when git cannot answer (no git / not a repo).
 */
function gitPorcelain(cwd: string, relPath: string): string | null {
	try {
		const res = spawnSync("git", ["status", "--porcelain", "--", relPath], {
			cwd,
			encoding: "utf8",
		});
		if (res.status !== 0 || res.stdout === null) return null;
		return res.stdout.trim();
	} catch {
		return null;
	}
}

/**
 * Build the "Store digest vs git" section (read-only, fail-open render).
 * @param {string} cwd - Project root.
 * @param {string} projectName - Configured project name ("" = not configured).
 * @returns {DiagnosticSection} One section; degraded states are `info`, real drift is `error`/`warning`.
 */
export function checkDigestGitSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		if (projectName === "") {
			items.push({
				status: "info",
				message: "No project configured — digest check skipped.",
				suggestion: suggestionFor("project-name-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		const dbPath = buildStoreDbPath(projectName, cwd);
		if (!existsSync(dbPath)) {
			items.push({
				status: "info",
				message: "No store DB yet — nothing to compare.",
				suggestion: suggestionFor("store-db-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		const api = resolveDigestApi();
		if (!api) {
			items.push({
				status: "info",
				message:
					"digest-contract-unavailable: Phase B digest API (io/db.ts) not present in this build — degraded, nothing verified.",
				suggestion: suggestionFor("digest-contract-unavailable"),
			});
			return { title: SECTION_TITLE, items };
		}

		const relDb = relative(cwd, dbPath).split("\\").join("/");
		const gitState = gitPorcelain(cwd, relDb); // null = git unavailable

		let db: ReturnType<typeof openStoreDb> | null = null;
		try {
			db = openStoreDb(dbPath);
			const stamp = api.readStoreDigestStamp(db);
			if (!stamp) {
				items.push({
					status: "info",
					message: `digest-not-stamped: ${relDb} has never been stamped (scope ${api.scope}) — foreign-modification detection inactive until the next publish.`,
					suggestion: suggestionFor("digest-not-stamped"),
				});
				return { title: SECTION_TITLE, items };
			}
			if (stamp.scope !== api.scope) {
				items.push({
					status: "info",
					message: `digest-not-stamped: stamp scope "${stamp.scope}" != current "${api.scope}" — re-stamped at next publish.`,
					suggestion: suggestionFor("digest-not-stamped"),
				});
				return { title: SECTION_TITLE, items };
			}

			const computed = api.computeStoreContentDigest(db);
			if (computed !== stamp.digest) {
				const details = [
					`stamped: ${stamp.digest.slice(0, 16)}… at ${stamp.stampedAt} (scope ${stamp.scope})`,
					`computed: ${computed.slice(0, 16)}…`,
					gitState === null
						? "git: unavailable (cannot tell velpari-writer from foreign edit)"
						: `git status: ${gitState === "" ? "(clean — the change is IN the committed bytes or in-process)" : gitState}`,
				];
				items.push({
					status: "error",
					message: `digest-mismatch: store content changed without a re-stamp — foreign modification or an un-stamped velpari writer (${relDb}).`,
					details,
					suggestion: suggestionFor("digest-mismatch"),
				});
			} else if (gitState !== null && gitState !== "") {
				items.push({
					status: "warning",
					message: `store-uncommitted: digest matches the stamp, but ${relDb} has uncommitted changes vs HEAD — the publish flow commits it; a manual file edit is a finding.`,
					details: [`git status: ${gitState}`],
					suggestion: suggestionFor("store-uncommitted"),
				});
			} else {
				items.push({
					status: "ok",
					message: `Digest matches the stamped content (scope ${stamp.scope}, stamped ${stamp.stampedAt}); ${gitState === null ? "git unavailable — file-level check skipped." : "git clean."}`,
				});
			}
		} finally {
			if (db !== null) {
				try {
					closeStoreDb(db);
				} catch {
					/* render discipline — close failures never mask findings */
				}
			}
		}
	} catch (err) {
		// Doctor ALWAYS renders — a broken store/read path degrades to a warning.
		items.push({
			status: "warning",
			message: `digest check skipped (${(err as Error)?.message ?? String(err)})`,
		});
	}
	return { title: SECTION_TITLE, items };
}
