// Adapted from pi-senai's test-home helper:
//   /mnt/Just_Do_It/02_Devp_Soft/12_orchestra/pi-seani/pi-extension/test/e2e/helpers/test-home.ts
//
// Divergences from pi-senai:
//   - Project name lookup: walks up looking for package.json with name
//     "pi-velpari" instead of "pi-senai".
//   - Symlink target: the BUILT extension directory
//     `dist/pi-extension/src/` (per the Pi-Velpari AGENTS.md guidance:
//     "Symlink the built directory, NOT a single file or the project
//     root"). The test fixture does not run `npm run build`; the e2e
//     script is responsible for building first. distModuleUrl resolves
//     to the same path, so registration RPC and direct `bash` imports
//     see the same module.
//
// Isolation contract:
//   - Synthetic HOME with isolated XDG dirs (config, cache, data).
//   - Marker file at the root (`OWNERSHIP_MARKER`) gates cleanup so
//     accidental mismatches never delete the wrong tree.
//   - The test home never touches the developer's real HOME or any
//     Pi-managed file outside the temp dir.

import * as fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

export interface TestHome {
	/** Absolute path to the temp project directory (cwd of the test). */
	cwd: string;
	/** Absolute path to the synthetic HOME. */
	home: string;
	/** The env overrides to pass into child_process.spawn. */
	env: NodeJS.ProcessEnv;
	/** Cleanup callback — safe to call multiple times. */
	cleanup: () => void;
}

export interface MakeHomeOptions {
	/** Extra subdirectories to create inside cwd. */
	layout?: string[];
	/** Extra files to write (absolute paths under cwd). */
	files?: Array<{ path: string; content: string }>;
	/** Optional human label embedded in the dir name for debugging. */
	label?: string;
	/** Skip creating the .pi/agent/extensions symlink. Useful for unit
	 *  tests that only need an isolated cwd and never spawn `pi`. */
	skipExtensionSymlink?: boolean;
}

const OWNERSHIP_MARKER = ".pi-velpari-e2e-owned";

/** Returns true when `pi` is on PATH and RUN_E2E=1 is set. This is the
 *  Tier 1 gate — does NOT require a real LLM key. */
export function shouldRunE2E(): boolean {
	if (process.env.RUN_E2E !== "1") return false;
	try {
		execSync("command -v pi", { stdio: "ignore", shell: "/bin/bash" });
		return true;
	} catch {
		return false;
	}
}

/** Recognized provider keys (matches the Senai Tier 2 contract, kept
 *  identical here so a future Velpari Tier 2 suite can reuse the same
 *  recognition logic). */
const PROVIDER_KEY_VARS = [
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GOOGLE_API_KEY",
	"MISTRAL_API_KEY",
	"KIMI_API_KEY",
];

/** The dummy key CI workflows inject. Treated as "no real key" so
 *  tests that need a real LLM skip locally and on CI alike. */
const DUMMY_KEYS = new Set(["sk-ant-e2e-dummy-not-used", ""]);

/** Returns true when a recognized provider key is set to a non-dummy value
 *  in the environment or in the global Pi auth file. Tests that exercise
 *  real LLM calls should gate on this and skip cleanly when false. */
export function hasRealLlmKey(): boolean {
	for (const k of PROVIDER_KEY_VARS) {
		const v = process.env[k];
		if (v && v.length > 0 && !DUMMY_KEYS.has(v)) return true;
	}

	const authPaths = [
		path.join(homedir(), ".pi", "agent", "auth.json"),
		path.join(homedir(), ".pi", "auth.json"),
	];
	if (process.env.KIMI_CODE_HOME) {
		authPaths.push(path.join(process.env.KIMI_CODE_HOME, "auth.json"));
		authPaths.push(path.join(process.env.KIMI_CODE_HOME, "agent", "auth.json"));
	}
	for (const authPath of authPaths) {
		if (!fs.existsSync(authPath)) continue;
		try {
			const auth = JSON.parse(fs.readFileSync(authPath, "utf8")) as Record<string, unknown>;
			if (
				Object.values(auth).some(
					(entry) =>
						typeof entry === "object" &&
						entry !== null &&
						typeof (entry as { key?: unknown }).key === "string" &&
						((entry as { key: string }).key.length > 0) &&
						!DUMMY_KEYS.has((entry as { key: string }).key),
				)
			) {
				return true;
			}
		} catch {
			// Ignore unreadable or malformed global auth files.
		}
	}
	return false;
}

/** Returns true when Tier 2 (real-LLM) E2E should run. Stricter than
 *  `shouldRunE2E`: requires both the gate flag and a recognized provider
 *  API key in the environment. Without a key the test would crash on
 *  the first model call. */
export function shouldRunLLME2E(): boolean {
	if (!shouldRunE2E()) return false;
	if (process.env.RUN_LLM_E2E !== "1") return false;
	return hasRealLlmKey();
}

/** Walk up from this helper file until we find a package.json with name
 *  "pi-velpari". Returns the absolute path to that project root, or null. */
function findProjectRoot(start: string): string | null {
	let dir = start;
	for (let i = 0; i < 16; i++) {
		const pkg = path.join(dir, "package.json");
		if (fs.existsSync(pkg)) {
			try {
				const json = JSON.parse(fs.readFileSync(pkg, "utf8"));
				if (json && json.name === "pi-velpari") return dir;
			} catch {
				/* keep walking */
			}
		}
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
	return null;
}

/** Absolute file:// URL of a compiled module under `dist/pi-extension/src/`.
 *  E2E subprocesses run with cwd set to the temp project dir, so a relative
 *  specifier like `./dist/...` cannot resolve. Callers must use this. */
export function distModuleUrl(relative: string): string {
	const thisDir = path.dirname(fileURLToPath(import.meta.url));
	const root = findProjectRoot(thisDir);
	if (!root) throw new Error("distModuleUrl: could not locate the pi-velpari project root");
	return pathToFileURL(path.join(root, "dist", "pi-extension", "src", relative)).href;
}

/** Absolute path of the built extension directory. Symlinks into the
 *  test home point here so `pi --mode rpc` discovers the same compiled
 *  artifact that the bash-import path uses. */
function distExtensionDir(): string {
	const thisDir = path.dirname(fileURLToPath(import.meta.url));
	const root = findProjectRoot(thisDir);
	if (!root) throw new Error("distExtensionDir: could not locate the pi-velpari project root");
	const dist = path.join(root, "dist", "pi-extension", "src");
	if (!fs.existsSync(path.join(dist, "index.js"))) {
		throw new Error(
			`distExtensionDir: ${dist}/index.js is missing — run \`npm run build\` before the e2e suite`,
		);
	}
	return dist;
}

export function makeTestHome(opts: MakeHomeOptions = {}): TestHome {
	const root = fs.mkdtempSync(path.join(tmpdir(), "pi-velpari-e2e-"));
	const home = path.join(root, "home");
	const cwd = path.join(root, "project");
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(cwd, { recursive: true });
	fs.writeFileSync(path.join(root, OWNERSHIP_MARKER), "owned");

	// Symlink the built Velpari extension into the synthetic HOME so
	// `pi --mode rpc` picks it up. The target is the BUILT directory
	// (dist/pi-extension/src/) — per AGENTS.md "Symlink the built
	// directory, NOT a single file or the project root". The same
	// compiled JS gets imported by both pi-discovery and the bash
	// RPC channel (via distModuleUrl).
	if (!opts.skipExtensionSymlink) {
		const extDir = path.join(home, ".pi", "agent", "extensions");
		fs.mkdirSync(extDir, { recursive: true });
		fs.symlinkSync(distExtensionDir(), path.join(extDir, "pi-velpari"));
	}

	for (const sub of opts.layout ?? ["src", "test"]) {
		fs.mkdirSync(path.join(cwd, sub), { recursive: true });
	}

	const tmpDir = path.join(root, "tmp");
	const env: NodeJS.ProcessEnv = {
		...process.env,
		HOME: home,
		TMPDIR: tmpDir,
		XDG_CACHE_HOME: path.join(home, ".cache"),
		XDG_CONFIG_HOME: path.join(home, ".config"),
		XDG_DATA_HOME: path.join(home, ".local/share"),
	};
	fs.mkdirSync(tmpDir, { recursive: true });
	fs.mkdirSync(path.join(home, ".config"), { recursive: true });

	let cleaned = false;
	return {
		cwd,
		home,
		env,
		cleanup: () => {
			if (cleaned) return;
			cleaned = true;
			// Refuse to remove anything outside the marked root.
			const marker = path.join(root, OWNERSHIP_MARKER);
			if (!fs.existsSync(marker)) return;
			fs.rmSync(root, { recursive: true, force: true });
		},
	};
}
