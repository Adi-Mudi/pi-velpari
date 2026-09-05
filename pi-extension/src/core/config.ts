import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PATHS } from "./constants.js";

/**
 * files.json shape (v3 — per FR-11, FR-67, NFR-15).
 */
export interface FilesConfig {
	version: 3;
	projectName: string;
	framework?: {
		language?: string;
		libraries?: string[];
		runtime?: string;
	};
	inputDocuments: string[];
	outputPaths: Record<string, string>;
	excludedPaths: string[];
}

const DEFAULT_CONFIG: FilesConfig = {
	version: 3,
	projectName: "",
	framework: {},
	inputDocuments: [],
	outputPaths: {},
	excludedPaths: [],
};

/**
 * Load files.json from disk. Returns defaults if missing.
 */
export function loadFilesConfig(cwd: string = process.cwd()): FilesConfig {
	const filePath = join(cwd, PATHS.CONFIG_DIR, "files.json");
	if (!existsSync(filePath)) return { ...DEFAULT_CONFIG };
	const raw = readFileSync(filePath, "utf8");
	const parsed = JSON.parse(raw) as Partial<FilesConfig>;
	return { ...DEFAULT_CONFIG, ...parsed, version: 3 };
}

/**
 * Save files.json. Phase A stub — validates version only.
 */
export function saveFilesConfig(config: FilesConfig, cwd: string = process.cwd()): void {
	const filePath = join(cwd, PATHS.CONFIG_DIR, "files.json");
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Validate files.json shape. Returns true if valid.
 */
export function validateFilesConfig(config: Partial<FilesConfig>): config is FilesConfig {
	if (config.version !== 3) return false;
	if (typeof config.projectName !== "string") return false;
	if (!Array.isArray(config.inputDocuments)) return false;
	if (typeof config.outputPaths !== "object" || config.outputPaths === null) return false;
	if (!Array.isArray(config.excludedPaths)) return false;
	return true;
}

/**
 * Phase A stub for the files-discovery scan. Phase B implements real scanning.
 */
export function runFilesDiscovery(_cwd: string = process.cwd()): string[] {
	void _cwd;
	return [];
}
