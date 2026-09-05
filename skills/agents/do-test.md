---
name: do-test
description: DO TEST (development-order stage) — read the test plan and produce a test-coverage priority (modules with the most untested critical paths go first). Writes a structured JSON report.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# DO TEST (development-order stage)

Read the test plan (`<inputArtifact>`) and produce a test-coverage
priority. Modules with the most untested critical paths go first so the
team gets fast feedback on what matters most.

## Inputs (in your task)

- `<inputArtifact>` — the test plan markdown
- `<scoutReportPath>` — path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`:

```json
{
  "proposals": [
    {
      "id": "do-test-NN",
      "source": "do-test",
      "payload": {
        "rank": 1,
        "moduleId": "M-1",
        "name": "auth-service",
        "coveredFRs": ["FR-1"],
        "uncoveredCriticalFRs": ["FR-2", "FR-5"],
        "rationale": "Critical auth path has 2 uncovered FRs — prioritize to close coverage"
      }
    }
  ],
  "source": "do-test",
  "timestamp": "ISO-8601"
}
```

## Heuristics

- Count uncovered FR-Ns per module (FRs without any TC).
- Prioritize modules where uncovered FRs are critical (security, data integrity).
- Modules with full coverage can come later.

## Hard rules

- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`.
- Use `session-mode: standalone`.
- Final message ≤ 10 lines: outcome + artifact path.