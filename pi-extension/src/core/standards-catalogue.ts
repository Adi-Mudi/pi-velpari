/**
 * Standards catalogue loader (Phase 3, plan §Phase 3).
 *
 * Reads skills/standards/catalogue.json — the registry of every overlay
 * Velpari ships with. The catalogue is the source of truth for:
 *   - which overlays exist
 *   - what standards each overlay enforces
 *   - which scopes / inference signals match it
 *
 * Each overlay's full definition lives under
 * skills/standards/overlays/<id>/profile.json. The catalogue is just the
 * index.
 *
 * Pure IO + JSON. No LLM calls. No UI calls. No writes.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CatalogueOverlay {
	id: string;
	version: string;
	label: string;
	standards: string[];
	scopes: string[];
	inferenceSignals: string[];
}

interface StandardsCatalogue {
	version: string;
	overlays: CatalogueOverlay[];
}

/**
 * Default location of the catalogue (relative to the extension's cwd).
 * For tests, the caller passes an absolute `cataloguePath`.
 */
const DEFAULT_CATALOGUE_PATH = ["skills", "standards", "catalogue.json"] as const;

export function cataloguePath(cwd: string): string {
	return join(cwd, ...DEFAULT_CATALOGUE_PATH);
}

/**
 * Load the catalogue. Returns null when the file is missing or malformed.
 */
export function loadCatalogue(cwd: string): StandardsCatalogue | null {
	const path = cataloguePath(cwd);
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as Partial<StandardsCatalogue>;
		if (typeof parsed.version !== "string") return null;
		if (!Array.isArray(parsed.overlays)) return null;
		const overlays: CatalogueOverlay[] = [];
		for (const o of parsed.overlays) {
			if (!isValidCatalogueOverlay(o)) return null;
			overlays.push(o);
		}
		return { version: parsed.version, overlays };
	} catch {
		return null;
	}

	// helper kept inside closure to satisfy parser
	// (no-op; the isValidCatalogueOverlay function is hoisted)
}

function isValidCatalogueOverlay(o: unknown): o is CatalogueOverlay {
	if (!o || typeof o !== "object") return false;
	const obj = o as Record<string, unknown>;
	if (typeof obj.id !== "string" || obj.id.length === 0) return false;
	if (typeof obj.version !== "string") return false;
	if (typeof obj.label !== "string") return false;
	if (!Array.isArray(obj.standards)) return false;
	if (!obj.standards.every((s) => typeof s === "string")) return false;
	if (!Array.isArray(obj.scopes)) return false;
	if (!obj.scopes.every((s) => typeof s === "string")) return false;
	if (!Array.isArray(obj.inferenceSignals)) return false;
	if (!obj.inferenceSignals.every((s) => typeof s === "string")) return false;
	return true;
}

/**
 * Find a single overlay by id. Returns null when not found.
 */
export function findOverlay(catalogue: StandardsCatalogue, id: string): CatalogueOverlay | null {
	return catalogue.overlays.find((o) => o.id === id) ?? null;
}

/**
 * List overlay ids in the catalogue. Returns an empty array for an
 * empty catalogue (not null) so callers can iterate without null checks.
 */
export function listOverlayIds(catalogue: StandardsCatalogue | null): string[] {
	return catalogue?.overlays.map((o) => o.id) ?? [];
}
