---
name: af-source-testcases
description: ATOMIC FROM TEST CASES (atomic-function stage) — read the test cases and propose atomic test helpers (small reusable assertion functions used across multiple test cases). Writes a structured JSON report.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# ATOMIC FROM TEST CASES (atomic-function stage)

Read the test cases (`<inputArtifact>`) and propose atomic test helpers
— small reusable assertion functions used across multiple test cases.

## Inputs (in your task)

- `<inputArtifact>` — the test cases markdown
- `<scoutReportPath>` — path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`:

```json
{
  "proposals": [
    {
      "id": "af-source-testcases-NN",
      "source": "af-source-testcases",
      "payload": {
        "afId": "AF-1",
        "name": "expectValidUser",
        "filePath": "tests/helpers/expect-valid-user.ts",
        "signature": "function expectValidUser(user: User): void",
        "purpose": "Asserts the user object has all required fields and is well-formed",
        "duplicatedIn": ["TC-1", "TC-3", "TC-5"],
        "testable": true
      }
    }
  ],
  "source": "af-source-testcases",
  "timestamp": "ISO-8601"
}
```

## Heuristics

- Assertion repeated in 3+ test cases → atomic helper candidate.
- Common setup (e.g. "createUser + verify + cleanup") → atomic setup helper.
- Don't propose atoms for 1-off assertions.

## Hard rules

- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`.
- Use `session-mode: standalone`.
- Final message ≤ 10 lines: outcome + artifact path.