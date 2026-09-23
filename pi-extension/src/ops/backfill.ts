// ============================================================================
// ops/backfill.ts — /velpari-backfill import engine (Layer 1, Phase 6 4.1)
// ============================================================================
// Decision record: .IDE_Plans/velpari-storage-traceability_decision-record_*_v1.0.md
//   §14.5 — backfill-on-refuse: a pre-store project recovers with the
//           one-step `/velpari-backfill <kind>` import instead of a silent
//           file fallback (decision 3 + reconciliation 8).
//   Decision 8 — minimal on-demand per-kind backfill lives in Phase 6;
//           the full `/velpari-migrate-store` stays Phase 11.
//   D4/YAML retirement — backfill writes the STORE ONLY: no Doc/ write, no
//           stage advance, no git commit (the stage's own publish commits
//           later). YAML sidecar files are NOT recreated — they retired as
//           sources; /velpari-export is the download view.
//
// Sources (sidecar-first, markdown-table fallback): published legacy
// artifacts are parsed back into payload rows with v002 prose where
// parseable. Rows that cannot be parsed are skipped; a payload with ZERO
// rows is a refusal (never an empty import).
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ArtifactKind, ArtifactPayload } from "../io/store.js";
import {
	KIND_ORDER,
	checkpointNow,
	publishArtifact,
	readLatestPublishedRows,
	verifyExportChecksum,
	writeArtifact,
	type ArtifactEnvelopeInput,
} from "../io/store.js";
import { openStoreDb, closeStoreDb } from "../io/db.js";
import { buildStoreDbPath, resolveDocArtifact } from "../core/paths.js";
import { loadRtmDataForEngine } from "../core/rtm-data.js";
import { loadAfDataForEngine } from "../core/af-data.js";
import { loadFeasibilityRecord } from "../core/feasibility-record.js";

// ---------------------------------------------------------------------------
// Generic markdown pipe-table parser (legacy published artifacts are the
// Phase 5 renderer's own output or the skill-template tables — same shape:
// heading caption, header row, `---` separator, data rows).
// ---------------------------------------------------------------------------

export interface ParsedTable {
	/** Nearest preceding markdown heading (e.g. "FR", "Traceability Rows"). */
	caption: string;
	headers: string[];
	rows: string[][];
}

function splitRow(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((c) => c.trim().replace(/\\\|/g, "|"));
}

function isSeparator(line: string): boolean {
	return line.includes("-") && /^[\s|:-]+$/.test(line);
}

/** Parse every pipe table in a markdown document (deterministic order). */
export function parseMarkdownTables(markdown: string): ParsedTable[] {
	const lines = markdown.split(/\r?\n/);
	const tables: ParsedTable[] = [];
	let caption = "";
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		const heading = /^#{1,6}\s+(.*)$/.exec(line);
		if (heading) {
			caption = heading[1]!.trim();
			i += 1;
			continue;
		}
		if (
			line.trimStart().startsWith("|") &&
			i + 1 < lines.length &&
			isSeparator(lines[i + 1]!)
		) {
			const headers = splitRow(line);
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length && lines[i]!.trimStart().startsWith("|")) {
				if (!isSeparator(lines[i]!)) rows.push(splitRow(lines[i]!));
				i += 1;
			}
			tables.push({ caption, headers, rows });
			continue;
		}
		i += 1;
	}
	return tables;
}

function norm(header: string): string {
	return header.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Column index matching any alias (normalized), or -1. */
function col(headers: string[], ...aliases: string[]): number {
	const n = headers.map(norm);
	for (const alias of aliases) {
		const idx = n.indexOf(alias);
		if (idx >= 0) return idx;
	}
	return -1;
}

/** Cell value by column alias — null when absent/empty. */
function val(headers: string[], row: string[], ...aliases: string[]): string | null {
	const idx = col(headers, ...aliases);
	if (idx < 0 || idx >= row.length) return null;
	const v = row[idx];
	return v === undefined || v === "" ? null : v;
}

/**
 * First table whose headers cover EVERY alias-group (each group needs one
 * matching column), optionally constrained by a caption regex.
 */
function findTable(
	tables: ParsedTable[],
	captionRe: RegExp | null,
	groups: string[][],
): ParsedTable | null {
	for (const t of tables) {
		if (captionRe && !captionRe.test(t.caption)) continue;
		const ok = groups.every((aliases) => col(t.headers, ...aliases) >= 0);
		if (ok) return t;
	}
	return null;
}

/** Restore newlines the renderers flattened (`<br>` cell encoding). */
function prose(v: string | null): string | null {
	return v === null ? null : v.replace(/<br>/g, "\n");
}

function sha256Hex(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Read a published legacy Doc/ markdown artifact for a kind, or null. */
function readLegacyMarkdown(
	projectName: string,
	cwd: string,
	artifact: string,
): { path: string; markdown: string } | null {
	const resolved = resolveDocArtifact(artifact, projectName, cwd);
	if (!resolved || !existsSync(resolved.path)) return null;
	return { path: resolved.path, markdown: readFileSync(resolved.path, "utf8") };
}

// ---------------------------------------------------------------------------
// Per-kind legacy loaders — sidecar/engine readers first (proven shapes),
// markdown-table fallback. Returns null when nothing is parseable.
// ---------------------------------------------------------------------------

interface LegacyLoad {
	payload: ArtifactPayload;
	/** Human source description for the change-log provenance line. */
	source: string;
}

/** Row count across every array row-set in a payload. */
function payloadRowCount(payload: ArtifactPayload): number {
	let count = 0;
	for (const value of Object.values(payload)) {
		if (Array.isArray(value)) count += value.length;
		else if (value !== undefined && value !== null) count += 1;
	}
	return count;
}

const LEGAL_VERDICTS = new Set([
	"go", "no-go", "go-with-conditions", "reuse", "partial", "build",
]);
const LEGAL_ADR_STATUS = new Set(["proposed", "accepted", "superseded", "rejected"]);
const LEGAL_TIERS = new Set(["entry", "basic", "intermediate", "advanced"]);
const LEGAL_CRITICALITY = new Set(["A", "B", "C"]);
const LEGAL_SIL = new Set(["none", "sil-1", "sil-2", "sil-3", "sil-4"]);

function loadPrd(projectName: string, cwd: string): LegacyLoad | null {
	const src = readLegacyMarkdown(projectName, cwd, "PRD");
	if (!src) return null;
	const tables = parseMarkdownTables(src.markdown);
	// FR/NFR: table with an id column + a phase column; caption separates them.
	const withPhase = tables.filter(
		(t) => col(t.headers, "phase") >= 0 && col(t.headers, "id", "fr id", "fr", "nfr id", "nfr") >= 0,
	);
	const frT = withPhase.find((t) => !/nfr|non-?\s*functional/i.test(t.caption)) ?? null;
	const nfrT = withPhase.find((t) => /nfr|non-?\s*functional/i.test(t.caption)) ?? null;
	const sectionT = findTable(tables, /section/i, [["no", "#", "no."], ["title"]]);

	const toRows = (t: ParsedTable | null): { id: string; phase: number; textHash: string; text: string | null }[] => {
		if (!t) return [];
		const out: { id: string; phase: number; textHash: string; text: string | null }[] = [];
		for (const row of t.rows) {
			const id = val(t.headers, row, "id", "fr id", "fr", "nfr id", "nfr");
			if (!id) continue;
			const text = prose(val(t.headers, row, "requirement", "text", "description", "title"));
			const phase = Number(val(t.headers, row, "phase") ?? "1");
			out.push({ id, phase: Number.isFinite(phase) && phase > 0 ? phase : 1, textHash: sha256Hex(text ?? id), text });
		}
		return out;
	};

	const fr = toRows(frT);
	const nfr = toRows(nfrT);
	const prdSection = (sectionT?.rows ?? []).flatMap((row) => {
		const no = Number(val(sectionT!.headers, row, "no", "#", "no.") ?? "NaN");
		const title = val(sectionT!.headers, row, "title");
		if (!Number.isFinite(no) || !title) return [];
		const body = prose(val(sectionT!.headers, row, "body", "content"));
		return [{ no, title, bodyRef: null, body }];
	});

	if (fr.length === 0 && nfr.length === 0 && prdSection.length === 0) return null;
	return {
		payload: { ...(fr.length ? { fr } : {}), ...(nfr.length ? { nfr } : {}), ...(prdSection.length ? { prdSection } : {}) },
		source: src.path,
	};
}

function loadRtm(projectName: string, cwd: string): LegacyLoad | null {
	// Sidecar/engine first — proven legacy shape (falls through when the
	// store has no rows, which is exactly the backfill precondition).
	const data = loadRtmDataForEngine(cwd, projectName);
	if (data && data.rows.length > 0) {
		const rtmRow = data.rows.map((row) => ({
			id: row.id,
			frRef: row.id,
			afRef: row.design ? row.design : null,
			tcRef: row.tests && row.tests.length > 0 ? row.tests.join(", ") : null,
			phase: row.phase,
			targetSha256: row.fingerprint ?? sha256Hex(`${row.id}|${row.title}`),
		}));
		return { payload: { rtmRow }, source: "RTM sidecar" };
	}
	// Markdown fallback — table with FR/id + phase (or a trace-caption table).
	const src = readLegacyMarkdown(projectName, cwd, "RTM");
	if (!src) return null;
	const tables = parseMarkdownTables(src.markdown);
	const t =
		findTable(tables, /trace/i, [["fr", "id", "fr id", "requirement"]]) ??
		findTable(tables, null, [["fr", "id", "fr id", "requirement"], ["phase"]]);
	if (!t) return null;
	const rtmRow = t.rows.flatMap((row, i) => {
		const frRef = val(t.headers, row, "fr", "fr id", "requirement", "id");
		if (!frRef || /^nfr/i.test(frRef)) return [];
		const phaseRaw = Number(val(t.headers, row, "phase") ?? "1");
		return [{
			id: frRef,
			frRef,
			afRef: val(t.headers, row, "af", "design", "design element"),
			tcRef: val(t.headers, row, "tc", "tests", "test cases", "test"),
			phase: Number.isFinite(phaseRaw) && phaseRaw > 0 ? phaseRaw : 1,
			targetSha256: val(t.headers, row, "target sha-256", "fingerprint", "sha-256") ?? sha256Hex(`${i}|${frRef}`),
		}];
	});
	if (rtmRow.length === 0) return null;
	return { payload: { rtmRow }, source: src.path };
}

function loadFeasibility(projectName: string, cwd: string): LegacyLoad | null {
	const src = readLegacyMarkdown(projectName, cwd, "feasibility-study");
	const tables = src ? parseMarkdownTables(src.markdown) : [];

	// Decision row: study table first, then the code-generated record (D9).
	let feasibilityDecision: Record<string, unknown> | undefined;
	const decisionT = findTable(tables, /decision/i, [["verdict"]]);
	const record = loadFeasibilityRecord(cwd, projectName);
	if (decisionT) {
		for (const row of decisionT.rows) {
			const verdict = val(decisionT.headers, row, "verdict");
			if (!verdict || !LEGAL_VERDICTS.has(verdict)) continue;
			feasibilityDecision = {
				verdict,
				language: val(decisionT.headers, row, "language"),
				decidedBy: val(decisionT.headers, row, "decided by", "decidedby") ?? "backfill",
				at: val(decisionT.headers, row, "at", "decided at") ?? new Date().toISOString(),
				webSearchConsent: /yes/i.test(val(decisionT.headers, row, "web consent", "web search consent") ?? "") ? 1 : 0,
			};
			break;
		}
	}
	if (!feasibilityDecision && record && LEGAL_VERDICTS.has(record.verdict)) {
		feasibilityDecision = {
			verdict: record.verdict,
			language: record.selectedLanguage ?? null,
			decidedBy: "backfill",
			at: new Date().toISOString(),
			webSearchConsent: 0,
		};
	}

	const spikeT = findTable(tables, /spike/i, [["language"]]);
	const feasibilitySpike = (spikeT?.rows ?? []).flatMap((row) => {
		const language = val(spikeT!.headers, row, "language");
		if (!language) return [];
		const passed = /yes|pass/i.test(val(spikeT!.headers, row, "passed") ?? "") ? 1 : 0;
		return [{ language, passed: passed as 0 | 1, resultRef: val(spikeT!.headers, row, "result ref", "result") }];
	});

	const reuseT = findTable(tables, /reuse/i, [["candidate"], ["verdict"]]);
	const reuseScan = (reuseT?.rows ?? []).flatMap((row) => {
		const candidate = val(reuseT!.headers, row, "candidate");
		const verdict = val(reuseT!.headers, row, "verdict");
		if (!candidate || !verdict) return [];
		return [{
			candidate,
			license: val(reuseT!.headers, row, "license"),
			repoFreshness: val(reuseT!.headers, row, "freshness", "repo freshness"),
			verdict,
		}];
	});

	const payload: Record<string, unknown> = {
		...(feasibilityDecision ? { feasibilityDecision } : {}),
		...(feasibilitySpike.length ? { feasibilitySpike } : {}),
		...(reuseScan.length ? { reuseScan } : {}),
	};
	if (payloadRowCount(payload as ArtifactPayload) === 0) return null;
	return {
		payload: payload as ArtifactPayload,
		source: src ? src.path : "feasibility-decision record",
	};
}

function loadDesign(projectName: string, cwd: string): LegacyLoad | null {
	const src = readLegacyMarkdown(projectName, cwd, "design");
	if (!src) return null;
	const tables = parseMarkdownTables(src.markdown);

	const moduleT = findTable(tables, /module/i, [["id"], ["name"]]);
	const designModule = (moduleT?.rows ?? []).flatMap((row) => {
		const id = val(moduleT!.headers, row, "id");
		const name = val(moduleT!.headers, row, "name");
		if (!id || id === "Module") return [];
		return [{ id, name: name ?? id, description: prose(val(moduleT!.headers, row, "description")) }];
	});

	const srcFrT = findTable(tables, /source fr/i, [["module"], ["fr"]]);
	const moduleSourceFr = (srcFrT?.rows ?? []).flatMap((row) => {
		const moduleId = val(srcFrT!.headers, row, "module");
		const frId = val(srcFrT!.headers, row, "fr");
		return moduleId && frId ? [{ moduleId, frId }] : [];
	});

	const adrT = findTable(tables, /adr/i, [["id"], ["status"]]);
	const adr = (adrT?.rows ?? []).flatMap((row) => {
		const id = val(adrT!.headers, row, "id");
		const status = (val(adrT!.headers, row, "status") ?? "").toLowerCase();
		if (!id || !LEGAL_ADR_STATUS.has(status)) return [];
		return [{
			id,
			adrStatus: status as "proposed" | "accepted" | "superseded" | "rejected",
			options: val(adrT!.headers, row, "options") ?? "",
			chosen: val(adrT!.headers, row, "chosen"),
			rationale: val(adrT!.headers, row, "rationale"),
		}];
	});

	// Diagrams: `### <id> (<kind>)` headings followed by ```mermaid fences.
	const diagram: { id: string; diagramKind: string; mermaidText: string }[] = [];
	const dRe = /^#{2,4}\s+(?:Diagram\s+)?(\S+)\s+\(([^)]+)\)\s*$/;
	const dLines = src.markdown.split(/\r?\n/);
	for (let i = 0; i < dLines.length; i++) {
		const m = dRe.exec(dLines[i]!);
		if (!m) continue;
		const fenceStart = dLines.slice(i + 1).findIndex((l) => l.trim().startsWith("```mermaid"));
		if (fenceStart < 0) continue;
		const from = i + 2 + fenceStart;
		const end = dLines.slice(from).findIndex((l) => l.trim() === "```");
		if (end < 0) continue;
		diagram.push({ id: m[1]!, diagramKind: m[2]!, mermaidText: dLines.slice(from, from + end).join("\n") });
	}

	const appT = findTable(tables, /approach/i, [["module"], ["tactic"]]);
	const approach = (appT?.rows ?? []).flatMap((row) => {
		const moduleId = val(appT!.headers, row, "module");
		const tacticId = val(appT!.headers, row, "tactic");
		return moduleId && tacticId ? [{ moduleId, tacticId }] : [];
	});

	const payload: Record<string, unknown> = {
		...(designModule.length ? { designModule } : {}),
		...(moduleSourceFr.length ? { moduleSourceFr } : {}),
		...(adr.length ? { adr } : {}),
		...(diagram.length ? { diagram } : {}),
		...(approach.length ? { approach } : {}),
	};
	if (payloadRowCount(payload as ArtifactPayload) === 0) return null;
	return { payload: payload as ArtifactPayload, source: src.path };
}

function loadAtomicFunctions(projectName: string, cwd: string): LegacyLoad | null {
	// Sidecar/engine first (AfData shape is validated by af-data.ts).
	const data = loadAfDataForEngine(cwd, projectName);
	if (data && data.functions.length > 0) {
		const tier = data.tier && LEGAL_TIERS.has(data.tier) ? data.tier : "basic";
		const atomicFunction = data.functions.map((fn) => {
			const criticality = String(fn.criticality ?? "");
			const silRaw = String(fn.sil ?? "").toLowerCase();
			return {
				id: fn.afId,
				name: fn.name,
				signature: fn.signature ?? "",
				tier,
				criticality: (LEGAL_CRITICALITY.has(criticality) ? criticality : "A") as "A" | "B" | "C",
				sil: (LEGAL_SIL.has(silRaw) ? silRaw : "none") as "none" | "sil-1" | "sil-2" | "sil-3" | "sil-4",
				isLeaf: (fn.isLeaf === 1 || fn.isLeaf === true ? 1 : 0) as 0 | 1,
				purpose: fn.purpose ?? null,
				source: fn.source ?? null,
				cohesion: fn.cohesion ?? null,
				verification: fn.verification ?? null,
				testable: fn.testable ?? null,
			};
		});
		return { payload: { atomicFunction }, source: "atomic-functions sidecar" };
	}
	// Markdown fallback — the AF catalog table.
	const src = readLegacyMarkdown(projectName, cwd, "atomic-functions");
	if (!src) return null;
	const t = findTable(parseMarkdownTables(src.markdown), null, [["id", "af id", "af"], ["name"]]);
	if (!t) return null;
	const atomicFunction = t.rows.flatMap((row) => {
		const id = val(t.headers, row, "id", "af id", "af");
		if (!id || !/^AF-\d+$/.test(id)) return [];
		const tierRaw = (val(t.headers, row, "tier") ?? "basic").toLowerCase();
		const criticality = (val(t.headers, row, "criticality") ?? "A").toUpperCase();
		const silRaw = (val(t.headers, row, "sil") ?? "none").toLowerCase();
		return [{
			id,
			name: val(t.headers, row, "name") ?? id,
			signature: val(t.headers, row, "signature") ?? "",
			tier: (LEGAL_TIERS.has(tierRaw) ? tierRaw : "basic") as "entry" | "basic" | "intermediate" | "advanced",
			criticality: (LEGAL_CRITICALITY.has(criticality) ? criticality : "A") as "A" | "B" | "C",
			sil: (LEGAL_SIL.has(silRaw) ? silRaw : "none") as "none" | "sil-1" | "sil-2" | "sil-3" | "sil-4",
			isLeaf: (/^y/i.test(val(t.headers, row, "leaf", "is leaf") ?? "") ? 1 : 0) as 0 | 1,
			purpose: prose(val(t.headers, row, "purpose")),
			source: prose(val(t.headers, row, "source")),
			cohesion: prose(val(t.headers, row, "cohesion")),
			verification: prose(val(t.headers, row, "verification")),
			testable: prose(val(t.headers, row, "testable")),
		}];
	});
	if (atomicFunction.length === 0) return null;
	return { payload: { atomicFunction }, source: src.path };
}

function loadPseudocode(projectName: string, cwd: string): LegacyLoad | null {
	const src = readLegacyMarkdown(projectName, cwd, "pseudocode");
	if (!src) return null;
	// Table form (Phase 5 renderer / skill template).
	const t = findTable(parseMarkdownTables(src.markdown), /pseudocode|block/i, [["id"], ["content", "af"]]);
	const fromTable = (t?.rows ?? []).flatMap((row) => {
		const id = val(t!.headers, row, "id");
		const content = prose(val(t!.headers, row, "content"));
		if (!id || !content) return [];
		return [{ id, afRef: val(t!.headers, row, "af") ?? "", contentHash: sha256Hex(content), content }];
	});
	if (fromTable.length > 0) {
		return { payload: { pseudocodeBlock: fromTable }, source: src.path };
	}
	// Heading form: `### AF-N` (or `## <id> — AF-N`) followed by a fence.
	const lines = src.markdown.split(/\r?\n/);
	const pseudocodeBlock: { id: string; afRef: string; contentHash: string; content: string }[] = [];
	const hRe = /^#{2,4}\s+(?:(\S+)\s+[-—]\s+)?(AF-\d+)\b.*$/;
	for (let i = 0; i < lines.length; i++) {
		const m = hRe.exec(lines[i]!);
		if (!m) continue;
		const fenceAt = lines.slice(i + 1, i + 4).findIndex((l) => l.trim().startsWith("```"));
		if (fenceAt < 0) continue;
		const from = i + 2 + fenceAt;
		const end = lines.slice(from).findIndex((l) => l.trim() === "```");
		if (end < 0) continue;
		const content = lines.slice(from, from + end).join("\n");
		if (!content) continue;
		pseudocodeBlock.push({
			id: m[1] && m[1] !== m[2] ? m[1] : `PC-${pseudocodeBlock.length + 1}`,
			afRef: m[2]!,
			contentHash: sha256Hex(content),
			content,
		});
	}
	if (pseudocodeBlock.length === 0) return null;
	return { payload: { pseudocodeBlock }, source: src.path };
}

function loadTestplan(projectName: string, cwd: string): LegacyLoad | null {
	// Row tables live in the test-cases doc; the test-plan doc is the
	// strategy prose view (no rows of its own).
	const cases = readLegacyMarkdown(projectName, cwd, "test-cases")
		?? readLegacyMarkdown(projectName, cwd, "test-plan");
	if (!cases) return null;
	const tables = parseMarkdownTables(cases.markdown);

	const baseT = findTable(tables, /test case/i, [["id", "tc id"], ["kind", "type"]])
		?? findTable(tables, null, [["id", "tc id"], ["kind", "type"]]);
	if (!baseT) return null;

	// Steps/objective/expected: same table when present, else the "Test Steps" table.
	const stepsT = findTable(tables, /step/i, [["tc", "id"], ["steps", "expected"]]);
	const stepByTc = new Map<string, { steps: string | null; expected: string | null; objective: string | null }>();
	const collect = (t: ParsedTable | null): void => {
		if (!t) return;
		for (const row of t.rows) {
			const tc = val(t.headers, row, "tc", "id", "tc id");
			if (!tc) continue;
			stepByTc.set(tc, {
				steps: prose(val(t.headers, row, "steps")),
				expected: prose(val(t.headers, row, "expected")),
				objective: prose(val(t.headers, row, "objective")),
			});
		}
	};
	collect(baseT);
	collect(stepsT);

	const testCase = baseT.rows.flatMap((row) => {
		const id = val(baseT.headers, row, "id", "tc id");
		if (!id) return [];
		const kindRaw = (val(baseT.headers, row, "kind", "type") ?? "TC").toUpperCase();
		const extra = stepByTc.get(id);
		return [{
			id,
			tcKind: (kindRaw === "IT" ? "IT" : "TC") as "TC" | "IT",
			strategyRef: val(baseT.headers, row, "strategy", "strategy ref"),
			steps: extra?.steps ?? prose(val(baseT.headers, row, "steps")),
			objective: extra?.objective ?? prose(val(baseT.headers, row, "objective")),
			expected: extra?.expected ?? prose(val(baseT.headers, row, "expected")),
		}];
	});
	if (testCase.length === 0) return null;

	const traceT = findTable(tables, /trace/i, [["tc"], ["target"]]);
	const tcTrace = (traceT?.rows ?? []).flatMap((row) => {
		const tcId = val(traceT!.headers, row, "tc");
		const targetKind = (val(traceT!.headers, row, "target kind") ?? "").toLowerCase();
		const targetId = val(traceT!.headers, row, "target id", "target");
		if (!tcId || !targetId || !["fr", "nfr", "af"].includes(targetKind)) return [];
		return [{ tcId, targetKind: targetKind as "fr" | "nfr" | "af", targetId }];
	});

	return {
		payload: { testCase, ...(tcTrace.length ? { tcTrace } : {}) },
		source: cases.path,
	};
}

function loadDevelopmentOrder(projectName: string, cwd: string): LegacyLoad | null {
	const src = readLegacyMarkdown(projectName, cwd, "development-order");
	if (!src) return null;
	const tables = parseMarkdownTables(src.markdown);

	const stepT = findTable(tables, /step/i, [["id", "step"], ["module"]]);
	const devStep = (stepT?.rows ?? []).flatMap((row) => {
		const id = val(stepT!.headers, row, "id", "step");
		const module = val(stepT!.headers, row, "module");
		if (!id || !module) return [];
		return [{ id, module, description: prose(val(stepT!.headers, row, "description")) }];
	});
	if (devStep.length === 0) return null;

	const afT = findTable(tables, /atomic|af/i, [["step"], ["af"]]);
	const stepAf = (afT?.rows ?? []).flatMap((row) => {
		const stepId = val(afT!.headers, row, "step");
		const afId = val(afT!.headers, row, "af");
		return stepId && afId ? [{ stepId, afId }] : [];
	});

	const depT = findTable(tables, /depend/i, [["step"], ["depends on", "depends"]]);
	const stepIds = new Set(devStep.map((s) => s.id));
	const stepDep = (depT?.rows ?? []).flatMap((row) => {
		const stepId = val(depT!.headers, row, "step");
		// Only real edges: the renderer prints "—" for "no dependency".
		const dependsOnId = val(depT!.headers, row, "depends on", "depends");
		return stepId && dependsOnId && stepIds.has(stepId) && stepIds.has(dependsOnId)
			? [{ stepId, dependsOnId }]
			: [];
	});

	return {
		payload: {
			devStep,
			...(stepAf.length ? { stepAf } : {}),
			...(stepDep.length ? { stepDep } : {}),
		},
		source: src.path,
	};
}

function loadFinalDesign(projectName: string, cwd: string): LegacyLoad | null {
	const src = readLegacyMarkdown(projectName, cwd, "final-design");
	if (!src) return null;
	// Table form.
	const t = findTable(parseMarkdownTables(src.markdown), /section/i, [["no", "#"], ["title"]]);
	const fromTable = (t?.rows ?? []).flatMap((row) => {
		const no = Number(val(t!.headers, row, "no", "#") ?? "NaN");
		const title = val(t!.headers, row, "title");
		if (!Number.isFinite(no) || !title) return [];
		return [{
			no,
			title,
			sourceArtifact: val(t!.headers, row, "source artifact", "source") ?? "design",
			sourceIds: val(t!.headers, row, "source ids") ?? "[]",
		}];
	});
	if (fromTable.length > 0) {
		return { payload: { finalSection: fromTable }, source: src.path };
	}
	// Prose form: `## 1. Overview` headings.
	const finalSection: { no: number; title: string; sourceArtifact: string; sourceIds: string }[] = [];
	for (const line of src.markdown.split(/\r?\n/)) {
		const m = /^#{2,3}\s+(\d+)\.\s+(.+)$/.exec(line);
		if (!m) continue;
		finalSection.push({ no: Number(m[1]), title: m[2]!.trim(), sourceArtifact: "design", sourceIds: "[]" });
	}
	if (finalSection.length === 0) return null;
	return { payload: { finalSection }, source: src.path };
}

// ---------------------------------------------------------------------------
// backfillKind — the single entry point (§14.5).
// ---------------------------------------------------------------------------

/** Store kind → the envelope `stage` it is imported under. */
const KIND_STAGE: Record<ArtifactKind, string> = {
	prd: "drafting-prd",
	rtm: "building-rtm",
	feasibility: "analyzing-feasibility",
	design: "designing",
	"atomic-functions": "analyzing-atomic-functions",
	pseudocode: "writing-pseudocode",
	testplan: "planning-tests",
	"development-order": "ordering-development",
	"final-design": "finalizing-design",
};

const LOADERS: Record<ArtifactKind, (projectName: string, cwd: string) => LegacyLoad | null> = {
	prd: loadPrd,
	rtm: loadRtm,
	feasibility: loadFeasibility,
	design: loadDesign,
	"atomic-functions": loadAtomicFunctions,
	pseudocode: loadPseudocode,
	testplan: loadTestplan,
	"development-order": loadDevelopmentOrder,
	"final-design": loadFinalDesign,
};

/**
 * Upstream kind required by each kind's run-scoped cross-kind FKs
 * (db-schema.ts): rtm_row.fr_ref → fr; module_source_fr.fr_id → fr;
 * pseudocode_block.af_ref + step_af.af_id → atomic_function. Kinds not
 * listed here are self-contained within their own kind.
 */
const FK_UPSTREAM: Partial<Record<ArtifactKind, ArtifactKind>> = {
	rtm: "prd",
	design: "prd",
	pseudocode: "atomic-functions",
	"development-order": "atomic-functions",
};

export interface BackfillResult {
	ok: boolean;
	kind: ArtifactKind;
	/** Human summary — always non-empty; the command notifies it verbatim. */
	note: string;
	rowCount: number;
}

/**
 * Import one kind's legacy published artifact into the project store
 * (decision 3 recovery path). Store-only: no Doc/ write, no stage advance,
 * no git commit. Idempotent: an already-published kind is a no-op note.
 *
 * Chain: idempotent check → parse legacy (sidecar-first) → writeArtifact →
 * verifyExportChecksum → publishArtifact → checkpointNow.
 *
 * @param cwd - Project root.
 * @param projectName - Project whose store to import into.
 * @param kind - Store kind (KIND_ORDER member).
 * @param runId - Import run id (command generates a timestamped one).
 */
export function backfillKind(
	cwd: string,
	projectName: string,
	kind: ArtifactKind,
	runId: string,
): BackfillResult {
	if (!KIND_ORDER.includes(kind)) {
		return {
			ok: false,
			kind,
			note: `unknown kind '${kind}' — expected one of: ${KIND_ORDER.join(", ")}`,
			rowCount: 0,
		};
	}
	const existing = readLatestPublishedRows(cwd, projectName, kind);
	if (existing) {
		return {
			ok: true,
			kind,
			note: `already present in the store (run ${existing.envelope.runId} v${existing.envelope.version}) — no-op.`,
			rowCount: 0,
		};
	}
	const loaded = LOADERS[kind](projectName, cwd);
	if (!loaded) {
		return {
			ok: false,
			kind,
			note:
				`no parseable legacy source found for '${kind}' (looked for published Doc/ markdown + sidecar for ${projectName}). ` +
				`Run the stage and publish it, or place the legacy artifact, then retry /velpari-backfill ${kind}.`,
			rowCount: 0,
		};
	}
	const rowCount = payloadRowCount(loaded.payload);
	if (rowCount === 0) {
		return {
			ok: false,
			kind,
			note: `'${kind}' legacy source parsed to zero rows (${loaded.source}) — refusing an empty import. Run the stage and publish it instead.`,
			rowCount: 0,
		};
	}

	const dbPath = buildStoreDbPath(projectName, cwd);
	const db = openStoreDb(dbPath);
	try {
		const envelope: ArtifactEnvelopeInput = {
			version: 1,
			stage: KIND_STAGE[kind],
			generatedAt: new Date().toISOString(),
			inputs: "{}",
			reviewerVerdict: null,
			changeLog: JSON.stringify([`Backfilled by /velpari-backfill from ${loaded.source}.`]),
		};
		try {
			writeArtifact(db, kind, runId, envelope, loaded.payload);
		} catch (err) {
			// Run-scoped cross-kind FKs: rtm/design reference fr,
			// pseudocode/development-order reference atomic_function — all in
			// the SAME run id. A missing upstream is a LOUD, actionable
			// refusal (never a raw SQLITE_CONSTRAINT).
			const upstream = FK_UPSTREAM[kind];
			const isFk = /FOREIGN KEY/i.test(String(err));
			if (isFk && upstream) {
				return {
					ok: false,
					kind,
					note:
						`rows reference upstream '${upstream}' rows that are not imported yet (run-scoped FK). ` +
						`Import it first: /velpari-backfill ${upstream}, then retry /velpari-backfill ${kind}.`,
					rowCount,
				};
			}
			throw err;
		}
		const check = verifyExportChecksum(db, runId, kind);
		if (!check.ok) {
			return {
				ok: false,
				kind,
				note: `checksum verify failed after write (expected ${check.expected}, got ${check.actual}) — artifact left as draft; run /velpari-reset or retry.`,
				rowCount,
			};
		}
		publishArtifact(db, runId, kind);
		checkpointNow(db);
		return {
			ok: true,
			kind,
			note: `imported ${rowCount} row(s) from ${loaded.source} as run ${runId} v1 (published).`,
			rowCount,
		};
	} finally {
		closeStoreDb(db);
	}
}

