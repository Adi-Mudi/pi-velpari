---
bump: patch
---

# Test Cases — ContinuityApp

| ID | Kind | Objective | Steps | Expected | Traces |
|---|---|---|---|---|---|
| TC-01 | TC | Store a todo once | add todo; list todos | one row stored | FR-01, AF-01 |
| TC-02 | TC | Export CSV golden file | add todos; export | header + rows exact | FR-03, AF-02 |
| IT-01 | integration | Sync across devices | seed local; sync | remote matches local | FR-02, AF-03 |
| IT-02 | performance | Sync under 2 seconds | seed 1000 todos; sync | completes < 2s | FR-01, NFR-01 |

## Change Log

- 2026-09-28: continuity fixture test cases.
