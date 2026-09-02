# velpari-rtm — Stage Prompt

## Source
Read `Doc/PRD_<projectName>.md` (gate check — refuse to run if missing).

## Task
Derive the Requirements Traceability Matrix (RTM) from the PRD.

## Output Format

Write the working copy to:
`.IDE_Plans/velpari/runs/<run-id>/rtm/RTM_<projectName>.md`

The published copy (after `/velpari-approve`) goes to:
`Doc/RTM_<projectName>.md`

Structure:
```markdown
# Requirements Traceability Matrix — <projectName>

## Traceability

| Req ID | Description | Design Element | Implementation / Helper Function | Test Case(s) | Status |
|---|---|---|---|---|---|
| FR-01 | <desc> | <module> | HF-NN | TC-001, TC-002 | approved |
| FR-02 | <desc> | <module> | (none) | TC-003 | approved |
| NFR-01 | <desc> | <module> | (none) | TC-004 | approved |
| ... | | | | | |
```

## Helper Function Dedup (FR-27, FR-30)

Each row that references a helper function uses the `HF-NN` id from the
PRD's `## Helper Functions` section. Dedup key is `name + file path`.

If the PRD introduces a new helper function, it must also be referenced
from at least one FR-N row. Helper functions that are not referenced from
any FR-N are flagged in the doctor report.

## Coverage Check

Every FR-N and NFR-N in the PRD must appear in the RTM. Every test case
listed must trace to at least one FR-N or NFR-N. Drift is a defect.

## Preview Gate
After writing the working copy, render preview + confirm before publishing.
