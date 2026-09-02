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
}

type DocumentType =
  | "PRD" | "RTM" | "Feasibility Study" | "Design" | "Pseudocode"
  | "Test Plan" | "Test Cases"
  | "Atomic Functions" | "Development Order";
```

## Cross-Extension Compatibility

Per AGENTS.md §Cross-extension compatibility: when Senai's schema in `Pi-Orchestra_v4/pi-extension/src/architect-inputs-config.ts` evolves, update `validateSenaiSchema` in `handoff.ts` in lockstep.

## Preview Gate

After building the JSON but before writing to `.pi/senai/`, render preview and ask user to confirm.
