---
name: velpari-handoff
description: Pi-Velpari Handoff stage — package approved artifacts into `.pi/senai/architect-inputs.json` for Senai. The handler is deterministic file packaging; it does not invoke an LLM. Use when the run is at `planned-tests` or `ordered-development`.
---

# velpari-handoff — Stage Prompt

## Purpose

Document-only prompt template. The handoff handler (`pi-extension/src/handoff.ts`) is deterministic file packaging — it does not invoke an LLM. This skill file exists for documentation and for any future LLM-driven transformation steps.

## Source

State must be at `planned-tests` or `ordered-development`.

## Required Artifacts (must all exist)

| Type | Doc/ path |
|---|---|
| PRD | `Doc/PRD_<projectName>.md` |
| RTM | `Doc/RTM_<projectName>.md` |
| Feasibility Study | `Doc/feasibility-study_<projectName>.md` |
| Design | `Doc/design_<projectName>.md` |
| Pseudocode | `Doc/pseudocode_<projectName>.md` |
| Test Plan | `Doc/test-plan_<projectName>.md` |
| Test Cases | `Doc/test-cases_<projectName>.md` |

## Optional Artifacts (included when present, per FR-34)

| Type | Doc/ path |
|---|---|
| Atomic Functions | `Doc/atomic-functions_<projectName>.md` |
| Development Order | `Doc/development-order_<projectName>.md` |

## Output

Write to `.pi/senai/architect-inputs.json`. Schema (version 1):

```typescript
interface ArchitectInputs {
  version: 1;
  projectName: string;
  createdAt: string;        // ISO 8601 timestamp
  mission: string;           // from run state
  documents: ArchitectDocument[];
}

interface ArchitectDocument {
  type: DocumentType;
  path: string;              // relative to project root
  // PHASE-D (N29) — store-backed version metadata (additive; the keys are
  // always emitted since N29. null = no store row for that kind; the
  // payload is written AFTER the N4 freeze, so frozen documents carry
  // `frozen: true` + `freezeReason: "handoff (N4)"` truthfully.)
  version?: number | null;         // store envelope version (artifacts.version)
  revisionId?: number | null;      // head artifact_revisions.revision_id handed off
  revisionNumber?: number | null;  // monotonic revision number of that head
  frozen?: boolean;                // freeze state at handoff (N4)
  freezeReason?: string | null;    // "handoff (N4)" when frozen
}

type DocumentType =
  | "PRD" | "RTM" | "Feasibility Study" | "Design" | "Pseudocode"
  | "Test Plan" | "Test Cases"
  | "Atomic Functions" | "Development Order" | "Final Design"
  // PHASE-D (N26) — optional 11th entry, presence-driven: appended only
  // when a wireframe exists (projectType "full-app") — the published
  // `Doc/design/wireframe_<projectName>.md`, else the run's durable
  // working copy. Absent on backend/legacy projects (exactly 10 docs).
  | "Wireframe";
```

The N29 per-document fields are additive: the chirpi consumer accepts
unknown fields, the payload `version` stays 1, and a legacy payload
without the keys still passes `validateSenaiSchema`.

## Cross-Extension Compatibility

Per AGENTS.md §Cross-extension compatibility: the `architect-inputs.json` schema is owned by `@adi-mudi/pi-chirpi` (`pi-chirpi/pi-extension/src/architect/inputs-config.ts`). When that schema evolves, update `validateSenaiSchema` in `handoff.ts` in lockstep.

## Preview Gate

After building the JSON but before writing to `.pi/senai/`, render preview and ask user to confirm.
