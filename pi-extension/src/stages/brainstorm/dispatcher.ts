/**
 * Brainstorm scan dispatcher (Phase 3 of the lifecycle v2 upgrade).
 *
 * Prepares and validates subagent dispatch payloads for the brainstorm scan
 * gate. The parent LLM is the one that actually calls the `subagent` tool —
 * this module does NOT spawn subagents. It returns a hardened payload the
 * parent spreads into subagent(), and it enforces the scan-type → scout
 * mapping, the per-type and total dispatch caps, artifact path containment,
 * and read-only tool stripping.
 *
 * Velpari adaptations from senai's dispatcher:
 *   - Scout set is velpari's 4 agents (extractor, prd-checker, rtm-checker,
 *     web-search-agent) — no senai roles, no registry.
 *   - scanType is REQUIRED: every dispatch belongs to a scan gate.
 *   - web-search-agent runs ONLY for "community" scans — this encodes the
 *     FR-52 web-search consent in code (the user picks the community scan
 *     at the scan gate; the dispatcher hard-rejects it otherwise).
 *   - subagent cwd is the run dir (velpari subagent convention: scouts use
 *     relative paths to their report files).
 *
 * Guards (Phase 2) are layered in here:
 *   - guardDispatchCount refuses when the next dispatch would exceed the cap.
 *   - guardArtifactPath refuses any artifact path outside the run dir.
 */

import { SCOUT_AGENT_IDS, type ScoutAgentId } from "../../io/agents-install.js";
import {
	loadAgentConfig,
	resolveAgentName,
} from "../../core/agents-config.js";
import type { ScanType } from "../../core/state.js";
import {
	guardArtifactPath,
	guardDispatchCount,
} from "./guard.js";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/** Scan-type → scout mapping for the requirements mission. */
export const SCAN_TYPE_ROLES: Record<ScanType, readonly string[]> = {
	code: ["extractor", "prd-checker"],
	doc: ["prd-checker", "rtm-checker"],
	community: ["web-search-agent"],
};

/** Max dispatches per scan type at the scan gate. Separate from
 *  VELPARI_BRAINSTORM_DISPATCH_CAP, which bounds the whole brainstorm. */
export const SCAN_TYPE_DISPATCH_CAP = 2;

/** Wall-clock budget per dispatch, in milliseconds. The parent LLM uses
 *  this to decide when to cancel a stalled subagent. */
export const BRAINSTORM_DISPATCH_TIMEOUT_MS = 30_000;

/** Wall-clock budget for COMMUNITY-scan dispatches. Web research (search +
 *  fetch + read) cannot complete in the 30s local-scan budget. */
export const BRAINSTORM_COMMUNITY_DISPATCH_TIMEOUT_MS = 90_000;

/** Default scan selection for the requirements mission. Community (web
 *  search) is added only when the user consents at the scan gate — FR-52. */
export const DEFAULT_SCANS: readonly ScanType[] = ["code", "doc"];

/** Read-only tools every brainstorm dispatch keeps after stripping.
 *  Lowercase pi tool names (velpari convention). */
export const READ_ONLY_ALLOWED_TOOLS: readonly string[] = ["read", "grep", "glob"];

/** Extra read-only tools allowed for COMMUNITY scans only — the
 *  web-search-agent needs them to do web research. */
export const COMMUNITY_EXTRA_TOOLS: readonly string[] = ["websearch", "fetchurl"];

/** Default tools every brainstorm dispatch receives. */
export const DEFAULT_DISPATCH_TOOLS: readonly string[] = [...READ_ONLY_ALLOWED_TOOLS];

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** What the parent LLM hands us when it wants to dispatch a scout. */
export interface DispatchRequest {
	/** Scout ROLE id — must be one of SCOUT_AGENT_IDS and serve scanType.
	 *  Roles are fixed; only the spawned agent NAME is swappable via
	 *  `.pi/velpari/agents.json` (resolved in prepareDispatch). */
	agent: string;
	/** Task description (passed through verbatim; the dispatcher does not edit). */
	task: string;
	/** Which scan gate this dispatch belongs to. */
	scanType: ScanType;
	/** Optional: hint for the parent LLM about what output to expect. */
	expectedOutput?: string;
	/** Optional: explicit tools allowlist (defaults to DEFAULT_DISPATCH_TOOLS). */
	tools?: readonly string[];
	/** Optional: artifact paths the scout may write. Each is path-guarded. */
	artifactPaths?: readonly string[];
}

/** What the dispatcher returns when validation succeeds. The parent LLM
 *  passes these args to `subagent({ ...subagentArgs })`. */
export interface PreparedDispatch {
	/** Scout ROLE id (validated). Kept role-keyed even when agents.json
	 *  maps the role to a custom agent name. */
	agent: string;
	/** Scan gate this dispatch belongs to. */
	scanType: ScanType;
	/** Task description (verbatim). */
	task: string;
	/** Expected output hint for the parent LLM (or "" if not provided). */
	expectedOutput: string;
	/** Hardened tools allowlist — write/edit/bash already stripped. */
	tools: string[];
	/** Run dir the dispatch is rooted at (also the subagent cwd). */
	runDir: string;
	/** Subagent invocation args. The parent LLM spreads these into subagent(). */
	subagentArgs: {
		/** Resolved agent name (from agents.json; defaults to the role id). */
		agent: string;
		cwd: string;
		task: string;
		/** Hint to the parent: how long to wait before cancelling. */
		timeoutMs: number;
	};
	/** Monotonic dispatch number within this brainstorm (1-based). */
	dispatchNumber: number;
	/** ISO timestamp when the dispatch was prepared. */
	startedAt: string;
}

/** Result of dispatch preparation. */
export type DispatchPrepResult =
	| { ok: true; prepared: PreparedDispatch }
	| { ok: false; reason: string; details?: string[] };

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/** Strip forbidden tools from a scout's tool list. Community scans keep
 *  websearch + fetchurl; every other scan keeps only read/grep/glob.
 *
 *  Examples:
 *    enforceReadOnlyTools(["read", "write", "grep"], "code")      → ["read", "grep"]
 *    enforceReadOnlyTools(["write", "edit"], "doc")               → []
 *    enforceReadOnlyTools(["read", "websearch"], "community")     → ["read", "websearch"]
 *    enforceReadOnlyTools(["read", "websearch"], "code")          → ["read"] */
export function enforceReadOnlyTools(
	tools: readonly string[],
	scanType?: ScanType,
): string[] {
	const allowed = new Set(
		scanType === "community"
			? [...READ_ONLY_ALLOWED_TOOLS, ...COMMUNITY_EXTRA_TOOLS]
			: READ_ONLY_ALLOWED_TOOLS,
	);
	return tools.filter((t) => allowed.has(t));
}

/** Prepare a scout dispatch.
 *
 *  Returns `{ok: true, prepared}` when the request is valid and the parent
 *  LLM should proceed to call `subagent(prepared.subagentArgs)`. Returns
 *  `{ok: false, reason}` when any guard refuses the dispatch.
 *
 *  Validates in order:
 *   1. scout id is one of velpari's 4 agents
 *   2. scan-type role match (web-search-agent ⇒ community only — FR-52)
 *      + per-type cap
 *   3. total dispatch cap (guardDispatchCount)
 *   4. artifact paths inside the run dir (guardArtifactPath)
 *   5. tool strip (read-only; community keeps web tools)
 *
 *  The dispatcher never calls subagent itself. The parent LLM owns the
 *  actual spawn.
 *
 *  `cwd` locates `.pi/velpari/agents.json`: after validation (which stays
 *  role-based — FR-52 is anchored on the role), the role is resolved to the
 *  spawn agent name via resolveAgentName. */
export function prepareDispatch(
	request: DispatchRequest,
	runDir: string,
	currentDispatchCount: number,
	currentScanTypeCount: number = 0,
	cwd: string = process.cwd(),
): DispatchPrepResult {
	// 1. Scout id check.
	if (!(SCOUT_AGENT_IDS as readonly string[]).includes(request.agent)) {
		return {
			ok: false,
			reason:
				`Agent "${request.agent}" is not a velpari scout.\n` +
				`Allowed scouts: ${SCOUT_AGENT_IDS.join(", ")}.`,
		};
	}

	// 2. Scan-type gate: the scout must serve the requested scan type, and
	//    the per-type cap must not be exceeded. web-search-agent runs ONLY
	//    for community scans (FR-52 consent encoded in code).
	const allowedScouts = SCAN_TYPE_ROLES[request.scanType];
	if (request.agent === "web-search-agent" && request.scanType !== "community") {
		return {
			ok: false,
			reason:
				`web-search-agent only runs for "community" scans (requested: "${request.scanType}").\n` +
				`Web research requires the user's consent at the scan gate (FR-52).`,
		};
	}
	if (!allowedScouts.includes(request.agent)) {
		return {
			ok: false,
			reason:
				`Agent "${request.agent}" does not serve the "${request.scanType}" scan.\n` +
				`Allowed scouts for "${request.scanType}": ${allowedScouts.join(", ")}.`,
		};
	}
	if (currentScanTypeCount >= SCAN_TYPE_DISPATCH_CAP) {
		return {
			ok: false,
			reason:
				`Scan-type cap reached for "${request.scanType}" (${SCAN_TYPE_DISPATCH_CAP}).\n` +
				`Merge the findings you already have instead of dispatching more.`,
		};
	}

	// 3. Total dispatch count guard.
	const countGuard = guardDispatchCount(currentDispatchCount);
	if (!countGuard.ok) {
		return { ok: false, reason: countGuard.reason! };
	}

	// 4. Artifact path guard (only if paths were provided).
	if (request.artifactPaths && request.artifactPaths.length > 0) {
		for (const p of request.artifactPaths) {
			const pathGuard = guardArtifactPath(p, runDir);
			if (!pathGuard.ok) {
				return { ok: false, reason: pathGuard.reason! };
			}
		}
	}

	// 5. Tools allowlist — strip forbidden tools.
	const requestedTools =
		request.tools && request.tools.length > 0 ? request.tools : DEFAULT_DISPATCH_TOOLS;
	const cleanedTools = enforceReadOnlyTools(requestedTools, request.scanType);
	if (cleanedTools.length === 0) {
		return {
			ok: false,
			reason:
				`Agent "${request.agent}" has no read-only tools after stripping forbidden ones.\n` +
				`Requested: [${requestedTools.join(", ")}]\n` +
				`Allowed: ${READ_ONLY_ALLOWED_TOOLS.join(", ")}` +
				(request.scanType === "community"
					? `, ${COMMUNITY_EXTRA_TOOLS.join(", ")}`
					: "") +
				`.`,
		};
	}

	const timeoutMs =
		request.scanType === "community"
			? BRAINSTORM_COMMUNITY_DISPATCH_TIMEOUT_MS
			: BRAINSTORM_DISPATCH_TIMEOUT_MS;

	// Resolve the spawn agent name. The scout-id check above guarantees
	// request.agent is one of the 4 brainstorm roles, so the cast is safe.
	// Validation stays role-based; only the spawned NAME is resolved here.
	const agentName = resolveAgentName(loadAgentConfig(cwd), request.agent as ScoutAgentId);

	const prepared: PreparedDispatch = {
		agent: request.agent,
		scanType: request.scanType,
		task: request.task,
		expectedOutput: request.expectedOutput ?? "",
		tools: cleanedTools,
		runDir,
		subagentArgs: {
			agent: agentName,
			cwd: runDir,
			task: request.task,
			timeoutMs,
		},
		dispatchNumber: currentDispatchCount + 1,
		startedAt: new Date().toISOString(),
	};

	return { ok: true, prepared };
}

/** Build the per-scan lines for the prompt's `## Scan Plan` block. Lives in
 *  the dispatcher (L1) so core/prompt.ts (L0) stays free of scout/timeout
 *  knowledge — the caller passes the returned lines into buildStagePrompt
 *  via `scanPlanLines`.
 *
 *  When `cwd` is given and `.pi/velpari/agents.json` maps a role to a custom
 *  agent name, the role renders as `role → agentName`. Without a mapping (or
 *  without cwd) the output is byte-identical to the role-only format. */
export function formatScanPlanLines(scans: readonly ScanType[], cwd?: string): string[] {
	if (scans.length === 0) {
		return ["- (none — user skipped scans; inline research only)"];
	}
	const agentConfig = cwd ? loadAgentConfig(cwd) : null;
	return scans.map((scan) => {
		const roles = SCAN_TYPE_ROLES[scan]
			.map((role) => {
				const agentName = agentConfig
					? resolveAgentName(agentConfig, role as ScoutAgentId)
					: role;
				return agentName === role ? role : `${role} → ${agentName}`;
			})
			.join(", ");
		const timeout =
			scan === "community"
				? BRAINSTORM_COMMUNITY_DISPATCH_TIMEOUT_MS
				: BRAINSTORM_DISPATCH_TIMEOUT_MS;
		return `- ${scan} — scouts: ${roles} (timeout ${timeout / 1000}s)`;
	});
}

/** Helper for the parent LLM: format the prepared dispatch as a prompt
 *  block. Includes all subagent invocation args the parent needs to make
 *  the call. */
export function formatPreparedDispatch(prepared: PreparedDispatch): string {
	return [
		"## Prepared dispatch",
		"",
		`Agent: \`${prepared.agent}\` → spawn \`${prepared.subagentArgs.agent}\` (scan: ${prepared.scanType})`,
		`Dispatch #: ${prepared.dispatchNumber}`,
		`Timeout: ${prepared.subagentArgs.timeoutMs}ms`,
		`CWD: ${prepared.runDir}`,
		"",
		"Tools (read-only):",
		prepared.tools.map((t) => `- ${t}`).join("\n"),
		"",
		"Task:",
		prepared.task,
		prepared.expectedOutput ? `\nExpected output: ${prepared.expectedOutput}` : "",
		"",
		"Call:",
		"```",
		`subagent({`,
		`  agent: "${prepared.subagentArgs.agent}",`,
		`  cwd: ${JSON.stringify(prepared.subagentArgs.cwd)},`,
		`  task: ${JSON.stringify(prepared.subagentArgs.task)},`,
		`})`,
		"```",
	].join("\n");
}
