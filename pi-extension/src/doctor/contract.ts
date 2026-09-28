/**
 * Doctor interface-contract adapters — Phase C (N22).
 *
 * Single home for consuming Phase B's and Phase D's interface contracts
 * (B plan §Integration request 5; D plan §Integration requests 1–2).
 * Batch 1 runs B/C/D in parallel, so at build time in THIS worktree the
 * contract symbols do not exist yet. Every consumer therefore goes
 * through a resolver that feature-detects at runtime and returns `null`
 * when a contract is absent — the checks degrade to an `info` finding,
 * never an error, until batch gate 1 merges the real implementations.
 *
 * Loading strategy per contract:
 *  - `io/db.ts` + `core/config.ts` EXIST in this worktree → static
 *    namespace imports, property feature-detection (builds pre-merge).
 *  - `core/semver.ts` (Phase D) + `core/soft-lock.ts` (Phase B) do NOT
 *    exist yet → `existsSync` guard + computed dynamic import with
 *    top-level await, resolved ONCE at module load (module ES2022
 *    supports TLA; `"type": "module"` so dist is ESM). A missing module
 *    costs one stat call.
 *
 * Tests inject fixtures through `setContractForTests` (override wins
 * over resolution), so the digest/semver checks are testable without
 * waiting for B's or D's internals — the contract fixture rule
 * (outline §4.3.3).
 *
 * Layer 1 (doctor). Imports only L0 (`core/`, `io/`) + `node:`; no
 * upward imports. Never throws — every resolver degrades to `null`.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as configApi from "../core/config.js";
import * as dbApi from "../io/db.js";

// ---------------------------------------------------------------------------
// Contract shapes (verbatim from B's / D's plans — keep in sync by reading
// the plan text, NOT by importing their internals).
// ---------------------------------------------------------------------------

/** B: stamped store-content digest row set (store_meta key-value). */
export interface StoreDigestStamp {
	scope: string;
	digest: string;
	stampedAt: string;
}

/** B: schema version inspection (read-only — pre-migration surfacing). */
export interface StoreVersionInfo {
	version: number;
	maxKnown: number;
	pending: number;
}

/** B — `STORE_DIGEST_SCOPE` + `computeStoreContentDigest` + `readStoreDigestStamp` + `inspectStoreVersion` (io/db.ts). */
export interface DigestApi {
	scope: string;
	computeStoreContentDigest(db: unknown): string;
	readStoreDigestStamp(db: unknown): StoreDigestStamp | null;
	inspectStoreVersion(dbPath: string): StoreVersionInfo | null;
}

/** D — `classifyChange` / `validateBump` / `bumpGateMessages` (core/semver.ts). */
export interface SemverApi {
	classifyChange(published: string, working: string): unknown;
	validateBump(published: string, working: string): unknown;
	bumpGateMessages(verdict: unknown): { errors: string[]; warnings: string[] };
}

/** B — `listSoftLocks` (core/soft-lock.ts). */
export interface SoftLockRow {
	revisionId: number;
	kind: string;
	revisionNumber: number;
	lockedAt: string;
	lockedBy: string;
}

export interface SoftLockApi {
	listSoftLocks(cwd: string, projectName: string, kind?: string): SoftLockRow[];
}

/** B — typed config accessors (core/config.ts). */
export interface ConfigApi {
	maxWorktreesConfig(cwd?: string): number;
	testingRunnerConfig(cwd?: string): "remote" | "local";
	projectTypeConfig(cwd?: string): "backend" | "full-app";
}

// ---------------------------------------------------------------------------
// Test overrides (contract fixture rule — inject, don't wait).
// ---------------------------------------------------------------------------

interface ContractOverrides {
	digest: DigestApi | null;
	semver: SemverApi | null;
	softLock: SoftLockApi | null;
	config: ConfigApi | null;
}

let overrides: Partial<ContractOverrides> = {};

/** Test-only: inject a fixture contract (or `null` to force degradation). */
export function setContractForTests(p: Partial<ContractOverrides>): void {
	overrides = { ...overrides, ...p };
}

/** Test-only: drop all overrides and return to runtime resolution. */
export function resetContractForTests(): void {
	overrides = {};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

/**
 * Coerce a namespace import (or anything) into an indexable record for
 * runtime feature detection.
 * @param {unknown} mod - The module value (namespace import, default, or nullish).
 * @returns {Rec} The value as a `Record<string, unknown>` (empty object for nullish input).
 */
function asRec(mod: unknown): Rec {
	return (mod ?? {}) as Rec;
}

/**
 * Runtime type guard: is this exported value callable?
 * @param {unknown} v - Any resolved export value.
 * @returns {boolean} `true` when `v` is a function.
 */
function isFn(v: unknown): boolean {
	return typeof v === "function";
}

/**
 * Computed dynamic import with an existence guard. Returns `null` when
 * the module is absent (batch-1 pre-merge) or fails to load — a foreign
 * module that throws during evaluation degrades the same as missing.
 * The specifier is a VARIABLE so tsc never resolves it statically
 * (no TS2307 before D/B land their files).
 */
async function loadOptionalModule(relSpec: string): Promise<Rec | null> {
	try {
		const url = new URL(relSpec, import.meta.url);
		if (!existsSync(fileURLToPath(url))) return null;
		return asRec(await import(url.href));
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Resolvers (called fresh — cheap property checks; dynamic modules are
// resolved once at module load below).
// ---------------------------------------------------------------------------

/** B digest contract from `io/db.ts` (exists pre-merge, exports may not). */
export function resolveDigestApi(): DigestApi | null {
	if ("digest" in overrides) return overrides.digest ?? null;
	const rec = asRec(dbApi);
	if (!isFn(rec.computeStoreContentDigest) || !isFn(rec.readStoreDigestStamp)) return null;
	return {
		scope: typeof rec.STORE_DIGEST_SCOPE === "string" ? rec.STORE_DIGEST_SCOPE : "store-content-v1",
		computeStoreContentDigest: rec.computeStoreContentDigest as DigestApi["computeStoreContentDigest"],
		readStoreDigestStamp: rec.readStoreDigestStamp as DigestApi["readStoreDigestStamp"],
		inspectStoreVersion: isFn(rec.inspectStoreVersion)
			? (rec.inspectStoreVersion as DigestApi["inspectStoreVersion"])
			: () => null,
	};
}

/** D semver contract from `core/semver.ts` (absent until D merges). */
export function resolveSemverApi(): SemverApi | null {
	if ("semver" in overrides) return overrides.semver ?? null;
	if (!SEMVER_MODULE) return null;
	const rec = SEMVER_MODULE;
	if (!isFn(rec.classifyChange) || !isFn(rec.validateBump) || !isFn(rec.bumpGateMessages)) return null;
	return {
		classifyChange: rec.classifyChange as SemverApi["classifyChange"],
		validateBump: rec.validateBump as SemverApi["validateBump"],
		bumpGateMessages: rec.bumpGateMessages as SemverApi["bumpGateMessages"],
	};
}

/** B soft-lock contract from `core/soft-lock.ts` (absent until B merges). */
export function resolveSoftLockApi(): SoftLockApi | null {
	if ("softLock" in overrides) return overrides.softLock ?? null;
	if (!SOFT_LOCK_MODULE) return null;
	const rec = SOFT_LOCK_MODULE;
	if (!isFn(rec.listSoftLocks)) return null;
	return { listSoftLocks: rec.listSoftLocks as SoftLockApi["listSoftLocks"] };
}

/** B config accessors from `core/config.ts` (exists pre-merge, exports may not). */
export function resolveConfigApi(): ConfigApi | null {
	if ("config" in overrides) return overrides.config ?? null;
	const rec = asRec(configApi);
	if (!isFn(rec.maxWorktreesConfig) || !isFn(rec.testingRunnerConfig) || !isFn(rec.projectTypeConfig)) {
		return null;
	}
	return {
		maxWorktreesConfig: rec.maxWorktreesConfig as ConfigApi["maxWorktreesConfig"],
		testingRunnerConfig: rec.testingRunnerConfig as ConfigApi["testingRunnerConfig"],
		projectTypeConfig: rec.projectTypeConfig as ConfigApi["projectTypeConfig"],
	};
}

// Module-level optional loads — resolved once, before any importer body runs.
const SEMVER_MODULE: Rec | null = await loadOptionalModule("../core/semver.js");
const SOFT_LOCK_MODULE: Rec | null = await loadOptionalModule("../core/soft-lock.js");
