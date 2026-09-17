/**
 * PHASE 5 — tier schema helpers for /velpari-atomic-function (dedicated layer).
 *
 * Re-exports the tier-field primitives from `core/atomic-tier` so the
 * dedicated layer (parent LLM merge logic, scout prompts, test
 * fixtures) can name them without reaching into `core/` directly.
 *
 * Schema rule (ISO/IEC 29110 + IEC 61508/IEC 62304): higher tiers
 * inherit lower-tier fields. `entry ⊂ basic ⊂ intermediate ⊂ advanced`.
 *
 *   entry         — 8 base-core fields
 *   basic         — 8 base-core + 5 cross-refs       (13 total)
 *   intermediate  — + 11 V-Model LLD + EARS fields    (24 total)
 *   advanced      — + 11 INCOSE GtWR + maintenance    (35 total)
 *
 * Layer 1 — imports core/ only.
 */

import {
	BASE_CORE_FIELDS as _BASE_CORE_FIELDS,
	TIER_FIELDS as _TIER_FIELDS,
	requiredFieldsFor as _requiredFieldsFor,
	tierLabel as _tierLabel,
	type AtomicFieldName as _AtomicFieldName,
	type AtomicProfile as _AtomicProfile,
} from "../../core/atomic-tier.js";

export const BASE_CORE_FIELDS = _BASE_CORE_FIELDS;
export const TIER_FIELDS = _TIER_FIELDS;
export const requiredFieldsFor = _requiredFieldsFor;
export const tierLabel = _tierLabel;

export type AtomicFieldName = _AtomicFieldName;
export type AtomicProfile = _AtomicProfile;

/**
 * Render the tier-appropriate atomic-function table header. Returns
 * the column list for a markdown table at the given tier:
 *
 *   entry         — 8 base-core columns
 *   basic         — 8 base-core + 5 cross-refs
 *   intermediate  — 24 columns
 *   advanced      — 35 columns
 *
 * Pure helper used by the parent LLM when building the working-copy
 * markdown. The order follows the official ISO/IEC 29110 template.
 */
export function tableHeader(tier: _AtomicProfile["tier"]): string {
	return requiredFieldsFor(tier).join(" | ");
}