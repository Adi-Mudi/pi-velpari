---
name: do-value
description: DO VALUE (development-order stage) — read the PRD and produce a user-value ranking (modules delivering the most user value go first so users get value early). Writes a structured JSON report.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# DO VALUE (development-order stage)

Read the PRD and produce a user-value ranking. Modules that deliver the
most user value (highest priority FRs, most users affected) go first so
users get value early (MVP-driven delivery).

## Inputs (in your task)

- `<inputArtifact>` — the PRD markdown
- `<scoutReportPath>` — path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`:

```json
{
  "proposals": [
    {
      "id": "do-value-NN",
      "source": "do-value",
      "payload": {
        "rank": 1,
        "moduleId": "M-1",
        "name": "auth-service",
        "valueScore": 10,
        "mustFRs": ["FR-1", "FR-2"],
        "usersAffected": "all users",
        "rationale": "Signup is a must-have, blocks all other user flows"
      }
    }
  ],
  "source": "do-value",
  "timestamp": "ISO-8601"
}
```

## Heuristics

- Value = (priority weight) × (number of users affected).
- Must-priority FRs are heavy weights; could-priority is light.
- Modules that block other modules (e.g. auth) are first.

## Hard rules

- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`.
- Use `session-mode: standalone`.
- Final message ≤ 10 lines: outcome + artifact path.