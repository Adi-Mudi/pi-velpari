// Integration — Phase F (N31) §5.2: REAL mock MCP server process round-trip.
// The launcher spawns test/fixtures/mock-excalidraw-mcp.mjs (same wire
// protocol as mcp-excalidraw-server@2.0.0), against a REAL local /health
// server on 127.0.0.1 — asserts: enable+push confirms, initialize
// handshake, exact mermaidDiagram round-trip in the JSONL record, info-only
// notices, MCP child stopped at shutdown; plus the unreachable-server path
// degrading silently (push never offered) and browser/RPC classification.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	__resetCanvasSession,
	__setCanvasTestDeps,
	offerCanvasPush,
	shutdownLauncher,
	type CanvasUi,
	type LauncherDeps,
} from "../../src/core/excalidraw.js";

const here = dirname(fileURLToPath(import.meta.url));
/** tsc does NOT copy .mjs into dist/ — walk up from this test file to the repo root and use the source-tree fixture. */
const FIXTURE = (() => {
	let dir = here;
	for (let i = 0; i < 6; i++) {
		const candidate = join(dir, "pi-extension", "test", "fixtures", "mock-excalidraw-mcp.mjs");
		if (existsSync(candidate)) return candidate;
		dir = dirname(dir);
	}
	throw new Error("mock-excalidraw-mcp.mjs fixture not found (walked up from the test file)");
})();
const BLOCK = "flowchart LR\n  user --> api";

let tmpDir: string;
let recordPath: string;
let healthServer: Server | null = null;
const spawned: ChildProcess[] = [];
const savedEnv: Record<string, string | undefined> = {};

function saveEnv(key: string): void {
	savedEnv[key] = process.env[key];
}
function restoreEnv(key: string): void {
	if (savedEnv[key] === undefined) delete process.env[key];
	else process.env[key] = savedEnv[key];
}

async function startHealth(): Promise<string> {
	return await new Promise<string>((resolve, reject) => {
		const server = createServer((req, res) => {
			if (req.url === "/health") {
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify({ status: "healthy", service: "mcp-excalidraw-canvas", elements_count: 0 }));
				return;
			}
			res.statusCode = 404;
			res.end();
		});
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			healthServer = server;
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(new Error("no port"));
				return;
			}
			resolve(`http://127.0.0.1:${address.port}`);
		});
	});
}

async function stopHealth(): Promise<void> {
	if (!healthServer) return;
	await new Promise<void>((resolve) => healthServer?.close(() => resolve()));
	healthServer = null;
}

/** Unused loopback port → the /health fetch gets ECONNREFUSED. */
async function deadUrl(): Promise<string> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	const address = server.address();
	const port = typeof address === "object" && address !== null ? address.port : 0;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return `http://127.0.0.1:${port}`;
}

function testDeps(over: LauncherDeps = {}): LauncherDeps {
	return {
		command: { cmd: process.execPath, baseArgs: [FIXTURE] },
		spawn: (cmd, args, options) => {
			const child = nodeSpawn(cmd, args, options as Parameters<typeof nodeSpawn>[2]);
			spawned.push(child);
			return child;
		},
		timeouts: {
			initMs: 8_000,
			healthPollMs: 2_500,
			healthIntervalMs: 100,
			pushMs: 5_000,
			detectMs: 4_000,
			killMs: 1_500,
			stopMs: 3_000,
		},
		...over,
	};
}

function scriptedUi(answers: boolean[]): {
	ui: CanvasUi;
	calls: Array<{ title: string; message: string }>;
	notices: Array<{ message: string; level: string }>;
} {
	const calls: Array<{ title: string; message: string }> = [];
	const notices: Array<{ message: string; level: string }> = [];
	let i = 0;
	return {
		calls,
		notices,
		ui: {
			notify: (message, level) => notices.push({ message, level }),
			confirm: async (title, message) => {
				calls.push({ title, message });
				return answers[i++] ?? false;
			},
		},
	};
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-excalidraw-mcp-"));
	recordPath = join(tmpDir, "record.jsonl");
	__resetCanvasSession();
	__setCanvasTestDeps(null);
	saveEnv("EXPRESS_SERVER_URL");
	saveEnv("MOCK_MCP_RECORD");
	saveEnv("MOCK_MCP_TOOL_FAIL");
	saveEnv("MOCK_MCP_ISERROR");
	process.env.MOCK_MCP_RECORD = recordPath;
});

afterEach(async () => {
	await shutdownLauncher();
	for (const child of spawned.splice(0)) {
		if (child.exitCode === null && !child.killed) {
			try {
				child.kill("SIGKILL");
			} catch {
				/* gone */
			}
		}
	}
	await stopHealth();
	restoreEnv("EXPRESS_SERVER_URL");
	restoreEnv("MOCK_MCP_RECORD");
	restoreEnv("MOCK_MCP_TOOL_FAIL");
	restoreEnv("MOCK_MCP_ISERROR");
	__resetCanvasSession();
	__setCanvasTestDeps(null);
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("§5.2 — mock MCP round-trip (real process + real /health)", () => {
	test("enable → health → push: exact diagram reaches the mock server; child stopped at shutdown", async () => {
		process.env.EXPRESS_SERVER_URL = await startHealth();
		const { ui, calls, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps: testDeps() });

		assert.strictEqual(calls.length, 2, "enable confirm + push confirm");
		assert.strictEqual(calls[0]!.title, "Excalidraw canvas");
		assert.strictEqual(calls[1]!.title, "Push to canvas");
		assert.strictEqual(notices.length, 1, "exactly one summary");
		assert.strictEqual(notices[0]!.level, "info");
		assert.match(notices[0]!.message, /Pushed 1 diagram\(s\)/);

		assert.ok(existsSync(recordPath), "mock server must have recorded requests");
		const records = readFileSync(recordPath, "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l));
		const init = records.find((r) => r.method === "initialize");
		assert.ok(init, "initialize handshake recorded");
		assert.strictEqual(init.params.clientInfo.name, "pi-velpari");
		assert.ok(
			records.some((r) => r.method === "notifications/initialized"),
			"initialized notification recorded",
		);
		const tool = records.find((r) => r.method === "tools/call");
		assert.ok(tool, "tools/call recorded");
		assert.strictEqual(tool.params.name, "create_from_mermaid");
		assert.strictEqual(tool.params.arguments.mermaidDiagram, BLOCK, "exact mermaid body round-trips");

		// Health was up before our spawn → canvas NOT ours → no `stop` spawn;
		// but the MCP child must be gone after shutdown.
		await shutdownLauncher();
		const child = spawned[0];
		assert.ok(child, "one MCP child spawned");
		assert.ok(child.exitCode !== null || child.signalCode !== null, "MCP child must not be left behind");
	});

	test("unreachable server degrades silently: push never offered, info-only, second offer retries without re-asking enable", async () => {
		process.env.EXPRESS_SERVER_URL = await deadUrl();
		const { ui, calls, notices } = scriptedUi([true, true]);
		const deps = testDeps();
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(calls.length, 1, "only the enable confirm — never the push confirm when unreachable");
		assert.strictEqual(notices.length, 1);
		assert.strictEqual(notices[0]!.level, "info", "graceful info-level, never error");
		assert.match(notices[0]!.message, /did not become reachable|did not start/);
		assert.doesNotThrow(() => {
			for (const n of notices) assert.strictEqual(n.level, "info");
		});

		// Session stays enabled → next flow retries WITHOUT re-asking enable.
		const second = scriptedUi([true, true]);
		await offerCanvasPush(second.ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps: testDeps() });
		assert.strictEqual(second.calls.length, 0, "enable is asked once per session");
		assert.strictEqual(second.notices.length, 1);
	});

	test("tool isError mentioning a tab → browser-tab guidance (classification over the real wire)", async () => {
		process.env.EXPRESS_SERVER_URL = await startHealth();
		process.env.MOCK_MCP_ISERROR = "1";
		const { ui, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps: testDeps() });
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!.message, /needs a browser tab/);
	});

	test("JSON-RPC error from the server → partial summary, graceful info", async () => {
		process.env.EXPRESS_SERVER_URL = await startHealth();
		process.env.MOCK_MCP_TOOL_FAIL = "server exploded";
		const { ui, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps: testDeps() });
		assert.strictEqual(notices.length, 1);
		assert.strictEqual(notices[0]!.level, "info");
		assert.match(notices[0]!.message, /1 failed/);
	});

	test("nonexistent launcher binary → info 'did not start' (spawn error path with a real process)", async () => {
		process.env.EXPRESS_SERVER_URL = await deadUrl();
		const { ui, notices } = scriptedUi([true]);
		await offerCanvasPush(ui, {
			mermaidBlocks: [BLOCK],
			sourceLabel: "design",
			deps: testDeps({ command: { cmd: "/nonexistent/excalidraw-x", baseArgs: [] } }),
		});
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!.message, /did not start/);
	});
});
