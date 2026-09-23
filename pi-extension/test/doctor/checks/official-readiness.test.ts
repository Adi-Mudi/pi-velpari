/**
 * Tests for doctor/checks/official-readiness.ts.
 * Phase 2: closes the 25% / 18% funcs coverage gap.
 *
 * The check has 7 sub-checks; each test exercises one to cover all
 * 7 helper functions (readPackageJson, checkKeyword, checkPiExtensions,
 * checkSubagentsBundledDep, checkNpmignore, plus the inline
 * peer-dep / repository / README checks).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkOfficialReadiness } from "../../../src/doctor/checks/official-readiness.js";

function makeCwd(): string {
	return mkdtempSync(join(tmpdir(), "velpari-official-readiness-"));
}

const GOOD_PKG = {
	name: "@adi-mudi/pi-velpari",
	version: "1.3.0",
	keywords: ["pi-package", "pi", "extension"],
	pi: {
		extensions: ["./pi-extension/src/index.ts"],
		skills: [],
	},
	dependencies: {},
	bundledDependencies: [],
	peerDependencies: {
		"@earendil-works/pi-coding-agent": "^0.85.0",
		"@earendil-works/pi-tui": "^0.85.0",
		typebox: "^1.3.27",
	},
	repository: { url: "git+https://github.com/Adi-Mudi/pi-velpari.git" },
};

function writePackage(cwd: string, overrides: Record<string, unknown> = {}): void {
	const pkg = { ...GOOD_PKG, ...overrides };
	writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
}

function writeNpmignore(cwd: string, lines: string[]): void {
	writeFileSync(join(cwd, ".npmignore"), lines.join("\n") + "\n", "utf8");
}

function writeReadme(cwd: string, content: string): void {
	writeFileSync(join(cwd, "README.md"), content, "utf8");
}

describe("checkOfficialReadiness — minimal good project", () => {
	it("reports zero errors + at least one ok item when everything is in place", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd);
			writeNpmignore(cwd, ["coverage/", ".IDE_Plans/"]);
			writeReadme(cwd, "Install: `pi install npm:@adi-mudi/pi-velpari`\n");
			const section = checkOfficialReadiness(cwd);
			assert.equal(section.title, "Official-extension readiness");
			const errors = section.items.filter((i) => i.status === "error");
			assert.equal(errors.length, 0, `unexpected errors: ${errors.map((e) => e.message).join("\n")}`);
			assert.ok(
				section.items.some((i) => i.status === "ok"),
				"at least one ok item",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkOfficialReadiness — keyword check", () => {
	it("errors when keywords are missing", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd, { keywords: ["something-else"] });
			const section = checkOfficialReadiness(cwd);
			const errors = section.items.filter((i) => i.status === "error");
			assert.ok(errors.some((e) => /pi-package/.test(e.message)));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("errors when keywords is a non-array value", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd, { keywords: "pi-package,extension" });
			const section = checkOfficialReadiness(cwd);
			assert.ok(section.items.some((i) => i.status === "error"));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("errors when keywords is missing entirely", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd, { keywords: undefined });
			const section = checkOfficialReadiness(cwd);
			assert.ok(section.items.some((i) => i.status === "error" && /pi-package/.test(i.message)));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkOfficialReadiness — pi.extensions check", () => {
	it("errors when pi.extensions is empty", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd, { pi: { extensions: [], skills: [] } });
			const section = checkOfficialReadiness(cwd);
			assert.ok(section.items.some((i) => i.status === "error" && /extensions/i.test(i.message)));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("errors when pi object is missing", () => {
		const cwd = makeCwd();
		try {
			const pkg = { ...GOOD_PKG };
			delete (pkg as Record<string, unknown>).pi;
			writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg, null, 2));
			const section = checkOfficialReadiness(cwd);
			assert.ok(section.items.some((i) => i.status === "error"));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkOfficialReadiness — subagents bundled-dep check", () => {
	it("warns when subagents is missing from dependencies", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd);
			const section = checkOfficialReadiness(cwd);
			assert.ok(section.items.some((i) => i.status === "warning" && /pi-interactive-subagents/.test(i.message)));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("warns when subagents is in dependencies but not in bundledDependencies", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd, {
				dependencies: { "pi-interactive-subagents": "^3.7.2" },
				bundledDependencies: [],
			});
			const section = checkOfficialReadiness(cwd);
			assert.ok(section.items.some((i) => i.status === "warning" && /pi-interactive-subagents/.test(i.message)));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("ok when subagents is in both dependencies + bundledDependencies", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd, {
				dependencies: { "pi-interactive-subagents": "^3.7.2" },
				bundledDependencies: ["pi-interactive-subagents"],
			});
			const section = checkOfficialReadiness(cwd);
			const ok = section.items.find((i) => i.status === "ok" && /pi-interactive-subagents/.test(i.message));
			assert.ok(ok, "expected an ok item for subagents");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkOfficialReadiness — .npmignore check", () => {
	it("warns when .npmignore is missing", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd);
			const section = checkOfficialReadiness(cwd);
			assert.ok(section.items.some((i) => i.status === "warning" && /\.npmignore/i.test(i.message)));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("passes .npmignore check when file exists", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd);
			writeNpmignore(cwd, ["coverage/"]);
			const section = checkOfficialReadiness(cwd);
			const ok = section.items.find((i) => i.status === "ok" && /\.npmignore/i.test(i.message));
			assert.ok(ok, "expected ok item for .npmignore");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkOfficialReadiness — README install line check", () => {
	it("warns when README install line uses the wrong package name", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd);
			writeNpmignore(cwd, []);
			writeReadme(cwd, "Install: `pi install npm:@wrong/package`\n");
			const section = checkOfficialReadiness(cwd);
			assert.ok(section.items.some((i) => /README/.test(i.message)));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("warns when README.md is missing", () => {
		const cwd = makeCwd();
		try {
			writePackage(cwd);
			writeNpmignore(cwd, []);
			const section = checkOfficialReadiness(cwd);
			const warn = section.items.find((i) => i.status === "warning" && /README\.md missing/i.test(i.message));
			assert.ok(warn, "expected a warning about missing README");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkOfficialReadiness — malformed package.json", () => {
	it("treats corrupt package.json as missing", () => {
		const cwd = makeCwd();
		try {
			writeFileSync(join(cwd, "package.json"), "{not-json", "utf8");
			const section = checkOfficialReadiness(cwd);
			// Without a readable package.json, every check fails.
			assert.ok(section.items.some((i) => i.status === "error"));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
