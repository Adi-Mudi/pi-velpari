# velpari-testplan — Stage Prompt

## Source
Read `Doc/pseudocode_<projectName>.md` (gate check — refuse to run if missing).

## Task
Produce the test plan and the test cases table. Every test case must trace back to an RTM requirement.

## Output Format

This stage writes **two** working copies:

1. `.IDE_Plans/velpari/runs/<run-id>/testplan/test-plan_<projectName>.md`
2. `.IDE_Plans/velpari/runs/<run-id>/testplan/test-cases_<projectName>.md`

After `/velpari-approve`, both publish to `Doc/test-plan_<projectName>.md` and `Doc/test-cases_<projectName>.md`.

### Test Plan Structure

```markdown
# Test Plan — <projectName>

## 1. Test Strategy
<unit, integration, e2e, manual>

## 2. Test Types

| Type | Scope | Tools | Owner |
|---|---|---|---|
| Unit | <scope> | <tools> | <owner> |
| Integration | <scope> | <tools> | <owner> |
| E2E | <scope> | <tools> | <owner> |

## 3. Test Environment
<CI, local, staging>

## 4. Coverage Targets
<unit: 80%, integration: 60%, etc.>

## 5. Entry / Exit Criteria
- Entry: <conditions>
- Exit: <conditions>

## 6. Risks
<test risks + mitigations>
```

### Test Cases Structure

```markdown
# Test Cases — <projectName>

| TC ID | Name | FR Ref | Steps | Expected |
|---|---|---|---|---|
| TC-001 | <name> | FR-NN | 1. ... 2. ... | <expected> |
| TC-002 | <name> | FR-NN | ... | ... |
```

## Zero-Hallucination Rule (FR-22)
Every test case must reference an FR-N from the source RTM. Coverage gaps (FRs without tests) must be flagged.

## Preview Gate
After writing both working copies, render previews + confirm before publishing.
