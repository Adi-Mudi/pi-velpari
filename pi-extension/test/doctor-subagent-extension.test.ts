/**
 * doctor/checks/subagent-extension tests (Phase 4a).
 *
 * Locks the contract for the sub-agent extension health check:
 *   - missing settings.json -> info
 *   - dead local-path entry -> warning
 *   - multiple sub-agent providers -> warning
 *   - pi-interactive-subagents missing -> error
 *   - pi-interactive-subagents too old -> warning
 *   - pi-interactive-subagents ≥ 3.7.2 -> ok
 *
 * The check accepts an `agentDirOverride` argument so tests can stage
 * a fake settings.json under a tmpdir.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSubagentExtension } from "../src/discipline/doctor/checks/subagent-extension.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-subagent-"));
}

function stageSettings(dir: string, settings: object): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "settings.json"), JSON.stringify(settings), "utf8");
}

test("returns info when settings.json is missing", () => {
	const dir = tempDir();
	try {
		const section = checkSubagentExtension(dir);
		assert.equal(section.title, "Sub-agent extension");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "info");
		assert.match(section.items[0]!.message, /Could not read pi settings\.json/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("emits error when pi-interactive-subagents is not listed", () => {
	const dir = tempDir();
	try {
		stageSettings(dir, { packages: ["npm:@foo/bar"] });
		const section = checkSubagentExtension(dir);
		const err = section.items.find((it) => it.status === "error");
		assert.ok(err, "expected an error item");
		assert.match(err.message, /pi-interactive-subagents is not in pi's packages list/);
		assert.ok(err.suggestion, "error item must carry a suggestion");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("emits ok when pi-interactive-subagents ≥ 3.7.2 and version.json is readable", () => {
	const dir = tempDir();
	try {
		stageSettings(dir, {
			packages: ["git:github.com/HazAT/pi-interactive-subagents"],
		});
		const pkgDir = join(
			dir,
			"git",
			"github.com",
			"HazAT",
			"pi-interactive-subagents",
		);
		mkdirSync(pkgDir, { recursive: true });
		writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ version: "3.7.5" }), "utf8");

		const section = checkSubagentExtension(dir);
		const ok = section.items.find((it) => it.status === "ok");
		assert.ok(ok, "expected an ok item");
		assert.match(ok.message, /pi-interactive-subagents 3\.7\.5 installed/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("emits warning when pi-interactive-subagents is older than 3.7.2", () => {
	const dir = tempDir();
	try {
		stageSettings(dir, {
			packages: ["git:github.com/HazAT/pi-interactive-subagents"],
		});
		const pkgDir = join(dir, "git", "github.com", "HazAT", "pi-interactive-subagents");
		mkdirSync(pkgDir, { recursive: true });
		writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ version: "3.7.1" }), "utf8");

		const section = checkSubagentExtension(dir);
		const warn = section.items.find(
			(it) => it.status === "warning" && /older than/.test(it.message),
		);
		assert.ok(warn, "expected a 'older than 3.7.2' warning");
		assert.match(warn.message, /3\.7\.1/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("emits warning when multiple sub-agent providers are listed", () => {
	const dir = tempDir();
	try {
		stageSettings(dir, {
			packages: [
				"git:github.com/HazAT/pi-interactive-subagents",
				"git:github.com/someone/pi-subagents",
			],
		});
		const section = checkSubagentExtension(dir);
		const multi = section.items.find(
			(it) => it.status === "warning" && /Multiple sub-agent-providing/.test(it.message),
		);
		assert.ok(multi, "expected a 'multiple providers' warning");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("emits warning for dead local-path package entries", () => {
	const dir = tempDir();
	try {
		stageSettings(dir, {
			packages: ["./stale-extension/that/does/not/exist"],
		});
		const section = checkSubagentExtension(dir);
		const dead = section.items.find(
			(it) => it.status === "warning" && /Dead package entry/.test(it.message),
		);
		assert.ok(dead, "expected a 'dead package entry' warning");
		assert.ok(dead.details);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("emits info when version cannot be read but provider is listed", () => {
	const dir = tempDir();
	try {
		stageSettings(dir, {
			packages: ["git:github.com/HazAT/pi-interactive-subagents"],
		});
		// No package.json in the expected git clone location.
		const section = checkSubagentExtension(dir);
		const info = section.items.find(
			(it) => it.status === "info" && /could not be read/.test(it.message),
		);
		assert.ok(info, "expected an info item about unread version");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("verifies git clone path layout matches pi's actual install location", () => {
	// Smoke test that the version probe uses the path that pi actually
	// uses: <agentDir>/git/github.com/HazAT/pi-interactive-subagents/package.json.
	const dir = tempDir();
	try {
		stageSettings(dir, {
			packages: ["git:github.com/HazAT/pi-interactive-subagents@v3.7.2"],
		});
		const pkgDir = join(
			dir,
			"git",
			"github.com",
			"HazAT",
			"pi-interactive-subagents",
		);
		mkdirSync(pkgDir, { recursive: true });
		writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ version: "3.7.2" }), "utf8");
		assert.ok(existsSync(join(pkgDir, "package.json")));
		const section = checkSubagentExtension(dir);
		const ok = section.items.find((it) => it.status === "ok");
		assert.ok(ok, "expected ok at exactly 3.7.2 (boundary)");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
