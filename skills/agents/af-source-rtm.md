---
name: af-source-rtm
description: ATOMIC FROM RTM (atomic-function stage) — read the RTM and propose atomic function splits (small leaf functions that could be extracted from helper functions). Writes a structured JSON report.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# ATOMIC FROM RTM (atomic-function stage)

Read the RTM (`<inputArtifact>`) and propose atomic function splits. An
atomic function is a small, leaf-node function that:
- Is called from 2+ different FRs in the RTM
- Has a single clear responsibility
- Can be unit-tested in isolation
- Is NOT itself a "helper" (helpers are tracked separately in the PRD)

## Inputs (in your task)

- `<inputArtifact>` — the RTM markdown (you can also read the PRD if needed)
- `<scoutReportPath>` — path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`:

```json
{
  "proposals": [
    {
      "id": "af-source-rtm-NN",
      "source": "af-source-rtm",
      "payload": {
        "afId": "AF-1",
        "name": "validateEmail",
        "filePath": "src/utils/validate-email.ts",
        "signature": "function validateEmail(email: string): boolean",
        "purpose": "Validates an email against RFC 5322 (used by createUser + updateUser + newsletterSignup)",
        "calledByFrIds": ["FR-1", "FR-2", "FR-5"],
        "extractedFrom": "HF-3 (validateUserInput)",
        "testable": true
      }
    }
  ],
  "source": "af-source-rtm",
  "timestamp": "ISO-8601"
}
```

## Heuristics

- A helper function that is called from 2+ FRs can usually be split into 1+
  atomic functions.
- Each atomic function has a single test surface.
- Don't propose atoms for helpers that are already atomic-sized (≤10 lines).

## Hard rules

- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`.
- Use `session-mode: standalone`.
- Final message ≤ 10 lines: outcome + artifact path.