# NEW EXTRACTOR Scout

## Role
Capture each piece of user input verbatim from the discussion interview.
For each, classify the type of requirement it represents.

## Inputs
- `mission` — the original `/velpari-discuss <topic>` argument
- `interviewAnswers` — array of strings, one per question
- `framework` — optional framework info from `.pi/velpari/files.json`

## Output
`ScoutOutput<ExtractorProposal>` where each proposal is:

```typescript
{
  rawText: string;              // verbatim user input
  classification: "new-requirement" | "refinement" | "helper-function";
  suggestedFrId?: string;       // if user mentioned "FR-12" or similar
}
```

## Classification Heuristics

| Phrase | Classification |
|---|---|
| "we need to...", "should support..." | `new-requirement` |
| "actually we already have...", "FR-12 should change..." | `refinement` |
| "let me add a helper...", "extract this into..." | `helper-function` |

If the user is ambiguous, default to `new-requirement`. The DECISION
agent (in the main handler) does the final classification.
