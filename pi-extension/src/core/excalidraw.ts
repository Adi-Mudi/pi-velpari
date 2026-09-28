/**
 * Excalidraw canvas launcher — Phase F (N31).
 *
 * Pushes the design/export flow's Mermaid diagrams to a local Excalidraw
 * canvas, offer-only-when-reachable:
 *
 *   enable (one in-session confirm) → runtime detect → start the local MCP
 *   server on demand (`npx -y mcp-excalidraw-server@2.0.0`) → /health
 *   identity probe → push confirm → `create_from_mermaid` over MCP stdio.
 *
 * Every failure degrades gracefully to the existing Mermaid path: all
 * notifications this module emits are info-level (never `error`, never a
 * throw that escapes `offerCanvasPush`) and no network touch (npx fetch,
 * canvas start, /health probe) happens before an explicit confirm (§3.5).
 * `session_shutdown` stops the MCP child and the canvas WE started — no
 * daemon left behind (§2.2).
 *
 * Supply chain (plan §6): exact pin `mcp-excalidraw-server@2.0.0` only —
 * never `@latest` — recorded in EXCALIDRAW_PIN; npm verifies the registry
 * dist.integrity (EXCALIDRAW_INTEGRITY) at fetch time. Nothing is vendored
 * or bundled (§3.1/§3.3): node built-ins only, zero runtime dependencies.
 *
 * Identity: `/health` must answer `{service: "mcp-excalidraw-canvas"}` —
 * the same marker the package's own status/stop commands trust — so a
 * foreign service squatting the port is reported unreachable, never pushed.
 *
 * Test discipline: with NODE_TEST_CONTEXT set (node --test children) the
 * default dependency set is null → `offerCanvasPush` is a silent no-op
 * unless a test injects deps (option or __setCanvasTestDeps) — the whole
 * existing suite stays green without edits and no real spawn can leak.
 */

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

/** Pin consumed by every spawn (npx never floats a tag for us). */
export const EXCALIDRAW_PKG = "mcp-excalidraw-server";
export const EXCALIDRAW_VERSION = "2.0.0";
export const EXCALIDRAW_PIN = `${EXCALIDRAW_PKG}@${EXCALIDRAW_VERSION}`;
/** npm registry dist.integrity for the pin — npm verifies it at fetch (§6 audit). */
export const EXCALIDRAW_INTEGRITY =
	"sha512-aBzC2Mbb7XSVoiIC0SSZh2728Z59H82sXzTe8pn1o9fLVedPBecgYhuDxrtsPpVT7Njh3Spb0b/k40R5Jjk8Xg==";

/** Identity marker the canvas server puts in /health (package ≥ 1.1). */
const CANVAS_SERVICE_NAME = "mcp-excalidraw-canvas";
/** Era pin: request the protocol of the shipped package; the server always answers its own. */
const MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_CANVAS_URL = "http://127.0.0.1:3000";

export interface LauncherTimeouts {
	detectMs: number;
	initMs: number;
	healthPollMs: number;
	healthIntervalMs: number;
	healthProbeMs: number;
	pushMs: number;
	stopMs: number;
	killMs: number;
}

const DEFAULT_TIMEOUTS: LauncherTimeouts = {
	detectMs: 4_000,
	initMs: 120_000, // first run may npx-fetch the package — bounded, never open-ended
	healthPollMs: 20_000,
	healthIntervalMs: 500,
	healthProbeMs: 1_500,
	pushMs: 30_000,
	stopMs: 10_000,
	killMs: 3_000,
};

export interface LauncherCommand {
	cmd: string;
	baseArgs: string[];
}

/** The pinned command — asserted by tests (no @latest, no fetch of tags). */
export function defaultLauncherCommand(): LauncherCommand {
	return { cmd: "npx", baseArgs: ["-y", EXCALIDRAW_PIN] };
}

/** Minimal UI contract — every notify from this module is info-level by design. */
export interface CanvasUi {
	notify(message: string, level: "info"): void;
	confirm?: (title: string, message: string) => Promise<boolean | undefined>;
}

export interface RuntimeStatus {
	ok: boolean;
	reason?: string;
}

export type CanvasSpawnFn = (
	command: string,
	args: string[],
	options: { stdio: Array<"pipe" | "ignore">; env?: NodeJS.ProcessEnv },
) => ChildProcess;

export type CanvasFetchFn = (
	url: string,
	init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface LauncherDeps {
	detectRuntime?: () => Promise<RuntimeStatus>;
	spawn?: CanvasSpawnFn;
	fetchImpl?: CanvasFetchFn;
	sleep?: (ms: number) => Promise<void>;
	command?: LauncherCommand;
	timeouts?: Partial<LauncherTimeouts>;
}

interface ResolvedDeps {
	timeouts: LauncherTimeouts;
	command: LauncherCommand;
	detectRuntime: () => Promise<RuntimeStatus>;
	spawn: CanvasSpawnFn;
	fetchImpl: CanvasFetchFn;
	sleep: (ms: number) => Promise<void>;
}

type CanvasSessionState = "unknown" | "enabled" | "disabled" | "unavailable";
type UnreachableReason = "url-not-loopback" | "runtime" | "mcp-start" | "canvas-timeout";
type ReachOutcome = { reachable: true } | { reachable: false; reason: UnreachableReason; detail?: string };

let sessionState: CanvasSessionState = "unknown";
let weStartedCanvas = false;
let testDepsOverride: LauncherDeps | null = null;

/** Test seams — see the file header. */
export function __setCanvasTestDeps(deps: LauncherDeps | null): void {
	testDepsOverride = deps;
}

export function __resetCanvasSession(): void {
	sessionState = "unknown";
	weStartedCanvas = false;
	if (mcp && !mcp.exited) {
		try {
			mcp.child.kill("SIGKILL");
		} catch {
			/* already gone */
		}
	}
	mcp = null;
}

/**
 * Mermaid fence bodies from a document, trimmed + de-duplicated (a design
 * stores the same fence in content and gateContent; renders repeat them).
 */
export function extractMermaidBlocks(text: string): string[] {
	const blocks: string[] = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(/```mermaid[ \t]*\r?\n([\s\S]*?)```/g)) {
		const body = (match[1] ?? "").trim();
		if (body.length > 0 && !seen.has(body)) {
			seen.add(body);
			blocks.push(body);
		}
	}
	return blocks;
}

/** Global kill-switch: VELPARI_EXCALIDRAW=0|off|false|disabled → total no-op. */
function killSwitchOff(): boolean {
	const value = process.env.VELPARI_EXCALIDRAW?.toLowerCase();
	return value === "0" || value === "off" || value === "false" || value === "disabled";
}

export function canvasBaseUrl(): string {
	return process.env.EXPRESS_SERVER_URL || DEFAULT_CANVAS_URL;
}

/** Push/stop only ever talk to loopback (§3.5; mirrors the package's own guard). */
export function isLoopbackUrl(raw: string): boolean {
	try {
		const { hostname } = new URL(raw);
		return hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || hostname.startsWith("127.");
	} catch {
		return false;
	}
}

function defaultDepsForContext(): LauncherDeps | null {
	if (process.env.NODE_TEST_CONTEXT) return null;
	return {};
}

/** Structural host shape — satisfies BOTH the design approve ctx (ExtensionCommandContext) and the export ctx (ExtensionContext) without naming a peer type at L0. */
export interface CanvasUiHost {
	ui: {
		notify(message: string, level: "info" | "error" | "warning"): void;
		confirm?(title: string, message: string): unknown;
	};
}

export function canvasUiFor(ctx: CanvasUiHost): CanvasUi {
	return {
		notify: (message, level) => ctx.ui.notify(message, level),
		// Only a literal `true` confirms (wireframe mocks answer "ok" etc.).
		confirm:
			typeof ctx.ui.confirm === "function"
				? async (title, message) => (await ctx.ui.confirm!(title, message)) === true
				: undefined,
	};
}

function resolveDeps(opts?: LauncherDeps): ResolvedDeps | null {
	const chosen = opts ?? testDepsOverride ?? defaultDepsForContext();
	if (chosen === null) return null;
	const timeouts: LauncherTimeouts = { ...DEFAULT_TIMEOUTS, ...chosen.timeouts };
	return {
		timeouts,
		command: chosen.command ?? defaultLauncherCommand(),
		detectRuntime: chosen.detectRuntime ?? (() => defaultDetectRuntime(timeouts)),
		spawn: chosen.spawn ?? ((cmd, args, options) => nodeSpawn(cmd, args, options)),
		fetchImpl: chosen.fetchImpl ?? ((url, init) => globalThis.fetch(url, init)),
		sleep: chosen.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
	};
}

/** `node -v` / `npx -v` gate — no spawn of npx at all when the runtime is missing. */
export async function __runVersionProbe(
	cmd: string,
	args: string[],
	minMajor: number,
	timeoutMs: number,
): Promise<RuntimeStatus> {
	return await new Promise<RuntimeStatus>((resolve) => {
		let child: ChildProcess;
		try {
			child = nodeSpawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		} catch {
			resolve({ ok: false, reason: `${cmd} is not available` });
			return;
		}
		let out = "";
		let settled = false;
		const finish = (status: RuntimeStatus): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(status);
		};
		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				/* already gone */
			}
			finish({ ok: false, reason: `${cmd} -v timed out after ${timeoutMs}ms` });
		}, timeoutMs);
		child.stdout?.on("data", (chunk: Buffer | string) => {
			out += String(chunk);
		});
		child.on("error", () => finish({ ok: false, reason: `${cmd} is not available` }));
		child.on("exit", (code) => {
			if (code !== 0) {
				finish({ ok: false, reason: `${cmd} -v exited with code ${code ?? "null"}` });
				return;
			}
			if (minMajor > 0) {
				const parsed = /v(\d+)\./.exec(out);
				const major = parsed ? Number(parsed[1]) : Number.NaN;
				if (!Number.isFinite(major) || major < minMajor) {
					finish({ ok: false, reason: `${cmd} >= ${minMajor} required (found ${out.trim() || "unknown"})` });
					return;
				}
			}
			finish({ ok: true });
		});
	});
}

async function defaultDetectRuntime(t: LauncherTimeouts): Promise<RuntimeStatus> {
	const node = await __runVersionProbe("node", ["-v"], 20, t.detectMs);
	if (!node.ok) return node;
	return await __runVersionProbe("npx", ["-v"], 0, t.detectMs);
}

// ---------------------------------------------------------------------------
// MCP stdio client (newline-delimited JSON-RPC 2.0)
// ---------------------------------------------------------------------------

interface McpHandle {
	child: ChildProcess;
	nextId: number;
	pending: Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
	>;
	stdoutBuffer: string;
	stderrTail: string;
	exited: boolean;
	exitWaiters: Array<() => void>;
}

let mcp: McpHandle | null = null;

function wireMcp(h: McpHandle): void {
	h.child.stdout?.on("data", (chunk: Buffer | string) => {
		h.stdoutBuffer += String(chunk);
		let nl = h.stdoutBuffer.indexOf("\n");
		while (nl >= 0) {
			const line = h.stdoutBuffer.slice(0, nl).trim();
			h.stdoutBuffer = h.stdoutBuffer.slice(nl + 1);
			if (line.length > 0) handleMcpLine(h, line);
			nl = h.stdoutBuffer.indexOf("\n");
		}
	});
	h.child.stderr?.on("data", (chunk: Buffer | string) => {
		h.stderrTail = (h.stderrTail + String(chunk)).slice(-2_000);
	});
	// stdin errors (EPIPE when the child dies) must not crash the process.
	h.child.stdin?.on("error", () => closeMcp(h, "MCP server stdin closed"));
	h.child.on("error", () => closeMcp(h, "MCP server process error"));
	h.child.on("exit", (code, signal) =>
		closeMcp(h, `MCP server exited (code ${code ?? "null"}${signal ? `, ${signal}` : ""})`),
	);
}

function handleMcpLine(h: McpHandle, line: string): void {
	let msg: unknown;
	try {
		msg = JSON.parse(line);
	} catch {
		return; // non-JSON chatter on stdout — ignore (fixture emits it)
	}
	if (msg === null || typeof msg !== "object") return;
	const rec = msg as { id?: unknown; result?: unknown; error?: { message?: unknown } };
	if (typeof rec.id !== "number") return; // notifications / server-initiated traffic — not ours
	const waiter = h.pending.get(rec.id);
	if (!waiter) return; // unknown or stale id — ignore
	h.pending.delete(rec.id);
	clearTimeout(waiter.timer);
	if (rec.error !== undefined && rec.error !== null) {
		const detail = typeof rec.error.message === "string" ? rec.error.message : JSON.stringify(rec.error);
		waiter.reject(new Error(`MCP error: ${detail}`));
		return;
	}
	waiter.resolve(rec.result);
}

function closeMcp(h: McpHandle, reason: string): void {
	if (h.exited) return;
	h.exited = true;
	for (const [, waiter] of h.pending) {
		clearTimeout(waiter.timer);
		waiter.reject(new Error(reason));
	}
	h.pending.clear();
	if (mcp === h) mcp = null;
	const waiters = h.exitWaiters.splice(0, h.exitWaiters.length);
	for (const waiter of waiters) waiter();
}

function mcpRequest(h: McpHandle, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
	return new Promise((resolve, reject) => {
		if (h.exited) {
			reject(new Error("MCP server is not running"));
			return;
		}
		const input = h.child.stdin;
		if (!input || input.destroyed) {
			reject(new Error("MCP server stdin is unavailable"));
			return;
		}
		const id = h.nextId++;
		const timer = setTimeout(() => {
			h.pending.delete(id);
			const tail = (h.stderrTail.slice(-200) || "none").replace(/\s+/g, " ");
			reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms (stderr tail: ${tail})`));
		}, timeoutMs);
		h.pending.set(id, { resolve, reject, timer });
		input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
	});
}

function mcpNotify(h: McpHandle, method: string, params: unknown): void {
	const input = h.child.stdin;
	if (h.exited || !input || input.destroyed) return;
	input.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

async function startMcp(deps: ResolvedDeps): Promise<void> {
	await killMcp(deps);
	const child = deps.spawn(deps.command.cmd, [...deps.command.baseArgs], {
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env },
	});
	const handle: McpHandle = {
		child,
		nextId: 1,
		pending: new Map(),
		stdoutBuffer: "",
		stderrTail: "",
		exited: false,
		exitWaiters: [],
	};
	wireMcp(handle);
	try {
		await mcpRequest(
			handle,
			"initialize",
			{
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "pi-velpari", version: process.env.npm_package_version ?? "0.0.0" },
			},
			deps.timeouts.initMs,
		);
	} catch (err) {
		await killMcp(deps);
		throw new Error(`Excalidraw MCP server failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
	}
	mcpNotify(handle, "notifications/initialized", {});
	mcp = handle;
}

async function killMcp(deps?: ResolvedDeps): Promise<void> {
	const handle = mcp;
	mcp = null;
	if (!handle || handle.exited) return;
	const exited = new Promise<void>((resolve) => {
		if (handle.exited) resolve();
		else handle.exitWaiters.push(resolve);
	});
	try {
		handle.child.kill("SIGTERM");
	} catch {
		/* already gone */
	}
	const sleep = deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	await Promise.race([exited, sleep(deps?.timeouts.killMs ?? DEFAULT_TIMEOUTS.killMs)]);
	if (!handle.exited) {
		try {
			handle.child.kill("SIGKILL");
		} catch {
			/* already gone */
		}
		await Promise.race([exited, sleep(500)]);
	}
	closeMcp(handle, "MCP server killed");
}

// ---------------------------------------------------------------------------
// Reachability: loopback guard → /health identity probe → on-demand start
// ---------------------------------------------------------------------------

async function probeCanvas(deps: ResolvedDeps): Promise<boolean> {
	if (!isLoopbackUrl(canvasBaseUrl())) return false;
	try {
		const res = await deps.fetchImpl(`${canvasBaseUrl()}/health`, {
			signal: AbortSignal.timeout(deps.timeouts.healthProbeMs),
		});
		if (!res.ok) return false;
		const body = await res.json();
		if (body !== null && typeof body === "object" && "service" in body) {
			return (body as { service?: unknown }).service === CANVAS_SERVICE_NAME;
		}
		return false;
	} catch {
		return false;
	}
}

async function ensureReachable(deps: ResolvedDeps): Promise<ReachOutcome> {
	if (!isLoopbackUrl(canvasBaseUrl())) return { reachable: false, reason: "url-not-loopback" };
	const wasUp = await probeCanvas(deps);
	if (mcp === null || mcp.exited) {
		const runtime = await deps.detectRuntime();
		if (!runtime.ok) return { reachable: false, reason: "runtime" };
		try {
			await startMcp(deps);
		} catch (err) {
			return {
				reachable: false,
				reason: "mcp-start",
				detail: (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " "),
			};
		}
	}
	if (!wasUp) {
		const deadline = Date.now() + deps.timeouts.healthPollMs;
		let up = false;
		while (Date.now() < deadline) {
			await deps.sleep(deps.timeouts.healthIntervalMs);
			if (await probeCanvas(deps)) {
				up = true;
				break;
			}
		}
		if (!up) return { reachable: false, reason: "canvas-timeout" };
		// The canvas was down until OUR start brought it up → we own the daemon (§2.2).
		weStartedCanvas = true;
	}
	return { reachable: true };
}

// ---------------------------------------------------------------------------
// Push + summaries
// ---------------------------------------------------------------------------

interface PushOutcome {
	pushed: number;
	browserNeeded: number;
	failed: number;
	detail: string;
}

function toolResultView(resp: unknown): { isError: boolean; text: string } {
	if (resp === null || typeof resp !== "object") return { isError: true, text: "empty MCP response" };
	const rec = resp as { isError?: unknown; content?: unknown };
	const items = Array.isArray(rec.content) ? rec.content : [];
	const text = items
		.map((item) =>
			item !== null &&
			typeof item === "object" &&
			"text" in item &&
			typeof (item as { text?: unknown }).text === "string"
				? (item as { text: string }).text
				: "",
		)
		.join(" ")
		.trim();
	return { isError: rec.isError === true, text: text || "ok" };
}

async function pushMermaidBlocks(blocks: string[], deps: ResolvedDeps): Promise<PushOutcome> {
	const out: PushOutcome = { pushed: 0, browserNeeded: 0, failed: 0, detail: "" };
	const handle = mcp;
	if (!handle || handle.exited) {
		out.failed = blocks.length;
		out.detail = "the MCP connection closed before the push";
		return out;
	}
	for (const block of blocks) {
		try {
			const resp = await mcpRequest(
				handle,
				"tools/call",
				{ name: "create_from_mermaid", arguments: { mermaidDiagram: block } },
				deps.timeouts.pushMs,
			);
			const view = toolResultView(resp);
			if (!view.isError) {
				out.pushed++;
				continue;
			}
			out.failed++;
			out.detail = view.text;
			if (/browser|tab/i.test(view.text)) out.browserNeeded++;
		} catch (err) {
			out.failed++;
			out.detail = err instanceof Error ? err.message : String(err);
		}
	}
	return out;
}

function enableMessage(sourceLabel: string): string {
	return (
		`Velpari can push the ${sourceLabel}'s Mermaid diagrams to a local Excalidraw canvas. ` +
		`Enabling starts the local MCP server on demand via \`npx ${EXCALIDRAW_PIN}\` ` +
		`(exact pin; the first run may download the package). Canvas: ${canvasBaseUrl()}. ` +
		`Mermaid stays the source of truth. Enable for this session?`
	);
}

function reachMessage(reason: UnreachableReason, detail?: string): string {
	switch (reason) {
		case "url-not-loopback":
			return `Excalidraw canvas unreachable: EXPRESS_SERVER_URL must stay loopback — staying with the Mermaid path.`;
		case "runtime":
			return `Excalidraw canvas unavailable: Node (>= 20) and npx are required — staying with the Mermaid path.`;
		case "mcp-start":
			return `Excalidraw canvas unavailable: the local MCP server did not start${detail ? ` (${detail})` : ""} — staying with the Mermaid path.`;
		default: // canvas-timeout (and any future reason) → unreachable notice
			return `Excalidraw canvas did not become reachable at ${canvasBaseUrl()} — staying with the Mermaid path.`;
	}
}

function pushSummary(outcome: PushOutcome, base: string): string {
	if (outcome.failed === 0 && outcome.browserNeeded === 0) {
		return `Pushed ${outcome.pushed} diagram(s) to ${base} — open it in your browser to view.`;
	}
	const lines: string[] = [];
	if (outcome.pushed > 0) lines.push(`Pushed ${outcome.pushed}/${outcome.pushed + outcome.failed} diagram(s).`);
	if (outcome.browserNeeded > 0) {
		lines.push(`The canvas needs a browser tab: open ${base} and push again — Mermaid stays the source of truth.`);
	}
	if (outcome.failed > 0 && outcome.browserNeeded === 0) {
		const detail = outcome.detail ? `: ${outcome.detail}` : "";
		lines.push(`Canvas push incomplete (${outcome.failed} failed${detail}) — Mermaid stays the source of truth.`);
	}
	return lines.join(" ") || `Canvas push incomplete at ${base} — Mermaid stays the source of truth.`;
}

export interface CanvasOfferOptions {
	mermaidBlocks: string[];
	sourceLabel: string;
	deps?: LauncherDeps;
}

/**
 * The one entry point (design approve + export flow). Offer-only-when-reachable;
 * ALWAYS resolves — every failure path is an info-level notify (graceful
 * fallback to the existing Mermaid path), never an exception.
 */
export async function offerCanvasPush(ui: CanvasUi, opts: CanvasOfferOptions): Promise<void> {
	try {
		if (opts.mermaidBlocks.length === 0) return;
		if (killSwitchOff()) return;
		const deps = resolveDeps(opts.deps);
		if (deps === null) return;
		const confirm = ui.confirm;
		if (typeof confirm !== "function") return; // no consent surface → no network, silent
		if (sessionState === "disabled" || sessionState === "unavailable") return;
		if (sessionState === "unknown") {
			const enable = await confirm("Excalidraw canvas", enableMessage(opts.sourceLabel));
			if (enable !== true) {
				sessionState = "disabled";
				return;
			}
			sessionState = "enabled";
		}
		const reach = await ensureReachable(deps);
		if (!reach.reachable) {
			if (reach.reason === "runtime") sessionState = "unavailable";
			ui.notify(reachMessage(reach.reason, reach.detail), "info");
			return;
		}
		const base = canvasBaseUrl();
		const doPush = await confirm(
			"Push to canvas",
			`${opts.mermaidBlocks.length} Mermaid diagram(s) from the ${opts.sourceLabel} are ready. ` +
				`Push them to the Excalidraw canvas at ${base}? Mermaid stays the source of truth.`,
		);
		if (doPush !== true) {
			ui.notify(`Canvas ready at ${base} — nothing pushed; Mermaid stays the source of truth.`, "info");
			return;
		}
		const outcome = await pushMermaidBlocks(opts.mermaidBlocks, deps);
		ui.notify(pushSummary(outcome, base), "info");
	} catch (err) {
		const raw = err instanceof Error ? err.message : String(err);
		const short = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
		ui.notify(`Canvas push unavailable (${short}) — staying with the Mermaid path.`, "info");
	}
}

/**
 * session_shutdown hook (§2.2): terminate OUR MCP child and — only when this
 * session's start brought the canvas up — run the pinned CLI `stop` so no
 * daemon is left behind. Best-effort: never throws across the hook.
 */
export async function shutdownLauncher(): Promise<void> {
	const deps = resolveDeps(undefined);
	try {
		await killMcp(deps ?? undefined);
	} catch {
		/* best-effort teardown */
	}
	if (weStartedCanvas && deps !== null) {
		try {
			const child = deps.spawn(deps.command.cmd, [...deps.command.baseArgs, "stop"], {
				stdio: ["ignore", "ignore", "pipe"],
				env: { ...process.env },
			});
			await new Promise<void>((resolve) => {
				const timer = setTimeout(() => {
					try {
						child.kill("SIGKILL");
					} catch {
						/* gone */
					}
					resolve();
				}, deps.timeouts.stopMs);
				child.on("error", () => {
					clearTimeout(timer);
					resolve();
				});
				child.on("exit", () => {
					clearTimeout(timer);
					resolve();
				});
			});
		} catch {
			/* stop is best-effort */
		}
	}
	weStartedCanvas = false;
	sessionState = "unknown";
}
