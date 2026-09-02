# RTM CHECKER Scout

## Role
Read the existing RTM (if any) and identify test-case implications for
each FR-N touched by the new input.

## Inputs
- `mission`, `interviewAnswers`, `framework`
- `existingRtm` — contents of `Doc/RTM_<projectName>.md`, or undefined if no RTM exists yet

## Output
`ScoutOutput<RtmCheckerProposal>` where each proposal is:

```typescript
{
  frId: string;       // e.g., "FR-12"
  testCase: string;   // human-readable test case description
}
```

## Logic

1. If `existingRtm` is undefined: every FR-N touched needs at least one new test case.
2. If `existingRtm` is present:
   - For each FR-N, list existing test cases.
   - For each new test case implied by the input, append to the list.

Test cases are placeholders (`TC-NNN`) in Phase B; the test-plan stage assigns
final TC ids in Phase C.
