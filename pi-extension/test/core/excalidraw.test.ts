// Unit tests — core/excalidraw.ts (Phase F, N31): Excalidraw MCP launcher.
// Covers: fence extraction, exact pin + kill-switch, offer gating (test-
// context guard, consent surface, session states), enable → reachable →
// push happy path, push-declined, ownership stop at shutdown, graceful
// degradation (runtime/loopback/health/timeout/init/spawn/stdin paths —
// all info-level, never throws), push classification (browser/generic/RPC),
// version-probe branches, canvasUiFor normalization.
// Conventions: injected deps only (no real spawn, no network) + the shared
// fake MCP child (test/helpers/mock-mcp.ts).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
	EXCALIDRAW_PIN,
	__resetCanvasSession,
	__runVersionProbe,
	__setCanvasTestDeps,
	canvasUiFor,
	defaultLauncherCommand,
	extractMermaidBlocks,
	isLoopbackUrl,
	offerCanvasPush,
	shutdownLauncher,
	type CanvasFetchFn,
	type CanvasUi,
	type LauncherDeps,
} from "../../src/core/excalidraw.js";
import { fakeMcpChild } from "../helpers/mock-mcp.js";

const BLOCK = "flowchart LR\n  a --> b";

const okFetch: CanvasFetchFn = async () => ({
	ok: true,
	status: 200,
	json: async () => ({ status: "healthy", service: "mcp-excalidraw-canvas" }),
});

const downFetch: CanvasFetchFn = async () => {
	throw new Error("ECONNREFUSED");
};

const foreignFetch: CanvasFetchFn = async () => ({
	ok: true,
	status: 200,
	json: async () => ({ status: "healthy", service: "some-other-app" }),
});

function depsFor(over: LauncherDeps = {}): LauncherDeps {
	return {
		detectRuntime: async () => ({ ok: true }),
		fetchImpl: okFetch,
		sleep: async () => {},
		timeouts: { initMs: 500, healthPollMs: 60, healthIntervalMs: 1, pushMs: 500, detectMs: 500, killMs: 40 },
		...over,
	};
}

function scriptedUi(answers: boolean[]): {
	ui: CanvasUi;
	calls: Array<{ title: string; message: string }>;
	notices: string[];
} {
	const calls: Array<{ title: string; message: string }> = [];
	const notices: string[] = [];
	let i = 0;
	return {
		calls,
		notices,
		ui: {
			notify: (message, level) => {
				assert.strictEqual(level, "info", "every canvas notification must be info-level (graceful fallback)");
				notices.push(message);
			},
			confirm: async (title, message) => {
				calls.push({ title, message });
				const answer = answers[i] ?? false;
				i++;
				return answer;
			},
		},
	};
}

function spawnedRecorder(): { spawns: Array<{ cmd: string; args: string[] }>; deps: LauncherDeps } {
	const spawns: Array<{ cmd: string; args: string[] }> = [];
	const fake = fakeMcpChild();
	return {
		spawns,
		deps: {
			spawn: (cmd, args) => {
				spawns.push({ cmd, args });
				return fake.child;
			},
		},
	};
}

beforeEach(() => {
	__resetCanvasSession();
	__setCanvasTestDeps(null);
	delete process.env.VELPARI_EXCALIDRAW;
	delete process.env.EXPRESS_SERVER_URL;
});

afterEach(() => {
	__resetCanvasSession();
	__setCanvasTestDeps(null);
	delete process.env.VELPARI_EXCALIDRAW;
	delete process.env.EXPRESS_SERVER_URL;
});

describe("extractMermaidBlocks (fence extraction)", () => {
	test("extracts, trims and de-duplicates mermaid fence bodies", () => {
		const doc = [
			"intro",
			"```mermaid",
			"  flowchart LR",
			"    a --> b",
			"```",
			"text",
			"```mermaid",
			"  flowchart LR",
			"    a --> b",
			"```",
		].join("\n");
		assert.deepStrictEqual(extractMermaidBlocks(doc), ["flowchart LR\n    a --> b"]);
	});

	test("ignores non-mermaid fences and returns [] when none present", () => {
		const doc = "```yaml\nkey: v\n```\nplain text";
		assert.deepStrictEqual(extractMermaidBlocks(doc), []);
	});
});

describe("pin + kill-switch (§6 / §3.5)", () => {
	test("default launcher pins the exact version — never @latest", () => {
		const cmd = defaultLauncherCommand();
		assert.strictEqual(cmd.cmd, "npx");
		assert.deepStrictEqual(cmd.baseArgs, ["-y", "mcp-excalidraw-server@2.0.0"]);
		assert.strictEqual(EXCALIDRAW_PIN, "mcp-excalidraw-server@2.0.0");
	});

	test("VELPARI_EXCALIDRAW kill-switch makes the offer a total no-op", async () => {
		process.env.VELPARI_EXCALIDRAW = "0";
		const { ui, calls, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps: depsFor() });
		assert.strictEqual(calls.length, 0);
		assert.strictEqual(notices.length, 0);
	});
});

describe("offer gating", () => {
	test("no mermaid blocks → no dialog, no notify", async () => {
		const { ui, calls, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [], sourceLabel: "design", deps: depsFor() });
		assert.strictEqual(calls.length, 0);
		assert.strictEqual(notices.length, 0);
	});

	test("no confirm surface → silent (never spawns without consent)", async () => {
		const recorder = spawnedRecorder();
		const notices: string[] = [];
		await offerCanvasPush(
			{ notify: (m) => notices.push(m) },
			{ mermaidBlocks: [BLOCK], sourceLabel: "design", deps: depsFor({ ...recorder.deps }) },
		);
		assert.strictEqual(recorder.spawns.length, 0);
		assert.strictEqual(notices.length, 0);
	});

	test("NODE_TEST_CONTEXT without injected deps → silent no-op (existing-suite guard)", async () => {
		const saved = process.env.NODE_TEST_CONTEXT;
		process.env.NODE_TEST_CONTEXT = "1"; // simulate the node --test child environment regardless of runner
		try {
			const { ui, calls, notices } = scriptedUi([true, true]);
			await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design" });
			assert.strictEqual(calls.length, 0);
			assert.strictEqual(notices.length, 0);
		} finally {
			if (saved === undefined) delete process.env.NODE_TEST_CONTEXT;
			else process.env.NODE_TEST_CONTEXT = saved;
		}
	});

	test("enable declined → session disabled; later offers ask nothing and spawn nothing", async () => {
		const recorder = spawnedRecorder();
		const first = scriptedUi([false]);
		await offerCanvasPush(first.ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps: depsFor(recorder.deps) });
		assert.strictEqual(first.calls.length, 1);
		assert.strictEqual(first.calls[0]!.title, "Excalidraw canvas");
		const second = scriptedUi([true, true]);
		await offerCanvasPush(second.ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps: depsFor(recorder.deps) });
		assert.strictEqual(second.calls.length, 0, "disabled session must stay silent");
		assert.strictEqual(recorder.spawns.length, 0);
	});
});

describe("enable → reachable → push", () => {
	test("happy path: two confirms, exact diagram on the wire, info summary", async () => {
		const fake = fakeMcpChild();
		const spawns: Array<{ cmd: string; args: string[] }> = [];
		const deps = depsFor({
			spawn: (cmd, args) => {
				spawns.push({ cmd, args });
				return fake.child;
			},
		});
		const { ui, calls, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });

		assert.strictEqual(calls.length, 2, "enable confirm + push confirm");
		assert.strictEqual(calls[0]!.title, "Excalidraw canvas");
		assert.match(calls[0]!.message, /mcp-excalidraw-server@2\.0\.0/);
		assert.strictEqual(calls[1]!.title, "Push to canvas");
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /Pushed 1 diagram\(s\)/);

		const toolCall = fake.received.find((m) => m.method === "tools/call");
		assert.ok(toolCall, "tools/call must reach the MCP child");
		const params = toolCall.params as { name: string; arguments: { mermaidDiagram: string } };
		assert.strictEqual(params.name, "create_from_mermaid");
		assert.strictEqual(params.arguments.mermaidDiagram, BLOCK, "exact mermaid body round-trips");

		const init = fake.received.find((m) => m.method === "initialize");
		assert.ok(init, "initialize handshake must happen before the push");
		assert.deepStrictEqual(spawns[0]!.args, ["-y", "mcp-excalidraw-server@2.0.0"], "spawn uses the pin");
	});

	test("push declined → no tools/call, info message keeps Mermaid as source of truth", async () => {
		const fake = fakeMcpChild();
		const deps = depsFor({ spawn: () => fake.child });
		const { ui, calls, notices } = scriptedUi([true, false]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(calls.length, 2);
		assert.strictEqual(fake.received.filter((m) => m.method === "tools/call").length, 0);
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /nothing pushed/);
	});

	test("pre-warmed canvas (health already up): no ownership stop at shutdown", async () => {
		const fake = fakeMcpChild();
		const spawns: Array<{ cmd: string; args: string[] }> = [];
		const deps = depsFor({
			spawn: (cmd, args) => {
				spawns.push({ cmd, args });
				return fake.child;
			},
		});
		__setCanvasTestDeps(deps);
		const { ui } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design" });
		await shutdownLauncher();
		assert.strictEqual(fake.child.killed, true, "MCP child stopped (kill recorded by the fake)");
		assert.strictEqual(
			spawns.filter((s) => s.args.includes("stop")).length,
			0,
			"canvas we did not start must not be stopped",
		);
	});

	test("canvas down → our start brought it up → shutdown runs the pinned stop", async () => {
		const fake = fakeMcpChild();
		const spawns: Array<{ cmd: string; args: string[] }> = [];
		let healthCalls = 0;
		const sequenced: CanvasFetchFn = async () => {
			healthCalls++;
			if (healthCalls === 1) throw new Error("ECONNREFUSED"); // first probe: down
			return { ok: true, status: 200, json: async () => ({ service: "mcp-excalidraw-canvas" }) };
		};
		const deps = depsFor({
			fetchImpl: sequenced,
			spawn: (cmd, args) => {
				spawns.push({ cmd, args });
				return fake.child;
			},
		});
		__setCanvasTestDeps(deps);
		const { ui, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design" });
		assert.match(notices[0]!, /Pushed 1 diagram\(s\)/);
		await shutdownLauncher();
		const stopSpawns = spawns.filter((s) => s.args.includes("stop"));
		assert.strictEqual(stopSpawns.length, 1, "canvas we started must be stopped");
		assert.deepStrictEqual(stopSpawns[0]!.args, ["-y", "mcp-excalidraw-server@2.0.0", "stop"]);
	});
});

describe("graceful degradation (info-only, never throws)", () => {
	test("runtime missing → info + session becomes unavailable (later offers silent)", async () => {
		const recorder = spawnedRecorder();
		const deps = depsFor({ ...recorder.deps, detectRuntime: async () => ({ ok: false, reason: "npx missing" }) });
		const first = scriptedUi([true]);
		await offerCanvasPush(first.ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(first.calls.length, 1);
		assert.strictEqual(first.notices.length, 1);
		assert.match(first.notices[0]!, /Node \(>= 20\) and npx are required/);
		assert.match(first.notices[0]!, /staying with the Mermaid path/);
		assert.strictEqual(recorder.spawns.length, 0, "no spawn without a verified runtime");
		const second = scriptedUi([true]);
		await offerCanvasPush(second.ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(second.calls.length, 0, "unavailable session stays silent");
		assert.strictEqual(second.notices.length, 0);
	});

	test("non-loopback EXPRESS_SERVER_URL → info, fetch never called", async () => {
		let fetches = 0;
		const countingFetch: CanvasFetchFn = async () => {
			fetches++;
			return okFetch("");
		};
		process.env.EXPRESS_SERVER_URL = "http://10.0.0.5:3000";
		const { ui, notices } = scriptedUi([true]);
		await offerCanvasPush(ui, {
			mermaidBlocks: [BLOCK],
			sourceLabel: "design",
			deps: depsFor({ fetchImpl: countingFetch }),
		});
		assert.strictEqual(fetches, 0, "no network touch beyond loopback guard");
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /must stay loopback/);
	});

	test("canvas never reachable (foreign identity) → info, push never offered", async () => {
		const recorder = spawnedRecorder();
		const deps = depsFor({ ...recorder.deps, fetchImpl: foreignFetch });
		const { ui, calls, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(calls.length, 1, "push confirm must NOT be asked when unreachable");
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /did not become reachable/);
		assert.strictEqual(notices[0]!.includes("error") && notices[0]!.includes("Error"), false);
	});

	test("MCP initialize timeout (silent child) → info 'did not start'", async () => {
		const spawns: Array<{ cmd: string; args: string[] }> = [];
		const fake = fakeMcpChild({ silent: true });
		const deps = depsFor({
			timeouts: { initMs: 60, healthPollMs: 60, healthIntervalMs: 1, pushMs: 60, detectMs: 300, killMs: 30 },
			spawn: (cmd, args) => {
				spawns.push({ cmd, args });
				return fake.child;
			},
			fetchImpl: downFetch,
		});
		const { ui, notices } = scriptedUi([true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /did not start/);
		assert.match(notices[0]!, /timed out/, "timeout detail (with stderr tail) stays in the info line");
	});

	test("spawn 'error' event (ENOENT) → info 'did not start'", async () => {
		const fake = fakeMcpChild();
		const deps = depsFor({
			fetchImpl: downFetch,
			spawn: () => {
				process.nextTick(() =>
					(fake.child as unknown as { emit: (e: string, err: Error) => void }).emit("error", new Error("ENOENT")),
				);
				return fake.child;
			},
		});
		const { ui, notices } = scriptedUi([true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /did not start/);
	});

	test("child without stdin → info 'did not start' (guard, no crash)", async () => {
		const fake = fakeMcpChild({ stdinAbsent: true });
		const deps = depsFor({ fetchImpl: downFetch, spawn: () => fake.child });
		const { ui, notices } = scriptedUi([true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /did not start/);
		assert.match(notices[0]!, /stdin is unavailable/);
	});

	test("synchronous spawn throw → info 'did not start' with the detail (offer never rejects)", async () => {
		const deps = depsFor({
			fetchImpl: downFetch,
			spawn: () => {
				throw new Error("spawn exploded");
			},
		});
		const { ui, notices } = scriptedUi([true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /did not start \(spawn exploded\)/);
		assert.match(notices[0]!, /Mermaid path/);
	});

	test("catch-all: a throwing confirm → info notify, offer resolves (never rejects)", async () => {
		const fake = fakeMcpChild();
		const deps = depsFor({ spawn: () => fake.child });
		const notices: string[] = [];
		let step = 0;
		const ui: CanvasUi = {
			notify: (message, level) => {
				assert.strictEqual(level, "info");
				notices.push(message);
			},
			confirm: async () => {
				step++;
				if (step === 2) throw new Error("confirm exploded");
				return true;
			},
		};
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /Canvas push unavailable \(confirm exploded\)/);
		assert.match(notices[0]!, /Mermaid path/);
	});

	test("killMcp force-kills a child that ignores SIGTERM (no hang, no throw)", async () => {
		const fake = fakeMcpChild({ ignoreTerm: true });
		const deps = depsFor({
			spawn: () => fake.child,
			timeouts: { killMs: 30, initMs: 200, healthPollMs: 60, healthIntervalMs: 1, pushMs: 200, detectMs: 300 },
		});
		__setCanvasTestDeps(deps);
		const { ui } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design" });
		await shutdownLauncher(); // child ignored SIGTERM → SIGKILL path, then closeMcp
		assert.strictEqual(fake.child.killed, true);
	});
});

describe("push classification", () => {
	test("browser-required (result.isError mentioning a tab) → browser-tab guidance", async () => {
		const fake = fakeMcpChild({ toolError: "Canvas has no connected browser tab — open it first" });
		const deps = depsFor({ spawn: () => fake.child });
		const { ui, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /needs a browser tab/);
		assert.match(notices[0]!, /Mermaid stays the source of truth/);
	});

	test("generic tool failure → partial summary with detail, Mermaid kept", async () => {
		const fake = fakeMcpChild({ toolError: "conversion exploded" });
		const deps = depsFor({ spawn: () => fake.child });
		const { ui, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /Canvas push incomplete \(1 failed: conversion exploded\)/);
	});

	test("JSON-RPC error on tools/call → failed count, graceful info", async () => {
		const fake = fakeMcpChild({ toolRpcError: "server exploded" });
		const deps = depsFor({ spawn: () => fake.child });
		const { ui, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /1 failed/);
		assert.match(notices[0]!, /MCP error: server exploded/);
	});

	test("child exits after the handshake → transport-loss guard: push reports incomplete, info-only", async () => {
		const fake = fakeMcpChild({ exitAfterInit: true });
		const deps = depsFor({ spawn: () => fake.child });
		const { ui, notices } = scriptedUi([true, true]);
		await offerCanvasPush(ui, { mermaidBlocks: [BLOCK], sourceLabel: "design", deps });
		assert.strictEqual(notices.length, 1);
		assert.match(notices[0]!, /Canvas push incomplete \(1 failed: the MCP connection closed before the push\)/);
	});
});

describe("__runVersionProbe branches", () => {
	test("real `node -v` passes the node>=20 gate", async () => {
		const status = await __runVersionProbe("node", ["-v"], 20, 4_000);
		assert.strictEqual(status.ok, true, status.reason);
	});

	test("missing command → not available", async () => {
		const status = await __runVersionProbe("definitely-not-a-cmd-xyz", ["-v"], 0, 2_000);
		assert.strictEqual(status.ok, false);
		assert.match(status.reason ?? "", /is not available/);
	});

	test("non-zero exit → exited with code", async () => {
		const status = await __runVersionProbe(process.execPath, ["-e", "process.exit(7)"], 0, 4_000);
		assert.strictEqual(status.ok, false);
		assert.match(status.reason ?? "", /exited with code 7/);
	});

	test("version below minimum → required message", async () => {
		const status = await __runVersionProbe(process.execPath, ["-e", "console.log('v3.0.0')"], 20, 4_000);
		assert.strictEqual(status.ok, false);
		assert.match(status.reason ?? "", />= 20 required \(found v3\.0\.0\)/);
	});

	test("hang → timeout kill", async () => {
		const status = await __runVersionProbe(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], 0, 80);
		assert.strictEqual(status.ok, false);
		assert.match(status.reason ?? "", /timed out/);
	});
});

describe("helpers", () => {
	test("isLoopbackUrl accepts loopback only", () => {
		assert.strictEqual(isLoopbackUrl("http://127.0.0.1:3000"), true);
		assert.strictEqual(isLoopbackUrl("http://localhost:3000"), true);
		assert.strictEqual(isLoopbackUrl("http://[::1]:3000"), true);
		assert.strictEqual(isLoopbackUrl("http://127.1.2.3:3000"), true);
		assert.strictEqual(isLoopbackUrl("http://10.0.0.5:3000"), false);
		assert.strictEqual(isLoopbackUrl("not a url"), false);
	});

	test("canvasUiFor: no confirm → undefined surface; non-boolean answers normalize to decline", async () => {
		const noConfirm = canvasUiFor({ ui: { notify: () => {} } });
		assert.strictEqual(noConfirm.confirm, undefined);

		const weird = canvasUiFor({ ui: { notify: () => {}, confirm: async () => "ok" } });
		const answer = await weird.confirm?.("t", "m");
		assert.strictEqual(answer, false, "only a literal true enables");
	});
});
