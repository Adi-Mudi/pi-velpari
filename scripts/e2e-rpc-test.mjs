#!/usr/bin/env node
// scripts/e2e-rpc-test.mjs — Tier 3: velpari 2.0.0 full-sequence RPC e2e harness.
//
// Drives a real `pi --mode rpc` process (extension loaded from this repo's
// dist/) through the complete pre-production chain in a throwaway git
// workspace: configure-inputs → brainstorm → 9 stages (each: stage command →
// working copy + payload → fall-back approve) → handoff → handoff-ready.
//
// Remote-only by design (thermal protocol): run via the tier3 CI job
// (workflow_dispatch). Local use is limited to `node --check`.
//
// Usage:
//   node scripts/e2e-rpc-test.mjs
//
// Env knobs:
//   E2E_UNTIL_STAGE      stop after reaching this currentStage value
//                        (default "handoff-ready" = full chain)
//   E2E_MODEL            optional --model passthrough for the pi spawn
//   E2E_STAGE_TIMEOUT_MS per-stage agent-quiet timeout (default 1200000 = 20m)
//
// Fixed env on the pi spawn: PI_SUBAGENT_MUX=tmux (headless multiplexer-gate
// override, core/multiplexer.ts:36-39), VELPARI_EXCALIDRAW=0 (kill-switch,
// core/excalidraw.ts:164-168). VELPARI_SKIP_DB_PUBLISH is deliberately NOT
// set — stages 3+ read upstream artifacts only from the store.
//
// Outputs (under .tmp/tier3/run-<ts>/): report.md, results.json, pi-stderr.log
// Exit codes: 0 = all assertions pass, 1 = assertion failure, 2 = harness error.

import { spawn, spawnSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ---------- Configuration ----------
const PROJECT_ROOT = resolve(".");
const EXTENSION_PATH = join(PROJECT_ROOT, "dist", "pi-extension", "src", "index.js");
const WORKSPACE = mkdtempSync(join(tmpdir(), "velpari-tier3-ws-"));
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const REPORT_DIR = join(PROJECT_ROOT, ".tmp", "tier3", `run-${TS}`);
const STDERR_LOG = join(REPORT_DIR, "pi-stderr.log");
const PROJECT_NAME = "RPCTestApp";
const MISSION = "Build a CLI todo list manager";
const COMMAND_TIMEOUT_MS = 120000;
const STAGE_TIMEOUT_MS = Number(process.env.E2E_STAGE_TIMEOUT_MS ?? 20 * 60 * 1000);
const QUIET_MS = 20000;
const UNTIL_STAGE = process.env.E2E_UNTIL_STAGE ?? "handoff-ready";
const E2E_MODEL = process.env.E2E_MODEL ?? "";

// ---------- Result tracking ----------
const results = [];
let pass = 0;
let fail = 0;

function record(step, ok, detail = "") {
	results.push({ step, ok, detail });
	if (ok) {
		pass++;
		console.log(`  PASS  ${step}${detail ? ` — ${detail}` : ""}`);
	} else {
		fail++;
		console.log(`  FAIL  ${step}${detail ? ` — ${detail}` : ""}`);
	}
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function assertFile(step, path, mustExist = true) {
	const ok = existsSync(path) === mustExist;
	record(step, ok, mustExist ? `exists: ${path}` : `absent: ${path}`);
	return ok;
}

function assertJsonField(step, filePath, field, expected) {
	try {
		const json = JSON.parse(readFileSync(filePath, "utf8"));
		const actual = field.split(".").reduce((acc, k) => acc?.[k], json);
		const ok = actual === expected;
		record(step, ok, `${field} === ${JSON.stringify(expected)} (got ${JSON.stringify(actual)})`);
		return ok;
	} catch (err) {
		record(step, false, `${filePath}: ${err.message}`);
		return false;
	}
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

function readState() {
	return JSON.parse(readFileSync(join(WORKSPACE, ".pi", "velpari", "state.json"), "utf8"));
}

function git(...args) {
	const r = spawnSync("git", args, { cwd: WORKSPACE, encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${r.stderr?.trim()}`);
	}
	return r.stdout.trim();
}

// ---------- RPC client ----------
class RpcClient {
	constructor(proc, stderrLog) {
		this.proc = proc;
		this.lineBuf = "";
		this.pendingResponses = new Map(); // id → resolver
		this.eventLog = [];
		this.commandList = [];
		this.notifyLog = [];
		this.uiLog = [];
		this.lastEventAt = Date.now();
		this.onEvent = null; // (obj, index) => void
		this.onUiRequest = null; // (obj) => response object | null
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
			try {
				appendFileSync(stderrLog, chunk);
			} catch {
				// report dir may not exist yet at very first spawn output
			}
		});
	}

	_handle(obj) {
		this.lastEventAt = Date.now();
		this.eventLog.push(obj);
		const index = this.eventLog.length - 1;

		if (obj.type === "extension_ui_request") {
			// Fire-and-forget methods: log only, never respond.
			if (["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"].includes(obj.method)) {
				if (obj.method === "notify") {
					this.notifyLog.push({ msg: obj.message, type: obj.notifyType });
				}
				this.uiLog.push({ method: obj.method, title: obj.title ?? obj.message ?? "" });
				return;
			}
			// Dialog methods (select/confirm/input/editor): block until a response.
			this.uiLog.push({ method: obj.method, title: obj.title ?? "", options: obj.options ?? [] });
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
		this.proc.stdin.write(JSON.stringify(cmd) + "\n");
	}

	sendCommand(cmd) {
		const id = `req-${++this._reqCounter}`;
		this._send({ ...cmd, id });
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingResponses.delete(id);
				reject(new Error(`Timeout waiting for response to ${cmd.type}`));
			}, COMMAND_TIMEOUT_MS);
			this.pendingResponses.set(id, (obj) => {
				clearTimeout(timer);
				resolve(obj);
			});
		});
	}

	waitForEvent(predicate, timeoutMs = COMMAND_TIMEOUT_MS, fromIndex = 0) {
		return new Promise((resolve, reject) => {
			const found = this.eventLog.slice(fromIndex).find(predicate);
			if (found) return resolve(found);
			const timer = setTimeout(() => {
				this.onEvent = null;
				reject(new Error("Timeout waiting for event matching predicate"));
			}, timeoutMs);
			this.onEvent = (obj, index) => {
				if (index >= fromIndex && predicate(obj)) {
					clearTimeout(timer);
					this.onEvent = null;
					resolve(obj);
				}
			};
		});
	}
}

// ---------- UI request router (matched by title/labels, never by order) ----------
// Title/label strings pinned from live source 2026-10-07:
//   configure-inputs: commands/configure-inputs.ts:40-243 + ops/configure-inputs.ts
//   scan gate: stages/brainstorm/scan-gate.ts:193-223
//   arch prelude: core/arch-confirm.ts:38-73
//   handoff confirm: ops/handoff.ts:575-579
//   preflight fix-flow: doctor/fix-flow.ts:172,193-201
function makeUiRouter(client) {
	const pick = (opts, re) => opts.find((o) => re.test(o)) ?? null;
	return (obj) => {
		const title = obj.title ?? "";
		const opts = obj.options ?? [];
		if (obj.method === "input") {
			if (/Project name/i.test(title)) return { value: PROJECT_NAME };
			if (/Framework language/i.test(title)) return { value: "TypeScript" };
			if (/Libraries/i.test(title)) return { value: "" };
			if (/Runtime/i.test(title)) return { value: "Node 22" };
			record(`unexpected input answered empty: ${title}`, true, "informational");
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
			if (pick(opts, /^Fix all/) || /^Fix/i.test(title)) {
				record("preflight fix-flow appeared", false, `${title} — answered Abort; investigate`);
				return { value: pick(opts, /Abort/) ?? opts[opts.length - 1] };
			}
			record(`unexpected select cancelled: ${title}`, true, `options: ${opts.join(" | ")}`);
			return { cancelled: true };
		}
		if (obj.method === "confirm") {
			if (/Publish handoff/i.test(title)) return { confirmed: true };
			if (/Community scan|Web search dispatch/i.test(title)) return { confirmed: false };
			if (/Upstream inputs changed/i.test(title)) return { confirmed: true };
			if (/Excalidraw/i.test(title)) return { confirmed: false };
			if (/Apply fixes/i.test(title)) {
				record("preflight fix-flow appeared", false, `${title} — declined; investigate`);
				return { confirmed: false };
			}
			record(`unexpected confirm answered false: ${title}`, true, "informational");
			return { confirmed: false };
		}
		if (obj.method === "editor") return { value: "" };
		return { cancelled: true };
	};
}

// ---------- Driver helpers ----------
async function sendPrompt(client, message) {
	const mark = client.eventLog.length;
	const notifyMark = client.notifyLog.length;
	const resp = await client.sendCommand({ type: "prompt", message });
	if (!resp.success) {
		record(`prompt rejected: ${message.slice(0, 60)}`, false, String(resp.error));
		return { ok: false, mark, notifyMark };
	}
	return { ok: true, mark, notifyMark };
}

/** Wait for an agent_settled after `mark`, then for QUIET_MS of no events. */
async function waitSettled(client, mark, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	await client.waitForEvent(
		(e) => e.type === "agent_settled",
		Math.max(1000, deadline - Date.now()),
		mark,
	);
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

const BRAINSTORM_GUIDANCE = [
	"Work autonomously — do NOT ask me questions, make reasonable assumptions for a small CLI todo app.",
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

// Stage table pinned from live source 2026-10-07:
//   stage order/transitions: core/constants.ts:52-81
//   fall-back approve names: commands/index.ts:92-100
//   working dirs: core/paths.ts:142-172 + stages/registry.ts
//   store YAML artifact names: core/paths.ts:356-360
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
		extra:
			"Write BOTH test-plan and test-cases markdown files in the tests working dir; test cases need a Traces column referencing FR/AF ids.",
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

// ---------- Main ----------
async function main() {
	console.log("Velpari 2.0.0 Tier-3 RPC full-sequence harness");
	console.log("==============================================");
	console.log(`Extension: ${EXTENSION_PATH}`);
	console.log(`Workspace: ${WORKSPACE}`);
	console.log(`Report:    ${REPORT_DIR}`);
	console.log(`Until:     ${UNTIL_STAGE}`);
	console.log("");

	if (!existsSync(EXTENSION_PATH)) {
		console.error(`FATAL: ${EXTENSION_PATH} missing — run \`npm run build\` first.`);
		process.exit(2);
	}
	mkdirSync(REPORT_DIR, { recursive: true });

	// Workspace must be a git repo with identity (publish precheck,
	// ops/db-publish.ts:132-161; run binding N5/N6).
	git("init", "-b", "main");
	git("config", "user.name", "velpari-tier3");
	git("config", "user.email", "tier3@example.invalid");
	git("commit", "--allow-empty", "-m", "tier3 workspace init");
	record("workspace git init + identity", true, WORKSPACE);

	const args = ["--mode", "rpc", "--no-session", "--extension", EXTENSION_PATH];
	if (E2E_MODEL) args.push("--model", E2E_MODEL);
	const pi = spawn("pi", args, {
		cwd: WORKSPACE,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, PI_SUBAGENT_MUX: "tmux", VELPARI_EXCALIDRAW: "0" },
	});
	const client = new RpcClient(pi, STDERR_LOG);
	client.onUiRequest = makeUiRouter(client);
	let chainAborted = false;
	let runId = "";

	try {
		// Step 1: command surface — exactly 52 velpari-* commands
		// (commands/index.ts:79-143).
		console.log("\n--- Step 1: get_commands ---");
		const cmdsResp = await client.sendCommand({ type: "get_commands" });
		const velpariCmds = cmdsResp.success
			? client.commandList.filter((c) => c.name.startsWith("velpari-"))
			: [];
		record(
			"52 velpari-* commands registered",
			cmdsResp.success && velpariCmds.length === 52,
			`found ${velpariCmds.length}`,
		);

		// Step 2: /velpari-status — no active run (ops/status.ts:133-137).
		console.log("\n--- Step 2: /velpari-status (no run) ---");
		{
			const { ok, mark, notifyMark } = await sendPrompt(client, "/velpari-status");
			if (ok) await waitSettled(client, mark, STAGE_TIMEOUT_MS);
			record(
				"status reports no active run",
				ok && notifyMatched(client, notifyMark, /No active Velpari run/),
				notifyDump(client, notifyMark),
			);
		}

		// Step 3: /velpari-configure-inputs — UI router answers prompts
		// (commands/configure-inputs.ts:40-243).
		console.log("\n--- Step 3: /velpari-configure-inputs ---");
		{
			const { ok, mark, notifyMark } = await sendPrompt(client, "/velpari-configure-inputs");
			if (ok) await waitSettled(client, mark, STAGE_TIMEOUT_MS);
			record(
				"configure-inputs saved",
				ok && notifyMatched(client, notifyMark, /Configuration saved/),
				notifyDump(client, notifyMark),
			);
			assertJsonField(
				"files.json projectName",
				join(WORKSPACE, ".pi", "velpari", "files.json"),
				"projectName",
				PROJECT_NAME,
			);
		}

		// Step 4: /velpari-brainstorm — handler starts the run, then the LLM
		// runs the v2.1 lifecycle (UNDERSTAND → confirm → notes) autonomously.
		console.log("\n--- Step 4: /velpari-brainstorm ---");
		{
			const { ok, mark, notifyMark } = await sendPrompt(client, `/velpari-brainstorm ${MISSION}`);
			if (!ok) throw new Error("brainstorm prompt rejected");
			await waitSettled(client, mark, STAGE_TIMEOUT_MS);
			let state = readState();
			runId = state.runId;
			record("run created", state.currentStage === "brainstorming" && !!runId, `stage=${state.currentStage} runId=${runId}`);

			const g = await sendPrompt(client, BRAINSTORM_GUIDANCE);
			if (g.ok) await waitSettled(client, g.mark, STAGE_TIMEOUT_MS);

			const notesPath = join(WORKSPACE, ".IDE_Plans", "velpari", "runs", runId, "brainstorm", "brainstorm-notes.md");
			if (!existsSync(notesPath)) {
				const n = await sendPrompt(client, "The brainstorm notes file is still missing. Write it now with all required sections filled, then stop.");
				if (n.ok) await waitSettled(client, n.mark, STAGE_TIMEOUT_MS);
			}
			assertFile("brainstorm notes working copy", notesPath);
			void notifyMark;
		}

		// Step 5: /velpari-approve-brainstorm — publish + advance
		// (stages/brainstorm-approve.ts:110-313).
		console.log("\n--- Step 5: /velpari-approve-brainstorm ---");
		{
			let approved = false;
			for (let attempt = 1; attempt <= 2 && !approved; attempt++) {
				const { ok, mark, notifyMark } = await sendPrompt(client, "/velpari-approve-brainstorm");
				if (!ok) break;
				await waitSettled(client, mark, STAGE_TIMEOUT_MS);
				approved = readState().currentStage === "brainstormed";
				if (!approved && attempt === 1) {
					const blockers = notifyDump(client, notifyMark);
					record("brainstorm approve blocked (attempt 1)", true, blockers);
					const n = await sendPrompt(
						client,
						`The brainstorm approve was blocked with: ${blockers}. Fix the notes/session state (confirm understanding, resolve all questions, fill every section) and stop.`,
					);
					if (n.ok) await waitSettled(client, n.mark, STAGE_TIMEOUT_MS);
				}
			}
			record("brainstorm approved → brainstormed", approved, `stage=${readState().currentStage}`);
			if (!approved) chainAborted = true;
			const published = findFile(join(WORKSPACE, "Doc", "brainstorm"), /^brainstorm-.*\.md$/);
			record("published brainstorm artifact", !!published, published ?? "none in Doc/brainstorm/");
		}

		// Steps 6..14: the 9-stage chain. Stage commands are exempt-stage
		// (stage-start advances state immediately, stages/registry.ts:1006-1009);
		// approves run the full publish gate chain (ops/approve.ts).
		for (const s of STAGES) {
			if (chainAborted) {
				record(`${s.cmd} (skipped — chain aborted)`, true, "upstream failure");
				continue;
			}
			if (readState().currentStage === UNTIL_STAGE) {
				record(`${s.cmd} (skipped — E2E_UNTIL_STAGE=${UNTIL_STAGE} reached)`, true, "");
				continue;
			}
			console.log(`\n--- Stage: ${s.cmd} ---`);

			const start = await sendPrompt(client, s.cmd);
			if (!start.ok) {
				chainAborted = true;
				continue;
			}
			await waitSettled(client, start.mark, STAGE_TIMEOUT_MS);
			record(`${s.cmd} → ${s.during}`, readState().currentStage === s.during, `stage=${readState().currentStage}`);

			const g = await sendPrompt(client, stageGuidance(s.extra));
			if (g.ok) await waitSettled(client, g.mark, STAGE_TIMEOUT_MS);

			const runDir = join(WORKSPACE, ".IDE_Plans", "velpari", "runs", runId);
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
			record(`${s.dir} working copy`, !!mdFile, mdFile ?? `no .md in ${workDir}`);
			record(`${s.dir} payload`, !!payloadFile, payloadFile ?? "missing payload/*.json");
			if (!mdFile || !payloadFile) {
				chainAborted = true;
				continue;
			}

			let advanced = false;
			for (let attempt = 1; attempt <= 2 && !advanced; attempt++) {
				const a = await sendPrompt(client, s.approve);
				if (!a.ok) break;
				await waitSettled(client, a.mark, STAGE_TIMEOUT_MS);
				advanced = readState().currentStage === s.after;
				if (!advanced && attempt === 1) {
					const blockers = notifyDump(client, a.notifyMark);
					record(`${s.approve} blocked (attempt 1)`, true, blockers);
					const n = await sendPrompt(
						client,
						`The approve was blocked with: ${blockers}. Fix the working copy/payload to satisfy the gate, then stop.`,
					);
					if (n.ok) await waitSettled(client, n.mark, STAGE_TIMEOUT_MS);
				}
			}
			record(`${s.approve} → ${s.after}`, advanced, `stage=${readState().currentStage}`);
			if (!advanced) {
				chainAborted = true;
				continue;
			}
			assertFile(
				`store YAML ${s.yaml}`,
				join(WORKSPACE, "Doc", "store", PROJECT_NAME, `${s.yaml}_${PROJECT_NAME}.yaml`),
			);
			assertFile("store DB", join(WORKSPACE, "Doc", "store", PROJECT_NAME, "index.db"));
		}

		// Step 15: /velpari-handoff (ops/handoff.ts:386-619).
		console.log("\n--- Step 15: /velpari-handoff ---");
		if (chainAborted || readState().currentStage === UNTIL_STAGE) {
			record("/velpari-handoff (skipped)", true, chainAborted ? "chain aborted" : `E2E_UNTIL_STAGE=${UNTIL_STAGE} reached`);
		} else {
			const { ok, mark, notifyMark } = await sendPrompt(client, "/velpari-handoff");
			if (ok) await waitSettled(client, mark, STAGE_TIMEOUT_MS);
			const finalStage = readState().currentStage;
			record("handoff → handoff-ready", ok && finalStage === "handoff-ready", `stage=${finalStage}; ${notifyDump(client, notifyMark)}`);
			assertFile("handoff payload", join(WORKSPACE, ".pi", "senai", "architect-inputs.json"));
		}
	} catch (err) {
		console.log("\nHARNESS ERROR:", err.message);
		record("harness", false, err.message);
	}

	try {
		pi.kill("SIGTERM");
	} catch {
		// already gone
	}

	// ---------- Report ----------
	const uiSummary = {};
	for (const u of client.uiLog) {
		const key = `${u.method}:${u.title}`;
		uiSummary[key] = (uiSummary[key] ?? 0) + 1;
	}
	const reportLines = [
		"# Velpari 2.0.0 Tier-3 RPC full-sequence report",
		"",
		`- Date: ${new Date().toISOString()}`,
		`- Extension: ${EXTENSION_PATH}`,
		`- Workspace: ${WORKSPACE}`,
		`- Run ID: ${runId || "(none)"}`,
		`- Until: ${UNTIL_STAGE}`,
		"",
		"## Summary",
		"",
		"| Metric | Value |",
		"| --- | --- |",
		`| Total assertions | ${results.length} |`,
		`| Pass | ${pass} |`,
		`| Fail | ${fail} |`,
		"",
		"## Step results",
		"",
		"| Step | Result | Detail |",
		"| --- | --- | --- |",
		...results.map((r) => `| ${r.step} | ${r.ok ? "PASS" : "FAIL"} | ${String(r.detail).replace(/\|/g, "\\|").slice(0, 300)} |`),
		"",
		"## UI requests observed",
		"",
		...Object.entries(uiSummary).map(([k, c]) => `- ${k} ×${c}`),
		"",
		"## Verdict",
		"",
		fail === 0 ? "**PASS** — full sequence reached the target stage." : `**FAIL** — ${fail} assertion(s) failed.`,
		"",
	];
	writeFileSync(join(REPORT_DIR, "report.md"), reportLines.join("\n"));
	writeFileSync(
		join(REPORT_DIR, "results.json"),
		JSON.stringify({ pass, fail, runId, workspace: WORKSPACE, results, uiLog: client.uiLog, notifies: client.notifyLog }, null, 2),
	);
	console.log(`\nReport written to ${REPORT_DIR}`);
	console.log(`SUMMARY: ${pass}/${results.length} passed, ${fail} failed`);
	process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error("FATAL:", err);
	process.exit(2);
});
