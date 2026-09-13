#!/usr/bin/env node
/**
 * Phase 4 smoke script: prove the v1.0.1 path-resolution fix works against
 * a simulated npm-install layout.
 *
 * Strategy:
 *   1. Build the source tree (npm run build) — produces dist/.
 *   2. Copy dist/pi-extension/ + skills/ + package.json into a fresh
 *      `node_modules/@adi-mudi/pi-velpari/` tree in a temp dir.
 *   3. Optionally probe the LIVE install at the user's pi agent path.
 *   4. Dynamically import the copied files and verify resolveSkillPath
 *      + bundledAgentPath return paths inside the simulated tree.
 *
 * The live npm install at
 *   ~/.pi/agent/npm/node_modules/@adi-mudi/pi-velpari/
 * ships source .ts files only (no dist/). Node's strip-types loader
 * refuses to load .ts under node_modules/, so we cannot import them
 * directly. A separate npm-packaging fix (ship dist/ artifacts) is
 * tracked separately; this script works around it by simulating the
 * install layout.
 *
 * Usage:
 *   node scripts/smoke-npm-install-layout.mjs
 *
 * Exits 0 on PASS, 1 on FAIL.
 */

import { existsSync, readFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPO = resolve(import.meta.dirname, "..");
const LIVE_PKG = resolve(process.env.HOME, ".pi/agent/npm/node_modules/@adi-mudi/pi-velpari");

const SKILLS = [
	"brainstorm", "prd", "rtm", "feasibility", "design", "pseudocode",
	"testplan", "atomic-function", "development-order",
	"configure-requirements", "handoff",
];

const AGENTS = [
	"af-source-prd", "af-source-pseudocode", "af-source-rtm", "af-source-testcases",
	"consolidator", "design-contract-definer", "design-data-flow-mapper",
	"design-error-definer", "design-module-decomposer",
	"do-risk", "do-test", "do-topology", "do-value",
	"extractor",
	"feasibility-cost", "feasibility-risk", "feasibility-schedule", "feasibility-tech",
	"fr-extractor", "helper-detector", "nfr-checker", "prd-checker",
	"pseudo-algorithm-extractor", "pseudo-complexity-analyzer", "pseudo-consolidator", "pseudo-edge-case-handler",
	"rtm-checker", "rtm-consolidator", "rtm-coverage-analyzer", "rtm-requirement-tracer", "rtm-test-case-linker",
	"testplan-coverage-tracer", "testplan-integration-test-generator", "testplan-strategy-designer", "testplan-unit-test-generator",
	"web-search-agent",
];

let fails = 0;
const log = (label, ok, detail) => {
	const tag = ok ? "PASS" : "FAIL";
	if (!ok) fails++;
	console.log(`[${tag}] ${label}${detail ? ` — ${detail}` : ""}`);
};
const info = (label, detail) => {
	console.log(`[INFO] ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log(`Repo:    ${REPO}`);
console.log(`Live:    ${LIVE_PKG}`);

// ---- Step 1: build -------------------------------------------------------
console.log("\n--- Step 1: build source tree ---");
const buildResult = spawnSync("npm", ["run", "build"], { cwd: REPO, stdio: "inherit" });
if (buildResult.status !== 0) {
	console.error("FATAL: npm run build failed");
	process.exit(1);
}

// ---- Step 2: simulate npm install ----------------------------------------
console.log("\n--- Step 2: simulate npm install in temp dir ---");
const sandbox = join(tmpdir(), `velpari-smoke-${Date.now()}`);
const fakeNodeModules = join(sandbox, "node_modules", "@adi-mudi", "pi-velpari");
const fakeCoreDir = join(fakeNodeModules, "pi-extension", "src", "core");
const fakeIoDir = join(fakeNodeModules, "pi-extension", "src", "io");
mkdirSync(fakeCoreDir, { recursive: true });
mkdirSync(fakeIoDir, { recursive: true });
mkdirSync(join(fakeNodeModules, "skills", "agents"), { recursive: true });

// Copy built artifacts
cpSync(join(REPO, "dist", "pi-extension", "src", "core"), fakeCoreDir, { recursive: true });
cpSync(join(REPO, "dist", "pi-extension", "src", "io"), fakeIoDir, { recursive: true });
cpSync(join(REPO, "skills"), join(fakeNodeModules, "skills"), { recursive: true });
cpSync(join(REPO, "package.json"), join(fakeNodeModules, "package.json"));

log("sandbox package.json exists", existsSync(join(fakeNodeModules, "package.json")));
log("sandbox prompt.js exists", existsSync(join(fakeCoreDir, "prompt.js")));
log("sandbox agents-install.js exists", existsSync(join(fakeIoDir, "agents-install.js")));

// ---- Step 3: dynamic import + resolve -------------------------------------
console.log("\n--- Step 3: dynamic import + resolve from sandbox ---");
const promptMod = await import(pathToFileURL(join(fakeCoreDir, "prompt.js")).href);
const agentsMod = await import(pathToFileURL(join(fakeIoDir, "agents-install.js")).href);

console.log("\n--- Skill path resolution (sandbox) ---");
for (const name of SKILLS) {
	const resolved = promptMod.resolveSkillPath(name);
	const expected = join(fakeNodeModules, "skills", `velpari-${name}.md`);
	const ok = resolved === expected && existsSync(resolved);
	log(`resolveSkillPath("${name}")`, ok, `→ ${resolved}`);
}

console.log("\n--- Agent path resolution (sandbox) ---");
for (const name of AGENTS) {
	const resolved = agentsMod.bundledAgentPath(name);
	const expected = join(fakeNodeModules, "skills", "agents", `${name}.md`);
	const ok = resolved === expected && existsSync(resolved);
	log(`bundledAgentPath("${name}")`, ok, `→ ${resolved}`);
}

// ---- Step 4: probe the LIVE install --------------------------------------
console.log("\n--- Step 4: probe live install ---");
if (existsSync(join(LIVE_PKG, "package.json"))) {
	const livePkg = JSON.parse(readFileSync(join(LIVE_PKG, "package.json"), "utf8"));
	log("live package.json main points at source tree", livePkg.main === "./pi-extension/src/index.ts", `main = ${livePkg.main}`);

	const liveCoreDir = join(LIVE_PKG, "pi-extension", "src", "core");
	const liveIoDir = join(LIVE_PKG, "pi-extension", "src", "io");
	const hasLiveJs = existsSync(join(liveCoreDir, "prompt.js"));
	const hasLiveTs = existsSync(join(liveCoreDir, "prompt.ts"));
	if (hasLiveJs) {
		log("live install has prompt.js (built artifacts)", true);
	} else {
		info("live install is source-only (.ts) — a separate npm-packaging issue (package should ship dist/ artifacts). Path-resolution fix is verified by the sandbox section above.");
	}
	log("live install has prompt.ts (source)", hasLiveTs);
	log("live install skills/ exists", existsSync(join(LIVE_PKG, "skills")));
	log("live install skills/agents/ exists", existsSync(join(LIVE_PKG, "skills", "agents")));

	if (hasLiveJs) {
		// We CAN import from the live install — verify paths there too
		const livePromptMod = await import(pathToFileURL(join(liveCoreDir, "prompt.js")).href);
		const liveAgentsMod = await import(pathToFileURL(join(liveIoDir, "agents-install.js")).href);
		const sample = livePromptMod.resolveSkillPath("brainstorm");
		const expected = join(LIVE_PKG, "skills", "velpari-brainstorm.md");
		log("live resolveSkillPath('brainstorm')", sample === expected && existsSync(sample), `→ ${sample}`);
		const sampleAgent = liveAgentsMod.bundledAgentPath("extractor");
		const expectedAgent = join(LIVE_PKG, "skills", "agents", "extractor.md");
		log("live bundledAgentPath('extractor')", sampleAgent === expectedAgent && existsSync(sampleAgent), `→ ${sampleAgent}`);
	}
} else {
	console.log(`[SKIP] live install not present at ${LIVE_PKG}`);
}

// ---- Cleanup -------------------------------------------------------------
rmSync(sandbox, { recursive: true, force: true });

console.log(`\n${fails === 0 ? "✅ SMOKE PASS" : `❌ SMOKE FAIL (${fails} failures)`}`);
process.exit(fails === 0 ? 0 : 1);