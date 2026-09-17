---
name: design-style-selector
description: STYLE SELECTOR (design stage) — read the §5 Quality Attribute Scenarios from the contract-definer report + feasibility study + standards overlay and pick the architectural style. Writes the candidate ranking and chosen style, with the chosen tactics per QA scenario. Writes a JSON report and acts as ADR-001's source data.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# STYLE SELECTOR (design stage)

This scout runs **first** in the design stage, before the 4 base
scouts. It performs **the architectural act** (per SEI Attribute-Driven
Design, step 4 — tactic selection per ASR).

Reads:
- The §5 QA scenarios from `design-contract-definer-report.json`
- The Phase 0 feasibility study + its verdict + chosen language
- The standards overlay (`.pi/velpari/standards-profile.json`)
- The framework config (`.pi/velpari/files.json:framework`)

Produces:
- A ranked list of candidate architectural styles
- The chosen style (id + label)
- The chosen tactic per QA scenario (cross-referenced to
  `tactic-catalog.ts`)

## Inputs (in your task)

- `<inputArtifact>` — feasibility study
- `<contract-definer-report>` — path to the contract-definer JSON
- `<scoutReportPath>` — path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`:

```json
{
  "proposals": [
    {
      "id": "design-style-selector-NN",
      "source": "design-style-selector",
      "payload": {
        "topic": "<candidate style>",
        "score": "<n>"
      }
    }
  ],
  "candidateStyles": [
    { "id": "<style id>", "label": "<label>", "score": "<n>", "favouredFor": ["<QA ids>"] }
  ],
  "chosenStyle": {
    "id": "<style id>",
    "label": "<style label>",
    "rationale": "<why this style over the runner-up; cite QA scenarios>"
  },
  "tacticsByQA": [
    { "nfrId": "NFR-1", "tactic": "<tactic id>", "rationale": "<why>" }
  ],
  "source": "design-style-selector",
  "timestamp": "ISO-8601"
}
```

The parent LLM renders:
- `chosenStyle` into ADR-001 `decision` (matched by label).
- `candidateStyles` into ADR-001 `options` (the runner-ups are the
  *not chosen* styles).
- `tacticsByQA` into the design §5 QA scenario `Approach` cell.

## Heuristics

- Use the core/style-catalog.ts scoring: each style has a list of
  QAs it favours / disfavours. Pick by net score, not by one big QA.
- Always emit at least 2 candidate styles in `candidateStyles`
  (required by `validateFirstADR`).
- Pick exactly one tactic per QA scenario from
  core/tactic-catalog.ts. The catalog is small and curated;
  do not invent tactic names.
- Reuse > Replace: if the feasibility study names a target stack
  (Cloud, On-prem, etc.), respect it. The chosen style must be
  compatible.

## Hard rules

- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`.
- Use `session-mode: standalone`.
- Final message ≤ 10 lines: outcome + artifact path.
