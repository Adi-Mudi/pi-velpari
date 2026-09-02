import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleConfigureInputs } from "../src/configure-inputs.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-configure-"));
}

function makeUI(notifies: Array<{ msg: string; level: string }>, inputs: string[]) {
	const queue = [...inputs];
	return {
		notifies,
		confirmCalls: 0,
		async confirm(_t: string, _m: string) {
			this.confirmCalls++;
			return true;
		},
		async input(_p: string) {
			return queue.shift() ?? "";
		},
		notify(msg: string, level: string) {
			notifies.push({ msg, level });
		},
	};
}

test("handleConfigureInputs writes files.json with the captured projectName", async () => {
	const dir = tempDir();
	try {
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies, ["MyApp", "TypeScript", "zod,jest", "Node 20"]) } as never;
		await handleConfigureInputs(ctx, dir);

		const configPath = join(dir, ".pi", "velpari", "files.json");
		assert.ok(existsSync(configPath), "files.json should be created");
		const raw = readFileSync(configPath, "utf8");
		const config = JSON.parse(raw);
		assert.equal(config.projectName, "MyApp");
		assert.equal(config.version, 3);
		assert.equal(config.framework.language, "TypeScript");
		assert.deepEqual(config.framework.libraries, ["zod", "jest"]);
		assert.equal(config.framework.runtime, "Node 20");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleConfigureInputs aborts when projectName is empty", async () => {
	const dir = tempDir();
	try {
		const notifies: Array<{ msg: string; level: string }> = [];
		let inputCalls = 0;
		const ctx = {
			ui: {
				notifies,
				async input(_p: string) {
					inputCalls++;
					return ""; // always empty — should never satisfy required
				},
				notify(msg: string, level: string) {
					notifies.push({ msg, level });
				},
				async confirm(_t: string, _m: string) {
					return true;
				},
			},
		} as never;
		await handleConfigureInputs(ctx, dir);

		const errored = notifies.some((n) => n.level === "error" && /required/i.test(n.msg));
		assert.ok(errored, "expected error about required projectName");
		void inputCalls;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
