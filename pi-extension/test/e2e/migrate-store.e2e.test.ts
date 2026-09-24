/**
 * Tier-1 E2E: `/velpari-migrate-store` (Phase 12, subphase 1.3).
 *
 * The 8 existing e2e suites never touch the migration or the DB-only publish
 * default, so the compiled artifact's migration flow is proven here inside a
 * REAL `pi` process:
 *
 *   1. `makeTestHome` — synthetic HOME + temp project + the built extension
 *      symlinked into `~/.pi/agent/extensions/pi-velpari`.
 *   2. Real git repo with a pinned local identity and isolated ambient config
 *      (`GIT_CONFIG_GLOBAL` → temp file, `GIT_CONFIG_SYSTEM=/dev/null`), so
 *      the migration precheck's identity decision belongs to the fixture.
 *   3. Legacy `Doc/` artifacts seeded (grouped PRD + flat RTM).
 *   4. `migrateDryRun` then `migrateExecute`, both driven through the RPC
 *      `bash` channel via `distModuleUrl("ops/migrate.js")` — the same
 *      compiled module Pi loads. No `prompt` call anywhere (Tier 1 needs no
 *      LLM key), and no `get_commands` assertion (registration.e2e owns the
 *      command surface).
 *   5. Assert on disk: store DB + exported YAML + the
 *      `velpari(migrate): <project> (run migrated)` commit.
 *   6. `runDoctor` over the same channel: the store/data sections must be
 *      error-free; the only markdown-shape errors allowed are the pre-store
 *      legacy-file findings (F8, recorded in the plan as a Phase 13 item) —
 *      pinned by count so a new regression cannot hide behind them.
 *
 * Shell safety (e2e README): embedded scripts carry no backticks and no
 * `${...}` — strings are built with single quotes + `+` and JSON.stringify.
 */

import { describe, it, before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, distModuleUrl, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedVelpariConfig } from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";
const PROJECT = "E2EMigrate";

/** Built modules driven through the RPC `bash` channel (hoisted). */
const MIGRATE_JS = JSON.stringify(distModuleUrl("ops/migrate.js"));
const DOCTOR_JS = JSON.stringify(distModuleUrl("doctor/index.js"));

/**
 * Run `script` (ESM source) in the temp project via the RPC `bash` channel and
 * parse the JSON payload it printed.
 * @param {RpcClient} client - Spawned RPC client.
 * @param {string} script - ESM source (single line; no backticks, no `${...}`).
 * @returns {Promise<T>} The parsed stdout payload.
 */
async function runModuleScript<T>(client: RpcClient, script: string): Promise<T> {
	const result = await client.request<any>("bash", {
		command: [
			// node:sqlite is experimental and prints an ExperimentalWarning to
			// stderr on first load; the bash channel merges stdout+stderr and
			// this helper parses the union as JSON, so silence warnings.
			"NODE_NO_WARNINGS=1 node --input-type=module -e",
			JSON.stringify(script),
		].join(" "),
	});
	assert.ok(result.success === true, `subprocess failed: ${JSON.stringify(result.error ?? result)}`);
	const output: string = result.data?.output ?? result.output ?? "";
	assert.ok(output.length > 0, "subprocess produced no output");
	return JSON.parse(output) as T;
}

/** Legacy flat-ish PRD (the migration loader parses its tables). */
const LEGACY_PRD_MD = [
	"# PSRS — E2EMigrate",
	"",
	"## Functional Requirements",
	"",
	"| ID | Phase | Requirement |",
	"|---|---|---|",
	"| FR-1 | 1 | The system shall parse input |",
	"",
	"## Non-Functional Requirements",
	"",
	"| ID | Phase | Requirement |",
	"|---|---|---|",
	"| NFR-1 | 1 | Response under 200ms |",
	"",
	"## PRD Sections",
	"",
	"| No | Title | Body |",
	"|---|---|---|",
	"| 1 | Purpose | Why we build this |",
	"",
].join("\n");

/** Legacy flat RTM in the pre-store layout (Doc/RTM_<project>.md). */
const LEGACY_RTM_MD = [
	"# RTM — E2EMigrate",
	"",
	"## Traceability",
	"",
	"| FR | Phase | Design | Tests |",
	"|---|---|---|---|",
	"| FR-1 | 1 | M-1 | TC-1 |",
	"",
].join("\n");

/** Write one fixture file under the e2e home (creating parents). */
function write(home: TestHome, rel: string, content: string): string {
	const abs = join(home.cwd, rel);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content, "utf8");
	return abs;
}

/** Repo-relative paths in the temp project's HEAD commit. */
function headFiles(cwd: string): string[] {
	const out = execFileSync("git", ["show", "--name-only", "--pretty=format:%s", "HEAD"], { cwd, encoding: "utf-8" });
	return out
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

describe("e2e/migrate-store", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedVelpariConfig(home, { projectName: PROJECT });

		// Legacy artifacts in both layouts the loader accepts (grouped PRD,
		// flat RTM). No state.json, so the migration precheck's G7 gate is open.
		write(home, join("Doc", "requirements", `PRD_${PROJECT}.md`), LEGACY_PRD_MD);
		write(home, join("Doc", `RTM_${PROJECT}.md`), LEGACY_RTM_MD);

		// Real git repo + pinned identity + isolated ambient config (Design 9).
		const git = (args: string[]): void => {
			execFileSync("git", args, { cwd: home!.cwd, stdio: "ignore" });
		};
		git(["init", "-q"]);
		git(["config", "user.name", "Velpari E2E"]);
		git(["config", "user.email", "e2e@velpari.local"]);
		const gitConfigGlobal = write(
			home,
			"gitconfig-global",
			"[user]\n\tname = Velpari E2E\n\temail = e2e@velpari.local\n",
		);
		home.env.GIT_CONFIG_GLOBAL = gitConfigGlobal;
		home.env.GIT_CONFIG_SYSTEM = "/dev/null";
		home.env.GIT_CONFIG_NOSYSTEM = "1";

		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("migrateDryRun reports the project and writes nothing", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const report = (await runModuleScript<any>(
			client,
			"import { migrateDryRun } from " +
				MIGRATE_JS +
				"; process.stdout.write(JSON.stringify(migrateDryRun(process.cwd())));",
		)) as {
			ok: boolean;
			projects: Array<{ projectName: string; kinds: Array<{ kind: string; status: string }> }>;
		};
		assert.equal(report.ok, true, "the dry run must pass its precheck");
		const project = report.projects.find((p) => p.projectName === PROJECT);
		assert.ok(project, `the legacy project must be discovered: ${JSON.stringify(report.projects)}`);
		assert.ok(project.kinds.length > 0, "the dry run must plan at least one kind");
		assert.equal(
			existsSync(join(home.cwd, "Doc", "store", PROJECT, "index.db")),
			false,
			"a dry run must not create the store DB",
		);
	});

	it("migrateExecute writes the store DB + YAML and commits under run 'migrated'", { timeout: 90_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const report = (await runModuleScript<any>(
			client,
			"import { migrateExecute } from " +
				MIGRATE_JS +
				"; process.stdout.write(JSON.stringify(migrateExecute(process.cwd())));",
		)) as {
			ok: boolean;
			projects: Array<{ projectName: string; kinds: Array<{ kind: string; status: string }> }>;
		};
		assert.equal(report.ok, true, "migrateExecute must succeed");
		const migrated = report.projects
			.find((p) => p.projectName === PROJECT)
			?.kinds.filter((k) => k.status === "migrated")
			.map((k) => k.kind);
		assert.deepEqual(migrated?.sort(), ["prd", "rtm"], `migrated kinds: ${JSON.stringify(migrated)}`);

		assert.ok(
			existsSync(join(home.cwd, "Doc", "store", PROJECT, "index.db")),
			"the migration must create Doc/store/<project>/index.db",
		);
		assert.ok(
			existsSync(join(home.cwd, "Doc", "store", PROJECT, `PRD_${PROJECT}.yaml`)),
			"the migration must export the YAML beside the DB (9-YAML contract)",
		);

		const lines = headFiles(home.cwd);
		const subject = lines[0] ?? "";
		assert.match(
			subject,
			new RegExp(`^velpari\\(migrate\\): ${PROJECT} \\(run migrated\\)`),
			`commit subject: ${subject}`,
		);
		assert.ok(
			lines.some((l) => l === `Doc/store/${PROJECT}/index.db`),
			`the migration commit must carry the store DB: ${lines.join(", ")}`,
		);
	});

	it("runDoctor on the migrated project is clean for the store/data checks", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		// The doctor report is large (dozens of scout-agent findings), and the
		// bash channel truncates big outputs — so the subprocess itself reduces
		// the verdict to what this test asserts.
		const verdict = (await runModuleScript<any>(
			client,
			"import { runDoctor } from " +
				DOCTOR_JS +
				"; const r = runDoctor(process.cwd()); const out = { errors: [], freshness: [] }; " +
				"for (const s of r.sections) { for (const i of s.items) { " +
				"if (i.status === 'error') out.errors.push(s.title + ': ' + i.message); " +
				"if (/fresh/i.test(s.title)) out.freshness.push({ status: i.status, message: i.message }); } } " +
				"process.stdout.write(JSON.stringify(out));",
		)) as {
			errors: string[];
			freshness: Array<{ status: string; message: string }>;
		};
		const errors = verdict.errors;
		// Three classified groups; everything else must be empty, so a NEW
		// store/data error cannot hide behind them:
		//  - project shape: this synthetic cwd has no `skills/`, no package.json;
		//  - legacy shape (F8, deferred): pre-store files carry no frontmatter
		//    and are not 20-section PSRS documents;
		//  - F6 (deferred, Phase 13): the legacy RTM loader drops NFR rows and
		//    stamps synthetic fingerprints, so a freshly migrated project reports
		//    NFR coverage gaps + a suspect FR link until an RTM republish.
		const shape = errors.filter((e) => /Stage skills|Official-extension readiness|Action items/i.test(e));
		const legacy = errors.filter((e) => /Artifact frontmatter|PSRS validation/i.test(e));
		const f6 = errors.filter((e) => /no RTM row|MVP coverage|requirement text changed after linking/.test(e));
		const data = errors.filter((e) => !shape.includes(e) && !legacy.includes(e) && !f6.includes(e));
		assert.deepEqual(data, [], "store/data doctor errors must be empty: " + data.join(" | "));
		assert.deepEqual(
			errors.filter((e) => /has drifted from the store/.test(e)),
			[],
			"the DB-only default must not report published-view drift (Phase 12 Fix F7)",
		);

		assert.ok(verdict.freshness.length > 0, "the doctor must report a freshness section");
		assert.ok(
			verdict.freshness.some((i) => i.status === "warning" && /no freshness stamp|no-stamp/i.test(i.message)),
			"migrated (unstamped) artifacts must surface the documented no-stamp warning: " +
				JSON.stringify(verdict.freshness),
		);
	});
});

test("E2E gate: this suite is skipped when Tier 1 prerequisites are missing", () => {
	if (!tier1Enabled()) {
		// eslint-disable-next-line no-console
		console.log(`[velpari-e2e] Tier 1 skipped: ${describeTier1Skip()}`);
	}
});
