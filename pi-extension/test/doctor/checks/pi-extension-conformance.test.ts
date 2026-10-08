/**
 * pi-extension-conformance doctor check tests (Phase C, plan Subphase 2.6 — G2b).
 *
 * Fixtures are TEMP extension-source checkouts (package.json name +
 * pi-extension/src layer tree + hooks/index.ts) built from the real
 * `LAYERS` map — no real extension files are touched. Covers: plain
 * project → info skip; complete fixture → ok; missing declared folder →
 * error; undeclared folder → error; chirpi import → error; missing hook
 * registrars → warning; installed mode → ok / incomplete → warning.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkPiExtensionConformance } from "../../../src/doctor/checks/pi-extension-conformance.js";
import { LAYERS } from "../../../src/layers.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-conformance-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Write a file under the fixture root, creating parent directories as needed.
 * @param {string} rel - Path relative to the temp fixture root.
 * @param {string} content - UTF-8 content to write.
 * @returns {void} Nothing; the file exists at `<tmpDir>/<rel>` afterwards.
 */
function put(rel: string, content: string): void {
	const abs = path.join(tmpDir, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf8");
}

/** Complete extension-source fixture: package.json + all layer folders + wired hooks. */
function makeSourceCheckout(): void {
	put(
		"package.json",
		JSON.stringify({
			name: "@adi-mudi/pi-velpari",
			peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
		}),
	);
	for (const folders of Object.values(LAYERS)) {
		for (const folder of folders) {
			fs.mkdirSync(path.join(tmpDir, "pi-extension", "src", folder), { recursive: true });
		}
	}
	put(
		"pi-extension/src/hooks/index.ts",
		[
			"registerSessionStartHook(pi);",
			"registerSessionBeforeCompactHook(pi);",
			"registerSessionShutdownHook(pi);",
			"registerToolCallHook(pi);",
			"registerBeforeAgentStartHook(pi);",
		].join("\n"),
	);
	put(
		"pi-extension/src/index.ts",
		'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";\nexport function activate(pi: ExtensionAPI): void {}\n',
	);
}

describe("checkPiExtensionConformance", () => {
	it("plain project (not an extension) → single info skip", () => {
		put("package.json", JSON.stringify({ name: "some-user-project" }));
		const section = checkPiExtensionConformance(tmpDir);
		assert.equal(section.title, "Pi extension conformance");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /conformance skipped/);
	});

	it("empty cwd (no package.json) → single info skip", () => {
		const section = checkPiExtensionConformance(tmpDir);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
	});

	it("complete source checkout → folder/hook/hygiene all ok", () => {
		makeSourceCheckout();
		const section = checkPiExtensionConformance(tmpDir);
		assert.ok(!section.items.some((i) => i.status === "error"), JSON.stringify(section.items, null, 2));
		assert.ok(section.items.some((i) => i.message.includes("declared layer folders present")));
		assert.ok(section.items.some((i) => i.message.includes("registers all 5 required lifecycle hooks")));
		assert.ok(section.items.some((i) => i.message.includes("Dependency hygiene clean")));
	});

	it("missing declared folder → error conformance-layer-mismatch", () => {
		makeSourceCheckout();
		fs.rmSync(path.join(tmpDir, "pi-extension", "src", "ui"), { recursive: true, force: true });
		const section = checkPiExtensionConformance(tmpDir);
		const err = section.items.find((i) => i.status === "error");
		assert.ok(err, "expected an error");
		assert.match(err!.message, /declares ui\/ but the folder is missing/);
		assert.match(err!.suggestion ?? "", /architecture-alignment/);
	});

	it("undeclared CODE folder under src/ → error conformance-layer-mismatch", () => {
		makeSourceCheckout();
		put("pi-extension/src/rogue/rogue.ts", "export const x = 1;\n");
		const section = checkPiExtensionConformance(tmpDir);
		const err = section.items.find((i) => i.status === "error");
		assert.ok(err, "expected an error");
		assert.match(err!.message, /src\/rogue\/ exists but is not declared/);
	});

	it("content-only folder under src/ (no .ts) → exempt, no error", () => {
		makeSourceCheckout();
		put("pi-extension/src/agents/web-search-agent-body.md", "# body\n");
		const section = checkPiExtensionConformance(tmpDir);
		assert.equal(
			section.items.some((i) => i.status === "error" && i.message.includes("src/agents/")),
			false,
			"a content-only folder is not a layer folder",
		);
	});

	it("chirpi static import → error conformance-dep-violation", () => {
		makeSourceCheckout();
		put("pi-extension/src/core/rogue.ts", 'import { x } from "@adi-mudi/pi-chirpi";\n');
		const section = checkPiExtensionConformance(tmpDir);
		const err = section.items.find((i) => i.status === "error");
		assert.ok(err, "expected an error");
		assert.match(err!.message, /forbidden static import/);
		assert.match(err!.message, /pi-chirpi/);
	});

	it("pi-interactive-subagents static import → error (must stay text-only)", () => {
		makeSourceCheckout();
		put("pi-extension/src/core/rogue.ts", 'import { subagent } from "pi-interactive-subagents";\n');
		const section = checkPiExtensionConformance(tmpDir);
		const err = section.items.find((i) => i.status === "error");
		assert.ok(err, "expected an error");
		assert.match(err!.message, /interactive-subagents/);
	});

	it("missing hook registrar → warning conformance-hooks-missing", () => {
		makeSourceCheckout();
		put("pi-extension/src/hooks/index.ts", "registerSessionStartHook(pi);\n");
		const section = checkPiExtensionConformance(tmpDir);
		const warn = section.items.find((i) => i.status === "warning");
		assert.ok(warn, "expected a warning");
		assert.match(warn!.message, /does not register:/);
		assert.match(warn!.message, /tool_call/);
	});

	it("imported but undeclared pi peer → error", () => {
		makeSourceCheckout();
		put("package.json", JSON.stringify({ name: "@adi-mudi/pi-velpari", peerDependencies: {} }));
		const section = checkPiExtensionConformance(tmpDir);
		const err = section.items.find((i) => i.status === "error");
		assert.ok(err, "expected an error");
		assert.match(err!.message, /peerDependencies does not declare/);
	});

	it("installed mode complete → ok; incomplete → warning", () => {
		const distIndex = path.join(tmpDir, "node_modules", "@adi-mudi", "pi-velpari", "dist", "pi-extension", "src", "index.js");
		const skills = path.join(tmpDir, "node_modules", "@adi-mudi", "pi-velpari", "skills");
		fs.mkdirSync(path.dirname(distIndex), { recursive: true });
		fs.writeFileSync(distIndex, "// dist\n", "utf8");
		fs.mkdirSync(skills, { recursive: true });
		fs.writeFileSync(path.join(skills, "README.md"), "# skills\n", "utf8");

		const section = checkPiExtensionConformance(tmpDir);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]!.message, /Installed extension complete/);

		fs.rmSync(skills, { recursive: true, force: true });
		const broken = checkPiExtensionConformance(tmpDir);
		assert.equal(broken.items[0]?.status, "warning");
		assert.match(broken.items[0]!.message, /missing: skills\//);
	});

	it("throws are caught (doctor always renders)", () => {
		// Unreadable package.json (a directory named package.json) must not crash.
		fs.mkdirSync(path.join(tmpDir, "package.json"), { recursive: true });
		const section = checkPiExtensionConformance(tmpDir);
		assert.ok(section.items.length > 0);
	});
});
