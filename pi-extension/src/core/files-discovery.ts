/**
 * File discovery scan (L0, self-contained).
 *
 * Port of Senai's discoverProjectFiles (pi-senai: agents/files-discovery.ts +
 * core/agents-config/files-types.ts) merged into one Velpari core module.
 * Classifies the TOP level of a project directory into code / document / test
 * folders and files, using folder-name sets, a test-path regex, and a content
 * heuristic for unknown folders. Used by the configure-inputs scan to suggest
 * codePaths / testPaths / inputDocuments.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface FileDiscoveryResult {
	codeFolders: SuggestedFolder[];
	codeFiles: string[];
	documentFolders: SuggestedFolder[];
	documentFiles: string[];
	testFolders: SuggestedFolder[];
	testFiles: string[];
}

interface SuggestedFolder {
	path: string;
	reason: string;
}

const TEST_PATTERNS = /(^|[._\-/])(test|tests|testing|spec|specs|__tests__)(?=[._\-/]|$)/i;

/** True when a path looks test-related (segment/delimiter aware). */
export function looksLikeTestPath(p: string): boolean {
	return TEST_PATTERNS.test(p.toLowerCase());
}

const CODE_EXTENSIONS = new Set([
	".ts", ".js", ".tsx", ".jsx", ".py", ".java", ".go", ".rs", ".c", ".cpp", ".h",
	".cs", ".rb", ".php", ".swift", ".kt", ".scala", ".mjs", ".vue", ".svelte",
	".sh", ".bash", ".ps1",
]);

const DOCUMENT_EXTENSIONS = new Set([
	".md", ".txt", ".rst", ".adoc",
]);

const CODE_FOLDER_NAMES = new Set([
	"src", "source", "lib", "libs", "app", "apps", "api", "apis",
	"packages", "pkg", "backend", "frontend", "client", "server",
	"core", "modules", "services", "components", "ui", "cli",
	"workers", "functions", "scripts", "bin", "cmd", "internal",
]);

const DOCUMENT_FOLDER_NAMES = new Set([
	"docs", "doc", "documentation", "specs", "specifications",
	"requirements", "design", "planning", "prd", "proposals",
	"notes", "wiki", "references", "guidelines", "rfcs",
]);

const TEST_FOLDER_NAMES = new Set([
	"tests", "test", "__tests__", "e2e", "integration", "spec",
	"specs", "unit", "functional", "regression", "coverage",
]);

const PROJECT_ROOT_MARKERS = new Set([
	"package.json", "pyproject.toml", "cargo.toml", "go.mod",
	"tsconfig.json", "jsconfig.json", "requirements.txt",
	"pnpm-workspace.yaml", "lerna.json", "nx.json",
]);

/**
 * Scan the top level of cwd and classify folders and files into code,
 * document, and test buckets. Dotfiles are skipped except `.github`.
 * excludedPaths match exactly or as a `prefix/`. All six result lists are
 * sorted alphabetically; folder paths carry a trailing `/`; paths are
 * relative to cwd.
 */
export function discoverProjectFiles(
	cwd: string,
	excludedPaths: string[],
): FileDiscoveryResult {
	const result: FileDiscoveryResult = {
		codeFolders: [],
		codeFiles: [],
		documentFolders: [],
		documentFiles: [],
		testFolders: [],
		testFiles: [],
	};

	const entries = safeReadDir(cwd);
	for (const entry of entries) {
		if (entry.name.startsWith(".") && entry.name !== ".github") continue;
		const relative = `${entry.name}${entry.isDirectory() ? "/" : ""}`;
		if (isExcluded(relative, excludedPaths)) continue;

		if (entry.isDirectory()) {
			classifyFolder(cwd, entry.name, relative, result, excludedPaths);
		} else {
			classifyFile(relative, result);
		}
	}

	result.codeFolders.sort((a, b) => a.path.localeCompare(b.path));
	result.codeFiles.sort((a, b) => a.localeCompare(b));
	result.documentFolders.sort((a, b) => a.path.localeCompare(b.path));
	result.documentFiles.sort((a, b) => a.localeCompare(b));
	result.testFolders.sort((a, b) => a.path.localeCompare(b.path));
	result.testFiles.sort((a, b) => a.localeCompare(b));

	return result;
}

/** Read a directory as Dirents; empty array on any failure. */
export function safeReadDir(dir: string): fs.Dirent[] {
	try {
		return fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

/** True when relative matches an exclusion exactly or under a `prefix/`. */
export function isExcluded(relative: string, excludedPaths: string[]): boolean {
	return excludedPaths.some((ex) => {
		if (relative === ex) return true;
		const prefix = ex.endsWith("/") ? ex : `${ex}/`;
		return relative.startsWith(prefix);
	});
}

function classifyFolder(
	cwd: string,
	name: string,
	relative: string,
	result: FileDiscoveryResult,
	excludedPaths: string[],
): void {
	const lower = name.toLowerCase();

	if (TEST_FOLDER_NAMES.has(lower) || looksLikeTestPath(lower)) {
		result.testFolders.push({ path: relative, reason: "test folder" });
		return;
	}

	if (DOCUMENT_FOLDER_NAMES.has(lower)) {
		result.documentFolders.push({ path: relative, reason: "document folder" });
		collectDocumentFiles(cwd, relative, excludedPaths, result);
		return;
	}

	if (CODE_FOLDER_NAMES.has(lower)) {
		result.codeFolders.push({ path: relative, reason: "common code folder" });
		return;
	}

	// Content-based detection for custom names.
	const childFiles = listChildFiles(cwd, relative, excludedPaths);
	const codeCount = childFiles.filter((f) => CODE_EXTENSIONS.has(path.extname(f))).length;
	const docCount = childFiles.filter((f) => DOCUMENT_EXTENSIONS.has(path.extname(f))).length;
	const hasProjectMarker = childFiles.some((f) => PROJECT_ROOT_MARKERS.has(path.basename(f).toLowerCase()));

	if (hasProjectMarker) {
		result.codeFolders.push({ path: relative, reason: "project root marker found" });
		return;
	}

	if (codeCount > 0 && codeCount / Math.max(childFiles.length, 1) > 0.5) {
		result.codeFolders.push({ path: relative, reason: `${codeCount} code files found` });
		return;
	}

	if (docCount > 0 && docCount / Math.max(childFiles.length, 1) > 0.5) {
		result.documentFolders.push({ path: relative, reason: `${docCount} document files found` });
		collectDocumentFiles(cwd, relative, excludedPaths, result);
		return;
	}
}

function classifyFile(relative: string, result: FileDiscoveryResult): void {
	const lower = relative.toLowerCase();
	const ext = path.extname(relative).toLowerCase();

	if (looksLikeTestPath(lower)) {
		result.testFiles.push(relative);
		return;
	}

	if (DOCUMENT_EXTENSIONS.has(ext) || lower.endsWith("readme") || lower.endsWith("changelog")) {
		result.documentFiles.push(relative);
		return;
	}

	if (CODE_EXTENSIONS.has(ext)) {
		result.codeFiles.push(relative);
	}
}

/** Recursively collect .md/.txt/.rst/.adoc files under a document folder. */
function collectDocumentFiles(
	cwd: string,
	folder: string,
	excludedPaths: string[],
	result: FileDiscoveryResult,
): void {
	const full = path.join(cwd, folder);
	const walk = (dir: string, prefix: string) => {
		const entries = safeReadDir(dir);
		for (const entry of entries) {
			const rel = `${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`;
			if (isExcluded(rel, excludedPaths)) continue;
			if (entry.isDirectory()) {
				walk(path.join(dir, entry.name), rel);
			} else if (DOCUMENT_EXTENSIONS.has(path.extname(entry.name))) {
				result.documentFiles.push(rel);
			}
		}
	};
	walk(full, folder);
}

function listChildFiles(cwd: string, folder: string, excludedPaths: string[]): string[] {
	const files: string[] = [];
	const walk = (dir: string, prefix: string) => {
		const entries = safeReadDir(dir);
		for (const entry of entries) {
			const rel = `${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`;
			if (isExcluded(rel, excludedPaths)) continue;
			if (entry.isDirectory()) {
				walk(path.join(dir, entry.name), rel);
			} else {
				files.push(rel);
			}
		}
	};
	walk(path.join(cwd, folder), folder);
	return files;
}

/** Render a suggested path with its classification reason. */
export function formatSuggestion(label: string, reason: string): string {
	return `${label} (${reason})`;
}
