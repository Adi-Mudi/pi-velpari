/**
 * core/dev-order-data.ts tests (B3 — development-order YAML sidecar; D8).
 *
 * Covers: schema validation, dependsOn resolution (unknown dep), the
 * D8 DAG rules — self-loop, 2-cycle, diamond-ok — topological order
 * violations, revision rules, render, and the loose sidecar reader.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	diffDevOrderData,
	extractDevOrderAfRefsFromSidecar,
	findDependencyCycle,
	renderDevOrderMarkdown,
	resolveDevOrderSidecar,
	validateDevOrderData,
	type DevOrderData,
	type DevOrderStep,
} from "../../src/core/dev-order-data.js";

function step(id: string, dependsOn: string[] = [], overrides: Record<string, unknown> = {}): DevOrderStep {
	return {
		id,
		module: `M-1 (${id} module)`,
		afs: ["AF-1"],
		dependsOn,
		...overrides,
	} as DevOrderStep;
}

function data(steps: DevOrderStep[], overrides: Record<string, unknown> = {}): DevOrderData {
	return {
		project: "TestApp",
		version: "1.0.0",
		steps,
		...overrides,
	} as DevOrderData;
}

describe("validateDevOrderData — schema", () => {
	it("accepts a valid linear plan", () => {
		const result = validateDevOrderData(data([step("DO-1"), step("DO-2", ["DO-1"])]));
		assert.deepEqual(result.issues, []);
		assert.ok(result.ok);
	});

	it("rejects missing top-level fields and a non-array steps", () => {
		const result = validateDevOrderData({ project: "P" });
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.startsWith("version:")));
		assert.ok(result.issues.some((i) => i.startsWith("steps:")));
	});

	it("flags bad/duplicate step ids and bad field types", () => {
		const result = validateDevOrderData(
			data([
				step("XX-1"),
				step("DO-1"),
				step("DO-1"),
				{ id: "DO-2", module: "", afs: "AF-1", dependsOn: "DO-1" } as unknown as DevOrderStep,
			]),
		);
		assert.ok(result.issues.some((i) => i.includes(".id: must match DO-<n>")));
		assert.ok(result.issues.some((i) => i.includes("duplicate id")));
		assert.ok(result.issues.some((i) => i.includes(".module: missing or empty")));
		assert.ok(result.issues.some((i) => i.includes(".afs: must be an array of AF-<n> ids")));
		assert.ok(result.issues.some((i) => i.includes(".dependsOn: must be an array of step ids")));
	});

	it("rejects an unknown dependsOn reference", () => {
		const result = validateDevOrderData(data([step("DO-1", ["DO-99"])]));
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.includes('unknown step "DO-99"')));
	});
});

describe("validateDevOrderData — D8 DAG", () => {
	it("blocks a self-loop", () => {
		const result = validateDevOrderData(data([step("DO-1", ["DO-1"])]));
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.includes("dependency cycle detected: DO-1 → DO-1")));
	});

	it("blocks a 2-cycle", () => {
		const result = validateDevOrderData(data([step("DO-1", ["DO-2"]), step("DO-2", ["DO-1"])]));
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.includes("dependency cycle detected")));
	});

	it("accepts a diamond (shared foundation is not a cycle)", () => {
		const steps = [step("DO-1"), step("DO-2", ["DO-1"]), step("DO-3", ["DO-1"]), step("DO-4", ["DO-2", "DO-3"])];
		const result = validateDevOrderData(data(steps));
		assert.deepEqual(result.issues, []);
		assert.equal(findDependencyCycle(steps), null);
	});

	it("blocks a dependency listed after its dependent (order violation)", () => {
		const result = validateDevOrderData(data([step("DO-1", ["DO-2"]), step("DO-2")]));
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.includes("order violation") && i.includes("DO-1") && i.includes("DO-2")));
	});

	it("ignores unknown deps during cycle detection (reported separately)", () => {
		const result = validateDevOrderData(data([step("DO-1", ["DO-99"]), step("DO-2", ["DO-1"])]));
		assert.ok(result.issues.some((i) => i.includes('unknown step "DO-99"')));
		assert.ok(!result.issues.some((i) => i.includes("dependency cycle detected")));
	});
});

describe("diffDevOrderData", () => {
	it("passes an append + version bump", () => {
		const baseline = data([step("DO-1")]);
		const updated = data([step("DO-1"), step("DO-2", ["DO-1"])], { version: "1.1.0" });
		assert.deepEqual(diffDevOrderData(baseline, updated).issues, []);
	});

	it("blocks deleting a baseline step (append-only)", () => {
		const baseline = data([step("DO-1"), step("DO-2", ["DO-1"])]);
		const updated = data([step("DO-1")], { version: "1.1.0" });
		const result = diffDevOrderData(baseline, updated);
		assert.ok(result.issues.some((i) => i.includes("append-only violation") && i.includes("DO-2")));
	});

	it("blocks a revision without a version bump", () => {
		assert.ok(
			diffDevOrderData(data([step("DO-1")]), data([step("DO-1")])).issues.some((i) =>
				i.includes("version must strictly increase"),
			),
		);
	});
});

describe("renderDevOrderMarkdown", () => {
	it("renders the Final Order table + per-step AFs lines (Layer-2)", () => {
		const rendered = renderDevOrderMarkdown(
			data([step("DO-1"), step("DO-2", ["DO-1"], { afs: ["AF-1", "AF-2"] })], { changeLog: ["1.0.0 — initial"] }),
		);
		assert.match(rendered, /artifact: development-order/);
		assert.match(rendered, /## Final Order/);
		assert.match(rendered, /\| 1 \| M-1 \(DO-1 module\) \| — \|/);
		assert.match(rendered, /\| 2 \| M-1 \(DO-2 module\) \| DO-1 \|/);
		assert.match(rendered, /## Recommended Execution Plan/);
		assert.match(rendered, /AFs: AF-1, AF-2/);
		assert.match(rendered, /## Change Log/);
	});
});

describe("sidecar resolution (D7 reader)", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-do-data-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("resolveDevOrderSidecar finds the .yaml next to the markdown", () => {
		const md = path.join(tmpDir, "development-order_TestApp.md");
		fs.writeFileSync(md, "# DO\n", "utf8");
		assert.equal(resolveDevOrderSidecar(md), null);
		const yaml = path.join(tmpDir, "development-order_TestApp.yaml");
		fs.writeFileSync(yaml, "project: TestApp\n", "utf8");
		assert.equal(resolveDevOrderSidecar(md), yaml);
	});

	it("extractDevOrderAfRefsFromSidecar unions step afs, null on junk", () => {
		const md = path.join(tmpDir, "development-order_TestApp.md");
		assert.equal(extractDevOrderAfRefsFromSidecar(md), null);
		const yaml = path.join(tmpDir, "development-order_TestApp.yaml");
		fs.writeFileSync(yaml, "not: [a dev-order doc]\n", "utf8");
		assert.equal(extractDevOrderAfRefsFromSidecar(md), null);
		fs.writeFileSync(
			yaml,
			[
				"project: TestApp",
				"version: 1.0.0",
				"steps:",
				"  - id: DO-1",
				"    afs: [AF-3, AF-7]",
				"  - id: DO-2",
				"    afs: [AF-1]",
				"",
			].join("\n"),
			"utf8",
		);
		assert.deepEqual(extractDevOrderAfRefsFromSidecar(md), ["AF-3", "AF-7", "AF-1"]);
	});
});
