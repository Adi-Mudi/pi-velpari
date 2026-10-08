
/**
 * Mock MCP stdio server standing in for mcp-excalidraw-server@2.0.0 in the
 * §5.2 round-trip test: the real wire protocol (newline-delimited JSON-RPC:
 * initialize → notifications/initialized → tools/call create_from_mermaid),
 * running as a REAL child process spawned by the launcher under test.
 *
 * Records every inbound request as JSONL at $MOCK_MCP_RECORD for the test's
 * mermaidDiagram round-trip assertion. Startup chatter (a non-JSON line, a
 * notification, a stale-id response) proves the client ignores noise.
 *
 * Env knobs: MOCK_MCP_TOOL_FAIL → tools/call JSON-RPC error;
 * MOCK_MCP_ISERROR → tools/call result.isError "browser tab" text.
 */
import { appendFileSync } from "node:fs";

const record = process.env.MOCK_MCP_RECORD;

function send(msg) {
	process.stdout.write(`${JSON.stringify(msg)}\n`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let nl = buffer.indexOf("\n");
	while (nl >= 0) {
		const line = buffer.slice(0, nl).trim();
		buffer = buffer.slice(nl + 1);
		if (line.length > 0) handle(line);
		nl = buffer.indexOf("\n");
	}
});

function handle(line) {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		return;
	}
	if (record) appendFileSync(record, `${JSON.stringify(msg)}\n`);
	if (!msg || typeof msg.method !== "string") return;
	if (msg.method === "initialize") {
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				protocolVersion: "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name: "mock-excalidraw", version: "0.0.1" },
			},
		});
		return;
	}
	if (msg.method === "notifications/initialized") return;
	if (msg.method === "tools/call") {
		if (process.env.MOCK_MCP_TOOL_FAIL) {
			send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: process.env.MOCK_MCP_TOOL_FAIL } });
			return;
		}
		if (process.env.MOCK_MCP_ISERROR) {
			send({
				jsonrpc: "2.0",
				id: msg.id,
				result: { content: [{ type: "text", text: "Canvas has no connected browser tab — open it first" }], isError: true },
			});
			return;
		}
		const params = msg.params || {};
		const diagram = (params.arguments && params.arguments.mermaidDiagram) || "";
		send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `canvas ack: ${diagram.length} chars` }] } });
		return;
	}
	send({ jsonrpc: "2.0", id: msg.id, result: {} });
}

// Startup chatter the client must ignore:
process.stdout.write("this-is-not-json\n");
send({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "mock up" } });
send({ jsonrpc: "2.0", id: 999999, result: { stale: true } });
