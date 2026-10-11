#!/usr/bin/env node
// scripts/eval-run.mjs — velpari golden-mission runner (Phase C, Lane C1).
//
// Two modes:
//   * FULL RUN (paid — CI/manual): seeds a committed golden-mission fixture,
//     git-inits a workspace, spawns `pi --mode rpc` and drives the velpari
//     stage sequence (same flow as scripts/e2e-rpc-test.mjs), then reads the
//     workspace `Eval/<project>/eval.db` and emits the locked report via
//     scripts/eval-report.mjs.
//   * REPORT-ONLY (`--report-only <workspace>`, NO LLM): builds the report
//     from an existing workspace eval DB — the local-verification path.
//
// Node built-ins only. Import is side-effect free (main() is guarded), so the
// argument/mission/report helpers are unit-testable.
//
// Usage:
//   node scripts/eval-run.mjs --mission <slug> [--model <id>] [--until <stage|handoff>]
//                             [--workspace <dir|tmp>] [--out <file>] [--spawn-scouts]
//   node scripts/eval-run.mjs --report-only <workspace> [--project <name>] [--run-id <id>]
//                             [--mission <slug>] [--model <id>] [--out <file>]
//   node scripts/eval-run.mjs --help

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, readEvalRows, resolveTarget } from "./eval-report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..");
export const DEFAULT_FIXTURES_DIR = join(PROJECT_ROOT, "Doc", "test-fixtures", "eval-missions");
const EXTENSION_PATH = join(PROJECT_ROOT, "dist", "pi-extension", "src", "index.js");
/** Fixed project name answered at the configure-inputs prompt; the eval DB groups under it. */
export const PROJECT_NAME = "EvalGoldenApp";

const COMMAND_TIMEOUT_MS = 120000;
// Startup is special: the first get_commands waits for extension AND provider
// loading (the cline provider resolves its model catalog over the network), so it
// gets a longer budget while later commands stay at COMMAND_TIMEOUT_MS (ledger P5).
const STARTUP_TIMEOUT_MS = Number(process.env.EVAL_STARTUP_TIMEOUT_MS ?? 300000);
const STAGE_TIMEOUT_MS = Number(process.env.EVAL_STAGE_TIMEOUT_MS ?? 20 * 60 * 1000);
const QUIET_MS = Number(process.env.EVAL_QUIET_MS ?? 20000);

// ---------------------------------------------------------------------------
// Mission fixtures (pure parsing)
// ---------------------------------------------------------------------------

/** List available mission slugs (filename basenames without `.md`). */
export function listMissions(fixturesDir = DEFAULT_FIXTURES_DIR) {
	try {
		return readdirSync(fixturesDir)
			.filter((f) => f.endsWith(".md"))
			.map((f) => f.slice(0, -3))
			.sort();
	} catch {
		return [];
	}
}

/** First non-empty paragraph of a text block. */
function firstParagraph(text) {
	const parts = String(text).split(/\n\s*\n/);
	return (parts[0] ?? "").trim();
}

/**
 * Parse a mission fixture markdown file (pure).
 * Expects YAML-ish frontmatter (`slug`, `title`) and `## Mission`,
 * `## Scope Boundaries`, `## Expected Core Capabilities` sections.
 * @param {string} text
 * @param {string} fallbackSlug
 * @returns {{ slug: string, title: string, mission: string, scope: string, capabilities: string }}
 */
export function parseMissionMarkdown(text, fallbackSlug) {
	const lines = String(text).split(/\r?\n/);
	let bodyStart = 0;
	const fm = {};
	if (lines[0]?.trim() === "---") {
		let j = 1;
		while (j < lines.length && lines[j].trim() !== "---") {
			const m = lines[j].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
			if (m) fm[m[1]] = m[2].trim();
			j++;
		}
		bodyStart = j + 1;
	}
	const body = lines.slice(bodyStart);
	const sections = {};
	let current = null;
	for (const line of body) {
		const h = line.match(/^##\s+(.+?)\s*$/);
		if (h) {
			current = h[1].trim().toLowerCase();
			sections[current] = [];
			continue;
		}
		if (current) sections[current].push(line);
	}
	const get = (name) => (sections[name.toLowerCase()] ?? []).join("\n").trim();
	const headingTitle = body.find((l) => /^#\s+/.test(l))?.replace(/^#\s+/, "").trim();
	return {
		slug: fm.slug || fallbackSlug,
		title: fm.title || headingTitle || fallbackSlug,
		mission: firstParagraph(get("mission")),
		scope: get("scope boundaries"),
		capabilities: get("expected core capabilities"),
	};
}

/**
 * Load + parse a mission fixture by slug. Never throws.
 * @returns {{ ok: true, ...parsed, path: string, raw: string } | { ok: false, error: string }}
 */
export function loadMission(slug, opts = {}) {
	const fixturesDir = opts.fixturesDir ?? DEFAULT_FIXTURES_DIR;
	if (!slug || typeof slug !== "string") return { ok: false, error: "mission slug is required" };
	if (/[/\\]/.test(slug) || slug.includes("..")) return { ok: false, error: `invalid mission slug: ${slug}` };
	const file = join(fixturesDir, `${slug}.md`);
	if (!existsSync(file)) {
		const available = listMissions(fixturesDir);
		return {
			ok: false,
			error: `unknown mission "${slug}" — available: ${available.length ? available.join(", ") : "(none)"}`,
		};
	}
	let raw;
	try {
		raw = readFileSync(file, "utf8");
	} catch (err) {
		return { ok: false, error: `cannot read mission "${slug}": ${err?.message ?? err}` };
	}
	return { ok: true, ...parseMissionMarkdown(raw, slug), path: file, raw };
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse eval-run CLI args.
 * @param {string[]} argv
 * @returns {object} Parsed args (with `help`/`error`).
 */
export function parseRunArgs(argv) {
	const args = {
		mission: null,
		model: null,
		until: null,
		workspace: null,
		reportOnly: null,
		project: null,
		runId: null,
		out: null,
		spawnScouts: false,
		help: false,
		error: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		switch (a) {
			case "--help":
			case "-h":
				args.help = true;
				break;
			case "--mission":
				args.mission = next() ?? null;
				break;
			case "--model":
				args.model = next() ?? null;
				break;
			case "--until":
				args.until = next() ?? null;
				break;
			case "--workspace":
				args.workspace = next() ?? null;
				break;
			case "--report-only":
				args.reportOnly = next() ?? null;
				break;
			case "--project":
				args.project = next() ?? null;
				break;
			case "--run-id":
				args.runId = next() ?? null;
				break;
			case "--out":
				args.out = next() ?? null;
				break;
			case "--spawn-scouts":
				args.spawnScouts = true;
				break;
			default:
				args.error = a.startsWith("--") ? `unknown option: ${a}` : `unexpected argument: ${a}`;
		}
	}
	return args;
}

/** Usage text. */
export function usage() {
	return [
		"Usage: node scripts/eval-run.mjs [options]",
		"",
		"Full golden run (paid — spawns pi):",
		"  --mission <slug>      golden mission fixture under Doc/test-fixtures/eval-missions/",
		"  --model <id>          model id passed to the pi spawn",
		"  --until <stage|handoff>  stop after this stage (default: handoff-ready)",
		"  --workspace <dir|tmp> workspace directory (default: a fresh temp dir)",
		"  --spawn-scouts        spawn the 4 real scouts per stage (slower; needs a session file)",
		"",
		"Report-only (no LLM):",
		"  --report-only <workspace>  build the report from an existing workspace eval DB",
		"  --project <name>      eval DB project name (else resolved from workspace config)",
		"  --run-id <id>         restrict rows to one velpari run id",
		"",
		"Common:",
		"  --out <file>          write the report JSON here (default: stdout)",
		"  --help                show this help",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Stage table (pinned from core/constants.ts + ops/approve.ts STAGE_APPROVE_MAP)
// ---------------------------------------------------------------------------

const STAGES = [
	{ cmd: "/velpari-prd", approve: "/velpari-prd-approve", during: "drafting-prd", after: "drafted-prd", dir: "prd", yaml: "PRD", extra: "" },
	{ cmd: "/velpari-rtm", approve: "/velpari-rtm-approve", during: "building-rtm", after: "built-rtm", dir: "rtm", yaml: "RTM", extra: "" },
	{
		cmd: "/velpari-feasibility",
		approve: "/velpari-feasibility-approve",
		during: "analyzing-feasibility",
		after: "analyzed-feasibility",
		dir: "feasibility",
		yaml: "feasibility-study",
		extra:
			'REQUIRED: persist the decision by calling the velpari_feasibility_session tool actions "set-decision" and "select-language" (select TypeScript), or the approve hard-blocks.',
	},
	{
		cmd: "/velpari-architecture-generator",
		approve: "/velpari-architecture-generator-approve",
		during: "designing",
		after: "designed",
		dir: "design",
		yaml: "design",
		extra:
			"The design working copy MUST include a '## Architecture Decisions' section with ADR-001 (status accepted, at least 2 options) and C4 Mermaid diagrams (context, container, component), or the publish gate hard-blocks.",
	},
	{
		cmd: "/velpari-atomic-function",
		approve: "/velpari-atomic-function-approve",
		during: "analyzing-atomic-functions",
		after: "analyzed-atomic-functions",
		dir: "atomic-functions",
		yaml: "atomic-functions",
		extra: "",
	},
	{
		cmd: "/velpari-pseudocode",
		approve: "/velpari-pseudocode-approve",
		during: "writing-pseudocode",
		after: "wrote-pseudocode",
		dir: "pseudocode",
		yaml: "pseudocode",
		extra: "Include 'AF: AF-N' reference lines for every atomic function, or the id-coverage gate blocks the publish.",
	},
	{
		cmd: "/velpari-testplan",
		approve: "/velpari-testplan-approve",
		during: "planning-tests",
		after: "planned-tests",
		dir: "tests",
		yaml: "test-plan",
		extra: "Write BOTH test-plan and test-cases markdown files in the tests working dir; test cases need a Traces column referencing FR/AF ids.",
	},
	{
		cmd: "/velpari-development-order",
		approve: "/velpari-development-order-approve",
		during: "ordering-development",
		after: "ordered-development",
		dir: "development-order",
		yaml: "development-order",
		extra: "Include 'AFs:' lists referencing atomic function ids.",
	},
	{
		cmd: "/velpari-final-design",
		approve: "/velpari-final-design-approve",
		during: "finalizing-design",
		after: "finalized-design",
		dir: "final-design",
		yaml: "final-design",
		extra: "",
	},
];

/**
 * Map `--until` to the stage to stop AFTER. Accepts `handoff`, an
 * in-progress (`during`) stage, or an already-completed (`after`) stage.
 */
export function resolveUntil(value) {
	if (!value || value === "handoff" || value === "handoff-ready") return "handoff-ready";
	const s = STAGES.find((x) => x.during === value || x.after === value);
	return s ? s.after : value;
}

// ---------------------------------------------------------------------------
// RPC driver (ported from scripts/e2e-rpc-test.mjs — the proven tier3 flow)
// ---------------------------------------------------------------------------

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

class RpcClient {
	constructor(proc, stderrLog) {
		this.proc = proc;
		this.lineBuf = "";
		this.pendingResponses = new Map();
		this.eventLog = [];
		this.commandList = [];
		this.notifyLog = [];
		this.lastEventAt = Date.now();
		this.onEvent = null;
		this.onUiRequest = null;
		this._reqCounter = 0;

		proc.stdout.on("data", (chunk) => {
			this.lineBuf += chunk.toString();
			let nl;
			while ((nl = this.lineBuf.indexOf("\n")) !== -1) {
				const line = this.lineBuf.slice(0, nl).replace(/\r$/, "");
				this.lineBuf = this.lineBuf.slice(nl + 1);
				try {
					this._handle(JSON.parse(line));
				} catch {
					// skip non-JSON noise
				}
			}
		});
		proc.stderr.on("data", (chunk) => {
			this.stderrBuf = (this.stderrBuf + chunk.toString()).slice(-4000);
			try {
				appendFileSync(stderrLog, chunk);
			} catch {
				// report dir may not exist yet
			}
		});
	}

	/** Last ~4 KB of the child's stderr — the only clue when pi dies at startup. */
	stderrTail() {
		return (this.stderrBuf || "").trim() || "(no stderr)";
	}

	_handle(obj) {
		this.lastEventAt = Date.now();
		this.eventLog.push(obj);
		const index = this.eventLog.length - 1;

		if (obj.type === "extension_ui_request") {
			if (["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"].includes(obj.method)) {
				if (obj.method === "notify") this.notifyLog.push({ msg: obj.message, type: obj.notifyType });
				return;
			}
			if (this.onUiRequest) {
				const response = this.onUiRequest(obj) ?? { cancelled: true };
				this._send({ type: "extension_ui_response", id: obj.id, ...response });
			}
			return;
		}
		if (obj.type === "response" && obj.id !== undefined) {
			const resolver = this.pendingResponses.get(obj.id);
			if (resolver) {
				resolver(obj);
				this.pendingResponses.delete(obj.id);
			}
		}
		if (obj.type === "response" && obj.command === "get_commands" && obj.success) {
			this.commandList = obj.data.commands;
		}
		if (this.onEvent) this.onEvent(obj, index);
	}

	_send(cmd) {
		this.proc.stdin.write(`${JSON.stringify(cmd)}\n`);
	}

	sendCommand(cmd, timeoutMs = COMMAND_TIMEOUT_MS) {
		const id = `req-${++this._reqCounter}`;
		this._send({ ...cmd, id });
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingResponses.delete(id);
				reject(new Error(`Timeout waiting for response to ${cmd.type}`));
			}, timeoutMs);
			this.pendingResponses.set(id, (obj) => {
				clearTimeout(timer);
				resolve(obj);
			});
		});
	}
}

/** UI request router — titles/labels pinned from live source (same as tier3). */
function makeUiRouter() {
	const pick = (opts, re) => opts.find((o) => re.test(o)) ?? null;
	return (obj) => {
		const title = obj.title ?? "";
		const opts = obj.options ?? [];
		if (obj.method === "input") {
			if (/Project name/i.test(title)) return { value: PROJECT_NAME };
			if (/Framework language/i.test(title)) return { value: "TypeScript" };
			if (/Libraries/i.test(title)) return { value: "" };
			if (/Runtime/i.test(title)) return { value: "Node 22" };
			return { value: "" };
		}
		if (obj.method === "select") {
			if (/Atomic-function tier/i.test(title)) return { value: pick(opts, /Keep current/) ?? opts[0] };
			if (/Safety class/i.test(title)) return { value: pick(opts, /Keep current/) ?? opts[0] };
			if (/Safety Integrity Level/i.test(title)) return { value: pick(opts, /Keep current/) ?? opts[0] };
			if (/Reviewer sub-agent/i.test(title)) return { value: pick(opts, /Keep current/) ?? opts[0] };
			if (/Project paths/i.test(title)) return { value: pick(opts, /^Finish/) ?? opts[opts.length - 1] };
			if (/Which scans should run/i.test(title)) return { value: pick(opts, /Skip scans/) ?? opts[0] };
			const proceed = pick(opts, /Proceed — generate the architecture/);
			if (proceed) return { value: proceed };
			return { cancelled: true };
		}
		if (obj.method === "confirm") {
			if (/Publish handoff/i.test(title)) return { confirmed: true };
			if (/Community scan|Web search dispatch/i.test(title)) return { confirmed: false };
			if (/Upstream inputs changed/i.test(title)) return { confirmed: true };
			if (/Excalidraw/i.test(title)) return { confirmed: false };
			return { confirmed: false };
		}
		if (obj.method === "editor") return { value: "" };
		return { cancelled: true };
	};
}

async function sendPrompt(client, message) {
	for (let attempt = 1; attempt <= 3; attempt++) {
		const mark = client.eventLog.length;
		const notifyMark = client.notifyLog.length;
		const resp = await client.sendCommand({ type: "prompt", message });
		if (resp.success) return { ok: true, mark, notifyMark };
		if (/already processing/i.test(String(resp.error))) {
			await waitSettled(client, mark, STAGE_TIMEOUT_MS).catch(() => {});
			continue;
		}
		return { ok: false, mark, notifyMark };
	}
	return { ok: false, mark: client.eventLog.length, notifyMark: client.notifyLog.length };
}

async function waitSettled(client, mark, timeoutMs, condition) {
	const deadline = Date.now() + timeoutMs;
	const sawSettled = () => client.eventLog.slice(mark).some((e) => e.type === "agent_settled");
	for (;;) {
		if ((condition ? condition() : false) || sawSettled()) break;
		if (Date.now() >= deadline) throw new Error(`timeout waiting for step to settle (${timeoutMs}ms)`);
		if (assistantErrorStreak(client) >= 2)
			throw new Error(`fail-fast: consecutive assistant errors — ${lastAssistantError(client).slice(0, 300)}`);
		await sleep(2000);
	}
	for (;;) {
		const idleFor = Date.now() - client.lastEventAt;
		if (idleFor >= QUIET_MS) return;
		if (Date.now() >= deadline) throw new Error(`timeout waiting for agent quiet (${timeoutMs}ms)`);
		await sleep(Math.min(5000, QUIET_MS - idleFor + 50));
	}
}

function newNotifies(client, notifyMark) {
	return client.notifyLog.slice(notifyMark);
}

function notifyMatched(client, notifyMark, re) {
	return newNotifies(client, notifyMark).some((n) => re.test(n.msg ?? ""));
}

function notifyDump(client, notifyMark) {
	return newNotifies(client, notifyMark)
		.map((n) => `[${n.type ?? "info"}] ${n.msg}`)
		.join(" | ")
		.slice(0, 600);
}

async function lastAssistantText(client) {
	try {
		const resp = await client.sendCommand({ type: "get_last_assistant_text" });
		return resp.success && resp.data?.text ? String(resp.data.text) : "(no assistant text)";
	} catch {
		return "(get_last_assistant_text failed)";
	}
}

function assistantErrorStreak(client) {
	let streak = 0;
	for (let i = client.eventLog.length - 1; i >= 0; i--) {
		const e = client.eventLog[i];
		if (e.type !== "message_end" || e.message?.role !== "assistant") continue;
		if (e.message.stopReason === "error") streak++;
		else break;
	}
	return streak;
}

function lastAssistantError(client) {
	for (let i = client.eventLog.length - 1; i >= 0; i--) {
		const e = client.eventLog[i];
		if (e.type === "message_end" && e.message?.role === "assistant" && e.message.stopReason === "error") {
			return String(e.message.errorMessage ?? "unknown assistant error");
		}
	}
	return "unknown assistant error";
}

const BRAINSTORM_GUIDANCE = [
	"Work autonomously — do NOT ask me questions, make reasonable assumptions for this small project.",
	"Complete the brainstorm lifecycle now: skip scans and subagent spawning;",
	'call the velpari_brainstorm_session tool with action "confirm-understanding";',
	"resolve every decision-ledger question so nothing stays in draft or discussing;",
	"then write the brainstorm notes working copy with ALL required sections filled",
	"(Mission, Interview Answers, Scout Proposals, Decision Summary, Agreed, Not wanted, Open — no _TBD_).",
	"Stop when the notes file is complete.",
].join(" ");

function stageGuidance(extra) {
	return [
		"Work autonomously — do NOT ask me questions and do NOT spawn subagents (write everything yourself).",
		"Complete this stage now: read the stage instructions and the DB input slices,",
		"then write the working copy markdown file(s) AND the payload JSON exactly as the instructions require",
		"(the payload file under the payload/ directory).",
		extra,
		"Stop when all files are written.",
	].join(" ");
}

function readState(workspace) {
	return JSON.parse(readFileSync(join(workspace, ".pi", "velpari", "state.json"), "utf8"));
}

function listFiles(dir) {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

function findFile(dir, re) {
	return listFiles(dir).find((f) => re.test(f)) ?? null;
}

function git(workspace, ...args) {
	const r = spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr?.trim()}`);
	return r.stdout.trim();
}

/** True when the user's global settings.json path-loads this repo (avoid double-load). */
function globalVelpariLoaded() {
	try {
		const settingsFile = join(homedir(), ".pi", "agent", "settings.json");
		const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
		return (settings.packages ?? []).some(
			(p) => typeof p === "string" && !p.includes(":") && resolve(join(homedir(), ".pi", "agent"), p) === PROJECT_ROOT,
		);
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Report emission
// ---------------------------------------------------------------------------

/**
 * Read a workspace eval DB, build the locked report, and write it to `out`
 * (or stdout). Fail-open: missing DB → a clear message, no throw.
 */
export async function emitReport({ dbPath, project, runId, mission, model, out }) {
	if (!dbPath || !existsSync(dbPath)) {
		process.stderr.write(`eval-run: no eval DB at ${dbPath ?? "(unresolved)"} — report skipped\n`);
		return { ok: false };
	}
	const rows = await readEvalRows(dbPath, { project, runId });
	const report = buildReport(rows, { model, mission, runId });
	const json = `${JSON.stringify(report, null, 2)}\n`;
	if (out) {
		mkdirSync(dirname(resolve(out)), { recursive: true });
		writeFileSync(resolve(out), json);
		process.stderr.write(`eval-run: wrote ${out} (${report.missions[0]?.stages.length ?? 0} stage rows)\n`);
	} else {
		process.stdout.write(json);
	}
	return { ok: true, report };
}

// ---------------------------------------------------------------------------
// Full golden run (paid)
// ---------------------------------------------------------------------------

/**
 * Build the child-process env for a golden run: default the mux and scrub any
 * HERDR_* keys so the tested extension's mux detection is deterministic
 * (ledger P2). Model credentials are passed through unchanged.
 */
export function buildSpawnEnv(base = process.env) {
	const env = { ...base, PI_SUBAGENT_MUX: base.PI_SUBAGENT_MUX || "tmux", VELPARI_EXCALIDRAW: "0" };
	for (const key of Object.keys(env)) {
		if (key.startsWith("HERDR_")) delete env[key];
	}
	return env;
}

/**
 * Extension paths that MUST be pinned when `-ne` is used. `-ne` disables
 * extension discovery, so a globally installed provider plugin is invisible to
 * the child: without the cline provider the `cline-pass/*` model cannot resolve
 * and pi exits before answering RPC (`get_commands` timeout — proven locally
 * 2026-10-11 and documented in scripts/e2e-rpc-test.mjs:567-590). The subagents
 * plugin is pinned for parity with the tier3 harness when it is installed
 * locally; on CI (install-free) it is simply absent.
 */
export function pinnedExtensionPaths(home = homedir()) {
	const candidates = [
		join(home, ".pi", "agent", "npm", "node_modules", "@maxpaulus", "pi-cline", "index.ts"),
		join(
			home,
			".pi",
			"agent",
			"git",
			"github.com",
			"Adi-Mudi",
			"pi-interactive-subagents",
			"pi-extension",
			"subagents",
			"index.ts",
		),
	];
	return candidates.filter((p) => existsSync(p));
}

/**
 * Wait for a child to actually exit. Returns true when it did.
 * Teardown used to be fire-and-forget (`kill("SIGTERM")` and move on), which
 * lets a still-running pi — and any children it spawned — survive into the next
 * golden run in the same job (ledger P5).
 */
export function waitExit(proc, ms) {
	if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			proc.removeListener("exit", done);
			resolve(true);
		};
		const timer = setTimeout(() => {
			proc.removeListener("exit", done);
			resolve(false);
		}, ms);
		proc.once("exit", done);
	});
}

/** SIGTERM → wait → SIGKILL → wait. Never throws; always returns. */
export async function shutdownWorker(proc, label = "pi", graceMs = 5000) {
	if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
	try {
		proc.kill("SIGTERM");
	} catch {
		return;
	}
	if (await waitExit(proc, graceMs)) return;
	process.stderr.write(`eval-run: ${label} ignored SIGTERM after ${graceMs}ms — SIGKILL\n`);
	try {
		proc.kill("SIGKILL");
	} catch {
		// already gone
	}
	await waitExit(proc, 3000);
}

async function runGolden(args) {
	const mission = loadMission(args.mission, { fixturesDir: args.fixturesDir });
	if (!mission.ok) {
		process.stderr.write(`eval-run: ${mission.error}\n`);
		return 2;
	}
	const until = resolveUntil(args.until);
	const workspace =
		args.workspace && args.workspace !== "tmp"
			? resolve(args.workspace)
			: mkdtempSync(join(tmpdir(), "velpari-eval-ws-"));
	mkdirSync(workspace, { recursive: true });
	const reportDir = join(workspace, ".tmp", "eval-run");
	mkdirSync(reportDir, { recursive: true });
	const stderrLog = join(reportDir, "pi-stderr.log");

	// git init + identity (publish precheck + run binding).
	if (spawnSync("git", ["rev-parse", "--git-dir"], { cwd: workspace }).status !== 0) {
		git(workspace, "init", "-b", "main");
	}
	git(workspace, "config", "user.name", "velpari-eval");
	git(workspace, "config", "user.email", "eval@example.invalid");
	try {
		git(workspace, "commit", "--allow-empty", "-m", "eval workspace init");
	} catch {
		// already has commits
	}

	if (!existsSync(EXTENSION_PATH)) {
		process.stderr.write(`eval-run: ${EXTENSION_PATH} missing — run \`npm run build\` first.\n`);
		return 2;
	}
	const useGlobal = globalVelpariLoaded();
	const spawnArgs = ["--mode", "rpc"];
	if (!args.spawnScouts) spawnArgs.push("--no-session");
	if (!useGlobal) {
		spawnArgs.push("-ne", "--extension", EXTENSION_PATH);
		// `-ne` also hides the globally installed provider plugins — pin them
		// explicitly or the model cannot resolve (see pinnedExtensionPaths).
		for (const ext of pinnedExtensionPaths()) spawnArgs.push("--extension", ext);
	}
	if (args.model) spawnArgs.push("--model", args.model);

	// Env scrub (ledger P2): never leak HERDR_* into the tested extension's
	// mux-detection paths; a golden run must be mux-independent.
	const spawnEnv = buildSpawnEnv();

	// A pi process + its RPC client. Factored so a failed STARTUP can be retried
	// once (ledger P5): inside one CI job the first golden run succeeded and the
	// second spawn of the SAME command died with a get_commands timeout, so the
	// harness now retries once and always prints pi's stderr tail on startup
	// failure — without that tail the cause was invisible.
	const spawnWorker = () => {
		const p = spawn("pi", spawnArgs, { cwd: workspace, stdio: ["pipe", "pipe", "pipe"], env: spawnEnv });
		const c = new RpcClient(p, stderrLog);
		c.onUiRequest = makeUiRouter();
		return { p, c };
	};
	let { p: pi, c: client } = spawnWorker();
	let runId = "";
	let resolvedModel = args.model || null;
	let advancedTo = "";

	try {
		let cmdsResp;
		try {
			cmdsResp = await client.sendCommand({ type: "get_commands" }, STARTUP_TIMEOUT_MS);
		} catch (startupErr) {
			process.stderr.write(
				`eval-run: startup failed (${startupErr?.message ?? startupErr}) — retrying once. pi stderr tail:\n${client.stderrTail()}\n`,
			);
			await shutdownWorker(pi, "pi (failed startup)");
			({ p: pi, c: client } = spawnWorker());
			cmdsResp = await client.sendCommand({ type: "get_commands" }, STARTUP_TIMEOUT_MS);
		}
		if (!cmdsResp.success) throw new Error("get_commands failed");
		const stateResp = await client.sendCommand({ type: "get_state" });
		if (stateResp.success && stateResp.data?.model) {
			resolvedModel = `${stateResp.data.model.provider}/${stateResp.data.model.id}`;
		}

		// configure-inputs
		{
			const { ok, mark, notifyMark } = await sendPrompt(client, "/velpari-configure-inputs");
			if (ok) await waitSettled(client, mark, STAGE_TIMEOUT_MS, () => newNotifies(client, notifyMark).length > 0);
		}

		// brainstorm
		{
			const { ok, mark, notifyMark } = await sendPrompt(client, `/velpari-brainstorm ${mission.mission}`);
			if (!ok) throw new Error("brainstorm prompt rejected");
			await waitSettled(
				client,
				mark,
				STAGE_TIMEOUT_MS,
				() => readState(workspace).currentStage === "brainstorming" || newNotifies(client, notifyMark).length > 0,
			);
			runId = readState(workspace).runId;
			const notesPath = join(workspace, ".IDE_Plans", "velpari", "runs", runId, "brainstorm", "brainstorm-notes.md");
			let reply = BRAINSTORM_GUIDANCE;
			for (let round = 1; round <= 5 && !existsSync(notesPath); round++) {
				const p = await sendPrompt(client, reply);
				if (!p.ok) break;
				await waitSettled(client, p.mark, STAGE_TIMEOUT_MS);
				if (existsSync(notesPath)) break;
				await lastAssistantText(client);
				reply =
					'Yes — confirmed. Proceed fully autonomously: call the velpari_brainstorm_session tool with action "confirm-understanding", skip scans, resolve every decision-ledger question (nothing stays in draft/discussing), and write the complete brainstorm-notes.md working copy now (all required sections, no _TBD_). Do not ask me anything.';
			}
			if (!existsSync(notesPath)) throw new Error("brainstorm notes working copy missing");
		}

		// approve brainstorm
		{
			let approved = false;
			for (let attempt = 1; attempt <= 4 && !approved; attempt++) {
				const { ok, mark, notifyMark } = await sendPrompt(client, "/velpari-approve-brainstorm");
				if (!ok) break;
				await waitSettled(
					client,
					mark,
					STAGE_TIMEOUT_MS,
					() => readState(workspace).currentStage === "brainstormed" || newNotifies(client, notifyMark).length > 0,
				);
				approved = readState(workspace).currentStage === "brainstormed";
				if (!approved && attempt < 4) {
					const blockers = notifyDump(client, notifyMark);
					const n = await sendPrompt(
						client,
						`The brainstorm approve was blocked with: ${blockers}. Fix the notes/session state and stop.`,
					);
					if (n.ok) await waitSettled(client, n.mark, STAGE_TIMEOUT_MS);
				}
			}
			if (!approved) throw new Error("brainstorm approve failed");
		}

		// stage chain
		for (const s of STAGES) {
			if (readState(workspace).currentStage === until) break;
			const start = await sendPrompt(client, s.cmd);
			if (!start.ok) throw new Error(`${s.cmd} prompt rejected`);
			await waitSettled(
				client,
				start.mark,
				STAGE_TIMEOUT_MS,
				() => readState(workspace).currentStage === s.during || newNotifies(client, start.notifyMark).length > 0,
			);
			const g = await sendPrompt(client, stageGuidance(s.extra));
			if (g.ok) await waitSettled(client, g.mark, STAGE_TIMEOUT_MS);

			const runDir = join(workspace, ".IDE_Plans", "velpari", "runs", runId);
			const workDir = join(runDir, s.dir);
			let mdFile = findFile(workDir, /\.md$/);
			let payloadFile = findFile(join(workDir, "payload"), /-payload\.json$/);
			if (!mdFile || !payloadFile) {
				const n = await sendPrompt(
					client,
					`The ${s.dir} working copy or payload JSON is still missing. Write the required markdown file(s) AND the payload JSON now, then stop.`,
				);
				if (n.ok) await waitSettled(client, n.mark, STAGE_TIMEOUT_MS);
				mdFile = findFile(workDir, /\.md$/);
				payloadFile = findFile(join(workDir, "payload"), /-payload\.json$/);
			}
			if (!mdFile || !payloadFile) throw new Error(`${s.dir} working copy/payload missing`);

			let advanced = false;
			for (let attempt = 1; attempt <= 4 && !advanced; attempt++) {
				const a = await sendPrompt(client, s.approve);
				if (!a.ok) break;
				await waitSettled(
					client,
					a.mark,
					STAGE_TIMEOUT_MS,
					() => readState(workspace).currentStage === s.after || newNotifies(client, a.notifyMark).length > 0,
				);
				advanced = readState(workspace).currentStage === s.after;
				if (!advanced && attempt < 4) {
					const blockers = notifyDump(client, a.notifyMark);
					const n = await sendPrompt(client, `The approve was blocked with: ${blockers}. Fix the working copy/payload, then stop.`);
					if (n.ok) await waitSettled(client, n.mark, STAGE_TIMEOUT_MS);
				}
			}
			if (!advanced) throw new Error(`${s.approve} failed`);
			advancedTo = s.after;
		}

		// handoff (unless the target was earlier)
		if (until === "handoff-ready" && readState(workspace).currentStage !== "handoff-ready") {
			const { ok, mark, notifyMark } = await sendPrompt(client, "/velpari-handoff");
			if (ok) await waitSettled(client, mark, STAGE_TIMEOUT_MS, () => newNotifies(client, notifyMark).length > 0);
			advancedTo = readState(workspace).currentStage;
		}
	} catch (err) {
		process.stderr.write(`eval-run: harness error: ${err?.message ?? err}\n`);
	} finally {
		// Ordered teardown (ledger P5): the old fire-and-forget SIGTERM let a live
		// pi survive into the NEXT golden run of the same CI job.
		await shutdownWorker(pi, "pi (mission teardown)");
	}

	const dbPath = join(workspace, "Eval", PROJECT_NAME, "eval.db");
	const result = await emitReport({
		dbPath,
		project: PROJECT_NAME,
		runId: runId || null,
		mission: mission.slug,
		model: resolvedModel,
		out: args.out,
	});
	process.stderr.write(`eval-run: workspace=${workspace} runId=${runId || "(none)"} reached=${advancedTo || "(none)"}\n`);
	return result.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Report-only (no LLM)
// ---------------------------------------------------------------------------

async function runReportOnly(args) {
	const workspace = resolve(args.reportOnly);
	if (!existsSync(workspace)) {
		process.stderr.write(`eval-run: workspace not found: ${workspace}\n`);
		return 2;
	}
	const target = resolveTarget({ dbPath: null, workspace, project: args.project });
	if (target.error) {
		process.stderr.write(`eval-run: ${target.error}\n`);
		return 2;
	}
	const missionSlug = args.mission ?? target.project;
	const result = await emitReport({
		dbPath: target.dbPath,
		project: target.project,
		runId: args.runId,
		mission: missionSlug,
		model: args.model,
		out: args.out,
	});
	return result.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/** CLI entry. Returns an exit code. */
export async function main(argv) {
	const args = parseRunArgs(argv);
	if (args.help) {
		process.stdout.write(`${usage()}\n`);
		return 0;
	}
	if (args.error) {
		process.stderr.write(`eval-run: ${args.error}\n${usage()}\n`);
		return 2;
	}
	if (args.reportOnly) return runReportOnly(args);
	if (!args.mission) {
		process.stderr.write(`eval-run: --mission <slug> is required for a full run (or use --report-only <workspace>)\n${usage()}\n`);
		return 2;
	}
	return runGolden(args);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => {
			process.stderr.write(`eval-run: unexpected error: ${err?.stack ?? err}\n`);
			process.exit(2);
		},
	);
}
