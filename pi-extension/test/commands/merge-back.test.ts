// Tests — commands/merge-back.ts (Phase 6, subphase 6.8.3 — D1 surface).
// Mock ExtensionContext drives runMergeBackFlow against the error-clean
// git fixture (test/helpers/fixture-repo.ts). Covers the plan's 5 cases:
// (1) registration name + description, (2) usage path with no branch (no
// git side effects), (3) dry-run renders the plan without prompting or
// merging, (4) --execute + confirm=false → cancelled, (5) --execute +
// confirm=true → delegates to executeMergeBack (HEAD moves, steps
// rendered). isTui() is false for the mock ⇒ runSimpleConfirm falls back
// to ctx.ui.confirm (ui/simple-picker.ts:49).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { registerMergeBackCommand, runMergeBackFlow } from "../../src/commands/merge-back.js";
import { divergent, git, mkErrorCleanRepo } from "../helpers/fixture-repo.js";

interface NotifyRecord {
	message: string;
	severity: string;
}

function makeCtx(confirmResult: boolean): {
	ctx: ExtensionContext;
	notifications: NotifyRecord[];
	confirmCalls: () => number;
} {
	const notifications: NotifyRecord[] = [];
	let confirmCalls = 0;
	const ctx = {
		ui: {
			notify(message: string, severity?: string) {
				notifications.push({ message, severity: severity ?? "info" });
			},
			async confirm() {
				confirmCalls++;
				return confirmResult;
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, notifications, confirmCalls: () => confirmCalls };
}

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-mergeback-cmd-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("commands/merge-back (Phase 6 6.8.3)", () => {
	test("1. registration: name + non-empty description + callable handler", () => {
		const commands = new Map<string, { description?: string; handler?: unknown }>();
		const pi = {
			registerCommand(name: string, spec: { description?: string; handler?: unknown }) {
				commands.set(name, spec);
			},
		} as unknown as ExtensionAPI;
		registerMergeBackCommand(pi);
		const spec = commands.get("velpari-merge-back");
		assert.ok(spec, "velpari-merge-back not registered");
		assert.ok((spec.description ?? "").length > 0, "description missing");
		assert.equal(typeof spec.handler, "function", "handler missing");
	});

	test("2. usage path: no branch → usage notify, nothing created", async () => {
		const dir = dirs[dirs.length - 1]!;
		const { ctx, notifications } = makeCtx(true);
		await runMergeBackFlow(ctx, dir, "");
		const note = notifications.at(-1)!;
		assert.equal(note.severity, "warning");
		assert.match(note.message, /usage: \/velpari-merge-back <branch> \[--execute\]/);
		assert.ok(!existsSync(join(dir, ".git")), "usage path must not touch git");
	});

	test("3. dry-run: renders the plan, no confirm prompt, HEAD unchanged", async () => {
		const dir = mkErrorCleanRepo();
		divergent(dir);
		const headBefore = git(dir, ["rev-parse", "HEAD"]);
		const { ctx, notifications, confirmCalls } = makeCtx(true);
		await runMergeBackFlow(ctx, dir, "feat");
		assert.equal(confirmCalls(), 0, "dry-run must not prompt");
		const text = notifications.map((n) => n.message).join("\n");
		assert.match(text, /planned steps:/);
		assert.match(text, /conflicts: clean/);
		assert.match(text, /Dry-run only — re-run with `--execute`/);
		assert.equal(git(dir, ["rev-parse", "HEAD"]), headBefore);
		assert.equal(git(dir, ["status", "--porcelain"]), "");
	});

	test("4. --execute + confirm=false → cancelled, no merge", async () => {
		const dir = mkErrorCleanRepo();
		divergent(dir);
		const headBefore = git(dir, ["rev-parse", "HEAD"]);
		const { ctx, notifications, confirmCalls } = makeCtx(false);
		await runMergeBackFlow(ctx, dir, "feat --execute");
		assert.equal(confirmCalls(), 1, "execute path must prompt exactly once");
		const note = notifications.at(-1)!;
		assert.match(note.message, /cancelled — nothing changed/);
		assert.equal(git(dir, ["rev-parse", "HEAD"]), headBefore);
	});

	test("5. --execute + confirm=true → delegates to executeMergeBack (HEAD moves, steps rendered)", async () => {
		const dir = mkErrorCleanRepo();
		divergent(dir);
		const headBefore = git(dir, ["rev-parse", "HEAD"]);
		const { ctx, notifications, confirmCalls } = makeCtx(true);
		await runMergeBackFlow(ctx, dir, "feat --execute");
		assert.equal(confirmCalls(), 1);
		const text = notifications.map((n) => n.message).join("\n");
		assert.match(text, /step 1 \[ok\] git merge — merged feat/);
		assert.match(text, /merge-back complete — merged feat/);
		assert.match(text, /audit commit [0-9a-f]+/, "D4 audit commit reported");
		assert.notEqual(git(dir, ["rev-parse", "HEAD"]), headBefore);
		// The audit commit carries the mandated subject and store-only paths.
		assert.equal(git(dir, ["log", "-1", "--format=%s"]), "velpari(merge-back): feat — audit trail");
	});
});
