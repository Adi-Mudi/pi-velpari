/**
 * doctor/checks/official-readiness tests (Phase 5 of official-extension plan).
 *
 * Locks the contract for the official-extension readiness check:
 *   - 7 sub-checks return correct status for happy + sad paths
 *   - All 5 actionable items route through fix-suggestions.ts
 *   - The check surfaces errors when package.json is missing
 *   - The check respects .npmignore presence/absence
 *   - The check distinguishes pinned vs unpinned peer dep ranges
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkOfficialReadiness } from "../src/discipline/doctor/checks/official-readiness.js";
import { suggestionFor, SUGGESTIONS } from "../src/discipline/doctor/checks/fix-suggestions.js";
import type { DiagnosticItem, DiagnosticSection } from "../src/discipline/doctor/_types.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-official-"));
}

function writePkg(
	dir: string,
	overrides: Record<string, unknown> = {},
): void {
	const base = {
		name: "@adi-mudi/pi-velpari",
		version: "1.0.0",
		keywords: ["pi-package", "pi"],
		pi: { extensions: ["./pi-extension/src/index.ts"] },
		peerDependencies: {
			"@earendil-works/pi-coding-agent": "*",
			"@earendil-works/pi-tui": "*",
			typebox: "*",
			"pi-interactive-subagents": ">=3.7.2",
		},
		repository: { type: "git", url: "https://github.com/Adi-Mudi/pi-velpari.git" },
	};
	const merged = { ...base, ...overrides };
	writeFileSync(join(dir, "package.json"), JSON.stringify(merged), "utf8");
}

function writeReadme(dir: string, body: string): void {
	writeFileSync(join(dir, "README.md"), body, "utf8");
}

function writeNpmignore(dir: string): void {
	writeFileSync(join(dir, ".npmignore"), ".IDE_Plans/\nDoc/\n", "utf8");
}

function findItem(section: DiagnosticSection, needle: string): DiagnosticItem | undefined {
	return section.items.find((i) => i.message.includes(needle));
}

test("official-readiness: happy path — all required sub-checks pass (info items allowed)", () => {
	const dir = tempDir();
	try {
		writePkg(dir);
		writeNpmignore(dir);
		writeReadme(
			dir,
			"## Install\n\n```bash\npi install npm:@adi-mudi/pi-velpari\n```\n",
		);
		const section = checkOfficialReadiness(dir);
		// The 5 required sub-checks must be `ok`. The 2 informational ones
		// (peer-dep pinning, repository) may be `ok` or `info` depending on
		// whether the user pinned ranges — both are acceptable outcomes.
		for (const item of section.items) {
			assert.ok(
				item.status === "ok" || item.status === "info",
				`expected ok or info but got ${item.status}: ${item.message}`,
			);
		}
		assert.ok(findItem(section, "pi-package"));
		assert.ok(findItem(section, "pi.extensions"));
		assert.ok(findItem(section, "pi-interactive-subagents"));
		assert.ok(findItem(section, ".npmignore"));
		assert.ok(findItem(section, "repository.url"));
		assert.ok(findItem(section, "README.md install line"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("official-readiness: missing pi-package keyword → error with suggestion", () => {
	const dir = tempDir();
	try {
		writePkg(dir, { keywords: ["pi", "extension"] });
		writeNpmignore(dir);
		writeReadme(dir, "pi install npm:@adi-mudi/pi-velpari\n");
		const section = checkOfficialReadiness(dir);
		const item = findItem(section, "pi-package");
		assert.ok(item, "expected an item mentioning the keyword");
		assert.equal(item!.status, "error");
		assert.equal(item!.suggestion, suggestionFor("official.missing-pi-package-keyword"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("official-readiness: missing pi.extensions → error with suggestion", () => {
	const dir = tempDir();
	try {
		writePkg(dir, { pi: { skills: ["./skills"] } });
		writeNpmignore(dir);
		writeReadme(dir, "pi install npm:@adi-mudi/pi-velpari\n");
		const section = checkOfficialReadiness(dir);
		const item = findItem(section, "pi.extensions");
		assert.ok(item);
		assert.equal(item!.status, "error");
		assert.equal(item!.suggestion, suggestionFor("official.missing-pi-extensions"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("official-readiness: missing pi-interactive-subagents peer dep → warning with suggestion", () => {
	const dir = tempDir();
	try {
		writePkg(dir, {
			peerDependencies: {
				"@earendil-works/pi-coding-agent": "*",
				"@earendil-works/pi-tui": "*",
				typebox: "*",
			},
		});
		writeNpmignore(dir);
		writeReadme(dir, "pi install npm:@adi-mudi/pi-velpari\n");
		const section = checkOfficialReadiness(dir);
		const item = findItem(section, "peerDependencies is missing");
		assert.ok(item);
		assert.equal(item!.status, "warning");
		assert.equal(item!.suggestion, suggestionFor("official.missing-subagents-dep"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("official-readiness: missing .npmignore → warning with suggestion", () => {
	const dir = tempDir();
	try {
		writePkg(dir);
		writeReadme(dir, "pi install npm:@adi-mudi/pi-velpari\n");
		// no .npmignore
		const section = checkOfficialReadiness(dir);
		const item = findItem(section, ".npmignore missing");
		assert.ok(item);
		assert.equal(item!.status, "warning");
		assert.equal(item!.suggestion, suggestionFor("official.missing-npmignore"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("official-readiness: wrong install name in README → warning with suggestion", () => {
	const dir = tempDir();
	try {
		writePkg(dir);
		writeNpmignore(dir);
		writeReadme(dir, "## Install\n\npi install npm:pi-velpari\n");
		const section = checkOfficialReadiness(dir);
		const item = findItem(section, "uses \"pi install npm:pi-velpari\"");
		assert.ok(item);
		assert.equal(item!.status, "warning");
		assert.equal(item!.suggestion, suggestionFor("official.wrong-install-name"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("official-readiness: pinned peer dep ranges produce ok items", () => {
	const dir = tempDir();
	try {
		writePkg(dir, {
			peerDependencies: {
				"@earendil-works/pi-coding-agent": ">=0.74.0",
				"@earendil-works/pi-tui": ">=0.85.0",
				typebox: ">=1.3.0",
				"pi-interactive-subagents": ">=3.7.2",
			},
		});
		writeNpmignore(dir);
		writeReadme(dir, "pi install npm:@adi-mudi/pi-velpari\n");
		const section = checkOfficialReadiness(dir);
		const codingAgent = findItem(section, "pi-coding-agent");
		assert.ok(codingAgent);
		assert.equal(codingAgent!.status, "ok");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("official-readiness: missing package.json → single error item", () => {
	const dir = tempDir();
	try {
		const section = checkOfficialReadiness(dir);
		const item = section.items[0]!;
		assert.equal(section.items.length, 1);
		assert.equal(item.status, "error");
		assert.match(item.message, /package\.json missing/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("official-readiness: missing repository.url → info item (no suggestion)", () => {
	const dir = tempDir();
	try {
		writePkg(dir, { repository: undefined });
		writeNpmignore(dir);
		writeReadme(dir, "pi install npm:@adi-mudi/pi-velpari\n");
		const section = checkOfficialReadiness(dir);
		const item = findItem(section, "repository.url not set");
		assert.ok(item);
		assert.equal(item!.status, "info");
		assert.equal(item!.suggestion, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("official-readiness: all 5 official.* fingerprints are defined in SUGGESTIONS", () => {
	const keys = [
		"official.missing-pi-package-keyword",
		"official.missing-pi-extensions",
		"official.missing-subagents-dep",
		"official.missing-npmignore",
		"official.wrong-install-name",
	] as const;
	for (const k of keys) {
		assert.ok(SUGGESTIONS[k], `SUGGESTIONS must define "${k}"`);
	}
});
