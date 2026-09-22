// ============================================================================
// ops/stage-payloads.ts — stage payload validation + per-kind adapters
// (Layer 1, DB-primary publish path, Phase 4; v002 prose columns, Phase 6)
// ============================================================================
// User decision 2026-09-22 (Option 1 — LLM emits payload): the structured
// DB rows for each published artifact come from a small JSON payload the
// stage LLM writes during the stage — NEVER from markdown parsing (the
// zero-hallucination rule: the gate validates, nothing is guessed).
//
// Payload convention (LOCKED):
//   Path:  <runDir>/<stage-workingDir>/payload/<kind>-payload.json
//          (kind = the store ArtifactKind, keyed by the stage's workingDir)
//   Shape: {
//     "envelope": { "version": N, "stage": "...", "generatedAt": "...",
//                   "inputs"?: object|string, "reviewerVerdict"?: str|null,
//                   "changeLog"?: array|string },
//     "rows": { ...per-kind row-sets, camelCase, v001 DDL mirrored }
//   }
//
// Recorded limitation (plan Risks note 4): the payload is validated for
// schema + CHECK-domain conformance ONLY — its rows are NOT cross-checked
// against the published markdown prose. The G8 PRD mirror check (publish
// gate) verifies only that the published PRD file hash matches
// envelope.inputs["prd-file"].
//
// Feasibility adapter (plan 4.3): the decision row comes from
// state.feasibilitySession (verdict = session.decision verbatim — the
// Phase 4 dual-vocabulary CHECK accepts reuse/partial/build; language =
// selectedLanguage; decidedBy = selectedBy) + spike rows from
// session.spikeResults. The payload JSON carries the envelope; rows are
// merged from the session so the cleared session's decisions survive in
// the store (D9 spirit).
//
// Scope: L1 — imports L0 only (io/store types, core/state type). No TUI,
// no state mutation, no git.
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ArtifactKind,
	ArtifactEnvelopeInput,
	ArtifactPayload,
} from "../io/store.js";
import type { FeasibilitySession } from "../core/state.js";
import type { SpikeResult } from "../core/spike.js";

// ---------------------------------------------------------------------------
// Stage → store-kind mapping. STAGE_APPROVE_MAP.workingDir is the run-folder
// key the approve flow already computes; "tests" publishes the testplan kind.
// ---------------------------------------------------------------------------

const KIND_BY_WORKING_DIR: Record<string, ArtifactKind> = {
	prd: "prd",
	rtm: "rtm",
	feasibility: "feasibility",
	design: "design",
	"atomic-functions": "atomic-functions",
	pseudocode: "pseudocode",
	tests: "testplan",
	"development-order": "development-order",
	"final-design": "final-design",
};

/** Absolute payload path for one stage's working dir + store kind. */
export function stagePayloadPath(workingDirPath: string, kind: ArtifactKind): string {
	return join(workingDirPath, "payload", `${kind}-payload.json`);
}

/** Resolve the store kind from a stage's workingDir name (null = unknown). */
export function kindForWorkingDir(workingDir: string): ArtifactKind | null {
	return KIND_BY_WORKING_DIR[workingDir] ?? null;
}

// ---------------------------------------------------------------------------
// Field validation — mirrors the v001 DDL columns and CHECK domains 1:1.
// ---------------------------------------------------------------------------

interface FieldSpec {
	type: "string" | "int" | "bool01" | "hex64";
	/** Allowed values (string enums mirrored from DDL CHECKs). */
	values?: readonly string[];
	/** Field may be absent. */
	optional?: boolean;
	/** Field may be explicitly null (DDL nullable columns). */
	nullable?: boolean;
	/** integer must be >= this (phase >= 1, version >= 1, no >= 1). */
	min?: number;
}

const HEX64 = /^[0-9a-f]{64}$/;

const FR_NFR: Record<string, FieldSpec> = {
	id: { type: "string" },
	phase: { type: "int", min: 1 },
	textHash: { type: "string" },
	// v002 — REQUIRED at payload validation: strict-read stages cannot
	// produce slices without requirement prose (decision §14).
	text: { type: "string" },
};
const MODULE_REF: Record<string, FieldSpec> = {
	moduleId: { type: "string" },
	frId: { type: "string" },
};

/** Per-kind row-set specs: payload key → (single? + row field specs). */
interface RowSetSpec {
	single?: boolean;
	fields: Record<string, FieldSpec>;
}

const PRD_ROWS: Record<string, RowSetSpec> = {
	fr: { fields: FR_NFR },
	nfr: { fields: FR_NFR },
	prdSection: {
		fields: {
			no: { type: "int", min: 1 },
			title: { type: "string" },
			bodyRef: { type: "string", optional: true, nullable: true },
			// v002 — PRD section prose (optional/nullable at validation;
			// publish gate enforces per-kind strictness).
			body: { type: "string", optional: true, nullable: true },
		},
	},
};
const RTM_ROWS: Record<string, RowSetSpec> = {
	rtmRow: {
		fields: {
			id: { type: "string" },
			frRef: { type: "string" },
			afRef: { type: "string", optional: true, nullable: true },
			tcRef: { type: "string", optional: true, nullable: true },
			phase: { type: "int", min: 1 },
			targetSha256: { type: "string" },
		},
	},
};
const FEASIBILITY_ROWS: Record<string, RowSetSpec> = {
	feasibilityDecision: {
		single: true,
		fields: {
			verdict: {
				type: "string",
				values: ["go", "no-go", "go-with-conditions", "reuse", "partial", "build"],
			},
			language: { type: "string", optional: true, nullable: true },
			decidedBy: { type: "string" },
			at: { type: "string" },
			webSearchConsent: { type: "bool01", optional: true, nullable: true },
		},
	},
	feasibilitySpike: {
		fields: {
			language: { type: "string" },
			passed: { type: "bool01" },
			resultRef: { type: "string", optional: true, nullable: true },
		},
	},
	reuseScan: {
		fields: {
			candidate: { type: "string" },
			license: { type: "string", optional: true, nullable: true },
			repoFreshness: { type: "string", optional: true, nullable: true },
			verdict: { type: "string" },
		},
	},
};
const DESIGN_ROWS: Record<string, RowSetSpec> = {
	designModule: {
		fields: {
			id: { type: "string" },
			name: { type: "string" },
			// v002 — module responsibility prose (optional at validation;
			// publish gate may require for scope).
			description: { type: "string", optional: true, nullable: true },
		},
	},
	moduleSourceFr: { fields: MODULE_REF },
	adr: {
		fields: {
			id: { type: "string" },
			adrStatus: {
				type: "string",
				values: ["proposed", "accepted", "superseded", "rejected"],
			},
			options: { type: "string" },
			chosen: { type: "string", optional: true, nullable: true },
			rationale: { type: "string", optional: true, nullable: true },
		},
	},
	diagram: {
		fields: {
			id: { type: "string" },
			diagramKind: { type: "string" },
			mermaidText: { type: "string" },
		},
	},
	approach: {
		fields: { moduleId: { type: "string" }, tacticId: { type: "string" } },
	},
};
const ATOMIC_ROWS: Record<string, RowSetSpec> = {
	atomicFunction: {
		fields: {
			id: { type: "string" },
			name: { type: "string" },
			signature: { type: "string" },
			tier: {
				type: "string",
				values: ["entry", "basic", "intermediate", "advanced"],
			},
			criticality: { type: "string", values: ["A", "B", "C"] },
			sil: {
				type: "string",
				values: ["none", "sil-1", "sil-2", "sil-3", "sil-4"],
			},
			isLeaf: { type: "bool01" },
			// v002 — 5 of 8 base-core fields (principle 10a). Tier-gate
			// decides when required; doctor warns for advanced tiers.
			purpose: { type: "string", optional: true, nullable: true },
			source: { type: "string", optional: true, nullable: true },
			cohesion: { type: "string", optional: true, nullable: true },
			verification: { type: "string", optional: true, nullable: true },
			testable: { type: "string", optional: true, nullable: true },
		},
	},
};
const PSEUDOCODE_ROWS: Record<string, RowSetSpec> = {
	pseudocodeBlock: {
		fields: {
			id: { type: "string" },
			afRef: { type: "string" },
			contentHash: { type: "string" },
			// v002 — REQUIRED at payload validation (mirrors contentHash):
			// slice reads render the prose, not the hash.
			content: { type: "string" },
		},
	},
};
const TESTPLAN_ROWS: Record<string, RowSetSpec> = {
	testCase: {
		fields: {
			id: { type: "string" },
			tcKind: { type: "string", values: ["TC", "IT"] },
			strategyRef: { type: "string", optional: true, nullable: true },
			// v002 — test-case prose. Validator permits omission for
			// legacy payloads; publish gate enforces REQUIRED for the
			// testplan kind (DB-rendered test-cases.md cannot render empty).
			steps: { type: "string", optional: true, nullable: true },
			objective: { type: "string", optional: true, nullable: true },
			expected: { type: "string", optional: true, nullable: true },
		},
	},
	tcTrace: {
		fields: {
			tcId: { type: "string" },
			targetKind: { type: "string", values: ["fr", "nfr", "af"] },
			targetId: { type: "string" },
		},
	},
};
const DEV_ORDER_ROWS: Record<string, RowSetSpec> = {
	devStep: {
		fields: {
			id: { type: "string" },
			module: { type: "string" },
			// v002 — dev-step prose for the DB-rendered development-order doc.
			description: { type: "string", optional: true, nullable: true },
		},
	},
	stepAf: {
		fields: { stepId: { type: "string" }, afId: { type: "string" } },
	},
	stepDep: {
		fields: { stepId: { type: "string" }, dependsOnId: { type: "string" } },
	},
};
const FINAL_DESIGN_ROWS: Record<string, RowSetSpec> = {
	finalSection: {
		fields: {
			no: { type: "int", min: 1 },
			title: { type: "string" },
			sourceArtifact: { type: "string" },
			sourceIds: { type: "string", optional: true },
		},
	},
};

const ROWS_BY_KIND: Record<ArtifactKind, Record<string, RowSetSpec>> = {
	prd: PRD_ROWS,
	rtm: RTM_ROWS,
	feasibility: FEASIBILITY_ROWS,
	design: DESIGN_ROWS,
	"atomic-functions": ATOMIC_ROWS,
	pseudocode: PSEUDOCODE_ROWS,
	testplan: TESTPLAN_ROWS,
	"development-order": DEV_ORDER_ROWS,
	"final-design": FINAL_DESIGN_ROWS,
};

// ---------------------------------------------------------------------------
// loadStagePayload — read + validate one stage payload file.
// ---------------------------------------------------------------------------

export interface StagePayloadResult {
	ok: boolean;
	problems: string[];
	envelope?: ArtifactEnvelopeInput;
	payload?: ArtifactPayload;
}

/**
 * Validate one row object against its field specs. Unknown fields are
 * rejected (mirrors the STRICT DDL: no drift between payload and schema);
 * type, enum, nullable, and min-value rules follow the v001 columns.
 * @param {string} where - Human-readable location for problem messages
 *   (e.g. "payload.rows.fr[0]").
 * @param {Record<string, unknown>} row - The raw JSON row object to check.
 * @param {Record<string, FieldSpec>} fields - Field specs mirrored from the
 *   v001 DDL (type, enum values, optional/nullable, minimum).
 * @param {string[]} problems - Accumulator; validation problems are pushed
 *   here ("<where>: <issue>"), never thrown.
 * @returns {void}
 */
function checkFields(
	where: string,
	row: Record<string, unknown>,
	fields: Record<string, FieldSpec>,
	problems: string[],
): void {
	for (const [name, _value] of Object.entries(row)) {
		if (!(name in fields)) {
			problems.push(`${where}: unknown field "${name}"`);
		}
	}
	for (const [name, spec] of Object.entries(fields)) {
		const value = row[name];
		if (value === undefined) {
			if (!spec.optional) problems.push(`${where}: missing field "${name}"`);
			continue;
		}
		if (value === null) {
			if (!spec.nullable) {
				problems.push(`${where}: field "${name}" must not be null`);
			}
			continue;
		}
		if (spec.type === "string" || spec.type === "hex64") {
			if (typeof value !== "string") {
				problems.push(`${where}: field "${name}" must be a string`);
				continue;
			}
			if (spec.type === "hex64" && !HEX64.test(value)) {
				problems.push(`${where}: field "${name}" must be a 64-char sha256 hex`);
			}
			if (spec.values && !spec.values.includes(value)) {
				problems.push(
					`${where}: field "${name}" value "${value}" outside allowed set [${spec.values.join(", ")}]`,
				);
			}
		} else if (spec.type === "int") {
			if (typeof value !== "number" || !Number.isInteger(value)) {
				problems.push(`${where}: field "${name}" must be an integer`);
				continue;
			}
			if (spec.min !== undefined && value < spec.min) {
				problems.push(`${where}: field "${name}" must be >= ${spec.min}`);
			}
		} else if (spec.type === "bool01") {
			if (value !== 0 && value !== 1) {
				problems.push(`${where}: field "${name}" must be 0 or 1`);
			}
		}
	}
}

/**
 * Read + validate `<workingDirPath>/payload/<kind>-payload.json`.
 * Returns the validated envelope (normalized: inputs/changeLog as JSON
 * strings, ready for writeArtifact) + payload rows, or a problem list.
 * Unknown keys are rejected everywhere (envelope, rows, per-row).
 */
export function loadStagePayload(
	workingDirPath: string,
	kind: ArtifactKind,
): StagePayloadResult {
	const path = stagePayloadPath(workingDirPath, kind);
	const problems: string[] = [];
	if (!existsSync(path)) {
		return {
			ok: false,
			problems: [
				`stage payload missing: ${path}`,
				`the stage LLM must write it before approve (schema: see skills/velpari-* payload step)`,
			],
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"));
	} catch (err) {
		return {
			ok: false,
			problems: [`stage payload is not valid JSON: ${path} (${String(err)})`],
		};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ok: false, problems: [`stage payload must be a JSON object: ${path}`] };
	}
	const root = parsed as Record<string, unknown>;

	// --- envelope ---
	if (typeof root.envelope !== "object" || root.envelope === null || Array.isArray(root.envelope)) {
		problems.push("payload.envelope must be an object");
	} else {
		const env = root.envelope as Record<string, unknown>;
		const allowed = new Set([
			"version",
			"stage",
			"generatedAt",
			"inputs",
			"reviewerVerdict",
			"changeLog",
		]);
		for (const key of Object.keys(env)) {
			if (!allowed.has(key)) problems.push(`payload.envelope: unknown field "${key}"`);
		}
		if (typeof env.version !== "number" || !Number.isInteger(env.version) || env.version < 1) {
			problems.push("payload.envelope.version must be an integer >= 1");
		}
		if (typeof env.stage !== "string" || !env.stage.trim()) {
			problems.push("payload.envelope.stage must be a non-empty string");
		}
		if (typeof env.generatedAt !== "string" || !env.generatedAt.trim()) {
			problems.push("payload.envelope.generatedAt must be a non-empty string");
		}
		// G8 (prd kind): inputs MUST carry the published PRD file hash so the
		// publish gate can verify the mirror (envelope.inputs["prd-file"]).
		let inputsIsObject =
			typeof env.inputs === "object" && env.inputs !== null && !Array.isArray(env.inputs);
		if (env.inputs !== undefined && !inputsIsObject && typeof env.inputs !== "string") {
			problems.push('payload.envelope.inputs must be an object (artifact → sha256) or a JSON string');
		}
		if (kind === "prd") {
			const inputsObj =
				typeof env.inputs === "string"
					? safeParseInputs(env.inputs)
					: inputsIsObject
						? (env.inputs as Record<string, unknown>)
						: undefined;
			const prdHash = inputsObj?.["prd-file"];
			if (typeof prdHash !== "string" || !HEX64.test(prdHash)) {
				problems.push(
					'payload.envelope.inputs["prd-file"] must be the sha256 hex of the published PRD markdown (G8 mirror check)',
				);
			}
		}
		if (env.reviewerVerdict !== undefined && env.reviewerVerdict !== null && typeof env.reviewerVerdict !== "string") {
			problems.push("payload.envelope.reviewerVerdict must be a string or null");
		}
		if (
			env.changeLog !== undefined &&
			typeof env.changeLog !== "string" &&
			!Array.isArray(env.changeLog)
		) {
			problems.push("payload.envelope.changeLog must be an array of strings or a JSON string");
		}
	}

	// --- rows ---
	if (typeof root.rows !== "object" || root.rows === null || Array.isArray(root.rows)) {
		problems.push("payload.rows must be an object");
	} else {
		const rows = root.rows as Record<string, unknown>;
		const specs = ROWS_BY_KIND[kind];
		for (const key of Object.keys(rows)) {
			if (!(key in specs)) {
				problems.push(`payload.rows: unknown row-set "${key}" for kind "${kind}"`);
			}
		}
		for (const [key, spec] of Object.entries(specs)) {
			const value = rows[key];
			if (value === undefined) continue; // row-set optional in the payload
			if (spec.single) {
				if (typeof value !== "object" || value === null || Array.isArray(value)) {
					problems.push(`payload.rows.${key} must be a single object`);
					continue;
				}
				checkFields(`payload.rows.${key}`, value as Record<string, unknown>, spec.fields, problems);
			} else {
				if (!Array.isArray(value)) {
					problems.push(`payload.rows.${key} must be an array`);
					continue;
				}
				value.forEach((row, i) => {
					if (typeof row !== "object" || row === null || Array.isArray(row)) {
						problems.push(`payload.rows.${key}[${i}] must be an object`);
						return;
					}
					checkFields(
						`payload.rows.${key}[${i}]`,
						row as Record<string, unknown>,
						spec.fields,
						problems,
					);
				});
			}
		}
	}

	if (problems.length > 0) return { ok: false, problems };

	// --- normalize to writeArtifact inputs ---
	const env = root.envelope as Record<string, unknown>;
	const normalizedInputs =
		typeof env.inputs === "string" ? env.inputs : JSON.stringify(env.inputs ?? {});
	const normalizedChangeLog =
		typeof env.changeLog === "string" ? env.changeLog : JSON.stringify(env.changeLog ?? []);
	const envelope: ArtifactEnvelopeInput = {
		version: env.version as number,
		stage: env.stage as string,
		generatedAt: env.generatedAt as string,
		inputs: normalizedInputs,
		reviewerVerdict: (env.reviewerVerdict as string | null | undefined) ?? null,
		changeLog: normalizedChangeLog,
	};
	return { ok: true, problems: [], envelope, payload: root.rows as ArtifactPayload };
}

/**
 * Parse a JSON-string `inputs` envelope field back into an object (the
 * payload may inline inputs either as an object or as a JSON string).
 * @param {string} raw - The JSON string to parse.
 * @returns {Record<string, unknown> | undefined} The parsed object, or
 *   undefined when the string is not valid JSON or not an object.
 */
function safeParseInputs(raw: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// fall through
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Feasibility adapter — rows sourced from state.feasibilitySession (D9).
// ---------------------------------------------------------------------------

/**
 * Build the feasibility payload rows from the settled session. The session
 * gate in handleApprove guarantees decision + selectedLanguage; verdict is
 * written VERBATIM (dual-vocabulary CHECK — user decision 2026-09-22).
 * Spike rows come from session.spikeResults (passed = buildOk AND runOk);
 * reuse_scan rows stay payload-sourced (reuseSummary is chat prose, not
 * structured candidates).
 */
export function buildFeasibilityRowsFromSession(
	session: FeasibilitySession,
	recordedAt: string,
): {
	feasibilityDecision: {
		verdict: "reuse" | "partial" | "build";
		language: string;
		decidedBy: "clone" | "config" | "auto" | "user";
		at: string;
	};
	feasibilitySpike: Array<{ language: string; passed: 0 | 1; resultRef: string | null }>;
} {
	const spikes = (session.spikeResults ?? []) as SpikeResult[];
	return {
		feasibilityDecision: {
			verdict: session.decision ?? "build",
			language: session.selectedLanguage ?? "",
			decidedBy: session.selectedBy ?? "user",
			at: recordedAt,
		},
		feasibilitySpike: spikes.map((s) => ({
			language: s.language,
			passed: s.buildOk && s.runOk ? 1 : 0,
			resultRef: s.evidencePath ?? null,
		})),
	};
}
