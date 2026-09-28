/**
 * Pi-extension conformance check — Phase C (G2b), Doctor v2.
 *
 * SHAPE from Senai's `checks-pi-extension-conformance.ts`; content is
 * 100% velpari. **No `@adi-mudi/pi-chirpi` import — forbidden** (the
 * chirpi relationship is text-only, per AGENTS.md).
 *
 * Target detection (skip-when-not-an-extension pattern):
 *   - extension-source mode: `cwd/package.json.name === "@adi-mudi/pi-velpari"`
 *     AND `cwd/pi-extension/src/` exists → full audit:
 *       (a) every `src/*` layer folder ∈ `LAYERS` (from `src/layers.ts`)
 *           and every declared folder exists;
 *       (b) `hooks/index.ts` text registers the five expected hooks;
 *       (c) dependency hygiene — a static import of chirpi or
 *           pi-interactive-subagents in `pi-extension/src/**` is an
 *           error (both must stay text-only references);
 *       (d) `peerDependencies` declare `@earendil-works/pi-coding-agent`
 *           when source files import it.
 *   - installed mode: `<cwd>/node_modules/@adi-mudi/pi-velpari/dist` exists
 *     → `dist/pi-extension/src/index.js` + `skills/` present → ok, else warning.
 *   - otherwise → single `info` (skipped).
 *
 * Whole function try/catch-wrapped. Read-only: fs reads only, never writes.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { LAYERS } from "../../layers.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Pi extension conformance";

/** Every declared layer folder, flattened from `src/layers.ts`. */
const DECLARED_FOLDERS: readonly string[] = Object.values(LAYERS).flat();

/** Event → registrar token that must appear in `hooks/index.ts`. */
const REQUIRED_HOOKS: ReadonlyArray<readonly [string, string]> = [
	["before_agent_start", "registerBeforeAgentStartHook"],
	["tool_call", "registerToolCallHook"],
	["session-start", "registerSessionStartHook"],
	["session-shutdown", "registerSessionShutdownHook"],
	["session-before-compact", "registerSessionBeforeCompactHook"],
];

/** Static import specifiers that must never appear in extension sources. */
const FORBIDDEN_IMPORT_PREFIXES: readonly string[] = ["@adi-mudi/pi-chirpi", "pi-interactive-subagents"];

/** The pi peer package that, when imported, must be declared. */
const REQUIRED_PEER = "@earendil-works/pi-coding-agent";

/**
 * Recursively collect `.ts` files under a directory (fail-soft).
 * @param {string} dir - Absolute directory to walk.
 * @returns {string[]} Absolute paths of `.ts` files; unreadable entries are skipped.
 */
function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	try {
		for (const entry of readdirSync(dir)) {
			const p = join(dir, entry);
			try {
				if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
				else if (entry.endsWith(".ts")) out.push(p);
			} catch {
				/* unreadable entry — skip */
			}
		}
	} catch {
		/* unreadable dir — skip */
	}
	return out;
}

/**
 * Build the "Pi extension conformance" section (read-only).
 * @param {string} cwd - Project root (extension checkout, install dir, or plain project).
 * @returns {DiagnosticSection} One section; non-extension targets get a single `info` skip line.
 */
export function checkPiExtensionConformance(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		// -- Target detection ------------------------------------------------
		const pkgPath = join(cwd, "package.json");
		let pkgName: string | null = null;
		let peerDeps: Record<string, string> = {};
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
				name?: unknown;
				peerDependencies?: Record<string, string>;
			};
			pkgName = typeof pkg.name === "string" ? pkg.name : null;
			peerDeps = pkg.peerDependencies ?? {};
		} catch {
			/* plain project / unreadable — falls through to installed/none */
		}

		const srcDir = join(cwd, "pi-extension", "src");
		const installedDir = join(cwd, "node_modules", "@adi-mudi", "pi-velpari", "dist");
		const isSourceCheckout = pkgName === "@adi-mudi/pi-velpari" && existsSync(srcDir);
		const isInstalled = existsSync(installedDir);

		if (!isSourceCheckout && !isInstalled) {
			items.push({
				status: "info",
				message: "not a velpari extension checkout or install — conformance skipped.",
				suggestion: suggestionFor("conformance-not-applicable"),
			});
			return { title: SECTION_TITLE, items };
		}

		// -- Installed mode --------------------------------------------------
		if (isInstalled && !isSourceCheckout) {
			const indexJs = join(installedDir, "pi-extension", "src", "index.js");
			const skillsDir = join(cwd, "node_modules", "@adi-mudi", "pi-velpari", "skills");
			if (existsSync(indexJs) && existsSync(skillsDir)) {
				items.push({
					status: "ok",
					message: "Installed extension complete: dist/pi-extension/src/index.js + skills/ present.",
				});
			} else {
				const missing = [
					!existsSync(indexJs) ? "dist/pi-extension/src/index.js" : null,
					!existsSync(skillsDir) ? "skills/" : null,
				].filter((x): x is string => x !== null);
				items.push({
					status: "warning",
					message: `Installed extension incomplete — missing: ${missing.join(", ")}. Reinstall: pi install github:.../pi-velpari.`,
				});
			}
			return { title: SECTION_TITLE, items };
		}

		// -- Extension-source mode ------------------------------------------
		// (a) layer folders ↔ LAYERS parity (the arch test is the oracle).
		let foldersOk = true;
		const srcEntries = readdirSync(srcDir, { withFileTypes: true });
		const actualFolders = srcEntries.filter((e) => e.isDirectory()).map((e) => e.name);
		for (const folder of actualFolders) {
			if (DECLARED_FOLDERS.includes(folder)) continue;
			// Content-only folders (e.g. src/agents/*.md templates) are not
			// layer folders — layers constrain CODE imports (the arch test
			// walks code files only). Only folders carrying `.ts` sources
			// must be declared in src/layers.ts.
			if (listTsFiles(join(srcDir, folder)).length === 0) continue;
			foldersOk = false;
			items.push({
				status: "error",
				message: `conformance-layer-mismatch: src/${folder}/ exists but is not declared in src/layers.ts.`,
				suggestion: suggestionFor("conformance-layer-mismatch"),
			});
		}
		for (const folder of DECLARED_FOLDERS) {
			if (!actualFolders.includes(folder)) {
				foldersOk = false;
				items.push({
					status: "error",
					message: `conformance-layer-mismatch: src/layers.ts declares ${folder}/ but the folder is missing.`,
					suggestion: suggestionFor("conformance-layer-mismatch"),
				});
			}
		}
		if (foldersOk) {
			items.push({ status: "ok", message: `All ${DECLARED_FOLDERS.length} declared layer folders present; no undeclared folders.` });
		}

		// (b) hooks registration text.
		const hooksIndex = join(srcDir, "hooks", "index.ts");
		if (!existsSync(hooksIndex)) {
			items.push({
				status: "warning",
				message: "conformance-hooks-missing: pi-extension/src/hooks/index.ts missing — session/tool_call gates cannot register.",
				suggestion: suggestionFor("conformance-hooks-missing"),
			});
		} else {
			const hooksText = readFileSync(hooksIndex, "utf8");
			const missingHooks = REQUIRED_HOOKS.filter(([, token]) => !hooksText.includes(token)).map(
				([event]) => event,
			);
			if (missingHooks.length > 0) {
				items.push({
					status: "warning",
					message: `conformance-hooks-missing: hooks/index.ts does not register: ${missingHooks.join(", ")}.`,
					suggestion: suggestionFor("conformance-hooks-missing"),
				});
			} else {
				items.push({ status: "ok", message: "hooks/index.ts registers all 5 required lifecycle hooks." });
			}
		}

		// (c) dependency hygiene + (d) peer declaration — one scan.
		const tsFiles = listTsFiles(srcDir);
		const forbiddenHits: string[] = [];
		const importsPeer: string[] = [];
		for (const file of tsFiles) {
			let text: string;
			try {
				text = readFileSync(file, "utf8");
			} catch {
				continue;
			}
			for (const prefix of FORBIDDEN_IMPORT_PREFIXES) {
				if (text.includes(`from "${prefix}`) || text.includes(`from '${prefix}`)) {
					forbiddenHits.push(`${file.slice(cwd.length + 1)} → ${prefix}`);
				}
			}
			if (text.includes(`from "${REQUIRED_PEER}`) || text.includes(`from '${REQUIRED_PEER}`)) {
				importsPeer.push(file);
			}
		}
		if (forbiddenHits.length > 0) {
			items.push({
				status: "error",
				message: `conformance-dep-violation: forbidden static import(s): ${forbiddenHits.join("; ")} — chirpi/pi-interactive-subagents must stay text-only references.`,
				suggestion: suggestionFor("conformance-dep-violation"),
			});
		} else {
			items.push({ status: "ok", message: `Dependency hygiene clean across ${tsFiles.length} source files (no chirpi / interactive-subagents imports).` });
		}
		if (importsPeer.length > 0 && !(REQUIRED_PEER in peerDeps)) {
			items.push({
				status: "error",
				message: `conformance-dep-violation: sources import ${REQUIRED_PEER} but package.json peerDependencies does not declare it.`,
				suggestion: suggestionFor("conformance-dep-violation"),
			});
		}
	} catch (err) {
		items.push({
			status: "warning",
			message: `conformance check skipped (${(err as Error)?.message ?? String(err)})`,
		});
	}
	return { title: SECTION_TITLE, items };
}
