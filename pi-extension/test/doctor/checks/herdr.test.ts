/**
 * herdr doctor check tests (herdr integration initiative, Phase 3).
 *
 * Everything is deterministic: the mux env is injected, the CLI probes and
 * the plugin root/version are injected, so no real `herdr` install and no
 * ambient herdr pane are needed (this dev machine runs inside one, and the
 * OP-7 follow-up showed ambient-env dependencies are a real failure class).
 *
 * Covers: version parsing, floor comparison, floor resolution precedence,
 * all four version outcomes, both pi-integration outcomes, the three
 * herdr-backend outcomes, and the `runDoctor` wiring (no error items).
 */

import { after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	HERDR_MIN_VERSION_ENV,
	HERDR_MIN_VERSION_PLACEHOLDER,
	checkHerdrSection,
	detectSubagentHerdrBackend,
	isBelowFloor,
	parseHerdrVersion,
	piIntegrationStatus,
	resolveHerdrFloor,
	type HerdrCheckOptions,
} from "../../../src/doctor/checks/herdr.js";
import { runDoctor } from "../../../src/doctor/index.js";

/** Temp roots created by this suite; drained in the `after` hook. */
const roots: string[] = [];

/** Create a temp root and register it for cleanup. */
function tmpRoot(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	roots.push(dir);
	return dir;
}

after(() => {
	for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Build an env with every mux signal cleared, then apply overrides. Mirrors
 * the helper in `test/core/multiplexer.test.ts` (all 11 signals, including
 * the two herdr ones and the floor override).
 */
function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
	const base: Record<string, string | undefined> = {
		TMUX: undefined,
		ZELLIJ_PANE_ID: undefined,
		ZELLIJ_SESSION_NAME: undefined,
		WEZTERM_PANE: undefined,
		WEZTERM_EXECUTABLE: undefined,
		CMUX_PANE_ID: undefined,
		CMUX_SESSION_NAME: undefined,
		HERDR_ENV: undefined,
		HERDR_PANE_ID: undefined,
		PI_SUBAGENT_MUX: undefined,
		[HERDR_MIN_VERSION_ENV]: undefined,
	};
	for (const [k, v] of Object.entries(overrides)) base[k] = v;
	return base as NodeJS.ProcessEnv;
}

/** An env where herdr is the detected multiplexer. */
const HERDR_ENV_ACTIVE = env({ HERDR_ENV: "1" });

/**
 * Build a plugin fixture directory.
 * @param {Record<string, string>} files - relative path → content.
 */
function pluginFixture(files: Record<string, string>): string {
	const root = tmpRoot("herdr-plugin-");
	for (const [rel, content] of Object.entries(files)) {
		const full = join(root, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content);
	}
	return root;
}

/** Default probe overrides that keep every finding on its happy path. */
function healthyProbes(): {
	versionProbe: () => string;
	integrationProbe: () => string;
	subagentsRoot: string;
	subagentsVersion: string;
} {
	return {
		versionProbe: () => "herdr 0.9.3",
		integrationProbe: () => "pi: current (v9) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)",
		subagentsRoot: pluginFixture({
			"package.json": '{"name":"pi-interactive-subagents","version":"9.0.0"}',
			"pi-extension/backends/herdr.ts": "export const backend = 'herdr';",
		}),
		subagentsVersion: "9.0.0",
	};
}

describe("parseHerdrVersion", () => {
	it("parses `herdr 0.9.3`", () => {
		assert.equal(parseHerdrVersion("herdr 0.9.3"), "0.9.3");
	});
	it("parses a v-prefixed prerelease `herdr v1.0.0-beta.1`", () => {
		assert.equal(parseHerdrVersion("herdr v1.0.0-beta.1"), "1.0.0");
	});
	it("parses a bare version", () => {
		assert.equal(parseHerdrVersion("0.9.1"), "0.9.1");
	});
	it("returns null when there is no semver token", () => {
		assert.equal(parseHerdrVersion("no version here"), null);
	});
	it("returns null for null / undefined input", () => {
		assert.equal(parseHerdrVersion(null), null);
		assert.equal(parseHerdrVersion(undefined), null);
	});
});

describe("isBelowFloor", () => {
	it("equal versions are not below", () => {
		assert.equal(isBelowFloor("0.9.0", "0.9.0"), false);
	});
	it("higher patch is not below", () => {
		assert.equal(isBelowFloor("0.9.3", "0.9.0"), false);
	});
	it("higher major is not below", () => {
		assert.equal(isBelowFloor("1.0.0", "0.9.0"), false);
	});
	it("lower patch is below", () => {
		assert.equal(isBelowFloor("0.8.9", "0.9.0"), true);
	});
	it("unparseable floor → null (gate skipped, never a false warning)", () => {
		assert.equal(isBelowFloor("0.9.3", "lts/*"), null);
	});
	it("unparseable version → null", () => {
		assert.equal(isBelowFloor("garbage", "0.9.0"), null);
	});
});

describe("resolveHerdrFloor", () => {
	it("env override wins over everything", () => {
		const dir = tmpRoot("herdr-floor-env-");
		mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			join(dir, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: "X", velpari: { herdrMinVersion: "1.2.3" } }),
		);
		const out = resolveHerdrFloor(dir, env({ [HERDR_MIN_VERSION_ENV]: "9.9.9" }));
		assert.equal(out.floor, "9.9.9");
		assert.equal(out.source, HERDR_MIN_VERSION_ENV);
	});

	it("falls back to files.json velpari.herdrMinVersion", () => {
		const dir = tmpRoot("herdr-floor-file-");
		mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			join(dir, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: "X", velpari: { herdrMinVersion: "1.2.3" } }),
		);
		const out = resolveHerdrFloor(dir, env({}));
		assert.equal(out.floor, "1.2.3");
		assert.equal(out.source, "files.json velpari.herdrMinVersion");
	});

	it("falls back to the built-in placeholder constant when nothing is configured", () => {
		const out = resolveHerdrFloor(tmpRoot("herdr-floor-none-"), env({}));
		assert.equal(out.floor, HERDR_MIN_VERSION_PLACEHOLDER);
		assert.match(out.source, /built-in placeholder/);
	});

	it("survives a corrupt files.json (never throws, uses the constant)", () => {
		const dir = tmpRoot("herdr-floor-broken-");
		mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
		writeFileSync(join(dir, ".pi", "velpari", "files.json"), "{not json");
		const out = resolveHerdrFloor(dir, env({}));
		assert.equal(out.floor, HERDR_MIN_VERSION_PLACEHOLDER);
	});
});

describe("checkHerdrSection — branch A (herdr not detected)", () => {
	it("returns ONE info line and runs no probes", () => {
		let probed = false;
		const section = checkHerdrSection(tmpRoot("herdr-a-"), {
			env: env({ PI_SUBAGENT_MUX: "tmux" }),
			versionProbe: () => {
				probed = true;
				return "herdr 0.9.3";
			},
		});
		assert.equal(section.title, "Herdr (integration readiness)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "info");
		assert.match(section.items[0]!.message, /herdr not detected \(mux=tmux/);
		assert.equal(probed, false, "no CLI probe should run when herdr is not the active mux");
	});

	it("never emits a herdr-backend-missing item when mux is not herdr", () => {
		const section = checkHerdrSection(tmpRoot("herdr-a2-"), {
			env: env({ HERDR_ENV: undefined, TMUX: "x" }),
			subagentsRoot: null,
		});
		assert.ok(!section.items.some((i) => i.message.includes("herdr-backend-missing")));
	});
});

describe("checkHerdrSection — version floor outcomes", () => {
	it("version at or above the floor → ok", () => {
		const section = checkHerdrSection(tmpRoot("herdr-b1-"), { env: HERDR_ENV_ACTIVE, ...healthyProbes() });
		const item = section.items.find((i) => i.message.includes("≥ floor"));
		assert.ok(item, "expected an ok version item");
		assert.equal(item!.status, "ok");
		assert.match(item!.message, /herdr 0\.9\.3 ≥ floor 0\.9\.0/);
	});

	it("version below the floor → warning with a fix", () => {
		const section = checkHerdrSection(tmpRoot("herdr-b2-"), {
			env: HERDR_ENV_ACTIVE,
			versionProbe: () => "herdr 0.8.1",
			integrationProbe: () => null,
			subagentsRoot: null,
		});
		const item = section.items.find((i) => i.message.includes("herdr-version-below-floor"));
		assert.ok(item, "expected the below-floor warning");
		assert.equal(item!.status, "warning");
		assert.match(item!.message, /herdr 0\.8\.1 is below the supported floor 0\.9\.0/);
		assert.match(item!.suggestion ?? "", /herdr update/);
	});

	it("CLI absent from PATH → warning herdr-cli-missing", () => {
		const section = checkHerdrSection(tmpRoot("herdr-b3-"), {
			env: HERDR_ENV_ACTIVE,
			versionProbe: () => null,
			integrationProbe: () => null,
			subagentsRoot: null,
		});
		const item = section.items.find((i) => i.message.includes("herdr-cli-missing"));
		assert.ok(item, "expected the cli-missing warning");
		assert.equal(item!.status, "warning");
		assert.match(item!.suggestion ?? "", /install\.sh/);
	});

	it("unparseable version output → info, and NO warning (false-warning guard)", () => {
		const section = checkHerdrSection(tmpRoot("herdr-b4-"), {
			env: HERDR_ENV_ACTIVE,
			versionProbe: () => "herdr (build dev)",
			integrationProbe: () => null,
			subagentsRoot: null,
		});
		const item = section.items.find((i) => i.message.includes("could not be parsed"));
		assert.ok(item, "expected the parse-skip info item");
		assert.equal(item!.status, "info");
		assert.ok(
			!section.items.some((i) => i.status === "warning" && i.message.includes("version")),
			"unparseable output must not produce a version warning",
		);
	});

	it("unparseable configured floor → info, gate skipped", () => {
		const section = checkHerdrSection(tmpRoot("herdr-b5-"), {
			env: HERDR_ENV_ACTIVE,
			floor: "lts/*",
			versionProbe: () => "herdr 0.9.3",
			integrationProbe: () => null,
			subagentsRoot: null,
		});
		const item = section.items.find((i) => i.message.includes("not a parsable version"));
		assert.ok(item, "expected the floor-parse info item");
		assert.equal(item!.status, "info");
	});

	it("env override changes the verdict (floor is runtime-configurable)", () => {
		const section = checkHerdrSection(tmpRoot("herdr-b6-"), {
			env: env({ HERDR_ENV: "1", [HERDR_MIN_VERSION_ENV]: "5.0.0" }),
			// Injected so the verdict never depends on whether `herdr` happens
			// to be installed on the machine running the suite (CI has none).
			versionProbe: () => "herdr 0.9.3",
			integrationProbe: () => null,
			subagentsRoot: null,
		});
		const item = section.items.find((i) => i.message.includes("herdr-version-below-floor"));
		assert.ok(item, "0.9.3 must be below an env-pinned 5.0.0 floor");
		assert.match(item!.message, /below the supported floor 5\.0\.0/);
		assert.match(item!.details?.join(" ") ?? "", /PI_VELPARI_HERDR_MIN_VERSION/);
	});
});

describe("piIntegrationStatus", () => {
	it("parses the real `pi: current (vN)` line", () => {
		assert.equal(
			piIntegrationStatus("pi: current (v9) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)"),
			"current (v9)",
		);
	});

	it("returns null for the real `not installed` line", () => {
		assert.equal(piIntegrationStatus("pi: not installed (/home/u/.pi/agent/extensions/herdr-agent-state.ts)"), null);
	});

	it("ignores sibling integration names (opencode, antigravity-cli)", () => {
		const raw = ["opencode: current (v13)", "antigravity-cli: current (v1)", "omp: not installed"].join("\n");
		assert.equal(piIntegrationStatus(raw), null);
	});

	it("finds the pi line inside a full status listing", () => {
		const raw = [
			"omp: not installed (/home/u/.omp/agent/extensions/herdr-omp-agent-state.ts)",
			"pi: current (v9) (/home/u/.pi/agent/extensions/herdr-agent-state.ts)",
			"kimi: current (v7) (/home/u/.kimi-code/hooks/herdr-agent-state.sh)",
		].join("\n");
		assert.equal(piIntegrationStatus(raw), "current (v9)");
	});

	it("returns null for null output (conservative → info recommendation)", () => {
		assert.equal(piIntegrationStatus(null), null);
	});

	it("returns null for an unknown format", () => {
		assert.equal(piIntegrationStatus("usage: herdr integration status [--outdated-only]"), null);
	});
});

describe("checkHerdrSection — pi integration recommendation", () => {
	it("installed → ok", () => {
		const section = checkHerdrSection(tmpRoot("herdr-c1-"), { env: HERDR_ENV_ACTIVE, ...healthyProbes() });
		const item = section.items.find((i) => i.message.includes("pi integration installed"));
		assert.ok(item);
		assert.equal(item!.status, "ok");
	});

	it("missing / unreadable → info recommending `herdr integration install pi`", () => {
		const section = checkHerdrSection(tmpRoot("herdr-c2-"), {
			env: HERDR_ENV_ACTIVE,
			versionProbe: () => "herdr 0.9.3",
			integrationProbe: () => null,
			subagentsRoot: null,
		});
		const item = section.items.find((i) => i.message.includes("herdr integration install pi"));
		assert.ok(item, "expected the install recommendation");
		assert.equal(item!.status, "info");
		assert.match(item!.suggestion ?? "", /herdr integration install pi/);
	});
});

describe("detectSubagentHerdrBackend", () => {
	it("finds the marker in package source", () => {
		const root = pluginFixture({ "pi-extension/mux.ts": "const kinds = ['herdr'];" });
		assert.equal(detectSubagentHerdrBackend(root), true);
	});

	it("finds the marker case-insensitively", () => {
		const root = pluginFixture({ "README.md": "Supports HERDR panes." });
		assert.equal(detectSubagentHerdrBackend(root), true);
	});

	it("returns false for a plugin with no herdr marker (the 3.7.2 shape)", () => {
		const root = pluginFixture({
			"package.json": '{"name":"pi-interactive-subagents","version":"3.7.2"}',
			"pi-extension/index.ts": "export const backends = ['cmux', 'tmux', 'zellij', 'wezterm'];",
		});
		assert.equal(detectSubagentHerdrBackend(root), false);
	});

	it("ignores matches under node_modules", () => {
		const root = pluginFixture({ "node_modules/dep/index.js": "// herdr" });
		assert.equal(detectSubagentHerdrBackend(root), false);
	});

	it("returns false for null root and for a missing directory", () => {
		assert.equal(detectSubagentHerdrBackend(null), false);
		assert.equal(detectSubagentHerdrBackend(join(tmpdir(), "definitely-not-there-herdr")), false);
	});
});

describe("checkHerdrSection — subagents herdr backend", () => {
	it("backend marker found → ok", () => {
		const section = checkHerdrSection(tmpRoot("herdr-d1-"), { env: HERDR_ENV_ACTIVE, ...healthyProbes() });
		const item = section.items.find((i) => i.message.includes("herdr backend detected"));
		assert.ok(item, "expected the backend-ok item");
		assert.equal(item!.status, "ok");
		assert.match(item!.message, /9\.0\.0/);
	});

	it("plugin present without a backend → warning 'scouts cannot spawn yet'", () => {
		const root = pluginFixture({
			"package.json": '{"name":"pi-interactive-subagents","version":"3.7.2"}',
			"pi-extension/index.ts": "export const backends = ['cmux', 'tmux'] as const;",
		});
		const section = checkHerdrSection(tmpRoot("herdr-d2-"), {
			env: HERDR_ENV_ACTIVE,
			versionProbe: () => "herdr 0.9.3",
			integrationProbe: () => null,
			subagentsRoot: root,
			subagentsVersion: "3.7.2",
		});
		const item = section.items.find((i) => i.message.includes("herdr-backend-missing"));
		assert.ok(item, "expected the backend-missing warning");
		assert.equal(item!.status, "warning");
		assert.match(item!.message, /scouts cannot spawn yet/);
		assert.match(item!.message, /pi-interactive-subagents 3\.7\.2/);
		assert.match(item!.suggestion ?? "", /Phase 4/);
	});

	it("no plugin at all → warning naming the missing plugin", () => {
		const section = checkHerdrSection(tmpRoot("herdr-d3-"), {
			env: HERDR_ENV_ACTIVE,
			versionProbe: () => "herdr 0.9.3",
			integrationProbe: () => null,
			subagentsRoot: null,
			subagentsVersion: null,
		});
		const item = section.items.find((i) => i.message.includes("no subagents plugin was found"));
		assert.ok(item, "expected the missing-plugin warning");
		assert.equal(item!.status, "warning");
	});
});

describe("checkHerdrSection — robustness", () => {
	it("a throwing probe still renders a section with non-empty messages", () => {
		const section = checkHerdrSection(tmpRoot("herdr-e1-"), {
			env: HERDR_ENV_ACTIVE,
			versionProbe: () => {
				throw new Error("boom");
			},
		});
		assert.equal(section.title, "Herdr (integration readiness)");
		assert.ok(section.items.length > 0);
		assert.ok(section.items.every((i) => typeof i.message === "string" && i.message.length > 0));
	});

	it("never emits an error item (the doctor verdict must be unaffected)", () => {
		const root = pluginFixture({ "package.json": '{"version":"1.0.0"}' });
		const probes: HerdrCheckOptions[] = [
			{ env: env({ PI_SUBAGENT_MUX: "tmux" }) },
			{ env: HERDR_ENV_ACTIVE, versionProbe: () => "herdr 0.9.3" },
			{ env: HERDR_ENV_ACTIVE, versionProbe: () => null },
			{ env: HERDR_ENV_ACTIVE, versionProbe: () => "herdr 0.1.0" },
			{ env: HERDR_ENV_ACTIVE, versionProbe: () => "?", floor: "?" },
			{ env: HERDR_ENV_ACTIVE, subagentsRoot: null, subagentsVersion: null },
			{ env: HERDR_ENV_ACTIVE, subagentsRoot: root, subagentsVersion: "1.0.0" },
		];
		for (const opts of probes) {
			const section = checkHerdrSection(tmpRoot("herdr-e2-"), opts);
			for (const item of section.items) {
				assert.notEqual(item.status, "error", `unexpected error item: ${item.message}`);
			}
		}
	});
});

describe("runDoctor wiring", () => {
	it("registers the Herdr section and it contributes no errors", () => {
		const dir = tmpRoot("herdr-wiring-");
		const report = runDoctor(dir);
		const section = report.sections.find((s) => s.title === "Herdr (integration readiness)");
		assert.ok(section, "Herdr section missing from runDoctor output");
		for (const item of section!.items) {
			assert.notEqual(item.status, "error", `Herdr section emitted an error: ${item.message}`);
		}
	});
});
