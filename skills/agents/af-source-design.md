---
name: af-source-design
description: ATOMIC FROM DESIGN (atomic-function stage) — read the design doc and find patterns / modules that could be extracted into atomic functions. Writes a structured JSON report.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# ATOMIC FROM DESIGN (atomic-function stage)

Read the design doc (`<inputArtifact>`) and find patterns, modules, or
boundaries that could be extracted into atomic functions. A design-level
atomic candidate is a single, well-defined unit of work identified in the
design that maps cleanly to a leaf function with no further decomposition.

## Inputs (in your task)

- `<inputArtifact>` — the design markdown (Doc/design/design_<projectName>.md)
- `<scoutReportPath>` — path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`. Fill the **tier-aware** fields
when the prompt declares tier ≥ Intermediate (you will see a
`## Atomic Profile` block listing the required fields):

```json
{
  "proposals": [
    {
      "id": "af-source-design-NN",
      "source": "af-source-design",
      "payload": {
        "afId": "AF-1",
        "name": "validateIsoDate",
        "filePath": "src/utils/validate-iso-date.ts",
        "signature": "function validateIsoDate(s: string): boolean",
        "purpose": "Validates ISO 8601 date string with strict format check",
        "source": "design §3.2 Input validation module",
        "cohesion": "perfect-atomic",
        "verification": "Test",
        "testable": true,
        "designRef": "§3.2 Input validation module",
        "earsPattern": "Unwanted",
        "inputs": "s:string",
        "outputs": "boolean",
        "errors": ["empty string","non-ISO format"],
        "dependencies": [],
        "dbOrIo": "none",
        "complexity": 5,
        "coupling": "low",
        "argCount": 1,
        "oneLevelAbstr": "yes",
        "nameIntent": "verb-noun, descriptive"
      }
    }
  ],
  "source": "af-source-design",
  "timestamp": "ISO-8601"
}
```

Always fill the base-core fields (afId, name, filePath, signature, purpose,
source, cohesion, verification, testable). Fill tier-specific fields only
when the prompt declares a tier that requires them. Empty string for fields
the scout cannot determine.

## Heuristics

- Look for: validation routines, parsers, formatters, ID generators, retry loops, error mappers.
- Modules described in the design with a single, well-defined responsibility are atomic candidates.
- Don't propose atoms for things that require orchestration across modules.
- The atomic function should be a leaf — no further decomposition makes sense.

## Hard rules

- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`.
- Use `session-mode: standalone`.
- Final message ≤ 10 lines: outcome + artifact path.
