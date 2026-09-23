import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "../io/atomic-write.js";
import { PATHS } from "./constants.js";
import type { AtomicProfile } from "./atomic-tier.js";

/**
 * files.json shape (v4 — per FR-11, FR-67, NFR-15 + Senai files pattern:
 * codePaths/testPaths and default excluded paths).
 */
export interface FilesConfig {
	version: 4;
	/** Legacy single-design field. v1.3.0+ accepts `projectNames` for
	 *  multi-design. Exactly one of `projectName` and `projectNames`
	 *  must be set. Use `getEffectiveProjectNames(cfg)` to consume. */
	projectName: string;
	/** v1.3.0+ multi-design field. Array of 1+ distinct projectNames. */
	projectNames?: string[];
	framework?: {
		language?: string;
		libraries?: string[];
		runtime?: string;
	};
	codePaths: string[];
	inputDocuments: string[];
	testPaths: string[];
	outputPaths: Record<string, string>;
	excludedPaths: string[];
	/** Optional atomic-function tier profile (ISO/IEC 29110 + IEC 61508/IEC 62304).
	 *  When absent, deriveAtomicProfile() returns the defaults (basic / A / none). */
	atomic?: AtomicProfile;
}

/** Senai-parity default exclusions for discovery and scans. */
export const DEFAULT_EXCLUDED_PATHS: readonly string[] = [
	".git/",
	"node_modules/",
	"__pycache__/",
	".venv/",
	"venv/",
	"dist/",
	"build/",
	"target/",
	".pi/",
	".idea/",
	".vscode/",
];

const DEFAULT_CONFIG: FilesConfig = {
	version: 4,
	projectName: "",
	framework: {},
	codePaths: [],
	inputDocuments: [],
	testPaths: [],
	outputPaths: {},
	excludedPaths: [...DEFAULT_EXCLUDED_PATHS],
};

/** Fresh defaults — the arrays must not be shared references. */
function defaultConfig(): FilesConfig {
	return {
		...DEFAULT_CONFIG,
		framework: {},
		codePaths: [],
		inputDocuments: [],
		testPaths: [],
		outputPaths: {},
		excludedPaths: [...DEFAULT_EXCLUDED_PATHS],
	};
}

/** Pre-v4 shape, kept for migration. */
interface FilesConfigV3 {
	version: 3;
	projectName: string;
	framework?: FilesConfig["framework"];
	inputDocuments: string[];
	outputPaths: Record<string, string>;
	excludedPaths: string[];
}

/**
 * Migrate a v3 config to v4: keep every existing value, add the new
 * path arrays, and backfill default excludes when none were set.
 */
function migrateV3(v3: FilesConfigV3): FilesConfig {
	return {
		version: 4,
		projectName: v3.projectName,
		framework: v3.framework,
		codePaths: [],
		inputDocuments: Array.isArray(v3.inputDocuments) ? v3.inputDocuments : [],
		testPaths: [],
		outputPaths: v3.outputPaths ?? {},
		excludedPaths:
			Array.isArray(v3.excludedPaths) && v3.excludedPaths.length > 0 ? v3.excludedPaths : [...DEFAULT_EXCLUDED_PATHS],
	};
}

/**
 * Load files.json from disk. Returns defaults if missing. Migrates v3
 * files to v4 on load.
 */
export function loadFilesConfig(cwd: string = process.cwd()): FilesConfig {
	const filePath = join(cwd, PATHS.CONFIG_DIR, "files.json");
	if (!existsSync(filePath)) return defaultConfig();
	const raw = readFileSync(filePath, "utf8");
	const parsed = JSON.parse(raw) as Partial<FilesConfig> | FilesConfigV3;
	const migrated = parsed.version === 3 ? migrateV3(parsed as FilesConfigV3) : parsed;
	return { ...defaultConfig(), ...migrated, version: 4 };
}

/**
 * Save files.json.
 */
export function saveFilesConfig(config: FilesConfig, cwd: string = process.cwd()): void {
	const filePath = join(cwd, PATHS.CONFIG_DIR, "files.json");
	atomicWriteJson(filePath, config);
}

/**
 * Validate files.json shape. Returns true if valid.
 */
export function validateFilesConfig(config: Partial<FilesConfig>): config is FilesConfig {
	if (config.version !== 4) return false;
	const single = (config as Partial<FilesConfig>).projectName;
	const multi = (config as { projectNames?: unknown }).projectNames;
	const hasSingle = typeof single === "string" && single.length > 0;
	const hasMulti = Array.isArray(multi) && multi.length > 0;
	if (hasSingle && hasMulti) return false; // exactly one
	if (!hasSingle && !hasMulti) return false; // exactly one
	if (!Array.isArray(config.codePaths)) return false;
	if (!Array.isArray(config.inputDocuments)) return false;
	if (!Array.isArray(config.testPaths)) return false;
	if (typeof config.outputPaths !== "object" || config.outputPaths === null) return false;
	if (!Array.isArray(config.excludedPaths)) return false;
	return true;
}
