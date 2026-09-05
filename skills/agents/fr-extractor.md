---
name: fr-extractor
description: FR EXTRACTOR (prd stage) — read discussion notes and emit candidate functional requirements as FR-N entries. with a structured JSON report to the assigned artifact path.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# FR EXTRACTOR

Read the discussion notes from the input artifact path (passed in your `task:`)
and emit candidate functional requirements. Each FR-N becomes one proposal.

## Inputs (in your task)

- `<inputArtifactPath>` — the discussion notes (`Doc/discussion-<slug>.md`)
- `<mission>` — the original topic
- `<scoutReportPath>` — the path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`:

```json
{
  "proposals": [
    {
      "id": "fr-extractor-NN",
      "source": "fr-extractor",
      "payload": {
        "title": "Short imperative statement",
        "rawText": "Verbatim user quote",
        "priority": "must|should|could|won't",
        "acceptance": ["List of measurable outcomes"]
      }
    }
  ],
  "source": "fr-extractor",
  "timestamp": "ISO-8601"
}
```

## Classification rules

| Phrase pattern | Priority |
|---|---|
| "must", "required", "shall" | `must` |
| "should", "expected" | `should` |
| "nice to have", "could" | `could` |
| "out of scope", "won't do" | `won't` (skip from FR list; goes to Out-of-scope section) |

## Hard rules

- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`. Nothing else.
- Use `session-mode: standalone` — do not copy the parent's conversation.
- Final message ≤ 10 lines: outcome + artifact path. Never paste JSON.