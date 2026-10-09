/**
 * L3 ambient herdr-pane assertion (herdr integration initiative, Phase 3).
 *
 * This is the only test that proves the process is genuinely running INSIDE
 * a real herdr pane: herdr injects `HERDR_ENV` / `HERDR_PANE_ID` into managed
 * panes, so a real detection here cannot be faked by a test fixture.
 *
 * Gated by `RUN_HERDR_L3=1`, which the `herdr-l3` CI job sets for the command
 * it runs inside the pane (`herdr pane run …`). On any normal runner — and in
 * the Tier 1 e2e job, which loads every file under `test/e2e/` — this suite
 * reports as skipped and costs nothing.
 *
 * Why it exists: the OP-7 follow-up found that tests silently depended on the
 * ambient multiplexer env (helpers cleared four mux vars but not herdr's). A
 * run inside a real pane is the regression guard for that whole class.
 *
 * Skipped by: absence of `RUN_HERDR_L3=1`.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { detectMultiplexer, isSupportedMux } from "../../src/core/multiplexer.js";
import { checkHerdrSection } from "../../src/doctor/checks/herdr.js";

/** The CI job sets this for the command it sends into the herdr pane. */
const ENABLED = process.env.RUN_HERDR_L3 === "1";

if (!ENABLED) {
	// eslint-disable-next-line no-console
	console.log("[velpari-l3] ambient herdr suite skipped: RUN_HERDR_L3=1 not set (only the herdr-l3 CI job sets it).");
}

describe(
	"L3 ambient herdr pane — detection",
	{ skip: ENABLED ? false : "RUN_HERDR_L3=1 required (runs inside a real herdr pane in CI)" },
	() => {
		it("detects herdr from the pane's injected environment", () => {
			const info = detectMultiplexer(process.env);
			assert.equal(
				info.mux,
				"herdr",
				`expected mux=herdr inside a real herdr pane, got ${info.mux} via ${info.source}`,
			);
			assert.ok(
				["HERDR_PANE_ID", "HERDR_ENV", "PI_SUBAGENT_MUX"].includes(info.source),
				`unexpected herdr detection source: ${info.source}`,
			);
			assert.equal(isSupportedMux(info), true);
		});

		it("herdr is an accepted PI_SUBAGENT_MUX override value in this environment", () => {
			const info = detectMultiplexer({ PI_SUBAGENT_MUX: "herdr" } as NodeJS.ProcessEnv);
			assert.equal(info.mux, "herdr");
			assert.equal(info.source, "PI_SUBAGENT_MUX");
		});

		it("the doctor's herdr section takes the herdr branch (not the not-detected info line)", () => {
			const section = checkHerdrSection(process.cwd(), { env: process.env });
			assert.equal(section.title, "Herdr (integration readiness)");
			assert.ok(
				!section.items.some((item) => item.message.includes("herdr not detected")),
				"herdr was detected in the pane but the check reported it as not detected",
			);
			for (const item of section.items) {
				assert.notEqual(item.status, "error", `herdr section emitted an error inside the pane: ${item.message}`);
			}
		});
	},
);
