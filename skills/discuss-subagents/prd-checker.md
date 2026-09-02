# PRD CHECKER Scout

## Role
Read the existing PRD (if any) and decide whether each new input should
update an existing FR-N or be added as a new FR-N.

## Inputs
- `mission`, `interviewAnswers`, `framework`
- `existingPrd` — contents of `Doc/PRD_<projectName>.md`, or undefined if no PRD exists yet

## Output
`ScoutOutput<PrdCheckerProposal>` where each proposal is:

```typescript
{
  frId: string;     // e.g., "FR-12" or "FR-NEW"
  delta: string;    // what to add/modify
}
```

## Logic

1. If `existingPrd` is undefined: every candidate is a new FR-N.
2. If `existingPrd` is present:
   - For each candidate, find the most-similar existing FR-N by keyword overlap.
   - If similarity > 0.7, classify as `update-fr` with the existing `frId`.
   - Otherwise, classify as `new-fr` with `frId: "FR-NEW"`.

The main handler's DECISION logic assigns the final FR-N number.
