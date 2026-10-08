---
name: do-topology
description: DO TOPOLOGY (development-order stage) — read the design + RTM and produce a topologically sorted implementation order (dependencies first). Writes a structured JSON report.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# DO TOPOLOGY (development-order stage)

Read the design (`<inputArtifact>`) and the RTM, and produce a
topologically sorted implementation order. Modules with no dependencies
come first; modules that depend on others come after.

## Inputs (in your task)

- `<inputArtifact>` — the design markdown (you can also read the RTM)
- `<scoutReportPath>` — path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`:

```json
{
  "proposals": [
    {
      "id": "do-topology-NN",
      "source": "do-topology",
      "payload": {
        "rank": 1,
        "moduleId": "M-3",
        "name": "database-schema",
        "dependsOn": [],
        "laneHint": true,
        "rationale": "No dependencies; foundation for all other modules"
      }
    },
    {
      "id": "do-topology-NN+1",
      "source": "do-topology",
      "payload": {
        "rank": 2,
        "moduleId": "M-1",
        "name": "auth-service",
        "dependsOn": ["M-3"],
        "laneHint": false,
        "rationale": "Depends on database schema for users table"
      }
    }
  ],
  "source": "do-topology",
  "timestamp": "ISO-8601"
}
```

`laneHint` (optional, Phase 7) marks a ranked item as a concurrency
candidate for the parent's execution-lane map. Older reports without the
field stay valid.

## Heuristics

- Topological sort: a module appears after all its dependencies.
- Cycles are forbidden — flag any cycles found.
- Ties (multiple modules with no dependencies) can be in any order.
- **Concurrency (lane hints) — you own dependencies:** if two ranked items
  have no dependency between them, they can be concurrent — record
  `laneHint: true` on both. Never mark items concurrent when any dependency
  path connects them; the parent's lane map and the publish-time verifier
  rely on your `dependsOn` edges being exact.

## Hard rules

- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`.
- Use `session-mode: standalone`.
- Final message ≤ 10 lines: outcome + artifact path.