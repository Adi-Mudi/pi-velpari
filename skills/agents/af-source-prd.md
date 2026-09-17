---
name: af-source-prd
description: ATOMIC FROM PRD (atomic-function stage) — read the PRD and propose atomic helper functions per FR-N (small reusable functions that satisfy a single FR). Writes a structured JSON report.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# ATOMIC FROM PRD (atomic-function stage)

Read the PRD (`<inputArtifact>`) and propose atomic helper functions
per FR-N. An atomic function here is a small, reusable function that
satisfies a single FR's acceptance criteria and can be unit-tested in
isolation.

## Inputs (in your task)

- `<inputArtifact>` — the PRD markdown
- `<scoutReportPath>` — path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`. Fill the **tier-aware** fields
when the prompt declares tier ≥ Intermediate (you will see a
`## Atomic Profile` block listing the required fields):

```json
{
  "proposals": [
    {
      "id": "af-source-prd-NN",
      "source": "af-source-prd",
      "payload": {
        "afId": "AF-1",
        "name": "hashPassword",
        "filePath": "src/auth/hash-password.ts",
        "signature": "function hashPassword(plain: string, cost: number): Promise<string>",
        "purpose": "Hashes a password with bcrypt at the given cost factor",
        "source": "PRD FR-1 (acceptance criterion AC-3)",
        "cohesion": "perfect-atomic",
        "verification": "Test",
        "testable": true,
        "satisfiesFrId": "FR-1",
        "acceptanceRef": "AC-3",
        "earsPattern": "Ubiquitous",
        "inputs": "plain:string, cost:number",
        "outputs": "Promise<string>",
        "errors": ["empty plain","cost out of range"],
        "dependencies": [],
        "dbOrIo": "none",
        "complexity": 4,
        "coupling": "low",
        "argCount": 2,
        "oneLevelAbstr": "yes",
        "nameIntent": "verb-noun, descriptive"
      }
    }
  ],
  "source": "af-source-prd",
  "timestamp": "ISO-8601"
}
```

Always fill the base-core fields (afId, name, filePath, signature, purpose,
source, cohesion, verification, testable). Fill tier-specific fields only
when the prompt declares a tier that requires them. Empty string for fields
the scout cannot determine.

## Heuristics

- One atomic per FR-N's acceptance criterion (or per logical sub-step).
- Function signature should be testable (deterministic input → output).
- Don't propose atoms for things the standard library provides (e.g. JSON.parse).

## Hard rules

- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`.
- Use `session-mode: standalone`.
- Final message ≤ 10 lines: outcome + artifact path.