/**
 * environment doctor check tests (Phase C, plan Subphase 2.6 — G2a).
 *
 * Covers: node/engines verdicts (pure fn), git-absent via PATH shim →
 * warning, pi-absent via PATH shim → warning, config contract absent →
 * info, throwing accessor → warning naming the key.
 *
 * PATH mutations are restored in `finally` (shared process.env — node:test
 * runs in one process).
 */

import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { checkEnvironmentSection, meetsEngines } from "../../../src/doctor/checks/environment.js";
import { resetContractForTests, setContractForTests, type ConfigApi } from "../../../src/doctor/contract.js";

afterEach(() => {
	resetContractForTests();
});

/** Run `fn` with PATH replaced, always restoring the original. */
function withPath(path: string, fn: () => void): void {
	const original = process.env.PATH;
	process.env.PATH = path;
	try {
		fn();
	} finally {
		process.env.PATH = original;
	}
}

describe("meetsEngines (pure)", () => {
	it("satisfies equal version", () => {
		assert.equal(meetsEngines("22.13.0", ">=22.13.0"), true);
	});
	it("satisfies higher major", () => {
		assert.equal(meetsEngines("23.0.0", ">=22.13.0"), true);
	});
	it("satisfies higher minor", () => {
		assert.equal(meetsEngines("22.14.0", ">=22.13.0"), true);
	});
	it("fails lower patch", () => {
		assert.equal(meetsEngines("22.12.9", ">=22.13.0"), false);
	});
	it("fails lower major", () => {
		assert.equal(meetsEngines("20.0.0", ">=22.13.0"), false);
	});
	it("unparseable range → null (gate skipped, never a false warning)", () => {
		assert.equal(meetsEngines("22.13.0", "lts/*"), null);
	});
});

describe("checkEnvironmentSection", () => {
	it("renders on this machine with node satisfying engines", () => {
		const section = checkEnvironmentSection(process.cwd());
		assert.equal(section.title, "Environment");
		const nodeItem = section.items.find((i) => i.message.includes("engines.node"));
		assert.ok(nodeItem, "expected a node/engines line");
		// The dev machine runs the CI-supported node — either ok or the
		// explicit warning; never the info-skips.
		assert.ok(nodeItem!.status === "ok" || nodeItem!.status === "warning");
		if (nodeItem!.status === "warning") assert.match(nodeItem!.message, /environment-node-old/);
	});

	it("git absent (PATH shim) → warning environment-git-missing", () => {
		withPath("/nonexistent-bin-dir", () => {
			const section = checkEnvironmentSection(process.cwd());
			const gitItem = section.items.find((i) => i.message.includes("environment-git-missing"));
			assert.ok(gitItem, "expected git-missing warning");
			assert.equal(gitItem!.status, "warning");
			assert.match(gitItem!.suggestion ?? "", /Install git/);
		});
	});

	it("pi absent (PATH shim) → warning environment-pi-missing", () => {
		withPath("/nonexistent-bin-dir", () => {
			const section = checkEnvironmentSection(process.cwd());
			const piItem = section.items.find((i) => i.message.includes("environment-pi-missing"));
			assert.ok(piItem, "expected pi-missing warning");
			assert.equal(piItem!.status, "warning");
		});
	});

	it("config contract absent → ONE info line with defaults", () => {
		setContractForTests({ config: null });
		const section = checkEnvironmentSection(process.cwd());
		const info = section.items.find((i) => i.message.includes("config accessors not present"));
		assert.ok(info, "expected the single degraded info line");
		assert.equal(info!.status, "info");
		assert.match(info!.message, /remote \/ 3 \/ backend/);
		// Degraded contract never produces config ok/warning rows.
		assert.ok(!section.items.some((i) => i.message.includes("testing.runner =")));
	});

	it("config contract present → ok lines per accessor", () => {
		const api: ConfigApi = {
			testingRunnerConfig: () => "remote",
			maxWorktreesConfig: () => 3,
			projectTypeConfig: () => "backend",
		};
		setContractForTests({ config: api });
		const section = checkEnvironmentSection(process.cwd());
		const runner = section.items.find((i) => i.message.includes("testing.runner = remote"));
		assert.ok(runner, "expected testing.runner ok line");
		assert.equal(runner!.status, "ok");
		assert.ok(section.items.some((i) => i.message.includes("velpari.maxWorktrees = 3")));
		assert.ok(section.items.some((i) => i.message.includes("projectType = backend")));
	});

	it("throwing accessor → warning environment-config-invalid naming the key", () => {
		const api: ConfigApi = {
			testingRunnerConfig: () => {
				throw new Error('"weird" is not a legal runner');
			},
			maxWorktreesConfig: () => 3,
			projectTypeConfig: () => "backend",
		};
		setContractForTests({ config: api });
		const section = checkEnvironmentSection(process.cwd());
		const warn = section.items.find((i) => i.message.includes("environment-config-invalid"));
		assert.ok(warn, "expected config-invalid warning");
		assert.equal(warn!.status, "warning");
		assert.match(warn!.message, /testing\.runner/);
		assert.match(warn!.message, /not a legal runner/);
	});

	it("never throws on an unreadable environment (doctor always renders)", () => {
		withPath("", () => {
			const section = checkEnvironmentSection(process.cwd());
			assert.ok(section.items.length > 0);
			assert.ok(section.items.every((i) => typeof i.message === "string" && i.message.length > 0));
		});
	});
});
