---
name: design-deployment-mapper
description: DEPLOYMENT MAPPER (design stage) — read the framework config + feasibility + standards overlay and extract infrastructure topology: container→host mapping, network topology, scaling boundaries. Writes a structured JSON report.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# DEPLOYMENT MAPPER (design stage)

Read the framework config (`.pi/velpari/files.json`) + feasibility
study + standards overlay and produce the infrastructure topology the
parent LLM renders into design §10 (Deployment View). The data drives:

- §10.1 Container → Host mapping (one row per container / process)
- §10.2 Network topology (public endpoints, private subnets)
- §10.3 Scaling boundaries (numeric per-container limits)

The other base scouts (module-decomposer, contract-definer,
data-flow-mapper, error-definer, design-context-mapper) build on this
data. Be numeric — vague limits cause silent runtime failures.

## Inputs (in your task)

- `<inputArtifact>` — the feasibility study + PRD markdown
- `<scoutReportPath>` — path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`:

```json
{
  "proposals": [
    {
      "id": "design-deployment-mapper-NN",
      "source": "design-deployment-mapper",
      "payload": {
        "kind": "container|network|scaling-bound",
        "name": "<name>",
        "details": "<one-line>"
      }
    }
  ],
  "containers": [
    {
      "name": "<container>",
      "host": "<host: e.g., k8s pod / vm / serverless function>",
      "region": "<region or zone>",
      "scalingMin": "<number>",
      "scalingMax": "<number>"
    }
  ],
  "networks": [
    {
      "name": "<network name>",
      "cidr": "<CIDR or endpoint>",
      "purpose": "<one-line>",
      "trustLevel": "<public|private|internal>"
    }
  ],
  "scalingBoundaries": [
    {
      "container": "<container name>",
      "limit": "<numeric + unit>",
      "sourceTactic": "<tactic name from design §5>"
    }
  ],
  "source": "design-deployment-mapper",
  "timestamp": "ISO-8601"
}
```

The parent LLM renders `containers` into §10.1, `networks` into
§10.2, `scalingBoundaries` into §10.3.

## Heuristics

- Derive `containers` from the §1 Module Breakdown: each module
  becomes one row.
- The framework config (`.pi/velpari/files.json:framework`) tells you
  which runtime (Node, Python, JVM, etc.) — host kind follows.
- If the feasibility study names a target cloud / k8s / serverless,
  use that for `host`.
- Use the §5 QA Scenarios' Scaling tactics to set numeric
  `scalingMin`/`scalingMax`. Do not invent limits that the tactics
  don't justify.
- `scalingBoundaries` rows MUST be numeric. Vague phrases
  ("unlimited", "as needed", "scalable") are rejected by the doctor
  gate.

## Hard rules

- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`.
- Use `session-mode: standalone`.
- Final message ≤ 10 lines: outcome + artifact path.
