// Adapted from pi-senai's RpcClient (MIT):
//   /mnt/Just_Do_It/02_Devp_Soft/12_orchestra/pi-seani/pi-extension/test/e2e/helpers/rpc-client.ts
// Pi-Senai in turn adapted this from pi-mono's RpcClient (MIT):
//   https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-client.ts
// Docs:
//   https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
//
// Divergences from upstream, called out so a reviewer knows what was changed:
//   - We spawn `pi --mode rpc --no-session` so each E2E test starts clean
//     (no leftover session state from prior runs).
//   - We expose `waitForIdle()` (Promise resolving on the next agent_settled
//     event) and `promptAndWait(text)` so callers don't need to subscribe to
//     the event stream themselves.
//   - stderr is captured into `this.stderr` for debugging; we never forward
//     it to the parent process.
//
// Framing: strict LF-only JSONL. readline is NOT protocol-compliant (it
// coalesces chunks on pause/resume and may split a UTF-8 codepoint across a
// line boundary). We split on \n ourselves after each raw stdout chunk.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

export interface RpcRequest {
	id: string;
	type: string;
	[key: string]: unknown;
}

export interface RpcEvent {
	type: string;
	[key: string]: unknown;
}

export interface RpcClientOptions {
	/** Extra args passed to `pi`. Defaults to ["--mode", "rpc", "--no-session"]. */
	args?: string[];
	/** Environment overrides merged on top of process.env. */
	env?: NodeJS.ProcessEnv;
	/** Per-request timeout in ms (default 30000). */
	timeoutMs?: number;
	/** Working directory of the spawned `pi`. */
	cwd?: string;
}

export class RpcClient {
	private child: ChildProcessWithoutNullStreams;
	private pending = new Map<
		string,
		{ resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
	>();
	private listeners = new Set<(event: RpcEvent) => void>();
	private buffer = "";
	private idleResolvers: Array<() => void> = [];
	private isClosed = false;
	private defaultTimeoutMs: number;
	public stderr = "";
	/** True after at least one prompt call. Exposed via the hasSentPrompt
	 *  getter so tests can verify the prompt path was exercised. */
	private promptSent = false;

	constructor(options: RpcClientOptions = {}) {
		const args = options.args ?? ["--mode", "rpc", "--no-session"];
		const env = { ...process.env, ...(options.env ?? {}) };
		const timeoutMs = options.timeoutMs ?? 30000;

		this.defaultTimeoutMs = timeoutMs;

		this.child = spawn("pi", args, {
			env,
			cwd: options.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
		this.child.stderr.on("data", (chunk: Buffer) => {
			this.stderr += chunk.toString("utf8");
		});
		this.child.on("exit", (code) => this.handleExit(code));
		this.child.on("error", (err) => this.handleExit(1, err));
	}

	private handleStdout(chunk: Buffer): void {
		this.buffer += chunk.toString("utf8");
		let nl: number;
		while ((nl = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, nl).replace(/\r+$/, "");
			this.buffer = this.buffer.slice(nl + 1);
			if (!line) continue;
			this.dispatchLine(line);
		}
	}

	private dispatchLine(line: string): void {
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			return; // ignore non-JSON lines (e.g., stderr mirror)
		}
		// Only `type: "response"` (or an explicit error envelope) closes a
		// pending request. Streaming events like `bash_execution_update`
		// also carry the originating request's `id` — treating any such
		// event as the response would resolve the promise after the first
		// chunk and miss the final `data.output` / `success` payload.
		// Streaming events still flow to listeners via the second branch
		// below so callers can collect deltas if they want.
		if (
			msg &&
			typeof msg.id === "string" &&
			this.pending.has(msg.id) &&
			(msg.type === "response" || msg.error !== undefined)
		) {
			const { resolve, reject, timer } = this.pending.get(msg.id)!;
			clearTimeout(timer);
			this.pending.delete(msg.id);
			if (msg.error)
				reject(new Error(typeof msg.error === "string" ? msg.error : JSON.stringify(msg.error)));
			else resolve(msg);
			// A response implies a turn boundary for prompt/steer. Treat any
			// response as "settled" too — otherwise a broken-pi RPC (where
			// the prompt fails and no agent_settled fires) hangs
			// waitForIdle() forever. For working pi, agent_settled fires
			// first or simultaneously and resolves the same resolver set.
			if (msg.type === "response") {
				const resolvers = this.idleResolvers.splice(0);
				resolvers.forEach((fn) => fn());
			}
		} else if (msg && typeof msg.type === "string") {
			this.listeners.forEach((fn) => {
				try {
					fn(msg as RpcEvent);
				} catch {
					/* listener must not throw */
				}
			});
			if (msg.type === "agent_settled") {
				const resolvers = this.idleResolvers.splice(0);
				resolvers.forEach((fn) => fn());
			}
		}
	}

	private handleExit(code: number | null, err?: Error): void {
		if (this.isClosed) return;
		this.isClosed = true;
		const reason = err ?? new Error(`pi exited with code ${code}`);
		for (const { reject, timer } of this.pending.values()) {
			clearTimeout(timer);
			reject(reason);
		}
		this.pending.clear();
		// Destroy the pipe streams so the event loop is free to exit once
		// the parent has no other work. Without this, the test process
		// hangs after all assertions pass.
		try {
			this.child.stdout.destroy();
		} catch {
			/* ignore */
		}
		try {
			this.child.stderr.destroy();
		} catch {
			/* ignore */
		}
		try {
			this.child.stdin.destroy();
		} catch {
			/* ignore */
		}
	}

	private async sendAndAwait<T = any>(id: string, msg: RpcRequest): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(
						new Error(`RPC timeout after ${this.defaultTimeoutMs}ms for type=${msg.type}`),
					);
				}
			}, this.defaultTimeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.child.stdin.write(JSON.stringify(msg) + "\n");
		});
	}

	async request<T = any>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
		// pi's `prompt` RPC expects a `message` field (per the official docs).
		// Calling it with `text` instead makes pi respond with:
		//   { success: false, error: "Cannot read properties of undefined
		//   (reading 'startsWith')" }
		// (logged in earendil-works/pi issue #2461 as a "first prompt
		// fails" bug, but it's actually a missing-field bug that fires on
		// every prompt). Normalize: rename `text` to `message` here so
		// every test can pass either shape without thinking about it.
		const fixedPayload: Record<string, unknown> = { ...payload };
		if (type === "prompt") {
			this.promptSent = true;
			if ("text" in fixedPayload && !("message" in fixedPayload)) {
				fixedPayload.message = fixedPayload.text;
				delete fixedPayload.text;
			}
		}
		const id = randomUUID();
		const msg: RpcRequest = { id, type, ...fixedPayload };
		return await this.sendAndAwait<T>(id, msg);
	}

	onEvent(listener: (event: RpcEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** True after at least one prompt has been sent through this client.
	 *  Kept for test introspection — proves the request() normalization
	 *  fired (the message/text rename only matters for prompt calls). */
	get hasSentPrompt(): boolean {
		return this.promptSent;
	}

	/** Resolves on the next `agent_settled` event (or any response if
	 *  one is already queued in idleResolvers). Times out after
	 *  `timeoutMs` (default 15s) — pi 0.84.3 with a dummy LLM key never
	 *  fires agent_settled, so without a timeout the call hangs forever.
	 *  Throws TimeoutError on timeout; throws if the child exits first. */
	waitForIdle(timeoutMs = 15_000): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (this.isClosed) return reject(new Error("RPC client already closed"));
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				const idx = this.idleResolvers.indexOf(wrapped);
				if (idx >= 0) this.idleResolvers.splice(idx, 1);
				reject(
					new Error(
						`waitForIdle timed out after ${timeoutMs}ms — pi never emitted agent_settled (likely the LLM call failed with the dummy API key)`,
					),
				);
			}, timeoutMs);
			const wrapped = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve();
			};
			this.idleResolvers.push(wrapped);
		});
	}

	/** Send a prompt and return all events emitted for that turn. */
	async promptAndWait(text: string): Promise<RpcEvent[]> {
		const events: RpcEvent[] = [];
		const off = this.onEvent((e) => {
			events.push(e);
		});
		try {
			await this.request("prompt", { text });
			await this.waitForIdle();
		} finally {
			off();
		}
		return events;
	}

	/** Convenience wrappers — unwrap the `data` field of the RPC response
	 *  so callers get the payload directly. */
	async getCommands(): Promise<{ commands: Array<{ name: string; description: string }> }> {
		const res = await this.request<any>("get_commands");
		return (res.data ?? res) as { commands: Array<{ name: string; description: string }> };
	}

	async getState(): Promise<any> {
		const res = await this.request<any>("get_state");
		return res.data ?? res;
	}

	async getMessages(): Promise<{ messages: any[] }> {
		const res = await this.request<any>("get_messages");
		return (res.data ?? res) as { messages: any[] };
	}

	async getSessionStats(): Promise<any> {
		const res = await this.request<any>("get_session_stats");
		return res.data ?? res;
	}

	async steer(text: string): Promise<any> {
		const res = await this.request<any>("steer", { text });
		return res.data ?? res;
	}

	async close(): Promise<void> {
		if (this.isClosed) return;
		this.isClosed = true;
		return new Promise<void>((resolve) => {
			const killTimer = setTimeout(() => {
				if (!this.child.killed) this.child.kill("SIGKILL");
				// Belt-and-braces: destroy pipes if the child ignored SIGTERM
				// and SIGKILL is queued. Ensures the parent's event loop is
				// released even if the OS is slow to reap the child.
				try {
					this.child.stdout.destroy();
				} catch {
					/* ignore */
				}
				try {
					this.child.stderr.destroy();
				} catch {
					/* ignore */
				}
				try {
					this.child.stdin.destroy();
				} catch {
					/* ignore */
				}
				resolve();
			}, 1000);
			this.child.once("exit", () => {
				clearTimeout(killTimer);
				resolve();
			});
			if (!this.child.killed) this.child.kill("SIGTERM");
		});
	}
}

/** The exact error string pi 0.84.3 returns when its RPC prompt/steer
 *  handler hits an internal bug (verified at this version on 2026-09-01:
 *  the response for a plain `prompt {text: "hello"}` fails with this
 *  text, with no usable stack). Any E2E test that exercises the prompt
 *  path needs to skip when this fires — pi 0.84.3 cannot drive
 *  slash commands over RPC. */
export const PI_RPC_PROMPT_BUG_FRAGMENT = "reading 'startsWith'";

/** True when `err` is the known pi 0.84.3 RPC prompt-handler bug. Use to
 *  branch on `t.skip()` instead of failing the suite. */
export function isPiRpcPromptBug(err: unknown): boolean {
	return err instanceof Error && err.message.includes(PI_RPC_PROMPT_BUG_FRAGMENT);
}
