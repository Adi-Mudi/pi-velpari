---
name: rtm-consolidator
description: RTM CONSOLIDATOR (rtm stage) — read the other 3 scout reports, build the RTM table, and emit the final RTM structure. Writes a structured JSON report.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# RTM CONSOLIDATOR

Read the other 3 scout reports and build the consolidated Requirements
Traceability Matrix. The RTM has 1 row per FR-N with columns: req id, design element, implementation / helper function, test case(s), coverage status.

## Inputs (in your task)

- `<inputArtifact>` — the PRD markdown
- `<requirement-tracer-report>` — path to the tracer JSON
- `<test-case-linker-report>` — path to the linker JSON
- `<coverage-analyzer-report>` — path to the coverage JSON
- `<scoutReportPath>` — path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`:

```json
{
  "rows": [
    {
      "frId": "FR-1",
      "requirement": "Short title from PRD",
      "designElement": "ModuleName.FunctionName",
      "implementation": "src/path/file.ts:FunctionName",
      "helperFunctions": ["HF-1"],
      "testCases": ["TC-1", "TC-2"],
      "status": "covered|partial|missing"
    }
  ],
  "totals": {
    "frs": 10,
    "covered": 8,
    "partial": 1,
    "missing": 1
  },
  "coverageGaps": ["FR-3", "FR-7"],
  "source": "rtm-consolidator",
  "timestamp": "ISO-8601"
}
```

## Status rules

- `covered` — FR-N has implementation AND at least one test case.
- `partial` — FR-N has implementation OR test case, but not both.
- `missing` — FR-N has neither.

## Hard rules

- One row per FR-N from the PRD.
- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`.
- Use `session-mode: standalone`.
- Final message ≤ 10 lines: outcome + artifact path.