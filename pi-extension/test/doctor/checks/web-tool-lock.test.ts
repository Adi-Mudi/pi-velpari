/**
 * Tests for doctor/checks/web-tool-lock.ts.
 * Phase 2: closes the 35% coverage gap.
 *
 * The check enforces that ONLY the `web-search-agent` may carry
 * `websearch` or `fetchurl` in its tools list.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkWebToolLock } from "../../../src/doctor/checks/web-tool-lock.js";

function makeCwd(): string {
	return mkdtempSync(join(tmpdir(), "velpari-web-tool-lock-"));
}

function writeAgent(cwd: string, filename: string, frontmatter: Record<string, string>): void {
	const dir = join(cwd, ".pi", "agents");
	mkdirSync(dir, { recursive: true });
	const lines = ["---"];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push("---");
	lines.push("");
	lines.push("Body.");
	writeFileSync(join(dir, filename), lines.join("\n"), "utf8");
}

const BASE_FM = {
	description: "An agent",
	thinking: "medium",
	"session-mode": "standalone",
	"auto-exit": "true",
	spawning: "true",
};

describe("checkWebToolLock — no .pi/agents directory", () => {
	it("returns ok when .pi/agents/ does not exist", () => {
		const cwd = makeCwd();
		try {
			const section = checkWebToolLock(cwd);
			assert.equal(section.title, "Web-tool lock");
			assert.equal(section.items.length, 1);
			assert.equal(section.items[0]!.status, "ok");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkWebToolLock — empty .pi/agents directory", () => {
	it("returns ok when .pi/agents/ has no .md files", () => {
		const cwd = makeCwd();
		try {
			mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
			const section = checkWebToolLock(cwd);
			assert.equal(section.items[0]!.status, "ok");
			assert.match(section.items[0]!.message, /nothing to lock/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkWebToolLock — agents without web tools", () => {
	it("returns ok for a non-web agent", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "extractor.md", {
				...BASE_FM,
				name: "extractor",
				tools: "bash, read, write",
			});
			const section = checkWebToolLock(cwd);
			assert.ok(section.items.some((i) => i.status === "ok"));
			assert.equal(
				section.items.filter((i) => i.status === "error").length,
				0,
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("returns ok for the allowed web-search-agent carrying websearch", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "web-search-agent.md", {
				...BASE_FM,
				name: "web-search-agent",
				tools: "bash, read, websearch, fetchurl",
			});
			const section = checkWebToolLock(cwd);
			assert.equal(
				section.items.filter((i) => i.status === "error").length,
				0,
				`unexpected errors: ${JSON.stringify(section.items)}`,
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkWebToolLock — violations", () => {
	it("errors when a non-allowed agent carries websearch", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "extractor.md", {
				...BASE_FM,
				name: "extractor",
				tools: "bash, read, websearch",
			});
			const section = checkWebToolLock(cwd);
			const errors = section.items.filter((i) => i.status === "error");
			assert.ok(errors.length >= 1);
			assert.match(errors[0]!.message, /extractor/);
			assert.match(errors[0]!.message, /websearch/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("errors when a non-allowed agent carries fetchurl", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "prd-checker.md", {
				...BASE_FM,
				name: "prd-checker",
				tools: "bash, fetchurl",
			});
			const section = checkWebToolLock(cwd);
			const errors = section.items.filter((i) => i.status === "error");
			assert.ok(errors.length >= 1);
			assert.match(errors[0]!.message, /prd-checker/);
			assert.match(errors[0]!.message, /fetchurl/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("errors when both websearch and fetchurl are present in a non-allowed agent", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "rtm-checker.md", {
				...BASE_FM,
				name: "rtm-checker",
				tools: "bash, websearch, fetchurl",
			});
			const section = checkWebToolLock(cwd);
			const errors = section.items.filter((i) => i.status === "error");
			// 1 violation item + 1 summary item (with "1 violation" message)
			assert.ok(errors.length >= 1);
			const violation = errors.find((e) => /rtm-checker/.test(e.message));
			assert.ok(violation);
			assert.match(violation!.message, /websearch.*fetchurl|fetchurl.*websearch/);
			assert.ok(violation!.details && violation!.details.length > 0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("counts violations across multiple agents", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "extractor.md", {
				...BASE_FM,
				name: "extractor",
				tools: "bash, websearch",
			});
			writeAgent(cwd, "rtm-checker.md", {
				...BASE_FM,
				name: "rtm-checker",
				tools: "bash, fetchurl",
			});
			const section = checkWebToolLock(cwd);
			const errors = section.items.filter((i) => i.status === "error");
			assert.ok(errors.length >= 2);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("uses filename fallback when no `name:` in frontmatter", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "mystery-agent.md", {
				...BASE_FM,
				tools: "bash, websearch",
			});
			const section = checkWebToolLock(cwd);
			const errors = section.items.filter((i) => i.status === "error");
			assert.ok(errors.length >= 1);
			// falls back to "mystery-agent" (the filename without .md)
			assert.match(errors[0]!.message, /mystery-agent/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkWebToolLock — mixed scenarios", () => {
	it("reports ok when only web-search-agent has web tools", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "extractor.md", {
				...BASE_FM,
				name: "extractor",
				tools: "bash, read",
			});
			writeAgent(cwd, "web-search-agent.md", {
				...BASE_FM,
				name: "web-search-agent",
				tools: "bash, websearch, fetchurl",
			});
			const section = checkWebToolLock(cwd);
			assert.equal(section.items.filter((i) => i.status === "error").length, 0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("reports error count summary when violations exist", () => {
		const cwd = makeCwd();
		try {
			writeAgent(cwd, "extractor.md", {
				...BASE_FM,
				name: "extractor",
				tools: "bash, websearch",
			});
			writeAgent(cwd, "prd-checker.md", {
				...BASE_FM,
				name: "prd-checker",
				tools: "bash, read",
			});
			const section = checkWebToolLock(cwd);
			const summary = section.items.find(
				(i) => /violation\(s\) across/i.test(i.message),
			);
			assert.ok(summary);
			assert.equal(summary!.status, "error");
			assert.match(summary!.message, /1 violation/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});