/**
 * Shared fake MCP child for the Phase-F (N31) Excalidraw launcher tests.
 *
 * `fakeMcpChild()` builds an in-process stand-in for the mcp-excalidraw-
 * server stdio transport: PassThrough streams that answer `initialize` and
 * `tools/call create_from_mermaid` on stdin with newline-delimited JSON-RPC.
 * (The REAL mock-server process round-trip of instruction §5.2 lives in
 * test/fixtures/mock-excalidraw-mcp.mjs + test/integration/excalidraw-mcp.test.ts.)
 *
 * Options drive the failure branches:
 *   silent      — never answers (init/push timeout paths)
 *   initError   — JSON-RPC error on initialize
 *   toolRpcError — JSON-RPC error on tools/call
 *   toolError   — result.isError text (browser-required classification)
 *   ignoreTerm  — ignores SIGTERM so killMcp falls through to SIGKILL
 *   stdinAbsent — no stdin stream (mcpRequest's unavailable-stdin guard)
 *
 * The fake also emits startup chatter (non-JSON line, notification, stale
 * id) that excalidraw.ts:handleMcpLine must ignore, and records every
 * parsed request in `received` for assertions.
 */
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

export interface FakeMcpChild {
	child: ChildProcess;
	received: Array<Record<string, unknown>>;
}

export interface FakeMcpOptions {
	silent?: boolean;
	initError?: string;
	toolRpcError?: string;
	toolError?: string;
	ignoreTerm?: boolean;
	stdinAbsent?: boolean;
	/** Exit when the handshake completes (on notifications/initialized) — exercises the transport-loss guard. */
	exitAfterInit?: boolean;
}

export function fakeMcpChild(opts: FakeMcpOptions = {}): FakeMcpChild {
	const received: Array<Record<string, unknown>> = [];
	const emitter = new EventEmitter();
	const stdin = opts.stdinAbsent ? null : new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const child = {
		stdin,
		stdout,
		stderr,
		exitCode: null as number | null,
		killed: false,
		kill: (signal?: NodeJS.Signals | number): boolean => {
			if (opts.ignoreTerm && signal !== "SIGKILL") return true;
			(child as unknown as { killed: boolean }).killed = true;
			const sigkill = signal === "SIGKILL";
			setImmediate(() => emitter.emit("exit", sigkill ? null : 0, sigkill ? "SIGKILL" : null));
			return true;
		},
		on: emitter.on.bind(emitter),
		once: emitter.once.bind(emitter),
		off: emitter.off.bind(emitter),
		emit: emitter.emit.bind(emitter),
		removeListener: emitter.removeListener.bind(emitter),
	} as unknown as ChildProcess;

	const send = (msg: Record<string, unknown>): void => {
		stdout.write(`${JSON.stringify(msg)}\n`);
	};

	const handleLine = (line: string): void => {
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		received.push(msg);
		if (opts.silent) return;
		const method = typeof msg.method === "string" ? msg.method : "";
		const id = msg.id;
		if (method === "initialize") {
			if (opts.initError) {
				send({ jsonrpc: "2.0", id, error: { code: -32000, message: opts.initError } });
				return;
			}
			send({
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: "2025-06-18",
					capabilities: { tools: {} },
					serverInfo: { name: "fake-excalidraw", version: "0.0.0" },
				},
			});
			return;
		}
		if (method === "notifications/initialized") {
			// exitAfterInit: die the moment the handshake completes — before any
			// push can serialize, so the transport-loss guard is deterministic.
			if (opts.exitAfterInit) emitter.emit("exit", 1, null);
			return;
		}
		if (method === "tools/call") {
			if (opts.toolRpcError) {
				send({ jsonrpc: "2.0", id, error: { code: -32000, message: opts.toolRpcError } });
				return;
			}
			if (opts.toolError) {
				send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: opts.toolError }], isError: true } });
				return;
			}
			const params = msg.params as { arguments?: { mermaidDiagram?: string } } | undefined;
			const diagram = params?.arguments?.mermaidDiagram ?? "";
			send({
				jsonrpc: "2.0",
				id,
				result: { content: [{ type: "text", text: `canvas ack: ${diagram.length} chars` }] },
			});
			return;
		}
		send({ jsonrpc: "2.0", id, result: {} });
	};

	if (stdin) {
		let buffer = "";
		stdin.on("data", (chunk: Buffer | string) => {
			buffer += String(chunk);
			let nl = buffer.indexOf("\n");
			while (nl >= 0) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				if (line.length > 0) handleLine(line);
				nl = buffer.indexOf("\n");
			}
		});
	}

	// Startup chatter the client must ignore:
	stdout.write("this-is-not-json\n");
	send({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info" } });
	send({ jsonrpc: "2.0", id: 999999, result: { stale: true } });

	return { child, received };
}
