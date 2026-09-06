/**
 * Official-extension readiness check (Phase 5 of the official-extension plan).
 *
 * Audits whether `pi-velpari` is shaped for the official pi package
 * gallery (pi.dev/packages) and `npm publish --access public`. Seven
 * sub-checks:
 *
 *   1. `package.json:keywords` includes `pi-package`            — error
 *   2. `package.json:pi.extensions` is non-empty                 — error
 *   3. `package.json:peerDependencies` includes the bare
 *      `pi-interactive-subagents` (≥3.7.2)                      — warning
 *   4. `.npmignore` exists at the project root                  — warning
 *   5. `package.json:repository.url` is set                     — info
 *   6. Core peer deps (`pi-coding-agent`, `pi-tui`, `typebox`)
 *      are pinned to a non-`*` range                           — info
 *   7. `README.md` install line uses the correct package name
 *      `npm:@adi-mudi/pi-velpari`                               — warning
 *
 * Every actionable item carries a `→ Fix:` suggestion from
 * `fix-suggestions.ts`. Info items are FYI only.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

const PROJECT_NAME = "pi-velpari";
const SCOPED_PACKAGE_NAME = "@adi-mudi/pi-velpari";
const REQUIRED_KEYWORD = "pi-package";
const SUBAGENTS_NAME = "pi-interactive-subagents";
const SUBAGENTS_MIN_VERSION = "3.7.2";
const CORE_PEER_DEPS = [
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"typebox",
] as const;

interface PackageJsonShape {
	keywords?: unknown;
	pi?: { extensions?: unknown; skills?: unknown };
	peerDependencies?: Record<string, unknown>;
	repository?: { url?: unknown };
}

function readPackageJson(cwd: string): PackageJsonShape | null {
	const path = join(cwd, "package.json");
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as PackageJsonShape;
	} catch {
		return null;
	}
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function isPinnedRange(range: unknown): boolean {
	if (typeof range !== "string") return false;
	// Treat `*` and empty as not pinned. Accept `>=x.y.z`, `^x`, `~x`, `x`,
	// and any non-`"*"` range. Numeric semver prefixes count as pinned too.
	if (range === "*" || range === "") return false;
	return true;
}

function checkKeyword(pkg: PackageJsonShape, items: DiagnosticItem[]): void {
	const keywords = asStringArray(pkg.keywords);
	if (keywords.includes(REQUIRED_KEYWORD)) {
		items.push({
			status: "ok",
			message: `keywords contains "${REQUIRED_KEYWORD}".`,
		});
	} else {
		items.push({
			status: "error",
			message: `keywords is missing "${REQUIRED_KEYWORD}". The package will not appear on pi.dev/packages without it.`,
			suggestion: suggestionFor("official.missing-pi-package-keyword"),
		});
	}
}

function checkPiExtensions(pkg: PackageJsonShape, items: DiagnosticItem[]): void {
	const extensions = asStringArray(pkg.pi?.extensions);
	if (extensions.length > 0) {
		items.push({
			status: "ok",
			message: `pi.extensions: ${extensions.length} entr${extensions.length === 1 ? "y" : "ies"}.`,
		});
	} else {
		items.push({
			status: "error",
			message: "pi.extensions is missing or empty. Pi will not load any extension from this package.",
			suggestion: suggestionFor("official.missing-pi-extensions"),
		});
	}
}

function checkSubagentsPeerDep(pkg: PackageJsonShape, items: DiagnosticItem[]): void {
	const peers = pkg.peerDependencies ?? {};
	const range = peers[SUBAGENTS_NAME];
	if (typeof range === "string" && range.length > 0) {
		items.push({
			status: "ok",
			message: `peerDependencies["${SUBAGENTS_NAME}"]: "${range}".`,
		});
	} else {
		items.push({
			status: "warning",
			message: `peerDependencies is missing "${SUBAGENTS_NAME}" (>= ${SUBAGENTS_MIN_VERSION}). The 4-scout pipeline will fail at runtime.`,
			suggestion: suggestionFor("official.missing-subagents-dep"),
		});
	}
}

function checkNpmignore(cwd: string, items: DiagnosticItem[]): void {
	const path = join(cwd, ".npmignore");
	if (existsSync(path)) {
		items.push({
			status: "ok",
			message: ".npmignore present (tarball excludes dev artifacts).",
		});
	} else {
		items.push({
			status: "warning",
			message: ".npmignore missing. `npm publish` will include Doc/, .IDE_Plans/, tests, and .github/ in the tarball.",
			suggestion: suggestionFor("official.missing-npmignore"),
		});
	}
}

function checkRepositoryUrl(pkg: PackageJsonShape, items: DiagnosticItem[]): void {
	const url = pkg.repository?.url;
	if (typeof url === "string" && url.length > 0) {
		items.push({
			status: "ok",
			message: `repository.url: ${url}`,
		});
	} else {
		items.push({
			status: "info",
			message: 'repository.url not set. npmjs.com will render the package without a source link. Add "repository": { "type": "git", "url": "..." } to package.json.',
		});
	}
}

function checkCorePeerDepsPinned(pkg: PackageJsonShape, items: DiagnosticItem[]): void {
	const peers = pkg.peerDependencies ?? {};
	for (const dep of CORE_PEER_DEPS) {
		const range = peers[dep];
		if (isPinnedRange(range)) {
			items.push({
				status: "ok",
				message: `peerDependencies["${dep}"]: "${range}".`,
			});
		} else {
			items.push({
				status: "info",
				message: `peerDependencies["${dep}"] is "${String(range)}". Pi docs recommend "*" for core packages, but pinning to a tested minimum (e.g. ">=0.74.0") is a defensible alternative.`,
			});
		}
	}
}

function checkReadmeInstallName(cwd: string, items: DiagnosticItem[]): void {
	const path = join(cwd, "README.md");
	if (!existsSync(path)) {
		items.push({
			status: "warning",
			message: "README.md missing — cannot verify install command.",
		});
		return;
	}
	const text = readFileSync(path, "utf8");
	const wrongInstall = `pi install npm:${PROJECT_NAME}`;
	const rightInstall = `pi install npm:${SCOPED_PACKAGE_NAME}`;
	if (text.includes(wrongInstall) && !text.includes(rightInstall)) {
		items.push({
			status: "warning",
			message: `README.md install line uses "${wrongInstall}" instead of "${rightInstall}".`,
			suggestion: suggestionFor("official.wrong-install-name"),
		});
		return;
	}
	if (text.includes(rightInstall)) {
		items.push({
			status: "ok",
			message: `README.md install line uses "${rightInstall}".`,
		});
		return;
	}
	items.push({
		status: "info",
		message: `README.md does not advertise "${rightInstall}" — add an Install section pointing at the canonical install command.`,
	});
}

export function checkOfficialReadiness(cwd: string = process.cwd()): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const pkg = readPackageJson(cwd);

	if (pkg === null) {
		items.push({
			status: "error",
			message: "package.json missing or unreadable at project root.",
			suggestion: suggestionFor("official.missing-package-json"),
		});
		return { title: "Official-extension readiness", items };
	}

	checkKeyword(pkg, items);
	checkPiExtensions(pkg, items);
	checkSubagentsPeerDep(pkg, items);
	checkNpmignore(cwd, items);
	checkRepositoryUrl(pkg, items);
	checkCorePeerDepsPinned(pkg, items);
	checkReadmeInstallName(cwd, items);

	return { title: "Official-extension readiness", items };
}
